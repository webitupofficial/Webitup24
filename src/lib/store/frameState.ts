/**
 * lib/store/frameState.ts
 *
 * A single mutable object holding every per-frame value shared between the DOM layer and
 * the WebGL layer: pointer position, pointer velocity, scroll progress, scroll velocity.
 *
 * WHY NOT REACT STATE / ZUSTAND / CONTEXT:
 * These values change on every mousemove and every scroll tick — up to 1000Hz on a
 * high-polling-rate mouse. Routing them through any subscription mechanism means a React
 * render per event. Even with zustand's transient `subscribe` API you pay a function call
 * per subscriber per event, and it is far too easy for one component to accidentally use
 * the hook form and re-render the whole tree at 120fps.
 *
 * A plain module-scoped object costs a property read. `useFrame` samples it once per frame,
 * which is the correct cadence: reading it 8 times between two frames is 7 wasted reads,
 * and rendering 8 times between two frames is 8 wasted renders.
 *
 * The trade-off is that this is deliberately outside React's model, so it must never be
 * read during render — only inside `useFrame`, `requestAnimationFrame`, or an event handler.
 * Reading it in a render body would produce a value React cannot invalidate on, which is
 * exactly the hydration-mismatch class of bug. That rule is the whole contract.
 */

import { Vector2 } from 'three';

export interface FrameState {
  /** Pointer in NDC: -1..1 on both axes, y up. The space the raycaster wants. */
  pointer: Vector2;
  /** Smoothed pointer, eased toward `pointer`. What the shaders actually read. */
  pointerSmooth: Vector2;
  /** Pointer in CSS pixels, top-left origin. For DOM-space effects (cursor, magnets). */
  pointerPx: Vector2;

  /** Per-second pointer velocity in NDC units. Signed. */
  velocity: Vector2;
  /** Smoothed |velocity|, normalised to roughly 0..1 and clamped. */
  velocityMagnitude: number;
  /** Smoothed velocity direction, unit-ish. Drives the shader's directional shear. */
  velocityDirection: Vector2;

  /** 1 while the pointer is over the window, easing to 0 when it leaves. */
  pointerPresence: number;
  /** True for coarse pointers (touch). Set once at init, refreshed on first touch. */
  isTouch: boolean;

  /** Document scroll progress, 0..1. Written by Lenis. */
  scrollProgress: number;
  /** Raw scroll offset in pixels. */
  scrollY: number;
  /** Signed, normalised scroll velocity, roughly -1..1 after clamping. */
  scrollVelocity: number;

  /** Seconds since the canvas mounted. Single clock for DOM and WebGL. */
  elapsed: number;
  /** Last frame's delta in seconds, clamped. Never trust a raw delta — see below. */
  delta: number;
}

export const frameState: FrameState = {
  pointer: new Vector2(0, 0),
  pointerSmooth: new Vector2(0, 0),
  pointerPx: new Vector2(0, 0),

  velocity: new Vector2(0, 0),
  velocityMagnitude: 0,
  velocityDirection: new Vector2(0, 0),

  pointerPresence: 0,
  isTouch: false,

  scrollProgress: 0,
  scrollY: 0,
  scrollVelocity: 0,

  elapsed: 0,
  delta: 1 / 60,
};

/**
 * Maximum delta we will ever report, in seconds (~20fps).
 *
 * Raw deltas must be clamped. When a tab is backgrounded, rAF stops; on return the first
 * delta can be tens of seconds. Every `damp()` call using it converges instantly, every
 * physics step explodes, and the scene visibly snaps. Clamping trades a little slow-motion
 * during a genuine stall for never showing a discontinuity.
 */
export const MAX_DELTA = 0.05;

export function clampDelta(dt: number): number {
  // NaN-safe: a NaN delta poisons every damped value downstream, permanently.
  if (!Number.isFinite(dt) || dt <= 0) return 1 / 60;
  return Math.min(dt, MAX_DELTA);
}

/**
 * Reset the transient parts of frame state.
 *
 * Called on route change. Without it, scroll velocity from the outgoing page carries into
 * the incoming one and the hero visibly lurches on arrival.
 */
export function resetFrameState(): void {
  frameState.velocity.set(0, 0);
  frameState.velocityMagnitude = 0;
  frameState.velocityDirection.set(0, 0);
  frameState.scrollProgress = 0;
  frameState.scrollY = 0;
  frameState.scrollVelocity = 0;
}
