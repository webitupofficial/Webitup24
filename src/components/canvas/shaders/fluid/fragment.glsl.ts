import { mathGLSL } from '../lib/noise.glsl';

/**
 * shaders/fluid/fragment.glsl.ts
 *
 * Fragment stage for the hero blob.
 *
 * The look is built in five layers, cheapest first:
 *   1. Base gradient    — three palette colours ramped by displacement depth.
 *   2. Iridescence      — a cosine palette indexed by view angle, added at the grazing edges.
 *   3. Lighting         — two directional lights, Blinn-Phong specular, hemisphere ambient.
 *   4. Fresnel rim      — the edge glow that sells "wet". Also the main readability device:
 *                         it defines the silhouette against a near-black page.
 *   5. Pointer hot spot — a bright pool that tracks the cursor, tied to the vertex bulge.
 *
 * Then: dither before output. On large smooth gradients over a dark background, 8-bit
 * quantisation banding is extremely visible — interleaved gradient noise at ±1/255 removes
 * it for about three instructions, and is the single best-value line in this file.
 *
 * COLOUR MANAGEMENT: all maths here is in linear space. The two three.js include directives
 * at the end handle tone mapping and the linear→sRGB transfer. They must be last, and they
 * must operate on gl_FragColor. Omitting them is the most common cause of a custom
 * ShaderMaterial looking washed out or over-saturated next to a MeshStandardMaterial.
 */
