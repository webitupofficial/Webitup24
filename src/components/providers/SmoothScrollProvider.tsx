'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { frameState, resetFrameState } from '@/lib/store/frameState';
import { useUIStore } from '@/lib/store/useUIStore';
import { TIER_SETTINGS } from '@/lib/hooks/useCapabilities';

/**
 * SmoothScrollProvider — the Lenis ⇄ GSAP ScrollTrigger ⇄ R3F bridge.
 *
 * =========================================================================
 * THE PROBLEM
 * =========================================================================
 * Three systems each want to own the frame loop:
 *   • Lenis runs its own rAF to interpolate scroll.
 *   • GSAP runs `gsap.ticker` for tweens.
 *   • React Three Fiber runs its own rAF for `useFrame`.
 *
 * Left alone that is three independent rAF callbacks per frame in nondeterministic order.
 * The symptom is specific and instantly recognisable: WebGL content pinned or parallaxed
 * against the page jitters by a pixel or two, because on some frames the canvas reads a
 * scroll value from before Lenis updated it and on others from after.
 *
 * =========================================================================
 * THE FIX: ONE CLOCK, EXPLICIT ORDER
 * =========================================================================
 * Disable Lenis' internal rAF (`autoRaf: false`) and drive it from `gsap.ticker`, making
 * GSAP the single clock. Per frame the order becomes deterministic:
 *
 *   1. gsap.ticker fires
 *   2. → lenis.raf(t)           — integrate scroll, write frameState.scrollProgress
 *   3. → ScrollTrigger.update() — pins/scrubs read the just-updated position
 *   4. → GSAP tweens advance
 *   5. R3F useFrame             — shaders read frameState, already correct for this frame
 *
 * `lagSmoothing(0)` disables GSAP's stall recovery. That feature detects a long frame and
 * fabricates a smaller delta to avoid a visual jump — helpful for standalone tweens, actively
 * harmful when GSAP is also the scroll clock, because it desynchronises the tween timeline
 * from the scroll position driving it.
 *
 * =========================================================================
 * WHY THERE IS NO `ScrollTrigger.scrollerProxy()` HERE
 * =========================================================================
 * Nearly every Lenis+GSAP snippet online includes one. It is wrong for this configuration,
 * and adding it causes bugs rather than fixing them.
 *
 * In its default (document) mode Lenis performs *real native scrolling* — it interpolates a
 * target offset and calls `window.scrollTo()` with the result. So `window.scrollY` already
 * IS the smoothed position, and ScrollTrigger's default scroller reads it correctly with no
 * adapter. A proxy is only needed when Lenis is in wrapper mode, where it translates a
 * container with a CSS transform and the document never actually scrolls.
 *
 * Installing a proxy anyway means ScrollTrigger's `scrollTop` setter calls
 * `lenis.scrollTo(v, { immediate: true })` while pinning, which re-enters Lenis mid-update
 * and produces a feedback loop: pinned sections stutter and `end` markers drift.
 * =========================================================================
 */

// Registered at module scope. Inside a component body this re-runs every render — GSAP
// dedupes, but it's wasted work and hides the intent.
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

/** Shared instance for the imperative `scrollTo` helper at the bottom of this file. */
let sharedLenis: Lenis | null = null;

interface SmoothScrollProviderProps {
  children: React.ReactNode;
  /** Override from Sanity `siteSettings.motionDefaults.scrollLerp`. */
  lerp?: number;
}

