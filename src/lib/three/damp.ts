import * as THREE from 'three';

/**
 * lib/three/damp.ts
 *
 * Frame-rate independent smoothing helpers.
 *
 * WHY THIS FILE EXISTS AT ALL:
 * The lerp everyone writes inside `useFrame` is
 *
 *   value += (target - value) * 0.1;
 *
 * and it is frame-rate dependent. On a 144Hz display it converges 2.4× faster than on 60Hz, so
 * the site literally feels different on different monitors — snappy on a gaming laptop, sluggish
 * on an office display, and *wrong* on a 30fps thermally-throttled phone where the same code
 * produces visible stepping.
 *
 * The fix is exponential decay driven by elapsed time:
 *
 *   value = target + (value - target) * e^(-λ·dt)
 *
 * `three.js` ships this as `MathUtils.damp`. These wrappers add the things it does not: a
 * half-life parameterisation that is possible to reason about, vector/colour variants, and
 * NaN containment.
 *
 * ON PARAMETERISATION: `damp` takes a rate λ, where larger is faster, and the mapping from λ to
 * "how long until it gets there" is not intuitive. Half-life is: `dampHalf(v, t, 0.1, dt)`
 * covers half the remaining distance every 100ms. Designers can be given half-lives; nobody can
 * be given a lambda.
 */

/** λ for a given half-life. `e^(-λ·h) = 0.5` → `λ = ln2 / h`. */
const LN2 = Math.LN2;

function lambdaFor(halfLife: number): number {
  // Guard: a zero or negative half-life means "snap", expressed as a very large lambda rather
  // than a division by zero producing Infinity and then NaN downstream.
  if (!(halfLife > 0)) return 1e6;
  return LN2 / halfLife;
}

/**
 * Damp a scalar toward `target` with the given half-life, in seconds.
 *
 * Returns `target` exactly once the remainder falls below `epsilon`. Without that snap, damped
 * values asymptote forever: a uniform sits at 0.0000001 instead of 0, three.js still uploads it
 * every frame, and any `=== 0` check never fires.
 */
export function dampHalf(
  current: number,
  target: number,
  halfLife: number,
  dt: number,
  epsilon = 1e-4
): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return target;
  const next = target + (current - target) * Math.exp(-lambdaFor(halfLife) * dt);
  return Math.abs(target - next) < epsilon ? target : next;
}

/** In-place Vector2 damp. Mutates and returns `current` — no allocation per frame. */
export function dampVec2(
  current: THREE.Vector2,
  targetX: number,
  targetY: number,
  halfLife: number,
  dt: number
): THREE.Vector2 {
  const k = Math.exp(-lambdaFor(halfLife) * dt);
  current.x = targetX + (current.x - targetX) * k;
  current.y = targetY + (current.y - targetY) * k;
  return current;
}

/** In-place Vector3 damp toward another vector. */
export function dampVec3(
  current: THREE.Vector3,
  target: THREE.Vector3,
  halfLife: number,
  dt: number
): THREE.Vector3 {
  const k = Math.exp(-lambdaFor(halfLife) * dt);
  current.x = target.x + (current.x - target.x) * k;
  current.y = target.y + (current.y - target.y) * k;
  current.z = target.z + (current.z - target.z) * k;
  return current;
}

/**
 * In-place colour damp.
 *
 * Interpolates in whatever space the Colors are already in — which, with three.js
 * ColorManagement on, is linear-sRGB. That is the correct space for this: linear interpolation
 * between two linear colours is physically a blend of light, so it does not pass through the
 * muddy desaturated midpoint that lerping gamma-encoded values produces.
 */
export function dampColor(
  current: THREE.Color,
  target: THREE.Color,
  halfLife: number,
  dt: number
): THREE.Color {
  const k = Math.exp(-lambdaFor(halfLife) * dt);
  current.r = target.r + (current.r - target.r) * k;
  current.g = target.g + (current.g - target.g) * k;
  current.b = target.b + (current.b - target.b) * k;
  return current;
}

/**
 * Critically-damped spring — position and velocity integrated together.
 *
 * Use instead of `dampHalf` when the motion should have *weight*: a magnetic element following
 * the cursor, a camera settling after a scroll flick. Exponential damping always decelerates
 * into its target and can never overshoot, which is right for values (opacity, intensity) and
 * subtly lifeless for objects.
 *
 * `smoothTime` is the approximate time to reach the target, in seconds. The implementation is
 * the standard Game-Programming-Gems / Unity `SmoothDamp`: stable at any dt, including the
 * absurd ones a backgrounded tab produces.
 *
 * Mutates `state.velocity` and returns the new position.
 */
export interface SpringState {
  velocity: number;
}

export function smoothDamp(
  current: number,
  target: number,
  state: SpringState,
  smoothTime: number,
  dt: number,
  maxSpeed = Infinity
): number {
  const t = Math.max(0.0001, smoothTime);
  // ω is the natural frequency; the 2/t comes from the critically-damped solution.
  const omega = 2 / t;
  const x = omega * dt;
  // Padé approximation of e^(-x) — cheaper than Math.exp and accurate over the range of dt
  // values a frame loop produces.
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

  let change = current - target;
  const originalTarget = target;

  const maxChange = maxSpeed * t;
  change = Math.max(-maxChange, Math.min(change, maxChange));
  const clampedTarget = current - change;

  const temp = (state.velocity + omega * change) * dt;
  state.velocity = (state.velocity - omega * temp) * exp;
  let output = clampedTarget + (change + temp) * exp;

  // Prevent overshoot past the original target — without this the spring visibly bounces when
  // the target changes direction abruptly, which on a cursor-follower reads as a glitch.
  if (originalTarget - current > 0 === output > originalTarget) {
    output = originalTarget;
    state.velocity = (output - originalTarget) / dt;
  }

  return output;
}

/**
 * Map a value from one range to another, clamped.
 *
 * Present in three.js as `mapLinear`, but unclamped — and an unclamped remap driving a shader
 * uniform from scroll progress is how you end up with a distortion amplitude of 4.2 when the
 * user rubber-band-scrolls past the end of the document on iOS.
 */
export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  if (inMax === inMin) return outMin;
  const t = Math.min(1, Math.max(0, (value - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

/** Smoothstep, clamped. Matches the GLSL builtin so JS and shader maths agree. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
