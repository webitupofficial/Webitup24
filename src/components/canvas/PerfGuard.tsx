'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { AdaptiveDpr, PerformanceMonitor } from '@react-three/drei';

import { useUIStore } from '@/lib/store/useUIStore';

/**
 * PerfGuard — everything that keeps the canvas honest about its frame budget.
 *
 * Four independent jobs, all of which are the difference between a demo and a site:
 *
 *   1. Measure real frame times and degrade resolution when they slip (PerformanceMonitor +
 *      AdaptiveDpr). Device-tier detection is a *guess made before rendering anything*; this is
 *      the correction based on what actually happened.
 *   2. Stop rendering when the canvas is not visible.
 *   3. Survive WebGL context loss instead of leaving a black rectangle.
 *   4. Tell the DOM layer when the first frame has actually landed, so the poster image can be
 *      removed at the right moment rather than optimistically.
 *
 * =========================================================================
 * WHY DPR AND NOT QUALITY SETTINGS
 * =========================================================================
 * When frames start slipping there are three levers: draw fewer things, run a cheaper shader, or
 * render fewer pixels. The first two require rebuilding geometry or recompiling a program — both
 * of which cause a hitch *at the exact moment the device is already struggling*, making the
 * problem visibly worse before it gets better.
 *
 * Resolution is the only lever that is free to pull. Dropping DPR from 1.75 to 1.0 cuts fragment
 * work by ~67% with no allocation, no recompile, and no stall — and because this scene is
 * overwhelmingly fragment-bound (a full-screen fresnel-and-noise surface plus four post passes),
 * it is also the lever with the most authority. On a heavily blurred, grainy, bloomed image the
 * resolution drop is close to imperceptible, which is a happy accident of the art direction.
 */

export interface PerfGuardProps {
  /**
   * The element whose visibility gates rendering. Normally the canvas wrapper.
   * Omitted → rendering is gated on document visibility only.
   */
  observeRef?: React.RefObject<HTMLElement | null>;
}

