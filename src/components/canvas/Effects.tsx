'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Noise,
  Vignette,
} from '@react-three/postprocessing';
import {
  BlendFunction,
  type ChromaticAberrationEffect,
  type BloomEffect,
} from 'postprocessing';
import { HalfFloatType } from 'three';

import { clampDelta, frameState } from '@/lib/store/frameState';
import { dampHalf } from '@/lib/three/damp';

/**
 * Effects — the post-processing stack.
 *
 * Rendered only when `postProcessingEnabled` is true, which `useCapabilities` sets exclusively
 * for `tier === 'high' && motion === 'full'`. Everything here is a full-screen pass; on an
 * integrated GPU the four passes below cost more than the entire scene render, and they are the
 * layer a visitor is least able to name as missing.
 *
 * =========================================================================
 * ORDER IS THE WHOLE DESIGN
 * =========================================================================
 * `EffectComposer` merges compatible effects into a single fragment shader and runs them in the
 * order given. That order is not cosmetic:
 *
 *   1. Bloom              — needs the raw HDR scene. Anything that shifts luminance before it
 *                           changes which pixels bloom.
 *   2. ChromaticAberration— a lens artefact, so it must come after the light has been gathered.
 *                           Before bloom, the fringing itself would bloom, which looks like a
 *                           broken display rather than a lens.
 *   3. Noise              — film grain sits on the final image. Before bloom it would be
 *                           amplified into sparkle.
 *   4. Vignette           — last. It is the physical edge of the frame; nothing is outside it.
 *
 * =========================================================================
 * WHY `frameBufferType={HalfFloatType}`
 * =========================================================================
 * Bloom thresholds on luminance. In an 8-bit buffer everything clamps at 1.0, so the shader's
 * bright speculars — which genuinely exceed 1.0 before tone mapping — are indistinguishable
 * from merely-white pixels, and the bloom either catches everything or nothing. A half-float
 * buffer preserves the overbright values and the threshold becomes meaningful. It costs 2 bytes
 * per channel more, which on a high-tier GPU is not the constraint.
 */

/** Base chromatic aberration, in UV units. Deliberately microscopic. */
const CA_BASE = 0.0006;

/**
 * Peak aberration under fast cursor or scroll movement.
 *
 * 0.0035 is ~3px of fringing at 1440p. It sounds like nothing; on screen it is the difference
 * between "there is a lens here" and "this looks like a 3D anaglyph". Every value above ~0.005
 * that you have seen in a demo was chosen to look good in a screenshot, not to be scrolled past
 * for forty seconds.
 */
const CA_PEAK = 0.0035;

export interface EffectsProps {
  /** Master switch. False renders nothing — not a disabled composer. */
  enabled?: boolean;
  /** Global multiplier from `siteSettings.motionDefaults.shaderIntensity`. */
  intensity?: number;
}

export function Effects({ enabled = true, intensity = 1 }: EffectsProps) {
  const caRef = useRef<ChromaticAberrationEffect>(null);
  const bloomRef = useRef<BloomEffect>(null);
  const local = useRef({ energy: 0 });

  useFrame((_state, rawDelta) => {
    const dt = clampDelta(rawDelta);
    const L = local.current;

    /**
     * A single "energy" scalar drives both reactive effects.
     *
     * Cursor speed and scroll speed both mean "the user is moving", and driving two effects from
     * two separate signals lets them disagree — you get a frame where the aberration is peaking
     * and the bloom is at rest, which reads as two unrelated glitches instead of one coherent
     * response. `max` rather than sum, so a fast scroll during a fast cursor move does not
     * double up into a value the clamps then flatten.
     */
    const target = Math.max(frameState.velocityMagnitude, Math.abs(frameState.scrollVelocity));
    // Asymmetric feel by design: the 280ms half-life is slow enough that the effect trails the
    // gesture, which is what makes it feel like inertia rather than a state change.
    L.energy = dampHalf(L.energy, Math.min(target, 1), 0.28, dt);

    const ca = caRef.current;
    if (ca) {
      const amount = (CA_BASE + L.energy * (CA_PEAK - CA_BASE)) * intensity;
      // `offset` is a Vector2 on the effect instance — mutate it, never reassign. Reassigning
      // breaks the uniform binding the composer established at compile time, and the effect
      // silently stops updating.
      ca.offset.set(amount, amount * 0.62);
    }

    const bloom = bloomRef.current;
    if (bloom) {
      // Bloom lifts slightly with energy. Small range: bloom that visibly pumps with scroll is
      // the single most common way a post stack starts looking cheap.
      bloom.intensity = (0.55 + L.energy * 0.35) * intensity;
    }
  });

  if (!enabled) return null;

  return (
    <EffectComposer
      /**
       * MSAA off. There is no geometric aliasing to fix: the scene is one smooth closed surface
       * plus additive points, and the blob's edge antialiasing comes from the fresnel falloff.
       * MSAA on a half-float target is expensive and, here, buys nothing.
       */
      multisampling={0}
      /**
       * No normal pass. Nothing in this stack is a depth-aware effect (no SSAO, no DOF), and
       * the normal pass is a full extra scene render — it would roughly double the cost of the
       * frame to feed effects that do not exist.
       */
      enableNormalPass={false}
      frameBufferType={HalfFloatType}
    >
      {/* 1 — Bloom */}
      <Bloom
        ref={bloomRef}
        intensity={0.55 * intensity}
        /**
         * Threshold above 1.0 deliberately. With a half-float buffer and ACES tone mapping, the
         * only pixels exceeding 1.0 are the shader's specular highlights and the additive
         * particle cores — precisely what should glow. A sub-1.0 threshold blooms the blob's
         * whole lit hemisphere and the scene turns to fog.
         */
        luminanceThreshold={1.05}
        /** Soft threshold edge. At 0 the bloom mask has a hard boundary that crawls as the
         * surface moves — visible as a shimmering outline on the highlights. */
        luminanceSmoothing={0.35}
        /**
         * Mipmap blur instead of the legacy kernel: a downsample/upsample chain, so the blur
         * radius is resolution-independent and it is dramatically cheaper at large radii. The
         * old path needs several full-res passes for the same spread.
         */
        mipmapBlur
        radius={0.72}
      />

      {/* 2 — Chromatic aberration */}
      <ChromaticAberration
        ref={caRef}
        offset={[CA_BASE, CA_BASE * 0.62]}
        /**
         * Radial modulation: zero fringing at the optical centre, rising toward the corners.
         * This is how real glass behaves, and it is what keeps the effect off the centre of the
         * frame where the headline sits. Uniform aberration across the whole image makes body
         * copy look misprinted.
         */
        radialModulation
        modulationOffset={0.42}
      />

      {/* 3 — Film grain */}
      <Noise
        /**
         * `premultiply` multiplies the grain by the underlying colour, so black stays black.
         * Additive grain over a near-black background — which this design is mostly made of —
         * produces exactly the milky grey haze that makes a dark site look washed out.
         */
        premultiply
        blendFunction={BlendFunction.SCREEN}
        opacity={0.055}
      />

      {/* 4 — Vignette */}
      <Vignette
        offset={0.32}
        darkness={0.62}
        /**
         * Eskil's formulation off. It is a different falloff curve that darkens the centre as
         * well; the default (radial, centre untouched) is what "vignette" means to a designer.
         */
        eskil={false}
        blendFunction={BlendFunction.NORMAL}
      />
    </EffectComposer>
  );
}
