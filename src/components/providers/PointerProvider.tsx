'use client';

import { useEffect } from 'react';

import { clampDelta, frameState } from '@/lib/store/frameState';

/**
 * PointerProvider — the single global pointer listener.
 *
 * Writes into `frameState`; renders nothing; never triggers a React render.
 *
 * WHY ONE GLOBAL LISTENER:
 * Every component that wants cursor position could add its own `pointermove` handler. On a
 * page with a custom cursor, four magnetic buttons, a hover-video grid and a WebGL scene that
 * is nine listeners firing on every one of up to 1000 events per second. One listener writing
 * to one object, sampled once per frame by whoever needs it, is between one and two orders of
 * magnitude less work.
 *
 * VELOCITY: computed here rather than in the consumer, because it needs the *event* timestamps.
 * Deriving velocity from per-frame position deltas quantises it to the frame rate and produces
 * a value that changes meaning at 120Hz — the same physical hand movement would report half
 * the velocity. Using `event.timeStamp` makes it frame-rate independent.
 */

/**
 * Velocity smoothing half-life, in seconds.
 *
 * Raw pointer velocity is extremely spiky — a 3-pixel jitter between two events 2ms apart
 * reads as enormous speed. Exponential smoothing with a ~90ms half-life keeps the shader's
 * turbulence responsive to real gestures while ignoring sensor noise.
 */
const VELOCITY_HALF_LIFE = 0.09;

/** Normalisation divisor: NDC units per second that map to velocity 1.0. */
const VELOCITY_SCALE = 3.2;

/** Half-life for the smoothed pointer position, in seconds. */
const POSITION_HALF_LIFE = 0.06;

/** Half-life for presence fade-in/out. */
const PRESENCE_HALF_LIFE = 0.15;

/**
 * Frame-rate independent exponential decay.
 *
 * `current + (target - current) * factor` with a constant factor is the lerp everyone writes,
 * and it is wrong: at 120fps it converges twice as fast as at 60fps, so the entire feel of the
 * site changes with the display. Deriving the factor from `1 - 2^(-dt/halfLife)` makes
 * convergence a function of *time*, which is what "feel" actually is.
 */
function decayFactor(dt: number, halfLife: number): number {
  return 1 - Math.pow(2, -dt / halfLife);
}

export function PointerProvider() {
  useEffect(() => {
    let lastX = 0;
    let lastY = 0;
    let lastTime = 0;
    let hasMoved = false;

    // Raw, unsmoothed targets. The rAF loop eases frameState toward these.
    let targetVelX = 0;
    let targetVelY = 0;
    let targetPresence = 0;

    const onPointerMove = (event: PointerEvent) => {
      const { innerWidth: w, innerHeight: h } = window;

      // NDC: -1..1, y up. The space THREE.Raycaster.setFromCamera expects.
      const ndcX = (event.clientX / w) * 2 - 1;
      const ndcY = -((event.clientY / h) * 2 - 1);

      frameState.pointer.set(ndcX, ndcY);
      frameState.pointerPx.set(event.clientX, event.clientY);

      // First event has no previous sample; seeding velocity from it would report a huge
      // spike from (0,0) to wherever the cursor actually is.
      if (hasMoved) {
        const dt = Math.max((event.timeStamp - lastTime) / 1000, 1 / 1000);
        targetVelX = (ndcX - lastX) / dt;
        targetVelY = (ndcY - lastY) / dt;
      }

      lastX = ndcX;
      lastY = ndcY;
      lastTime = event.timeStamp;
      hasMoved = true;

      // A coarse pointer that generates pointermove is a finger dragging. Update the flag so
      // hover-dependent affordances can disable themselves — `pointer: coarse` at load can be
      // wrong on hybrid devices (Surface, iPad with trackpad).
      if (event.pointerType === 'touch') frameState.isTouch = true;

      targetPresence = 1;
    };

    const onPointerLeave = () => {
      targetPresence = 0;
      targetVelX = 0;
      targetVelY = 0;
    };

    const onPointerEnter = () => {
      targetPresence = 1;
    };

    /**
     * Zero velocity when the tab loses focus. Without this, a fast cursor movement
     * immediately before switching tabs leaves the velocity uniform pinned high, and the
     * shader is still churning at full turbulence in a background tab — which is both a
     * battery cost and visible as a jolt on return.
     */
    const onVisibilityChange = () => {
      if (document.hidden) {
        targetVelX = 0;
        targetVelY = 0;
        targetPresence = 0;
      }
    };

    /* --------------------------------------------------------------------
     * Smoothing loop
     *
     * Runs on its own rAF rather than inside R3F's useFrame, so pointer smoothing stays
     * correct on pages with no canvas (the contact page, the studio) where the custom cursor
     * and magnetic buttons still need it.
     * ------------------------------------------------------------------ */
    let rafId = 0;
    let prevFrameTime = performance.now();

    const loop = (now: number) => {
      const dt = clampDelta((now - prevFrameTime) / 1000);
      prevFrameTime = now;

      frameState.elapsed += dt;
      frameState.delta = dt;

      // --- Smoothed position ---
      const posK = decayFactor(dt, POSITION_HALF_LIFE);
      frameState.pointerSmooth.x += (frameState.pointer.x - frameState.pointerSmooth.x) * posK;
      frameState.pointerSmooth.y += (frameState.pointer.y - frameState.pointerSmooth.y) * posK;

      // --- Smoothed velocity ---
      const velK = decayFactor(dt, VELOCITY_HALF_LIFE);
      frameState.velocity.x += (targetVelX - frameState.velocity.x) * velK;
      frameState.velocity.y += (targetVelY - frameState.velocity.y) * velK;

      // Decay the raw target toward zero too, so a stationary cursor settles instead of
      // holding its last velocity forever (pointermove simply stops firing — there is no
      // "pointer stopped" event to hook).
      targetVelX *= 1 - decayFactor(dt, 0.05);
      targetVelY *= 1 - decayFactor(dt, 0.05);

      const speed = Math.hypot(frameState.velocity.x, frameState.velocity.y);
      frameState.velocityMagnitude = Math.min(speed / VELOCITY_SCALE, 1);

      // Direction is only meaningful above a noise floor; below it, normalising amplifies
      // jitter into a rapidly spinning unit vector.
      if (speed > 0.05) {
        frameState.velocityDirection.set(
          frameState.velocity.x / speed,
          frameState.velocity.y / speed
        );
      }

      // --- Presence ---
      const presK = decayFactor(dt, PRESENCE_HALF_LIFE);
      frameState.pointerPresence += (targetPresence - frameState.pointerPresence) * presK;

      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    // `passive: true` on pointermove: we never preventDefault, and saying so lets the browser
    // dispatch without waiting to see whether we will — measurable on scroll-adjacent input.
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('pointerenter', onPointerEnter);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onVisibilityChange);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('pointerenter', onPointerEnter);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onVisibilityChange);
    };
  }, []);

  return null;
}