export function PerfGuard({ observeRef }: PerfGuardProps) {
  const setWebglReady = useUIStore((s) => s.setWebglReady);

  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const setFrameloop = useThree((s) => s.setFrameloop);

  /* ----------------------------------------------------------------------
   * 1. First-frame signal
   * -------------------------------------------------------------------- */
  useEffect(() => {
    /**
     * Two rAFs, not one.
     *
     * By the time this effect runs, R3F has created the renderer but has not necessarily
     * *presented* a frame. One rAF gets us to the frame in which the draw is issued; the second
     * guarantees that frame has been composited. Signalling early means the poster image fades
     * out over a canvas that is still black — a flash that is far more noticeable than the extra
     * 16ms of waiting.
     */
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setWebglReady(true));
    });
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
      // On unmount the canvas is gone, so the DOM must stop believing WebGL is up — otherwise a
      // route that has no canvas keeps its poster hidden and shows empty space.
      setWebglReady(false);
    };
  }, [setWebglReady]);

  /* ----------------------------------------------------------------------
   * 2. Visibility gating
   * -------------------------------------------------------------------- */
  useEffect(() => {
    const el = observeRef?.current;

    /**
     * `document.hidden` alone is not enough.
     *
     * Browsers throttle `requestAnimationFrame` in background *tabs*, so a hidden tab is mostly
     * handled for us. What is not handled: the canvas scrolled off-screen in a *foreground* tab.
     * rAF keeps firing at full rate, and the GPU keeps rendering a full-screen shader nobody can
     * see. On a laptop that is a measurable, audible fan-spinning cost while the user reads the
     * case study text three screens down.
     */
    const observer = el
      ? new IntersectionObserver(
          ([entry]) => {
            if (!entry) return;
            if (entry.isIntersecting) {
              setFrameloop('always');
              invalidate();
            } else {
              setFrameloop('never');
            }
          },
          /**
           * A generous root margin. Resuming exactly at the viewport edge means the first
           * visible frame is also the frame in which the loop restarts, and any catch-up work
           * (the damped values converging from where they were parked) happens on screen.
           * Starting 25% of a viewport early gives it somewhere to happen unseen.
           */
          { rootMargin: '25% 0px 25% 0px', threshold: 0 }
        )
      : null;

    if (el && observer) observer.observe(el);

    const onVisibility = () => {
      if (document.hidden) {
        setFrameloop('never');
      } else {
        setFrameloop('always');
        invalidate();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      // Leave the loop running on teardown. A paused frameloop that outlives this effect is a
      // permanently frozen canvas, and that failure is silent.
      setFrameloop('always');
    };
  }, [observeRef, setFrameloop, invalidate]);

  /* ----------------------------------------------------------------------
   * 3. Context loss
   * -------------------------------------------------------------------- */
  useEffect(() => {
    const canvas = gl.domElement;

    /**
     * WebGL contexts are lost in production, routinely, for reasons the page did not cause:
     * the GPU driver resets, the OS reclaims VRAM under pressure, the laptop switches from
     * discrete to integrated graphics on unplug, a background tab exceeds the browser's context
     * budget. Chrome's limit is around 16 live contexts across all tabs.
     *
     * `preventDefault()` on `webglcontextlost` is mandatory: without it the browser will never
     * fire `webglcontextrestored`, and the canvas stays black forever. This one line is the
     * entire difference between a transient blip and a broken page.
     */
    const onLost = (event: Event) => {
      event.preventDefault();
      setWebglReady(false);
      if (process.env.NODE_ENV === 'development') {
        console.warn('[PerfGuard] WebGL context lost — poster fallback is now visible.');
      }
    };

    const onRestored = () => {
      /**
       * three.js reinitialises its own GPU-side state (programs, textures, buffers) on restore,
       * so there is nothing for us to rebuild. What we do have to do is nudge the loop: after a
       * restore the frameloop can be sitting idle, and without an explicit invalidate the canvas
       * stays blank despite having a perfectly good context.
       */
      invalidate();
      setWebglReady(true);
    };

    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    };
  }, [gl, invalidate, setWebglReady]);

  /* ----------------------------------------------------------------------
   * 4. Adaptive quality
   * -------------------------------------------------------------------- */
  const onDecline = useCallback(() => {
    if (process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DEBUG_WEBGL === 'true') {
      console.info('[PerfGuard] Frame budget missed — reducing DPR.');
    }
  }, []);

  const onIncline = useCallback(() => {
    if (process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DEBUG_WEBGL === 'true') {
      console.info('[PerfGuard] Headroom available — restoring DPR.');
    }
  }, []);

  return (
    <>
      <PerformanceMonitor
        /**
         * `bounds` maps measured frame rate to the acceptable window, in fps. Derived from the
         * refresh rate so a 120Hz display is not judged against a 60Hz target — otherwise a
         * ProMotion iPad running a flawless 60fps would be treated as failing and downgraded.
         *
         * The lower bound is 55 rather than 60: a hard 60 floor triggers on the single long frame
         * that every page has (a font swap, a lazy chunk arriving) and downgrades a device that
         * was fine.
         */
        bounds={(refreshRate) => (refreshRate > 90 ? [55, 500] : [50, 65])}
        /**
         * `flipflops` — after this many decline/incline oscillations, PerformanceMonitor gives up
         * and freezes the factor. Without it a device sitting exactly at the threshold ping-pongs
         * between DPR levels forever, and a canvas whose resolution changes twice a second is
         * far more distracting than one that is simply a bit soft.
         */
        flipflops={3}
        /** Starting quality factor, 0..1. Mid-range so the first correction is small in
         * whichever direction it needs to go. */
        factor={0.75}
        /** How far each correction moves the factor. Small = several gentle steps rather than
         * one jarring resolution jump. */
        step={0.1}
        onDecline={onDecline}
        onIncline={onIncline}
      >
        {/**
         * AdaptiveDpr reads `state.performance.current` — which PerformanceMonitor writes — and
         * rescales the drawing buffer. It must be *inside* PerformanceMonitor to see those
         * updates.
         *
         * `pixelated` is deliberately off. It sets `image-rendering: pixelated` on the canvas
         * during regression, which turns a soft downscale into visible chunky pixels. Bilinear
         * upscaling of a blurred, grainy, bloomed image is nearly invisible; nearest-neighbour
         * upscaling of it looks broken.
         */}
        <AdaptiveDpr />
      </PerformanceMonitor>
    </>
  );
}

/**
 * A ref-holder for the canvas wrapper element, shared between the DOM component that renders it
 * and the PerfGuard inside the canvas.
 *
 * Passing a ref *into* the R3F tree is legitimate — the two reconcilers are separate, but refs
 * are just objects and cross the boundary fine. What does not cross is context, which is why
 * every piece of shared state in this codebase is either a prop, a zustand store, or the
 * `frameState` singleton.
 */
export type CanvasWrapperRef = React.RefObject<HTMLDivElement | null>;
