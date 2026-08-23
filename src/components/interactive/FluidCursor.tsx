'use client';

import { useEffect, useRef } from 'react';

import { clampDelta, frameState } from '@/lib/store/frameState';
import { useUIStore, type CursorMode } from '@/lib/store/useUIStore';
import { dampHalf } from '@/lib/three/damp';
import { cn } from '@/lib/utils/cn';

/**
 * =============================================================================
 * FluidCursor — deliverable #5, part 2: "custom fluid cursor"
 * =============================================================================
 *
 * A cursor made of three cooperating pieces:
 *
 *   1. A hard dot that tracks the pointer almost exactly (half-life 20ms). This is the part the
 *      user actually aims with, so it must not lag — a laggy primary cursor is not stylish, it is
 *      broken, and it makes the site feel like a remote desktop session.
 *   2. A soft ring that lags (half-life ~110ms), stretches along the direction of travel, and
 *      resizes per `cursorMode`. This is the expressive part.
 *   3. A short trail of blobs behind the ring, each lagging more than the last, rendered through
 *      an SVG goo filter so they merge into one another instead of reading as separate dots. This
 *      is where the "fluid" comes from.
 *
 * -----------------------------------------------------------------------------
 * THE GOO FILTER
 * -----------------------------------------------------------------------------
 * `feGaussianBlur` bleeds the blobs into each other, then `feColorMatrix` multiplies the alpha
 * channel by a large factor and subtracts a bias — which turns the blur's soft alpha ramp back
 * into a hard edge. Where two blurs overlap, their summed alpha crosses the threshold *between*
 * the shapes, so the edge bridges them. That is a 2D metaball, done by the SVG rasteriser for a
 * few hundred bytes and no per-frame JavaScript.
 *
 * It is genuinely not free: an SVG filter forces the browser to re-rasterise the filtered subtree
 * whenever it changes, and the filter region grows with the blur radius and with how far the trail
 * spreads during a fast flick. It is therefore gated to the high tier. On mid, the trail renders
 * unfiltered with lower opacity, which still reads as motion smear.
 *
 * -----------------------------------------------------------------------------
 * WHY NO GSAP HERE
 * -----------------------------------------------------------------------------
 * Every other moving thing on this site is a GSAP tween, but this component writes
 * `element.style.transform` directly on its own rAF loop. Two reasons:
 *
 *   - There are up to seven elements, each needing position *and* velocity-derived deformation in
 *     the same transform string. GSAP owns `transform` when it animates it, so mixing a GSAP
 *     `scale` tween with a direct `translate` write means one of them wins and the other silently
 *     does nothing. Owning the whole string here removes the ambiguity entirely.
 *   - Every damped value uses the same half-life parameterisation as the shaders
 *     (`lib/three/damp`), so the cursor's inertia and the blob's inertia are described in the same
 *     units and actually match. A `duration`-based tween would be a different curve family.
 *
 * Discrete changes (colour, the label's text, whether the label is shown) go through React and
 * CSS transitions, because they happen a few times a second at most.
 *
 * -----------------------------------------------------------------------------
 * HIDING THE NATIVE CURSOR
 * -----------------------------------------------------------------------------
 * `cursor: none` is applied by `globals.css` keyed on `<html data-cursor="custom">`, and this
 * component is the only thing that sets that attribute. That coupling is deliberate: if the custom
 * cursor is not mounted, not visible, or has been suppressed for touch, the attribute is not set
 * and the native cursor is still there. The alternative — `cursor: none` in a stylesheet — leaves
 * a user with no cursor at all the moment anything here fails, which is unrecoverable without a
 * reload.
 *
 * `mode: 'hidden'` also restores the native cursor, for native controls: a range input's thumb, a
 * `<video>` scrubber and a text caret all communicate state through the system cursor, and
 * replacing that with a decorative ring loses information.
 */

/* ---------------------------------------------------------------------------
 * Tuning
 * ------------------------------------------------------------------------- */

/** Half-lives in seconds. Smaller = tighter tracking. */
const DOT_HALF_LIFE = 0.02;
const RING_HALF_LIFE = 0.11;
const TRAIL_HALF_LIFE_BASE = 0.055;
const TRAIL_HALF_LIFE_STEP = 0.05;

/** How quickly the ring settles into a new mode's size. */
const SHAPE_HALF_LIFE = 0.12;
/** How quickly velocity stretch builds and releases. */
const STRETCH_HALF_LIFE = 0.09;
/** Press feedback. */
const PRESS_HALF_LIFE = 0.06;

