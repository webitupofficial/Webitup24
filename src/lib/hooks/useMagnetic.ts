'use client';

import { useEffect, useRef } from 'react';

import { gsap } from '@/lib/gsap';
import { frameState } from '@/lib/store/frameState';
import { getUIState, useUIStore, type CursorMode } from '@/lib/store/useUIStore';

/**
 * lib/hooks/useMagnetic.ts
 *
 * Makes an element lean toward the cursor when the cursor is near it.
 *
 * =============================================================================
 * WHY THIS IS NOT A CSS TRANSITION
 * =============================================================================
 * The naive implementation is a `pointermove` handler that sets
 * `style.transform = translate(x, y)` with a CSS transition. It fails in three specific ways:
 *
 *   1. A CSS transition restarts from the current value on every event. At 120 pointer events per
 *      second the element never completes a transition and the easing is effectively linear,
 *      which removes the entire reason for the effect.
 *   2. Writing `style.transform` from an event handler forces a style recalculation inside the
 *      input handler, before the frame. With four magnetic buttons on screen that is four layout
 *      invalidations per pointer event.
 *   3. On leave, the element snaps back with the same duration it uses to follow, which reads as
 *      mechanical. Return should be slower and softer than pursuit.
 *
 * `gsap.quickTo` solves all three: it creates a pre-compiled setter bound to one property, writes
 * it on GSAP's ticker (once per frame, in the same batch as everything else on the page), and
 * interpolates rather than transitioning — so a new target mid-flight redirects the existing
 * motion instead of restarting it.
 *
 * =============================================================================
 * ON "MAGNETIC" AS AN INTERACTION, NOT A GIMMICK
 * =============================================================================
 * The pull is capped at a fraction of the element's own size and the element is *never* allowed
 * to move far enough that the cursor leaves it while the user is aiming. That constraint is the
 * difference between an affordance — "this thing noticed you" — and a moving target, which is a
 * genuine usability failure and an accessibility one. Fitts's law is not suspended because the
 * site won an award.
 */

export interface UseMagneticOptions {
  /**
   * How far the element travels toward the cursor, as a fraction of the distance from its centre
   * to the pointer. 0.25 means the element covers a quarter of the gap.
   */
  strength?: number;
  /** Hard cap on displacement in pixels, regardless of strength. */
  maxDistance?: number;
  /**
   * Activation radius in pixels beyond the element's own bounds. The element starts leaning
   * before the cursor is over it, which is what makes it feel like attraction rather than hover.
   */
  padding?: number;
  /** Scale applied while active. 1 disables. */
  scale?: number;
  /** Cursor mode to publish while the pointer is inside. */
  cursorMode?: CursorMode;
  /** Optional cursor label, e.g. "VIEW CASE". */
  cursorLabel?: string | null;
  /**
   * A nested element that moves further than its parent, for the classic layered pull (the label
   * leads the button). Selector is queried within the root.
   */
  innerSelector?: string;
  /** Multiplier applied to the inner element's displacement. >1 makes it lead. */
  innerStrength?: number;
  /** Disable without unmounting. */
  disabled?: boolean;
}

