'use client';

import { shaderMaterial } from '@react-three/drei';
import { extend, type ThreeElement } from '@react-three/fiber';
import * as THREE from 'three';

import { mathGLSL, noiseGLSL } from './lib/noise.glsl';

/**
 * ParticleMaterial — the atmospheric dust field around the blob.
 *
 * Kept in one file (shader strings included) rather than split across a `shaders/particles/`
 * directory because it is ~70 lines of GLSL. The fluid material earns its own directory; this
 * does not, and a three-file indirection for one small shader costs more in navigation than it
 * saves in tidiness.
 *
 * =========================================================================
 * WHY A CUSTOM SHADER AND NOT `<pointsMaterial />`
 * =========================================================================
 * `PointsMaterial` gives you a square sprite of constant colour with optional distance
 * attenuation. Everything that makes a particle field look like atmosphere rather than confetti
 * is missing from it:
 *
 *   • Per-particle drift through a noise field, so the cloud has internal currents.
 *   • Depth-faded alpha, so particles dissolve into the background instead of ending abruptly.
 *   • Radial falloff inside each point, so they read as soft motes rather than hard pixels.
 *   • Per-particle size and colour variation, driven by an attribute.
 *
 * All four are a handful of GLSL lines. Doing it in JS instead would mean rewriting a buffer of
 * thousands of positions on the CPU every frame — the single most common reason particle fields
 * tank frame rate.
 */

const particleVertexShader = /* glsl */ `
  ${mathGLSL}
  ${noiseGLSL}

  // Per-particle randomness, uploaded once at build time.
  attribute float aScale;    // 0..1 size multiplier
  attribute float aSeed;     // 0..1 phase offset, decorrelates the drift
  attribute float aTint;     // 0..1 mix position between the two palette colours

  uniform float uTime;
  uniform float uSize;        // Base point size, in world units before projection
  uniform float uDrift;       // Amplitude of the noise-field displacement
  uniform float uSpread;      // Radius of the shell the particles occupy
  uniform float uScroll;      // 0..1 document scroll
  uniform float uVelocity;    // 0..1 cursor speed
  uniform vec2  uPointer;     // Cursor in NDC-ish space, for the repulsion field
  uniform float uPointerStrength;
  uniform float uReveal;
  uniform float uPixelRatio;

  varying float vAlpha;
  varying float vTint;

  void main() {
    vec3 pos = position;

    // --- Drift ------------------------------------------------------------
    // Three decorrelated noise samples give a divergence-ish flow without paying for a real
    // curl (which needs six samples). At this scale the difference is invisible.
    float t = uTime * 0.08 + aSeed * TAU;
    vec3 flow = vec3(
      snoise(vec3(pos.xy * 0.35, t)),
      snoise(vec3(pos.yz * 0.35, t + 11.7)),
      snoise(vec3(pos.zx * 0.35, t + 23.3))
    );
    pos += flow * uDrift * (0.4 + aScale * 0.6);

    // --- Scroll: the field falls away and spreads as the page descends -----
    pos.y -= uScroll * 2.2;
    pos *= 1.0 + uScroll * 0.35;

    // --- Cursor repulsion -------------------------------------------------
    // Screen-space-ish, using xy only. A correct 3D repulsion needs the cursor's world ray and
    // reads as almost identical here, because the field is a thin shell around the camera axis.
    vec2 toPointer = pos.xy - uPointer * uSpread;
    float d = length(toPointer);
    float push = (1.0 - smoothstep(0.0, uSpread * 0.55, d)) * uPointerStrength;
    pos.xy += normalize(toPointer + 1e-5) * push * 0.5;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // --- Size -------------------------------------------------------------
    // Perspective attenuation: divide by view-space depth so distant motes shrink. The
    // uPixelRatio factor keeps apparent size constant across DPRs — gl_PointSize is in device
    // pixels, so without it particles are half-size on a retina display.
    float size = uSize * (0.35 + aScale) * uPixelRatio;
    // Fast cursor movement smears the field slightly larger. Cheap, and it ties the particles
    // to the same gesture the blob is responding to.
    size *= 1.0 + uVelocity * 0.4;
    gl_PointSize = size * (1.0 / max(-mvPosition.z, 0.001));

    // --- Alpha ------------------------------------------------------------
    // Fade both very near and very far particles. Near ones would otherwise fill the screen
    // with a single blown-out sprite as the camera passes through the shell.
    float depthFade = smoothstep(0.0, 2.0, -mvPosition.z) *
                      (1.0 - smoothstep(6.0, 13.0, -mvPosition.z));
    vAlpha = depthFade * uReveal * (0.25 + aScale * 0.75);
    vTint = aTint;
  }
`;

const particleFragmentShader = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;

  varying float vAlpha;
  varying float vTint;

  void main() {
    // gl_PointCoord is 0..1 across the sprite. Distance from centre gives a radial mask.
    float d = length(gl_PointCoord - 0.5);

    // Discard outside the circle before doing any more work. On a field of thousands of
    // overlapping additive sprites the wasted fragments are the actual cost, not the maths.
    if (d > 0.5) discard;

    // Squared falloff, not linear: linear leaves a visible hard-ish edge because the eye is
    // sensitive to discontinuities in the first derivative of brightness.
    float falloff = 1.0 - smoothstep(0.0, 0.5, d);
    falloff *= falloff;

    vec3 color = mix(uColorA, uColorB, vTint);

    gl_FragColor = vec4(color, falloff * vAlpha * uOpacity);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const ParticleMaterialImpl = shaderMaterial(
  {
    uTime: 0,
    uSize: 26,
    uDrift: 0.35,
    uSpread: 4,
    uScroll: 0,
    uVelocity: 0,
    uPointer: new THREE.Vector2(0, 0),
    uPointerStrength: 0,
    uReveal: 0,
    uPixelRatio: 1,
    uColorA: new THREE.Color('#8C7BFF'),
    uColorB: new THREE.Color('#C8FF3D'),
    uOpacity: 0.85,
  },
  particleVertexShader,
  particleFragmentShader,
  (material) => {
    if (!material) return;
    material.transparent = true;
    /**
     * Additive blending, and therefore `depthWrite: false`.
     *
     * Additive particles that write depth occlude each other, so the field's density becomes
     * dependent on draw order — and since three.js does not sort points within a single
     * geometry, that order is effectively arbitrary. The result flickers as the camera moves.
     * Disabling depth write makes the field commutative, which is what "atmosphere" requires.
     * Depth *test* stays on so the blob still occludes particles behind it.
     */
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.depthTest = true;
    material.toneMapped = true;
  }
);

extend({ ParticleMaterial: ParticleMaterialImpl });

declare module '@react-three/fiber' {
  interface ThreeElements {
    particleMaterial: ThreeElement<typeof ParticleMaterialImpl>;
  }
}

export type ParticleMaterialInstance = InstanceType<typeof ParticleMaterialImpl> & {
  uTime: number;
  uSize: number;
  uDrift: number;
  uSpread: number;
  uScroll: number;
  uVelocity: number;
  uPointer: THREE.Vector2;
  uPointerStrength: number;
  uReveal: number;
  uPixelRatio: number;
  uColorA: THREE.Color;
  uColorB: THREE.Color;
  uOpacity: number;
};
