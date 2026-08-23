import { mathGLSL, noiseGLSL } from '../lib/noise.glsl';

/**
 * shaders/fluid/vertex.glsl.ts
 *
 * Vertex stage for the hero blob.
 *
 * Responsibilities, in evaluation order:
 *   1. Build a displacement field from rotated FBM + a ridged component.
 *   2. Add a local pointer bulge that follows the cursor across the surface.
 *   3. Add cursor-velocity-driven turbulence and a directional shear.
 *   4. Apply a scroll-driven twist so the silhouette changes as the page moves.
 *   5. Recompute normals from the *displaced* surface.
 *
 * Step 5 is the one people skip, and it is the difference between this reading as a lit
 * liquid surface and reading as a sphere with a noisy texture. The incoming `normal`
 * attribute describes the undisplaced sphere; once we move vertices by up to ~40% of the
 * radius it is meaningless. So we sample the displacement field at two nearby points on the
 * surface, form a local tangent basis, and cross the resulting edge vectors.
 *
 * Cost: 3 evaluations of the displacement field per vertex (P + two neighbours) ≈ 9 simplex
 * calls at 3 octaves. On a 40-subdivision icosphere (~40k verts) that is ~360k noise
 * evaluations per frame — comfortably inside the vertex budget of 2019-era integrated
 * graphics, which is the floor we target. FBM_OCTAVES is lowered to 2 on the low tier.
 *
 * NOTE ON STRUCTURE: the noise/math libraries are interpolated in here rather than
 * concatenated by the caller, so this export is a complete, independently-compilable shader.
 * That means a shader-validation test can compile it in isolation.
 */