export function useMagnetic<T extends HTMLElement>(
  options: UseMagneticOptions = {}
): React.RefObject<T | null> {
  const {
    strength = 0.28,
    maxDistance = 22,
    padding = 64,
    scale = 1.04,
    cursorMode = 'hover',
    cursorLabel = null,
    innerSelector,
    innerStrength = 1.8,
    disabled = false,
  } = options;

  const ref = useRef<T>(null);
  const motion = useUIStore((s) => s.motion);

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    /**
     * Skip entirely on touch and on reduced motion.
     *
     * Touch: there is no hover state, so a magnetic element would either never activate or —
     * worse — activate on tap and shift under the finger mid-press, causing mis-taps.
     * Reduced motion 'none': this is unprompted movement, exactly what the preference excludes.
     * 'lite' keeps it: it is user-driven, bounded to ~22px, and stops the instant the cursor does.
     */
    if (frameState.isTouch || motion === 'none') return;

    const inner = innerSelector ? el.querySelector<HTMLElement>(innerSelector) : null;

    /**
     * `quickTo` returns a reusable setter. Created once here, outside the event handler — creating
     * one per event allocates a tween per pointer move, which is the exact opposite of the
     * optimisation.
     *
     * `duration: 0.55` with `power3.out`: long enough that the element visibly *arrives* rather
     * than tracking rigidly, which is what gives the impression of weight.
     */
    const toX = gsap.quickTo(el, 'x', { duration: 0.55, ease: 'power3.out' });
    const toY = gsap.quickTo(el, 'y', { duration: 0.55, ease: 'power3.out' });
    const toScale = gsap.quickTo(el, 'scale', { duration: 0.4, ease: 'power2.out' });

    const toInnerX = inner ? gsap.quickTo(inner, 'x', { duration: 0.7, ease: 'power3.out' }) : null;
    const toInnerY = inner ? gsap.quickTo(inner, 'y', { duration: 0.7, ease: 'power3.out' }) : null;

    /**
     * Cached bounds.
     *
     * `getBoundingClientRect()` forces a synchronous layout flush. Calling it inside a
     * `pointermove` handler on four elements at 120Hz is ~500 forced layouts per second, and it is
     * the single most common cause of jank in exactly this kind of effect.
     *
     * The cache is invalidated on resize and on scroll — the latter matters because the rect is
     * viewport-relative, so any scroll makes it stale. Reading it once per scroll *frame* rather
     * than once per pointer event is roughly a 10× reduction.
     */
    let rect = el.getBoundingClientRect();
    let rectDirty = false;

    const markDirty = () => {
      rectDirty = true;
    };

    let active = false;
    let rafId = 0;

    const loop = () => {
      if (rectDirty) {
        rect = el.getBoundingClientRect();
        rectDirty = false;
      }

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      const px = frameState.pointerPx.x;
      const py = frameState.pointerPx.y;

      const dx = px - cx;
      const dy = py - cy;

      // Activation region: the element's box grown by `padding`. A rectangular test rather than a
      // radial one, so a wide button activates along its whole length instead of only near the
      // middle — which is how a wide target should behave.
      const insideX = Math.abs(dx) < rect.width / 2 + padding;
      const insideY = Math.abs(dy) < rect.height / 2 + padding;
      const inside = insideX && insideY;

      if (inside !== active) {
        active = inside;
        toScale(inside ? scale : 1);

        // Publish cursor state. Guarded on the current value so we do not dispatch a store
        // update — and a React render of the cursor — on every frame the pointer sits still
        // inside the element.
        const ui = getUIState();
        if (inside) {
          if (ui.cursorMode !== cursorMode || ui.cursorLabel !== cursorLabel) {
            ui.setCursor(cursorMode, cursorLabel);
          }
        } else if (ui.cursorMode === cursorMode) {
          ui.setCursor('default', null);
        }
      }

      if (inside) {
        /**
         * Clamped displacement.
         *
         * `strength` scales with distance so the pull grows as the cursor approaches, and
         * `maxDistance` caps it so the element cannot chase the cursor out of its own bounds.
         * Both are needed: strength alone lets a far cursor yank the element across the screen,
         * and a cap alone makes the pull feel like a binary snap.
         */
        const tx = Math.max(-maxDistance, Math.min(maxDistance, dx * strength));
        const ty = Math.max(-maxDistance, Math.min(maxDistance, dy * strength));
        toX(tx);
        toY(ty);
        toInnerX?.(tx * innerStrength * 0.5);
        toInnerY?.(ty * innerStrength * 0.5);
      } else {
        toX(0);
        toY(0);
        toInnerX?.(0);
        toInnerY?.(0);
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    window.addEventListener('resize', markDirty);
    // Capture phase, passive: catches scrolls in any nested scroller too, not just the document.
    window.addEventListener('scroll', markDirty, { passive: true, capture: true });

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', markDirty);
      window.removeEventListener('scroll', markDirty, { capture: true });

      /**
       * Kill the tweens before clearing the transform.
       *
       * A `quickTo` setter holds a live tween. Clearing props while it is still running means the
       * tween's next tick writes the transform straight back, and the element is left permanently
       * offset — visible as a button sitting 20px from where its layout says it should be.
       */
      gsap.killTweensOf(el);
      if (inner) gsap.killTweensOf(inner);
      gsap.set(el, { clearProps: 'transform' });
      if (inner) gsap.set(inner, { clearProps: 'transform' });

      // Do not leave a stale cursor mode behind if the element unmounts while hovered — which is
      // exactly what happens when a magnetic link navigates.
      const ui = getUIState();
      if (ui.cursorMode === cursorMode) ui.setCursor('default', null);
    };
  }, [
    disabled,
    motion,
    strength,
    maxDistance,
    padding,
    scale,
    cursorMode,
    cursorLabel,
    innerSelector,
    innerStrength,
  ]);

  return ref;
}