/** Base ring diameter in px. Every mode is a scale of this, so there is one number to change. */
const RING_SIZE = 44;
/** Base dot diameter in px. */
const DOT_SIZE = 7;

/** Trail blob count per tier. */
const TRAIL_COUNT = { high: 4, mid: 2, low: 0 } as const;

/** Maximum stretch along the direction of travel. 0.5 = 150% at full speed. */
const MAX_STRETCH = 0.5;

/* ---------------------------------------------------------------------------
 * Per-mode shape
 * ------------------------------------------------------------------------- */

interface CursorShape {
  /** Ring scale, relative to RING_SIZE. */
  ring: number;
  /** Non-uniform override, for the text caret. Multiplies `ring`. */
  ringX?: number;
  ringY?: number;
  /** Dot scale. 0 hides it. */
  dot: number;
  /** Trail opacity multiplier. */
  trail: number;
}

/**
 * The mode → shape table.
 *
 * Note `hover` shrinks the dot to nothing and grows the ring: over an interactive element the ring
 * *becomes* the cursor, which is what makes the target feel enclosed rather than pointed at.
 *
 * `text` collapses the ring to a 2.6 × 24px pill by scaling one axis down and the other up. Since
 * the element's `border-radius` is 50% of its *unscaled* box, a non-uniform scale keeps it a
 * capsule with no border-radius animation — the shape change is entirely in the transform, which
 * is the only thing that can be animated for free.
 */
const MODE_SHAPE: Record<CursorMode, CursorShape> = {
  default: { ring: 1, dot: 1, trail: 1 },
  hover: { ring: 1.35, dot: 0, trail: 0.55 },
  view: { ring: 2.1, dot: 0, trail: 0 },
  drag: { ring: 1.7, dot: 0.5, trail: 0.4 },
  text: { ring: 1, ringX: 0.06, ringY: 0.55, dot: 0, trail: 0 },
  hidden: { ring: 0, dot: 0, trail: 0 },
};

/* ---------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------- */