export const fluidFragmentShader = /* glsl */ `
${mathGLSL}

// ---------------------------------------------------------------------------
// Uniforms
// ---------------------------------------------------------------------------
uniform vec3  uColorA;          // Deep / shadow tone.
uniform vec3  uColorB;          // Mid tone — the dominant read.
uniform vec3  uColorC;          // Highlight / accent tone.

uniform float uFresnelPower;    // Rim tightness. 2 = broad wash, 6 = thin bright edge.
uniform float uFresnelIntensity;
uniform float uIridescence;     // 0..1 strength of the thin-film effect.
uniform float uRoughness;       // Drives specular lobe width.
uniform float uEnvIntensity;    // Fake environment contribution.
uniform float uGrain;           // Film grain, on top of the dither.
uniform float uOpacity;
uniform float uReveal;          // Shared with the vertex stage — fades colour in on intro.

uniform vec3  uLightDirA;
uniform vec3  uLightDirB;
uniform vec3  uLightColorB;

uniform float uTime;
uniform vec2  uResolution;      // For resolution-independent grain.

// ---------------------------------------------------------------------------
// Varyings (must match vertex.glsl.ts exactly)
// ---------------------------------------------------------------------------
varying vec3  vNormal;
varying vec3  vWorldNormal;
varying vec3  vViewPosition;
varying vec3  vObjectPosition;
varying float vDisplacement;
varying float vPointerInfluence;

void main() {
  // Normalising in the fragment stage is required, not optional: varyings are linearly
  // interpolated across the triangle, and the interpolation of two unit vectors is not a
  // unit vector. Skipping it makes specular highlights flicker along edges.
  vec3 N = normalize(vNormal);
  vec3 V = normalize(-vViewPosition);           // Surface → eye, view space.
  float NdotV = saturate(dot(N, V));

  // -------------------------------------------------------------------------
  // 1. Base gradient
  //
  // Two-stage mix rather than one: a single mix between three colours via smoothstep
  // produces a visible kink at the midpoint. Ramping A→B over the lower half and B→C over
  // the upper half, both with smoothstep, keeps the derivative continuous.
  // -------------------------------------------------------------------------
  float depth = vDisplacement;
  vec3 base = mix(uColorA, uColorB, smoothstep(0.0, 0.62, depth));
  base = mix(base, uColorC, smoothstep(0.55, 1.0, depth));

  // -------------------------------------------------------------------------
  // 2. Fresnel
  //
  // Schlick-style approximation. Computed once and reused by the rim, the iridescence and
  // the environment term — they are all view-angle-driven, and sharing the term is both
  // cheaper and keeps them visually coherent.
  // -------------------------------------------------------------------------
  float fresnel = pow(1.0 - NdotV, uFresnelPower);

  // -------------------------------------------------------------------------
  // 3. Iridescence
  //
  // A thin-film approximation: index a cosine palette by view angle plus a slow drift.
  // Real thin-film interference would need a wavelength-dependent phase term; this is
  // visually indistinguishable at these thicknesses and costs one cos().
  // Weighted by fresnel so it only appears at grazing angles, which is where the real
  // effect lives — applying it flat across the surface is what makes fake iridescence
  // look like an oil slick decal.
  // -------------------------------------------------------------------------
  float iriT = fresnel * 1.4 + depth * 0.35 + uTime * 0.03;
  vec3 iridescent = cosPalette(
    iriT,
    vec3(0.5, 0.5, 0.5),
    vec3(0.5, 0.5, 0.5),
    vec3(1.0, 1.0, 1.0),
    vec3(0.0, 0.33, 0.67)
  );
  base = mix(base, base * 0.35 + iridescent * 0.85, uIridescence * fresnel);

  // -------------------------------------------------------------------------
  // 4. Lighting — two directional lights + hemisphere ambient
  //
  // Deliberately not a full PBR model. This surface is stylised: what it needs is a clear
  // form-defining key, a coloured fill to keep the shadows from going dead, and a tight
  // specular to read as wet. A Cook-Torrance BRDF would cost 4× and look worse here.
  // -------------------------------------------------------------------------
  vec3 L1 = normalize(uLightDirA);
  vec3 L2 = normalize(uLightDirB);

  // Wrapped diffuse: remapping N·L from [-1,1] to [0,1] rather than clamping at 0 lets
  // light bleed past the terminator, approximating subsurface scattering. Without it, a
  // blob this smooth develops a hard, plastic-looking terminator line.
  float diff1 = pow(saturate(dot(N, L1) * 0.5 + 0.5), 1.6);
  float diff2 = saturate(dot(N, L2) * 0.5 + 0.5);

  // Blinn-Phong specular. Exponent derived from roughness so one artist-facing knob
  // controls the lobe. +1 avoids a zero exponent when roughness hits 1.
  vec3 H = normalize(L1 + V);
  float specPower = mix(180.0, 8.0, saturate(uRoughness));
  float spec = pow(saturate(dot(N, H)), specPower) * (1.0 - uRoughness * 0.7);

  // Hemisphere ambient: sky tint from above, bounce tint from below. Two lerps, and it
  // does more for perceived realism than any amount of extra specular.
  float hemi = vWorldNormal.y * 0.5 + 0.5;
  vec3 ambient = mix(uColorA * 0.25, uColorB * 0.45, hemi);

  vec3 lit = base * (diff1 * 0.85 + 0.15)
           + base * uLightColorB * diff2 * 0.35
           + ambient
           + vec3(spec) * 1.6;

  // -------------------------------------------------------------------------
  // 5. Environment approximation
  //
  // Stands in for a real cubemap. Reflecting the view vector and using the result's Y to
  // pick a vertical gradient captures the only thing an env map contributes that the eye
  // actually notices on a curved surface: a bright sky above, dark ground below. Saves
  // loading and decoding an HDR, which on mobile is a 2–4MB download and a stall.
  // -------------------------------------------------------------------------
  vec3 R = reflect(-V, N);
  float envGrad = R.y * 0.5 + 0.5;
  vec3 env = mix(uColorA * 0.4, uColorC * 1.1, pow(envGrad, 1.5));
  lit += env * fresnel * uEnvIntensity;

  // -------------------------------------------------------------------------
  // 6. Rim + pointer hot spot
  // -------------------------------------------------------------------------
  lit += uColorC * fresnel * uFresnelIntensity;

  // The hot spot uses the same influence varying that drove the vertex bulge, so the
  // bright pool sits exactly on the deformation instead of near it. Cubed to keep it tight.
  float hot = vPointerInfluence * vPointerInfluence * vPointerInfluence;
  lit += uColorC * hot * 0.9;
  // A touch of white at the very centre reads as a wet specular pool.
  lit += vec3(1.0) * pow(vPointerInfluence, 8.0) * 0.35;

  // -------------------------------------------------------------------------
  // 7. Grain + dither, then output
  // -------------------------------------------------------------------------
  // gl_FragCoord is in device pixels, so grain stays a constant *screen* size across DPRs
  // instead of getting finer on retina — which is what you want, since it is a film
  // artefact, not a surface property.
  float n = igNoise(gl_FragCoord.xy + fract(uTime) * 137.0);
  lit += (n - 0.5) * uGrain;

  // Dither at exactly ±0.5/255 — the quantisation step. Enough to break banding,
  // not enough to be perceptible as noise.
  lit += (igNoise(gl_FragCoord.xy) - 0.5) * (1.0 / 255.0);

  // Fade in from black on intro alongside the geometric reveal.
  lit *= uReveal;

  gl_FragColor = vec4(lit, uOpacity);

  // ---- three.js output chunks --------------------------------------------
  // These MUST come last and MUST operate on gl_FragColor.
  //   tonemapping_fragment → applies renderer.toneMapping (ACES Filmic in our setup)
  //   colorspace_fragment  → linear → renderer.outputColorSpace (sRGB)
  // three's WebGLProgram runs resolveIncludes() on ShaderMaterial sources too, so these
  // expand correctly here — this is not limited to built-in materials.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
