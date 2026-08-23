'use client';

import { useRef } from 'react';

import { DURATION, EASE, REVEAL_TRIGGER, STAGGER, ScrollTrigger, gsap, useGSAP } from '@/lib/gsap';
import { useUIStore } from '@/lib/store/useUIStore';
import { cn } from '@/lib/utils/cn';

/**
 * =============================================================================
 * Reveal — the scroll-triggered entrance for everything that is not text
 * =============================================================================
 *
 * `SplitTextReveal` handles headlines, where the unit of animation is a line or a word. This is its
 * counterpart for blocks: cards, images, stat rows, list items. Two modes:
 *
 *   • Default — the wrapper itself fades and rises as one object.
 *   • `stagger` — the wrapper's *direct children* animate in sequence. For a grid, so the cards
 *     cascade rather than the whole grid arriving as a slab.
 *
 * -----------------------------------------------------------------------------
 * WHY THE CHILDREN ARE FOUND WITH `children` AND NOT A SELECTOR PROP
 * -----------------------------------------------------------------------------
 * `gsap.utils.toArray(el.children)` takes the wrapper's direct element children, whatever they are.
 * A selector prop (`stagger=".card"`) would be more flexible and is what most implementations do —
 * and it is also how a refactor that renames a class silently turns a staggered grid into a static
 * one, with no error anywhere. Direct children cannot go stale.
 *
 * The tradeoff is that the caller must render the staggered items as immediate children. That is a
 * real constraint, so it is stated in the prop's doc comment rather than left to be discovered.
 *
 * -----------------------------------------------------------------------------
 * NO-JS AND REDUCED MOTION
 * -----------------------------------------------------------------------------
 * The hidden state is applied by GSAP in a layout effect, never in a class or inline style on the
 * server. That ordering is the whole reason this is safe: with JavaScript broken, disabled, or still
 * downloading, the content is simply *visible* — there is no `opacity: 0` in the markup waiting for
 * a script that may never arrive to undo it. Under `motion: 'none'` the effect returns immediately,
 * which is both the correct behaviour and zero work.
 */

type RevealTag = 'div' | 'section' | 'ul' | 'ol' | 'li' | 'article' | 'header' | 'footer' | 'figure';

export interface RevealProps {
  children: React.ReactNode;
  as?: RevealTag;
  className?: string;
  /**
   * Animate direct children in sequence instead of the wrapper as a whole. The items MUST be
   * immediate children of this component (see the file header).
   */
  stagger?: boolean;
  /** Per-item stagger in seconds. Defaults to the house card value. */
  staggerEach?: number;
  /** Delay before the first element moves. */
  delay?: number;
  /** Travel distance in pixels. Smaller for dense lists, larger for full-width blocks. */
  distance?: number;
  /** ScrollTrigger `start`. Defaults to the shared reveal window (`top 85%`). */
  start?: string;
  /** Animate on mount rather than on scroll. For above-the-fold blocks. */
  immediate?: boolean;
  /** Scale up slightly as it rises. Reads as "arriving"; best on media, wrong on text blocks. */
  scale?: boolean;
}

export function Reveal({
  children,
  as: Tag = 'div',
  className,
  stagger = false,
  staggerEach = STAGGER.cards,
  delay = 0,
  distance = 32,
  start = REVEAL_TRIGGER.start,
  immediate = false,
  scale = false,
}: RevealProps) {
  const rootRef = useRef<any>(null);
  const motion = useUIStore((s) => s.motion);

  /**
   * `useGSAP` rather than a bare `useLayoutEffect`.
   *
   * It creates a `gsap.context` scoped to `rootRef` and reverts it on cleanup — which for a
   * ScrollTrigger-driven tween means the trigger is killed too. A plain effect that only reverted
   * the tween would leave an orphaned ScrollTrigger holding a reference to a detached element, and
   * a page with twenty of those accumulates them across client navigations until scroll performance
   * visibly degrades. This is the leak that `useGSAP` exists to prevent.
   */
  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;

      // Reduced motion: leave everything as the server rendered it.
      if (motion === 'none') return;

      const targets: HTMLElement[] = stagger
        ? (gsap.utils.toArray(root.children) as HTMLElement[])
        : [root];

      if (targets.length === 0) return;

      /**
       * `motion: 'lite'` — opacity only, no travel, no stagger.
       *
       * Transforms are the expensive half of this animation on a low-end device (each animated
       * element is promoted to its own compositor layer), and they are also the half a
       * reduced-motion user is actually asking not to see. Fading is both cheaper and gentler.
       */
      const lite = motion === 'lite';

      const from: Record<string, number> = { opacity: 0 };
      const to: Record<string, number> = { opacity: 1 };

      if (!lite) {
        from.y = distance;
        to.y = 0;
        if (scale) {
          from.scale = 0.96;
          to.scale = 1;
        }
      }

      gsap.set(targets, from);

      gsap.to(targets, {
        ...to,
        duration: lite ? DURATION.base : DURATION.slow,
        delay,
        ease: EASE.out,
        stagger: stagger && !lite ? staggerEach : 0,
        /**
         * Clear the inline transform once settled, for the same reason `SplitTextReveal` does:
         * a lingering `transform` keeps every revealed element on its own compositor layer for the
         * rest of the session, and on a grid of twenty cards that is twenty layers held for an
         * animation that ran once.
         */
        onComplete: () => {
          gsap.set(targets, { clearProps: 'transform,opacity,scale' });
        },
        ...(immediate
          ? {}
          : {
              scrollTrigger: {
                trigger: root,
                start,
                once: true,
                /**
                 * `invalidateOnRefresh` recalculates the from-values on refresh. Needed because
                 * `SplitTextReveal` debounces a global `ScrollTrigger.refresh()` after it splits,
                 * which can land mid-flight on a page where a headline sits above a grid.
                 */
                invalidateOnRefresh: true,
              },
            }),
      });

      /**
       * Reveals change nothing about document height, so no refresh is scheduled here — unlike
       * splitting, which does. Adding one would be a full recalculation of every trigger on the
       * page for no reason.
       */
      void ScrollTrigger;
    },
    // `motion` in the dependency list: the tier is resolved after mount, so the first run happens
    // under the pessimistic `'none'` default and this is what re-runs it once the real tier lands.
    { scope: rootRef, dependencies: [motion, stagger, staggerEach, delay, distance, start, immediate, scale] }
  );

  return (
    <Tag ref={rootRef as any} className={cn(className)}>
      {children}
    </Tag>
  );
}
