'use client';

import { shaderMaterial } from '@react-three/drei';
import { extend, type ThreeElement } from '@react-three/fiber';
import * as THREE from 'three';

import { fluidFragmentShader } from './fluid/fragment.glsl';
import { fluidVertexShader } from './fluid/vertex.glsl';

/**
 * FluidMaterial — the typed, R3F-registered material for the hero blob.
 *
 * `shaderMaterial` from drei does three things for us:
 *   • Builds a ShaderMaterial subclass with the uniform defaults below.
 *   • Generates getters/setters for each uniform, so `material.uTime = 1` works and we can
 *     mutate uniforms from useFrame without touching `material.uniforms.uTime.value`.
 *   • Assigns a stable `.key`, which we spread onto the JSX element. That key is what makes
 *     hot module replacement re-instantiate the material when a shader file changes —
 *     without it you edit GLSL, save, and see the old shader until a full reload.
 *
 * IMPORTANT: the default values here are not decorative. They define the uniform *types*
 * that three.js infers when building the program. A uniform declared with `0` becomes a
 * float; passing a Vector3 to it later silently fails. Every default below matches its GLSL
 * declaration exactly.
 */
export const FluidMaterialImpl = shaderMaterial(
  {
    // --- Animation ---------------------------------------------------------
    uTime: 0,
    uSpeed: 0.28,
    uSeed: 0,
    uReveal: 0,

    // --- Displacement ------------------------------------------------------
    uDistort: 0.42,
    uFrequency: 1.15,
    uRidgeMix: 0.25,

    // --- Pointer -----------------------------------------------------------
    // Initialised pointing away from the camera so the bulge starts off-screen rather than
    // sitting in the middle of the blob on first paint.
    uPointer: new THREE.Vector3(0, 0, -1),
    uPointerStrength: 0,
    uPointerRadius: 0.9,
    uPointerPush: 0.34,

    // --- Cursor velocity ---------------------------------------------------
    uVelocity: 0,
    uVelocityVec: new THREE.Vector2(0, 0),

    // --- Scroll ------------------------------------------------------------
    uScroll: 0,
    uScrollVelocity: 0,
    uTwist: 1.1,

    // --- Colour ------------------------------------------------------------
    // THREE.Color parses hex in sRGB and — with ColorManagement enabled, which is the
    // three.js default since r152 — converts to linear-sRGB on assignment. So these are
        // already in the working colour space the shader expects. Do not "fix" them by
    // squaring the components.
    uColorA: new THREE.Color('#0A0A0F'),
    uColorB: new THREE.Color('#5B2BE8'),
    uColorC: new THREE.Color('#C8FF3D'),

    // --- Surface -----------------------------------------------------------
    uFresnelPower: 3.4,
    uFresnelIntensity: 0.85,
    uIridescence: 0.55,
    uRoughness: 0.22,
    uEnvIntensity: 0.6,
    uGrain: 0.035,
    uOpacity: 1,

    // --- Lighting ----------------------------------------------------------
    uLightDirA: new THREE.Vector3(0.6, 0.9, 0.7).normalize(),
    uLightDirB: new THREE.Vector3(-0.8, -0.3, 0.4).normalize(),
    uLightColorB: new THREE.Color('#3AA0FF'),

    uResolution: new THREE.Vector2(1, 1),
  },
  fluidVertexShader,
  fluidFragmentShader,
  /**
   * Constructor callback. Runs once per instance, before first render.
   */
  (material) => {
    if (!material) return;
    // Front side only. The blob is closed and opaque, so rendering backfaces is pure waste —
    // and with a displaced surface, self-intersections make double-sided rendering produce
    // visible artefacts where inverted backfaces poke through.
    material.side = THREE.FrontSide;
    // Opt in to the renderer's tone-mapping pipeline. Required for the
    // `#include <tonemapping_fragment>` at the end of the fragment shader to receive its
    // TONE_MAPPING define from WebGLProgram.
    material.toneMapped = true;
    material.transparent = false;
    material.depthWrite = true;
  }
);

extend({ FluidMaterial: FluidMaterialImpl });

/**
 * Type augmentation so `<fluidMaterial />` is a real, autocompleted JSX element with typed
 * uniform props rather than `any`.
 *
 * R3F v9 renamed this interface from `ThreeElements` on the global JSX namespace to a
 * module-scoped `ThreeElements` — declaring it on the old global JSX.IntrinsicElements is
 * the single most common R3F v8→v9 migration break.
 */
declare module '@react-three/fiber' {
  interface ThreeElements {
    fluidMaterial: ThreeElement<typeof FluidMaterialImpl>;
  }
}

/** Instance type, for typing the `useRef` that useFrame mutates. */
export type FluidMaterialInstance = InstanceType<typeof FluidMaterialImpl> & {
  uTime: number;
  uSpeed: number;
  uSeed: number;
  uReveal: number;
  uDistort: number;
  uFrequency: number;
  uRidgeMix: number;
  uPointer: THREE.Vector3;
  uPointerStrength: number;
  uPointerRadius: number;
  uPointerPush: number;
  uVelocity: number;
  uVelocityVec: THREE.Vector2;
  uScroll: number;
  uScrollVelocity: number;
  uTwist: number;
  uColorA: THREE.Color;
  uColorB: THREE.Color;
  uColorC: THREE.Color;
  uFresnelPower: number;
  uFresnelIntensity: number;
  uIridescence: number;
  uRoughness: number;
  uEnvIntensity: number;
  uGrain: number;
  uOpacity: number;
  uResolution: THREE.Vector2;
};
