/**
 * shaders/lib/noise.glsl.ts
 *
 * GLSL noise library, authored as a tagged template literal.
 *
 * WHY `.glsl.ts` AND NOT `.glsl`:
 *   • Zero build configuration — works identically under webpack and Turbopack. A raw-loader
 *     rule for `.glsl` has to be declared twice (once per bundler) and Turbopack's version
 *     needs an extra dependency.
 *   • Imports are type-checked. A typo in a filename is a compile error, not a runtime
 *     "shader compiled to empty string" that manifests as a black screen.
 *   • The `/* glsl *\/` comment tag lights up syntax highlighting in VS Code via the
 *     `glsl-literal` extension, so you lose nothing editorially.
 *
 * Contents:
 *   snoise(vec3)  — Ian McEwan / Ashima Arts simplex noise. The de-facto standard: no
 *                   texture lookups, no dependent reads, ~40 ALU ops. Range roughly [-1, 1].
 *   fbm(vec3)     — fractal Brownian motion over snoise. Constant loop bound so the compiler
 *                   fully unrolls it (GLSL ES 1.0 requires it, and it's faster anyway).
 *   ridged(vec3)  — inverted-absolute FBM. Produces crease/vein structures rather than blobs.
 *   curl(vec3)    — divergence-free vector field. Used by the particle system: because curl
 *                   noise has zero divergence, advected particles never bunch up or thin
 *                   out, which is what makes the field read as a fluid instead of as drift.
 */

export const noiseGLSL = /* glsl */ `
// ---------------------------------------------------------------------------
// Simplex noise 3D — Ian McEwan, Ashima Arts (MIT). Public-domain-equivalent.
// ---------------------------------------------------------------------------
vec3 mod289_v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289_v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute289(vec4 x) { return mod289_v4(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner of the simplex cell.
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  // Determine which of the two possible tetrahedra we are in, and the other corners.
  vec3 g  = step(x0.yzx, x0.xyz);
  vec3 l  = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  // Hash the four corners into gradient indices.
  i = mod289_v3(i);
  vec4 p = permute289(
             permute289(
               permute289(i.z + vec4(0.0, i1.z, i2.z, 1.0))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  // Gradients: 7x7 points on a square, folded onto an octahedron.
  float n_ = 0.142857142857; // 1/7
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  // Normalise the gradients (cheap rational approximation of inversesqrt).
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  // Radially-symmetric falloff, then blend the four corner contributions.
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// ---------------------------------------------------------------------------
// Fractal Brownian motion.
//
// FBM_OCTAVES is a #define rather than a uniform on purpose: GLSL ES 1.0 requires
// compile-time-constant loop bounds, and a fully unrolled loop avoids the branch
// divergence that would otherwise cost more than the octave it saves. The canvas picks
// the octave count per device tier by compiling a different shader variant.
// ---------------------------------------------------------------------------
#ifndef FBM_OCTAVES
  #define FBM_OCTAVES 3
#endif

float fbm(vec3 p, float lacunarity, float gain) {
  float sum = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  // Rotating the sample point each octave breaks up the axis-aligned grid artefacts
  // that stacked simplex octaves otherwise produce.
  const mat3 rot = mat3(
    0.00,  0.80,  0.60,
   -0.80,  0.36, -0.48,
   -0.60, -0.48,  0.64
  );
  vec3 q = p;
  for (int i = 0; i < FBM_OCTAVES; i++) {
    sum += amp * snoise(q * freq);
    q = rot * q;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum;
}

/** Convenience overload with the values that look right for organic surfaces. */
float fbm(vec3 p) { return fbm(p, 2.0, 0.5); }

// ---------------------------------------------------------------------------
// Ridged multifractal. 1 - |noise| inverts the zero-crossings into sharp creases, so
// this produces veins and folds where plain FBM produces lumps. Mixed in at low weight
// it is what stops the blob reading as "a sphere with bumps".
// ---------------------------------------------------------------------------
float ridged(vec3 p, float lacunarity, float gain) {
  float sum = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < FBM_OCTAVES; i++) {
    float n = 1.0 - abs(snoise(p * freq));
    sum += amp * n * n;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Curl noise — the gradient-orthogonal (divergence-free) field derived from three
// offset noise samples. Divergence-free is the whole point: particles advected through
// it conserve density, so the field looks like an incompressible fluid.
//
// Cost: 6 snoise calls. Fine for a few thousand points on the GPU; do not call it
// per-vertex on a 46k-vertex mesh.
// ---------------------------------------------------------------------------
vec3 curl(vec3 p, float eps) {
  float n1, n2;
  vec3 dx = vec3(eps, 0.0, 0.0);
  vec3 dy = vec3(0.0, eps, 0.0);
  vec3 dz = vec3(0.0, 0.0, eps);

  // Two independent potential fields, offset so they decorrelate.
  vec3 pA = p;
  vec3 pB = p + vec3(31.416, 17.234, 47.853);

  n1 = snoise(pA + dy); n2 = snoise(pA - dy);
  float a = (n1 - n2) / (2.0 * eps);
  n1 = snoise(pB + dz); n2 = snoise(pB - dz);
  float b = (n1 - n2) / (2.0 * eps);

  n1 = snoise(pB + dx); n2 = snoise(pB - dx);
  float c = (n1 - n2) / (2.0 * eps);
  n1 = snoise(pA + dz); n2 = snoise(pA - dz);
  float d = (n1 - n2) / (2.0 * eps);

  n1 = snoise(pA + dx); n2 = snoise(pA - dx);
  float e = (n1 - n2) / (2.0 * eps);
  n1 = snoise(pB + dy); n2 = snoise(pB - dy);
  float f = (n1 - n2) / (2.0 * eps);

  return normalize(vec3(a - b, c - d, e - f));
}
`;