export function SmoothScrollProvider({ children, lerp }: SmoothScrollProviderProps) {
  const lenisRef = useRef<Lenis | null>(null);
  const pathname = usePathname();
  /** Guards the route-change effect from running its teardown logic on first mount. */
  const mountedRef = useRef(false);

  const motion = useUIStore((s) => s.motion);
  const tier = useUIStore((s) => s.tier);

  useEffect(() => {
    /**
     * Reduced motion: do not instantiate Lenis at all.
     *
     * Smooth scrolling *is* motion — it decouples the viewport from the input device and is a
     * documented vestibular trigger. Running Lenis with lerp 1 would technically remove the
     * easing but still hijack the scroll event, break native scroll-anchoring, and interfere
     * with assistive technology. Not running it is both simpler and more correct.
     *
     * ScrollTrigger keeps working — it just reads native scroll. Reveal animations still fire;
     * they're just instant fades (see `Reveal`/`SplitTextReveal`, which check motion level).
     */
    if (motion === 'none') {
      document.documentElement.classList.remove('lenis');
      // Native scroll needs a real scroll listener to publish progress for anything still
      // reading frameState (the header, the progress bar).
      const onNativeScroll = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        frameState.scrollY = window.scrollY;
        frameState.scrollProgress = max > 0 ? window.scrollY / max : 0;
        frameState.scrollVelocity = 0; // No meaningful per-frame velocity from native scroll.
      };
      window.addEventListener('scroll', onNativeScroll, { passive: true });
      onNativeScroll();
      ScrollTrigger.refresh();
      return () => window.removeEventListener('scroll', onNativeScroll);
    }

    const settings = TIER_SETTINGS[tier];

    const lenis = new Lenis({
      // Higher = snappier. Sanity override wins, then the per-tier default.
      lerp: lerp ?? settings.scrollLerp,

      /**
       * Wheel multiplier below 1 because the shader reads scroll *velocity*: at 1.0 a single
       * trackpad flick saturates the uniform and the blob snaps. 0.9 keeps the response
       * inside its useful range without feeling sluggish.
       */
      wheelMultiplier: 0.9,
      touchMultiplier: 1.6,

      /**
       * Touch devices get NATIVE scroll. Deliberate and non-negotiable:
       *   • iOS Safari's URL-bar collapse only happens on native scroll. Intercepting it
       *     leaves the bar permanently visible and a viewport ~60px shorter than 100vh claims.
       *   • Momentum scrolling is implemented in the compositor. JS-driven scroll on touch
       *     runs on the main thread and is measurably worse on exactly the devices least able
       *     to absorb it.
       */
      syncTouch: false,
      smoothWheel: true,

      // We drive this from gsap.ticker — see the module comment.
      autoRaf: false,

      infinite: false,
      orientation: 'vertical',
      gestureOrientation: 'vertical',
    });

    lenisRef.current = lenis;
    sharedLenis = lenis;

    /* --------------------------------------------------------------------
     * Publish scroll state for the WebGL layer
     * ------------------------------------------------------------------ */
    const onScroll = (e: { scroll: number; limit: number; velocity: number; progress: number }) => {
      frameState.scrollY = e.scroll;
      // Guard the value: `progress` is NaN on a page shorter than the viewport (limit 0), and
      // a NaN reaching a shader uniform silently blanks the entire mesh — one of the harder
      // WebGL bugs to trace, because nothing errors.
      frameState.scrollProgress = Number.isFinite(e.progress) ? e.progress : 0;

      /**
       * Normalise velocity to roughly -1..1. Lenis reports pixels-per-frame, which reaches
       * ~150 on a hard flick. Dividing by 50 puts ordinary scrolling in the 0..1 band the
       * shader expects while leaving headroom before the clamp.
       */
      frameState.scrollVelocity = Math.max(-1, Math.min(1, e.velocity / 50));
    };

    lenis.on('scroll', onScroll);
    // Keep ScrollTrigger's cached position in sync on every Lenis tick.
    lenis.on('scroll', ScrollTrigger.update);

    /* --------------------------------------------------------------------
     * The single clock
     * ------------------------------------------------------------------ */
    const tick = (time: number) => {
      // gsap.ticker reports seconds; Lenis expects milliseconds.
      lenis.raf(time * 1000);
    };

    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    /* --------------------------------------------------------------------
     * Layout invalidation
     * ------------------------------------------------------------------ */
    /**
     * ScrollTrigger caches each trigger's start/end pixel offsets. Anything that changes
     * document height invalidates that cache, and a stale cache means animations firing at
     * the wrong scroll position — the classic "works until you resize" bug.
     *
     * ResizeObserver on <body> catches all of it: font swaps, images loading without
     * intrinsic dimensions, accordions opening, the canvas resizing. A `window.resize`
     * listener alone misses every same-viewport height change, which is most of them.
     */
    const resizeObserver = new ResizeObserver(() => {
      // rAF-deferred: ResizeObserver fires before paint, and refreshing synchronously forces
      // a second layout pass in the same frame.
      requestAnimationFrame(() => {
        lenis.resize();
        ScrollTrigger.refresh();
      });
    });
    resizeObserver.observe(document.body);

    // Late webfonts reflow every text block and shift every trigger.
    void document.fonts?.ready.then(() => ScrollTrigger.refresh());

    document.documentElement.classList.add('lenis');

    return () => {
      lenis.off('scroll', onScroll);
      lenis.off('scroll', ScrollTrigger.update);
      gsap.ticker.remove(tick);
      // Restore GSAP's default so any later non-scroll page isn't left without stall recovery.
      gsap.ticker.lagSmoothing(500, 33);
      resizeObserver.disconnect();
      lenis.destroy();
      lenisRef.current = null;
      sharedLenis = null;
      document.documentElement.classList.remove('lenis');
    };
  }, [motion, tier, lerp]);

  /* ----------------------------------------------------------------------
   * Route changes
   * -------------------------------------------------------------------- */
  useEffect(() => {
    // Skip on first mount: there is nothing to reset, and — critically — child effects have
    // already run by the time a parent effect fires, so any cleanup here would destroy the
    // ScrollTriggers the initial page just registered.
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }

    const lenis = lenisRef.current;

    // Jump, don't animate. Easing a route change reads as the browser being slow.
    if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
    else window.scrollTo(0, 0);

    resetFrameState();

    /**
     * NOTE ON TRIGGER CLEANUP: we deliberately do NOT call
     * `ScrollTrigger.getAll().forEach(t => t.kill())` here.
     *
     * React runs child effects before parent effects, so by the time this fires the *incoming*
     * route's components have already registered their triggers — killing everything would
     * destroy the new page's animations and leave a dead scroll.
     *
     * Per-component cleanup is the correct mechanism, and it is handled by `useGSAP` from
     * @gsap/react, which reverts everything created inside its scope on unmount. Any trigger
     * created outside a `useGSAP` scope must clean itself up in its own effect return. That
     * convention is enforced by review, not by a global sweep here.
     */

    // Two rAFs: one for React to commit the new tree, one for the browser to lay it out.
    // Refreshing earlier measures the outgoing page's geometry.
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        lenisRef.current?.resize();
        ScrollTrigger.refresh();
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [pathname]);

  /* ----------------------------------------------------------------------
   * Lock scrolling while the menu is open
   * -------------------------------------------------------------------- */
  const menuOpen = useUIStore((s) => s.menuOpen);
  useEffect(() => {
    const lenis = lenisRef.current;
    if (!lenis) {
      // Native-scroll fallback (reduced motion).
      document.body.style.overflow = menuOpen ? 'hidden' : '';
      return () => {
        document.body.style.overflow = '';
      };
    }
    if (menuOpen) lenis.stop();
    else lenis.start();
  }, [menuOpen]);

  return <>{children}</>;
}