export const fluidVertexShader = /* glsl */ `
${mathGLSL}
${noiseGLSL}

// ---------------------------------------------------------------------------
// Uniforms
// ---------------------------------------------------------------------------
uniform float uTime;
uniform float uSpeed;           // Time multiplier — animation tempo.
uniform float uDistort;         // Base displacement amplitude, in object-space units.
uniform float uFrequency;       // Noise frequency. Higher = smaller, busier features.
uniform float uRidgeMix;        // 0..1 blend of ridged noise over plain FBM.

uniform vec3  uPointer;         // Cursor direction from the blob centre, OBJECT space.
uniform float uPointerStrength; // 0..1 presence. Eases to 0 when the cursor leaves.
uniform float uPointerRadius;   // Angular falloff radius of the bulge.
uniform float uPointerPush;     // Signed amplitude. Negative dents instead of bulging.

uniform float uVelocity;        // Smoothed |cursor velocity|, normalised 0..1.
uniform vec2  uVelocityVec;     // Smoothed cursor direction, for directional shear.

uniform float uScroll;          // Page scroll progress 0..1.
uniform float uScrollVelocity;  // Signed, normalised. Drives momentary squash/stretch.
uniform float uTwist;           // Max twist angle in radians at full scroll.

uniform float uReveal;          // 0..1 intro reveal. Grows displacement from a clean sphere.
uniform float uSeed;            // Per-instance offset so multiple blobs differ.

// ---------------------------------------------------------------------------
// Varyings
// ---------------------------------------------------------------------------
varying vec3  vNormal;           // Recomputed, VIEW space.
varying vec3  vWorldNormal;      // Recomputed, WORLD space (for the env reflection term).
varying vec3  vViewPosition;     // Fragment position in view space.
varying vec3  vObjectPosition;   // Undisplaced object position — stable texturing coords.
varying float vDisplacement;     // Displacement remapped to 0..1. Drives the colour ramp.
varying float vPointerInfluence; // 0..1 proximity to the cursor. Drives the hot spot.

// ---------------------------------------------------------------------------
// Pointer proximity.
//
// Split out from the displacement field because it is needed as a varying, and a varying
// must be written exactly once from main(). Writing it inside displacementAt() — which we
// call four times — would leave whichever call happened to run last, which is a genuinely
// nasty bug: it compiles, it looks almost right, and the highlight lags the cursor by one
// neighbour-sample offset.
//
// Uses angular distance between normalised directions, so the falloff is uniform across the
// surface regardless of how far the local radius has been displaced.
// ---------------------------------------------------------------------------
float pointerInfluenceAt(vec3 p) {
  float angular = distance(normalize(p), normalize(uPointer));
  return 1.0 - smoothstep(0.0, uPointerRadius, angular);
}

// ---------------------------------------------------------------------------
// The displacement field.
//
// Everything that moves a vertex must live in here. Anything applied only in main() would
// not be seen by the normal reconstruction and would light incorrectly.
// ---------------------------------------------------------------------------
float displacementAt(vec3 p) {
  float t = uTime * uSpeed;

  // --- Base organic field -------------------------------------------------
  // Offsetting by time (rather than scaling by it) scrolls the noise field through the
  // sphere, which reads as flow. Scaling would read as pulsing.
  vec3 samplePos = p * uFrequency + vec3(uSeed, t * 0.35, t * 0.15);
  float base = fbm(samplePos);

  // --- Ridged creases -----------------------------------------------------
  // Different frequency AND offset, so creases don't land on the FBM features (which would
  // just deepen the existing lumps instead of adding new structure).
  float ridge = ridged(p * uFrequency * 1.7 + vec3(t * 0.2, uSeed, -t * 0.1), 2.0, 0.5);
  // ridged() is ~0..1; recentre so the mix does not shift the mean radius.
  float field = mix(base, (ridge - 0.5) * 1.6, uRidgeMix);

  // --- Cursor-velocity turbulence -----------------------------------------
  // A high-frequency octave gated entirely by cursor speed. A stationary cursor means this
  // term is exactly zero, so the surface visibly settles — motion that responds to you and
  // then rests reads as alive; constant motion reads as a screensaver.
  float turbulence = snoise(p * uFrequency * 3.4 + vec3(t * 1.6, -t * 1.1, uSeed)) * uVelocity;

  // --- Pointer bulge ------------------------------------------------------
  float influence = pointerInfluenceAt(p);
  // Squared for a tighter, more liquid peak than the raw smoothstep gives.
  float bulge = influence * influence * uPointerStrength * uPointerPush;

  // --- Scroll squash/stretch ----------------------------------------------
  // Driven by scroll *velocity*, not position, so it reacts to flicks and settles when the
  // scroll settles. Scaling by p.y makes it a stretch about the equator rather than a
  // uniform scale.
  float stretch = uScrollVelocity * 0.35 * p.y;

  return (field * uDistort) + (turbulence * uDistort * 0.55) + bulge + stretch;
}

/**
 * Full object-space position of a surface point after displacement.
 * The twist and shear are geometric, so they live here where the normal reconstruction
 * can see them.
 */
vec3 displacedPosition(vec3 p, vec3 n) {
  // For a unit sphere the normal is the normalised position, so this is a radial offset.
  float d = displacementAt(p);
  vec3 displaced = p + n * d * uReveal;

  // Twist about Y with the angle scaling by height — a shear deformation.
  float twistAngle = uScroll * uTwist * displaced.y;
  displaced = rotateAxis(displaced, vec3(0.0, 1.0, 0.0), twistAngle);

  // Directional lean into the cursor drag. Attenuated toward the silhouette edges
  // (1 - |z|) so the outline doesn't visibly slide off the geometry.
  displaced.xy += uVelocityVec * uVelocity * 0.12 * (1.0 - abs(displaced.z));

  return displaced;
}

void main() {
  vObjectPosition = position;

  // Recomputed rather than trusting the 'normal' attribute: guards against geometry whose
  // normals were never computed, a common defect in exported .glb files.
  vec3 baseNormal = normalize(position);

  // ---- Displaced position ------------------------------------------------
  vec3 P = displacedPosition(position, baseNormal);

  // ---- Normal reconstruction ---------------------------------------------
  // EPS balances normal accuracy against fp32 cancellation in the subtractions below.
  // 0.015 on a unit sphere is large enough to stay clear of precision loss and small
  // enough to sample the same noise feature.
  const float EPS = 0.015;
  vec3 tangent   = orthogonal(baseNormal);
  vec3 bitangent = normalize(cross(baseNormal, tangent));

  // Project the offset neighbours back onto the unit sphere before displacing. Skipping
  // this leaves them inside the sphere and biases every normal inward — the surface ends
  // up looking subtly deflated.
  vec3 neighbourA = normalize(position + tangent   * EPS);
  vec3 neighbourB = normalize(position + bitangent * EPS);

  vec3 A = displacedPosition(neighbourA, neighbourA);
  vec3 B = displacedPosition(neighbourB, neighbourB);

  // cross(tangent, bitangent) == baseNormal by construction, so this comes out facing
  // outward and needs no flip.
  vec3 newNormal = normalize(cross(A - P, B - P));

  // ---- Varyings ----------------------------------------------------------
  // Written exactly once each, from main().
  vPointerInfluence = pointerInfluenceAt(position);

  // Normalise the displacement by its own amplitude so the colour ramp is stable when an
  // editor changes uDistort. max() guards a divide-by-zero when distortion is animated to 0.
  vDisplacement = saturate(displacementAt(position) / max(uDistort, 0.0001) * 0.5 + 0.5);

  vec4 worldPosition = modelMatrix * vec4(P, 1.0);
  vec4 viewPosition  = viewMatrix * worldPosition;

  vNormal       = normalize(normalMatrix * newNormal);
  vWorldNormal  = normalize(mat3(modelMatrix) * newNormal);
  vViewPosition = viewPosition.xyz;

  gl_Position = projectionMatrix * viewPosition;
}
`;