/**
 * Small maths helpers shared by both stages. Kept separate from the noise block so a
 * shader that needs `saturate` doesn't pay for 200 lines of simplex it never calls —
 * the GLSL compiler dead-strips unused functions, but compile time is real on mobile.
 */
export const mathGLSL = /* glsl */ `
#define PI 3.141592653589793
#define TAU 6.283185307179586

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec3  saturate(vec3 x)  { return clamp(x, 0.0, 1.0); }

/** Remap from one range to another, clamped. */
float remap(float v, float inMin, float inMax, float outMin, float outMax) {
  return outMin + (saturate((v - inMin) / (inMax - inMin))) * (outMax - outMin);
}

/** Smoothstep-based pulse: 1.0 in the middle of [edge0, edge1], 0.0 outside. */
float pulse(float edge0, float edge1, float x) {
  return smoothstep(edge0, edge1, x) - smoothstep(edge1, edge1 + (edge1 - edge0), x);
}

/** Rotate a point around an arbitrary axis. Rodrigues' rotation formula. */
vec3 rotateAxis(vec3 p, vec3 axis, float angle) {
  return mix(dot(axis, p) * axis, p, cos(angle)) + cross(axis, p) * sin(angle);
}

/**
 * Any vector perpendicular to v. The branch avoids the degenerate case where v is
 * parallel to the axis you happened to pick — a classic source of NaN normals at the
 * poles of a displaced sphere.
 */
vec3 orthogonal(vec3 v) {
  return normalize(
    abs(v.x) > abs(v.z)
      ? vec3(-v.y, v.x, 0.0)
      : vec3(0.0, -v.z, v.y)
  );
}

/**
 * Inigo Quilez's cosine palette. Four vec3 coefficients describe a full smooth gradient,
 * which is dramatically cheaper and smoother than sampling a gradient texture, and it
 * never bands.
 */
vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(TAU * (c * t + d));
}

/**
 * Interleaved gradient noise — Jorge Jimenez. One MAD and a fract; the best
 * quality-per-instruction dither available. Used to break up gradient banding, which is
 * highly visible on the large flat colour fields this design uses.
 */
float igNoise(vec2 uv) {
  return fract(52.9829189 * fract(dot(uv, vec2(0.06711056, 0.00583715))));
}
`;
