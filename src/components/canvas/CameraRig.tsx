'use client';

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { clampDelta, frameState } from '@/lib/store/frameState';
import { dampHalf, smoothstep } from '@/lib/three/damp';
import { resolveScene } from './registry';

/**
 * CameraRig — scroll-driven camera choreography.
 *
 * This is the WebGL half of the brief's "tie 3D camera transitions to DOM reveal effects".
 * The DOM half is ScrollTrigger; the shared clock between them is `frameState.scrollProgress`,
 * written by Lenis earlier in the same frame. Neither side knows about the other — they both
 * read one number — which is why they cannot drift apart.
 *
 * =========================================================================
 * WHY KEYFRAMES AND NOT SCROLLTRIGGER ON THE CAMERA
 * =========================================================================
 * The tempting approach is `gsap.to(camera.position, { scrollTrigger: { scrub: true } })`.
 * It works, and it is the wrong tool here:
 *
 *   • GSAP would own `camera.position`, so the pointer parallax below would have to fight it
 *     for the same property. Two systems writing one Vector3 per frame is a race whose winner
 *     depends on callback registration order.
 *   • A scrubbed tween is linear in scroll. Camera movement wants to be eased *per segment* —
 *     a fast pull-back out of the hero, then a long slow drift — and expressing that as a
 *     single tween means a bezier nobody can read.
 *   • Reduced-motion has to disable the scroll response without disabling the camera, which
 *     means killing a tween and restoring a position. Here it is `if (motion !== 'full')`.
 *
 * So: keyframes as data, interpolated manually, with parallax added on top as a separate term.
 * One writer, explicit order, trivially overridable.
 *
 * =========================================================================
 * WHY THE CAMERA MOVES AT ALL
 * =========================================================================
 * A static camera with a moving subject reads as a video. A camera that moves — even 20% of the
 * distance the subject moves — reads as a space you are inside. It is the single cheapest way to
 * make a WebGL hero feel like an environment instead of a widget.
 */

/** One point in the camera's path, keyed to document scroll progress. */
export interface CameraKeyframe {
  /** Scroll progress 0..1 at which this pose is reached. Must ascend. */
  at: number;
  position: [number, number, number];
  /** Where the camera looks. Usually near the origin — the blob's home. */
  target: [number, number, number];
  /** Field of view in degrees. Animating this is a dolly-zoom; use it sparingly. */
  fov: number;
}

/**
 * The default path for the homepage.
 *
 * Read it as a shot list:
 *   0.00 — head-on, close, wide FOV. The blob fills the frame.
 *   0.35 — pulled back and lifted; the services section takes the foreground.
 *   0.70 — swung right and down, longer lens. The blob is now a supporting element.
 *   1.00 — far back and low, almost out of frame, leaving the contact section clean.
 */
const DEFAULT_PATH: CameraKeyframe[] = [
  { at: 0, position: [0, 0, 4.2], target: [0, 0, 0], fov: 45 },
  { at: 0.35, position: [0.6, 0.5, 5.4], target: [0, -0.15, 0], fov: 42 },
  { at: 0.7, position: [1.5, -0.4, 6.2], target: [0.2, -0.3, 0], fov: 38 },
  { at: 1, position: [0.4, -1.2, 7.4], target: [0, -0.5, 0], fov: 36 },
];

/* ---------------------------------------------------------------------------
 * Module temporaries — see the no-allocation rule in FluidBlob.
 * ------------------------------------------------------------------------- */
const _posA = new THREE.Vector3();
const _posB = new THREE.Vector3();
const _tgtA = new THREE.Vector3();
const _tgtB = new THREE.Vector3();
const _desiredPos = new THREE.Vector3();
const _desiredTarget = new THREE.Vector3();
const _currentTarget = new THREE.Vector3();

export interface CameraRigProps {
  /** Override the path — a project page uses a tighter, more static one. */
  path?: CameraKeyframe[];
  /** Scene preset id; supplies the starting camera distance. */
  sceneId?: string | null;
  /** How far the camera drifts with the cursor, in world units. 0 disables parallax. */
  parallax?: number;
  /** 'full' enables scroll + parallax; 'lite' keeps parallax only; 'none' pins the camera. */
  motion?: 'full' | 'lite' | 'none';
  /** Disable while an orbit control or a model viewer owns the camera. */
  enabled?: boolean;
}

