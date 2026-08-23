'use client';

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { clampDelta, frameState } from '@/lib/store/frameState';
import { getUIState } from '@/lib/store/useUIStore';
import { TIER_SETTINGS } from '@/lib/hooks/useCapabilities';
import { dampHalf } from '@/lib/three/damp';
import { resolveScene, sceneColors, applyPaletteToScene, type PaletteToken } from './registry';
import { ParticleMaterialImpl, type ParticleMaterialInstance } from './shaders/ParticleMaterial';

/**
 * Particles — the dust field surrounding the blob.
 *
 * Renders nothing at all on the low tier (`particleCount: 0`), which is the point: this is the
 * first thing to cut, because it is atmosphere. Nobody scrolls back up to look at the dust.
 *
 * =========================================================================
 * DISTRIBUTION
 * =========================================================================
 * Naive `Math.random()` on each axis fills a cube, so the corners are denser than the middle and
 * the field has visible flat faces. Naive spherical coordinates (`random θ, random φ`) cluster
 * hard at the poles, because equal angular steps cover less surface area near them.
 *
 * We use a Fibonacci sphere for direction — the golden-angle spiral, which distributes points
 * with near-uniform density and no seams — then jitter the radius so the result is a shell with
 * thickness rather than a hollow ball. Uniformity matters here specifically because the eye is
 * extremely good at spotting structure in what is supposed to be noise.
 */

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface ParticlesProps {
  sceneId?: string | null;
  paletteTokens?: PaletteToken[] | null;
  intensity?: number;
  revealed?: boolean;
}

export function Particles({
  sceneId,
  paletteTokens,
  intensity = 1,
  revealed = true,
}: ParticlesProps) {
  const materialRef = useRef<ParticleMaterialInstance>(null);
  const pointsRef = useRef<THREE.Points>(null);

  const viewport = useThree((s) => s.viewport);

  const tier = useMemo(() => getUIState().tier, []);
  const preset = useMemo(() => resolveScene(sceneId), [sceneId]);

  const count = Math.round(TIER_SETTINGS[tier].particleCount * preset.particleMultiplier);

  /** Shell radius. Wide enough that the field frames the blob rather than sitting on it. */
  const spread = 4.2 * preset.scale;

  /* ------------------------------------------------------------------------
   * Buffers
   *
   * Built once. Typed arrays, filled in a single pass, handed to the GPU and never touched
   * again — all per-frame movement happens in the vertex shader. Rewriting a position buffer on
   * the CPU each frame means a full re-upload of `count * 3 * 4` bytes every 16ms, which for
   * 2,400 particles is ~29KB/frame of PCIe traffic to accomplish what the GPU can do for free.
   * ---------------------------------------------------------------------- */
  const buffers = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const seeds = new Float32Array(count);
    const tints = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // --- Fibonacci sphere direction ---
      // y sweeps linearly from +1 to -1; the radius of the circle at that height follows, which
      // is what makes the density uniform (Archimedes' hat-box theorem, in effect).
      const y = 1 - (i / Math.max(count - 1, 1)) * 2;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = GOLDEN_ANGLE * i;

      const dx = Math.cos(theta) * radiusAtY;
      const dz = Math.sin(theta) * radiusAtY;

      /**
       * Radius jitter, biased outward.
       *
       * `0.55 + r^0.6 * 0.45` — the fractional exponent pushes the distribution toward the
       * outer edge of the shell. A uniform random radius puts too many particles close to the
       * blob, where they compete with it; the blob should sit in a relatively clear pocket.
       */
      const r = spread * (0.55 + Math.pow(Math.random(), 0.6) * 0.45);

      positions[i * 3 + 0] = dx * r;
      positions[i * 3 + 1] = y * r;
      positions[i * 3 + 2] = dz * r;

      // Size: squared so most particles are small and a few are notably larger. A uniform
      // distribution of sizes reads as a flat texture; the variance is what gives depth.
      const s = Math.random();
      scales[i] = s * s;

      seeds[i] = Math.random();
      tints[i] = Math.random();
    }

    return { positions, scales, seeds, tints };
    // `spread` is derived from `preset.scale`, so sceneId is the real dependency. Rebuilding on
    // scene change is correct and rare — it is a navigation, not a frame.
  }, [count, spread]);

  const targetColors = useMemo(
    () => applyPaletteToScene(sceneColors(sceneId), paletteTokens),
    [sceneId, paletteTokens]
  );

  const local = useRef({ time: 0, reveal: 0, velocity: 0, presence: 0 });

  useFrame((_state, rawDelta) => {
    const material = materialRef.current;
    if (!material) return;

    const dt = clampDelta(rawDelta);
    const L = local.current;

    L.time += dt;
    material.uTime = L.time;

    // Particles reveal more slowly than the blob and start later in practice, because the field
    // arriving after the subject reads as the subject *displacing air*.
    L.reveal = dampHalf(L.reveal, revealed ? 1 : 0, 0.7, dt);
    material.uReveal = L.reveal;

    L.velocity = dampHalf(L.velocity, frameState.velocityMagnitude, 0.3, dt);
    material.uVelocity = L.velocity;

    L.presence = dampHalf(L.presence, frameState.isTouch ? 0 : frameState.pointerPresence, 0.25, dt);
    material.uPointerStrength = L.presence * 0.8 * intensity;
    material.uPointer.set(frameState.pointerSmooth.x, frameState.pointerSmooth.y);

    material.uScroll = frameState.scrollProgress;
    material.uSpread = spread;
    material.uDrift = 0.35 * intensity;
    material.uPixelRatio = viewport.dpr;

    const [, cb, cc] = targetColors;
    // Particles use the two accent colours, not the near-black base — additive blending with a
    // dark colour contributes nothing, so uColorA would render as invisible particles.
    material.uColorA.copy(cb);
    material.uColorB.copy(cc);

    // Rotate the whole field, counter to the blob, at a fraction of its speed. Opposing rotation
    // is what separates the two layers visually; matching directions makes them read as one
    // object and the depth collapses.
    if (pointsRef.current) {
      pointsRef.current.rotation.y -= dt * 0.014;
    }
  });

  // Nothing to draw. Returning null rather than an empty <points> avoids allocating a
  // zero-length geometry, which some drivers warn about.
  if (count === 0) return null;

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        {/**
         * `args` form rather than the imperative `setAttribute`: R3F attaches these declaratively
         * and disposes them on unmount. Note the `key` — without one, R3F reuses the existing
         * attribute object when `count` changes and the buffer length silently disagrees with
         * the draw range, which renders garbage triangles.
         */}
        <bufferAttribute
          key={`pos-${count}`}
          attach="attributes-position"
          args={[buffers.positions, 3]}
        />
        <bufferAttribute key={`scale-${count}`} attach="attributes-aScale" args={[buffers.scales, 1]} />
        <bufferAttribute key={`seed-${count}`} attach="attributes-aSeed" args={[buffers.seeds, 1]} />
        <bufferAttribute key={`tint-${count}`} attach="attributes-aTint" args={[buffers.tints, 1]} />
      </bufferGeometry>
      <particleMaterial
        key={ParticleMaterialImpl.key}
        ref={materialRef}
        uSize={26}
        uSpread={spread}
        uReveal={0}
        uColorA={targetColors[1]}
        uColorB={targetColors[2]}
      />
    </points>
  );
}