export function FluidCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const trailRefs = useRef<(HTMLDivElement | null)[]>([]);

  const tier = useUIStore((s) => s.tier);
  const motion = useUIStore((s) => s.motion);
  const cursorMode = useUIStore((s) => s.cursorMode);
  const cursorLabel = useUIStore((s) => s.cursorLabel);

  /**
   * The live mode, read by the rAF loop.
   *
   * A ref mirror of the reactive value, because the loop must not be torn down and rebuilt every
   * time the cursor moves over a button — restarting the loop would reset every damped value and
   * the cursor would snap instead of morphing between modes.
   */
  const modeRef = useRef<CursorMode>(cursorMode);
  modeRef.current = cursorMode;

  const trailCount = motion === 'full' ? TRAIL_COUNT[tier] : 0;
  const gooEnabled = motion === 'full' && tier === 'high';

  /* ------------------------------------------------------------------
   * Press state.
   *
   * Kept in a ref and read by the loop rather than in React state: a click would otherwise
   * re-render this component twice (down, up) and, worse, do it on the same tick the user is
   * waiting for a navigation to start.
   * ---------------------------------------------------------------- */
  const pressedRef = useRef(false);

  useEffect(() => {
    const down = () => {
      pressedRef.current = true;
    };
    const up = () => {
      pressedRef.current = false;
    };

    window.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    // `pointercancel` fires when the browser takes over the gesture (a scroll gesture starting, a
    // drag being handed to the OS). Without it the cursor stays stuck in its pressed state.
    window.addEventListener('pointercancel', up, { passive: true });
    // A pointerup that happens outside the window is never delivered; blur is the only signal.
    window.addEventListener('blur', up);

    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
    };
  }, []);

  /* ------------------------------------------------------------------
   * The loop.
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (motion === 'none') return;

    const dot = dotRef.current;
    const ring = ringRef.current;
    const label = labelRef.current;
    if (!dot || !ring) return;

    /**
     * Local clock.
     *
     * `frameState.delta` is written by `PointerProvider`'s loop, and the relative ordering of two
     * independent rAF callbacks within a frame is not specified — so reading it here could see
     * either this frame's or last frame's value. Measuring locally costs one subtraction and is
     * unambiguous.
     */
    let last = performance.now();

    /** Damped state. Mutated in place; nothing in this loop allocates. */
    const s = {
      dotX: frameState.pointerPx.x,
      dotY: frameState.pointerPx.y,
      ringX: frameState.pointerPx.x,
      ringY: frameState.pointerPx.y,
      trailX: new Float32Array(trailCount).fill(frameState.pointerPx.x),
      trailY: new Float32Array(trailCount).fill(frameState.pointerPx.y),
      ringScale: 1,
      ringScaleX: 1,
      ringScaleY: 1,
      dotScale: 1,
      trailAlpha: 1,
      stretch: 0,
      angle: 0,
      press: 0,
      opacity: 0,
    };

    /**
     * Whether the loop has positioned the cursor at least once with a real pointer reading.
     *
     * Until the pointer moves, `frameState.pointerPx` is (0, 0) — the top-left corner. Fading in
     * there and then flying to wherever the pointer actually is looks like a glitch, so the cursor
     * stays at zero opacity until `pointerPresence` reports the pointer is genuinely over the
     * window, and snaps to position on that first frame instead of damping to it.
     */
    let placed = false;

    /** Last value written to `<html data-cursor>`, so we only touch the DOM on change. */
    let lastDataset = '';

    const trail = trailRefs.current;
    let rafId = 0;

    const loop = (now: number) => {
      const dt = clampDelta((now - last) / 1000);
      last = now;

      const px = frameState.pointerPx.x;
      const py = frameState.pointerPx.y;
      const mode = modeRef.current;

      /* -- 1. Visibility ------------------------------------------------
       * Recomputed every frame rather than gated at mount, because `isTouch` can flip late (a
       * hybrid laptop where the user's first interaction is a tap) and `pointerPresence` eases
       * whenever the pointer leaves the window.
       */
      const suppressed = frameState.isTouch || mode === 'hidden';
      const targetOpacity = suppressed ? 0 : frameState.pointerPresence;

      if (!placed && frameState.pointerPresence > 0.01) {
        placed = true;
        s.dotX = s.ringX = px;
        s.dotY = s.ringY = py;
        s.trailX.fill(px);
        s.trailY.fill(py);
      }

      s.opacity = dampHalf(s.opacity, placed ? targetOpacity : 0, 0.14, dt);

      // Hide the native cursor only while ours is actually visible. See the file header.
      const wanted = s.opacity > 0.5 ? 'custom' : 'native';
      if (wanted !== lastDataset) {
        lastDataset = wanted;
        document.documentElement.dataset.cursor = wanted;
      }

      /* -- 2. Positions ------------------------------------------------ */
      s.dotX = dampHalf(s.dotX, px, DOT_HALF_LIFE, dt, 0.01);
      s.dotY = dampHalf(s.dotY, py, DOT_HALF_LIFE, dt, 0.01);
      s.ringX = dampHalf(s.ringX, px, RING_HALF_LIFE, dt, 0.01);
      s.ringY = dampHalf(s.ringY, py, RING_HALF_LIFE, dt, 0.01);

      /**
       * Trail: each blob chases the one in front of it, not the pointer.
       *
       * Chaining is what produces a curved trail — every blob independently chasing the pointer
       * would give a straight line of blobs at different distances, with no sense of the path the
       * cursor actually took.
       *
       * The `?? px` fallbacks are for `noUncheckedIndexedAccess`, which types every typed-array
       * read as possibly undefined. The indices are provably in range here, but a fallback is
       * cheaper to read than an assertion and cannot be wrong.
       */
      for (let i = 0; i < trailCount; i++) {
        const hl = TRAIL_HALF_LIFE_BASE + i * TRAIL_HALF_LIFE_STEP;
        const cx = s.trailX[i] ?? px;
        const cy = s.trailY[i] ?? py;
        const tx = i === 0 ? s.ringX : (s.trailX[i - 1] ?? cx);
        const ty = i === 0 ? s.ringY : (s.trailY[i - 1] ?? cy);
        s.trailX[i] = dampHalf(cx, tx, hl, dt, 0.01);
        s.trailY[i] = dampHalf(cy, ty, hl, dt, 0.01);
      }

      /* -- 3. Shape ---------------------------------------------------- */
      const shape = MODE_SHAPE[mode];
      s.ringScale = dampHalf(s.ringScale, shape.ring, SHAPE_HALF_LIFE, dt, 0.001);
      s.ringScaleX = dampHalf(s.ringScaleX, shape.ringX ?? 1, SHAPE_HALF_LIFE, dt, 0.001);
      s.ringScaleY = dampHalf(s.ringScaleY, shape.ringY ?? 1, SHAPE_HALF_LIFE, dt, 0.001);
      s.dotScale = dampHalf(s.dotScale, shape.dot, SHAPE_HALF_LIFE, dt, 0.001);
      s.trailAlpha = dampHalf(s.trailAlpha, shape.trail, SHAPE_HALF_LIFE, dt, 0.001);
      s.press = dampHalf(s.press, pressedRef.current ? 1 : 0, PRESS_HALF_LIFE, dt, 0.001);

      /* -- 4. Velocity stretch ----------------------------------------
       * The ring elongates along its direction of travel and thins across it — the standard
       * squash-and-stretch cue that sells inertia. Volume is preserved (`1/stretch` on the minor
       * axis) so the ring's apparent mass stays constant.
       *
       * Note the y negation: `velocityDirection` lives in NDC, where +y is UP, while CSS rotation
       * is measured clockwise from +x in a y-DOWN space. Without the flip the ring stretches
       * perpendicular to the actual motion at 45° angles, which looks subtly and inexplicably
       * wrong.
       */
      const speed = Math.min(frameState.velocityMagnitude, 1);
      s.stretch = dampHalf(s.stretch, speed, STRETCH_HALF_LIFE, dt, 0.001);

      if (speed > 0.02) {
        const targetAngle = Math.atan2(
          -frameState.velocityDirection.y,
          frameState.velocityDirection.x
        );
        /**
         * Shortest-arc interpolation.
         *
         * Damping the raw angle would spin the ring the long way round whenever the direction
         * crosses ±π — a full rotation on what should be a one-degree change. Normalising the
         * delta into (-π, π] first is the fix.
         */
        let d = targetAngle - s.angle;
        d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        s.angle += d * (1 - Math.pow(2, -dt / STRETCH_HALF_LIFE));
      }

      /* -- 5. Write ----------------------------------------------------
       * One transform string per element, one opacity. Both are compositor-only properties, so
       * these writes never trigger layout or paint — the whole reason for hand-writing transforms
       * instead of animating `left`/`top`/`width`.
       */
      const pressScale = 1 - s.press * 0.28;
      const major = 1 + s.stretch * MAX_STRETCH;
      const minor = 1 / major;

      const ringS = s.ringScale * pressScale;
      ring.style.transform =
        `translate3d(${s.ringX}px, ${s.ringY}px, 0) translate(-50%, -50%) ` +
        `rotate(${s.angle}rad) ` +
        `scale(${ringS * s.ringScaleX * major}, ${ringS * s.ringScaleY * minor})`;
      ring.style.opacity = String(s.opacity);

      dot.style.transform =
        `translate3d(${s.dotX}px, ${s.dotY}px, 0) translate(-50%, -50%) ` +
        `scale(${s.dotScale * (1 + s.press * 0.6)})`;
      dot.style.opacity = String(s.opacity * s.dotScale);

      if (label) {
        // The label rides the ring's position but never its scale — text under a non-uniform
        // scale is unreadable, and under the goo filter it is worse than unreadable.
        label.style.transform = `translate3d(${s.ringX}px, ${s.ringY}px, 0) translate(-50%, -50%)`;
        label.style.opacity = String(s.opacity);
      }

      for (let i = 0; i < trailCount; i++) {
        const el = trail[i];
        if (!el) continue;
        // Each blob is smaller than the one in front, which is what makes the merged shape taper
        // instead of reading as a chain of equal beads.
        const scale = (1 - (i + 1) / (trailCount + 1.4)) * s.ringScale;
        el.style.transform =
          `translate3d(${s.trailX[i] ?? 0}px, ${s.trailY[i] ?? 0}px, 0) translate(-50%, -50%) ` +
          `scale(${scale})`;
        el.style.opacity = String(s.opacity * s.trailAlpha);
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      // Always give the native cursor back. If this component unmounts (route-level motion change,
      // a fast refresh in development) and the attribute is left behind, the page has no cursor at
      // all and the only recovery is a reload.
      document.documentElement.dataset.cursor = 'native';
    };
  }, [motion, trailCount]);

  /* ------------------------------------------------------------------
   * Never render on the reduced-motion path.
   *
   * `motion` starts at `'none'` on both server and client (see `useUIStore`) and is upgraded by
   * `CapabilityProbe` after mount, so this returning null initially is also what keeps the cursor
   * out of the server-rendered markup — no hydration mismatch, and nothing to paint before the
   * capability decision is made.
   * ---------------------------------------------------------------- */
  if (motion === 'none') return null;

  return (
    <div
      /**
       * A stable hook for the two places that need to address this layer without knowing its
       * classes: the print stylesheet (which hides every fixed overlay — a full-viewport black
       * div would otherwise print as an entire page of ink) and manual debugging.
       */
      data-cursor-root
      className="pointer-events-none fixed inset-0 z-cursor overflow-hidden"
      aria-hidden="true"
      /**
       * `contain: strict` on a fixed, non-interactive overlay: nothing inside can affect layout
       * outside, and the browser is free to skip it entirely during layout passes caused by
       * content changes. On a page that reflows on scroll-driven reveals, that matters.
       */
      style={{ contain: 'strict' }}
    >
      {gooEnabled ? <GooFilter /> : null}

      {/* ----------------------------------------------------------------
        * Filtered group: ring + trail.
        *
        * `mix-blend-mode: difference` inverts whatever is beneath, so one cursor colour is
        * legible on the near-black hero, on a white case-study section, and on top of the acid
        * blob — with no mode switching. The cost is that it forces the page beneath into a
        * blending group; the blended area is only the cursor's own bounds, but it is still real,
        * which is why it is high-tier only.
        * -------------------------------------------------------------- */}
      <div
        className={cn('absolute inset-0', gooEnabled && 'mix-blend-difference')}
        style={gooEnabled ? { filter: 'url(#cursor-goo)' } : undefined}
      >
        {Array.from({ length: trailCount }, (_, i) => (
          <div
            key={i}
            ref={(el) => {
              trailRefs.current[i] = el;
            }}
            className="absolute left-0 top-0 rounded-full bg-bone will-change-transform"
            style={{ width: RING_SIZE, height: RING_SIZE, opacity: 0 }}
          />
        ))}

        <div
          ref={ringRef}
          /**
           * `border` rather than `bg` for the default state: an outlined ring lets the user see
           * what they are pointing at, which a filled disc the size of a fingertip does not.
           * Under the goo filter the border's alpha still participates in the metaball threshold,
           * so it merges with the trail regardless.
           */
          className="absolute left-0 top-0 rounded-full border border-bone/80 will-change-transform"
          style={{ width: RING_SIZE, height: RING_SIZE, opacity: 0 }}
        />
      </div>

      {/* ----------------------------------------------------------------
        * The aiming dot. Outside the filter — a 7px dot pushed through a 6px blur and an alpha
        * threshold either disappears or balloons, and either way stops being a precise pointer.
        * -------------------------------------------------------------- */}
      <div
        ref={dotRef}
        className="absolute left-0 top-0 rounded-full bg-acid will-change-transform"
        style={{ width: DOT_SIZE, height: DOT_SIZE, opacity: 0 }}
      />

      {/* ----------------------------------------------------------------
        * Label, e.g. "VIEW CASE". Rendered whenever a label is set; its own opacity transition
        * handles the text swap so the ring does not have to wait for React.
        * -------------------------------------------------------------- */}
      <div
        ref={labelRef}
        className="absolute left-0 top-0 flex items-center justify-center will-change-transform"
        style={{ opacity: 0 }}
      >
        <span
          className={cn(
            'whitespace-nowrap font-mono text-[0.625rem] uppercase tracking-[0.18em] text-ink',
            'transition-opacity duration-300 ease-swift',
            cursorLabel ? 'opacity-100' : 'opacity-0'
          )}
        >
          {cursorLabel}
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Goo filter
 * ------------------------------------------------------------------------- */

/**
 * The metaball filter. Zero-sized SVG carrying only a `<defs>`, so it contributes nothing to
 * layout.
 *
 * The alpha row of the colour matrix is the entire effect: `0 0 0 24 -11` means
 * `outA = 24 * inA - 11`, clamped to 0..1. Alpha below ~0.46 is crushed to nothing and above ~0.5
 * is saturated to opaque, so the blur's gradient becomes a step — and the step lands *between* two
 * nearby blobs, where their alphas sum past the threshold. Raising the multiplier hardens the edge;
 * raising the bias shrinks the shapes and makes them separate sooner.
 *
 * `stdDeviation` is in user units and therefore in CSS pixels here: 7 gives a bridge that forms at
 * roughly 30px of separation, which suits a 44px ring with a four-blob trail.
 */
function GooFilter() {
  return (
    <svg className="absolute h-0 w-0" aria-hidden="true" focusable="false">
      <defs>
        <filter id="cursor-goo" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0
                    0 1 0 0 0
                    0 0 1 0 0
                    0 0 0 24 -11"
            result="goo"
          />
          {/**
           * Composite the crisp original back over the gooed silhouette. Without this the ring's
           * 1px border is destroyed by the blur and the whole cursor becomes a soft filled blob —
           * the merge is preserved, but the precision is lost.
           */}
          <feBlend in="SourceGraphic" in2="goo" mode="normal" />
        </filter>
      </defs>
    </svg>
  );
}