export function CameraRig({
  path,
  sceneId,
  parallax = 0.45,
  motion = 'full',
  enabled = true,
}: CameraRigProps) {
  const camera = useThree((s) => s.camera);
  const preset = useMemo(() => resolveScene(sceneId), [sceneId]);

  /**
   * The resolved path. When no explicit path is given, the default is offset so keyframe 0 sits
   * at the scene preset's `cameraZ` — that way a "Model Showcase" scene, which wants the camera
   * further back, gets it without every caller having to author a bespoke path.
   */
  const keys = useMemo<CameraKeyframe[]>(() => {
    if (path?.length) return path;
    const first = DEFAULT_PATH[0];
    // `noUncheckedIndexedAccess` — DEFAULT_PATH is a literal with 4 entries, but the compiler
    // types index access as possibly-undefined and it is right to.
    if (!first) return DEFAULT_PATH;
    const dz = preset.cameraZ - first.position[2];
    return DEFAULT_PATH.map((k) => ({
      ...k,
      position: [k.position[0], k.position[1], k.position[2] + dz] as [number, number, number],
    }));
  }, [path, preset.cameraZ]);

  /** Where the camera is looking right now. Damped separately from position. */
  const lookRef = useRef(new THREE.Vector3(0, 0, 0));
  const initialisedRef = useRef(false);

  useFrame((_state, rawDelta) => {
    if (!enabled) return;

    const dt = clampDelta(rawDelta);

    /* ------------------------------------------------------------------
     * 1. Find the active keyframe segment
     *
     * A linear scan. With four keyframes a binary search would be slower (branch overhead
     * exceeds the comparisons saved) and a cached index would be a bug waiting for the day
     * somebody scrolls backwards fast enough to skip a segment.
     * ---------------------------------------------------------------- */
    const progress = motion === 'full' ? frameState.scrollProgress : 0;

    let i = 0;
    for (let k = 0; k < keys.length - 1; k++) {
      const next = keys[k + 1];
      if (next && progress >= next.at) i = k + 1;
      else break;
    }

    const from = keys[Math.min(i, keys.length - 1)];
    const to = keys[Math.min(i + 1, keys.length - 1)];
    if (!from || !to) return;

    /* ------------------------------------------------------------------
     * 2. Interpolate
     *
     * `smoothstep` between the two keyframe times, not a linear `t`. Linear interpolation
     * produces a velocity discontinuity at every keyframe — the camera visibly changes speed
     * as it crosses one, which reads as a stutter even though nothing dropped a frame.
     * ---------------------------------------------------------------- */
    const span = to.at - from.at;
    const rawT = span > 1e-6 ? (progress - from.at) / span : 0;
    const t = smoothstep(0, 1, Math.min(1, Math.max(0, rawT)));

    _posA.set(from.position[0], from.position[1], from.position[2]);
    _posB.set(to.position[0], to.position[1], to.position[2]);
    _desiredPos.copy(_posA).lerp(_posB, t);

    _tgtA.set(from.target[0], from.target[1], from.target[2]);
    _tgtB.set(to.target[0], to.target[1], to.target[2]);
    _desiredTarget.copy(_tgtA).lerp(_tgtB, t);

    /* ------------------------------------------------------------------
     * 3. Pointer parallax
     *
     * Added to the interpolated pose rather than baked into it, so it survives any camera path.
     * Kept on 'lite' motion: it is pointer-driven, bounded to well under a degree of visual
     * shift, and never moves on its own — none of which is a vestibular trigger. Scroll-driven
     * movement is the part that is, and that is what 'lite' disables.
     *
     * The X term is inverted and the Y term is not, which is the convention that reads as
     * "looking around a fixed object" rather than "the object following the cursor".
     */
    if (motion !== 'none' && !frameState.isTouch) {
      const p = frameState.pointerPresence;
      _desiredPos.x += -frameState.pointerSmooth.x * parallax * p;
      _desiredPos.y += frameState.pointerSmooth.y * parallax * 0.6 * p;
    }

    /* ------------------------------------------------------------------
     * 4. First frame: snap. Every frame after: damp.
     *
     * Without the snap the camera flies in from its declared initial position over the first
     * few hundred milliseconds, which on a cold load looks like a bug rather than an intro.
     * ---------------------------------------------------------------- */
    if (!initialisedRef.current) {
      camera.position.copy(_desiredPos);
      lookRef.current.copy(_desiredTarget);
      initialisedRef.current = true;
    } else {
      /**
       * Position half-life is longer than target half-life (250ms vs 180ms).
       *
       * That asymmetry matters: when the camera translates, its aim arrives slightly ahead of
       * its body, which is how a real operator pans — they lead the subject. Equal half-lives
       * produce a mechanically correct move that feels like a gantry.
       */
      camera.position.x = dampHalf(camera.position.x, _desiredPos.x, 0.25, dt);
      camera.position.y = dampHalf(camera.position.y, _desiredPos.y, 0.25, dt);
      camera.position.z = dampHalf(camera.position.z, _desiredPos.z, 0.25, dt);

      lookRef.current.x = dampHalf(lookRef.current.x, _desiredTarget.x, 0.18, dt);
      lookRef.current.y = dampHalf(lookRef.current.y, _desiredTarget.y, 0.18, dt);
      lookRef.current.z = dampHalf(lookRef.current.z, _desiredTarget.z, 0.18, dt);
    }

    _currentTarget.copy(lookRef.current);
    camera.lookAt(_currentTarget);

    /* ------------------------------------------------------------------
     * 5. FOV
     *
     * `updateProjectionMatrix` is only called when the value actually changed by a perceptible
     * amount. It rebuilds the projection matrix and marks it dirty for every shader that
     * consumes it; calling it unconditionally every frame on a camera whose FOV is static is
     * pure waste. The 0.01° threshold is below the point at which a change is visible.
     * ---------------------------------------------------------------- */
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const cam = camera as THREE.PerspectiveCamera;
      const desiredFov = THREE.MathUtils.lerp(from.fov, to.fov, t);
      const nextFov = dampHalf(cam.fov, desiredFov, 0.3, dt, 1e-3);
      if (Math.abs(nextFov - cam.fov) > 0.01) {
        cam.fov = nextFov;
        cam.updateProjectionMatrix();
      }
    }
  });

  return null;
}
