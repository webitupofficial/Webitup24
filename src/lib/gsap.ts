'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

/**
 * lib/gsap.ts
 *
 * One place where GSAP plugins are registered and shared easing/duration constants live.
 *
 * WHY CENTRALISE REGISTRATION:
 * `gsap.registerPlugin` is idempotent, so calling it in twelve components is harmless but
 * pointless. The real reason is bundling: importing `gsap/ScrollTrigger` from one module means
 * one copy in one chunk. Scattered imports let a route-level chunk pull in its own reference
 * graph, and the plugin ends up duplicated or, worse, loaded before the core in a way that
 * silently no-ops in production but works in dev.
 *
 * Everything here is client-only. `useGSAP` is re-exported so components import a single
 * module rather than three.
 */

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, useGSAP);

  /**
   * `nullTargetWarn: false` — ScrollTrigger animations frequently target refs that are
   * conditionally rendered (a section that only exists when Sanity returns data). A null target
   * is a legitimate no-op in that case, and the console noise trains people to ignore warnings
   * that do matter.
   */
  gsap.config({ nullTargetWarn: false });

  /**
   * Global defaults. Setting them once means every tween in the codebase shares a rhythm
   * without each author picking their own duration — which is the single most common reason a
   * site feels "assembled" rather than "designed".
   */
  gsap.defaults({
    ease: 'expo.out',
    duration: 1.1,
  });
}

/* ---------------------------------------------------------------------------
 * Motion language
 *
 * Named constants rather than magic numbers at each call site. When the art direction changes
 * — and it will — a single edit here retunes the whole site coherently.
 * ------------------------------------------------------------------------- */

export const EASE = {
  /** The house ease. Fast out of the gate, long settle. Reads as confident. */
  out: 'expo.out',
  /** For elements leaving — mirror of `out` so exits feel like the reverse of entrances. */
  in: 'expo.in',
  /** Symmetric, for pinned scrubs where an asymmetric ease looks like a stutter. */
  inOut: 'power3.inOut',
  /** Overshoot. Use sparingly: one element per viewport, or it reads as gimmicky. */
  back: 'back.out(1.7)',
  /** Near-linear, for scroll-scrubbed timelines. See the note below. */
  scrub: 'none',
} as const;

export const DURATION = {
  fast: 0.4,
  base: 0.8,
  slow: 1.2,
  /** Headline reveals. Long enough to be noticed, short enough not to gate reading. */
  reveal: 1.4,
} as const;

/**
 * Stagger for split-text and grid reveals.
 *
 * 0.04s is roughly two frames at 60fps. Below ~0.02 the stagger is imperceptible and you have
 * paid the cost of N tweens for nothing; above ~0.08 a long headline takes so long that the
 * user starts reading before the animation finishes, which is worse than no animation.
 */
export const STAGGER = {
  chars: 0.022,
  words: 0.055,
  lines: 0.08,
  cards: 0.09,
} as const;

/**
 * IMPORTANT — eases on scrubbed timelines.
 *
 * A scrubbed ScrollTrigger maps scroll position directly to timeline progress. Applying an ease
 * to a tween inside it means the element's velocity no longer matches the user's scroll
 * velocity, which the eye reads as the page failing to keep up. Always use `EASE.scrub`
 * ('none') inside `scrub: true` timelines, and put the smoothing on the trigger instead:
 * `scrub: 1` gives a 1-second catch-up that feels intentional.
 */

export { gsap, ScrollTrigger, useGSAP };

/* ---------------------------------------------------------------------------
 * Shared ScrollTrigger defaults
 * ------------------------------------------------------------------------- */

/**
 * The standard reveal trigger window.
 *
 * `top 85%` — fires when the element's top reaches 85% down the viewport, i.e. just after it
 * becomes visible. Firing at `top bottom` (the moment of first pixel) means the animation is
 * already finished by the time the element is comfortably in view, so the user never sees it.
 *
 * `once: true` on reveals: replaying an entrance when the user scrolls back up is a common
 * default and almost always wrong — it implies the content changed when it did not.
 */
export const REVEAL_TRIGGER = {
  start: 'top 85%',
  once: true,
} as const;

/** Scrubbed section trigger, for parallax and pinned sequences. */
export const SECTION_SCRUB = {
  start: 'top bottom',
  end: 'bottom top',
  scrub: 1 as const,
};