/* ---------------------------------------------------------------------------
 * Imperative scroll, for anchor links and "back to top".
 *
 * A module function rather than context: it needs to be callable from event handlers deep in
 * the tree, and threading a provider through purely to expose one imperative method is more
 * machinery than the problem deserves.
 * ------------------------------------------------------------------------- */
export function scrollTo(
  target: string | number | HTMLElement,
  options: { offset?: number; duration?: number; immediate?: boolean } = {}
) {
  const { offset = 0, duration = 1.2, immediate = false } = options;

  if (sharedLenis) {
    sharedLenis.scrollTo(target, { offset, duration, immediate });
    return;
  }

  // Reduced-motion path. `behavior: 'auto'` jumps instantly, which is what the preference asks
  // for — using 'smooth' here would reintroduce exactly the motion we removed Lenis to avoid.
  const el =
    typeof target === 'string'
      ? document.querySelector(target)
      : target instanceof HTMLElement
        ? target
        : null;

  if (el) {
    const top = el.getBoundingClientRect().top + window.scrollY + offset;
    window.scrollTo({ top, behavior: 'auto' });
  } else if (typeof target === 'number') {
    window.scrollTo({ top: target + offset, behavior: 'auto' });
  }
}

/** Read-only access for components that need to query scroll state imperatively. */
export function getLenis(): Lenis | null {
  return sharedLenis;
}
