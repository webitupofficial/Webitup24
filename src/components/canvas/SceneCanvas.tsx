'use client';

import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';

import { TIER_SETTINGS } from '@/lib/hooks/useCapabilities';
import { useUIStore } from '@/lib/store/useUIStore';
import { Experience, GLDebug } from './Experience';

/**
 * =============================================================================
 * SceneCanvas — the DOM side of the WebGL layer.
 * =============================================================================
 *
 * Mounted exactly once, in the site layout, and never unmounted by navigation. `Experience`
 * owns what is drawn; this owns the canvas element, its GL configuration, when it is allowed to
 * exist at all, and what is shown when it is not.
 *
 * -----------------------------------------------------------------------------
 * 1. WHY THE CANVAS IS FIXED AND `pointer-events: none`
 * -----------------------------------------------------------------------------
 * The canvas is a `position: fixed` full-viewport layer behind all content. It never scrolls;
 * the *scene* responds to scroll via `frameState.scrollProgress`. That is what makes a
 * scroll-driven 3D background possible without any of the compositing pathologies of a canvas
 * that is itself in the scroll flow (repaints, iOS's scroll-position rounding, and a canvas that
 * has to be as tall as the document).
 *
 * `pointer-events: none` is then mandatory rather than optional: a full-viewport element on top
 * of — or beneath, but still hit-testable in — the content would swallow every click, hover and
 * text selection on the page. This is the single most common way a WebGL background breaks a
 * site, and it breaks it completely.
 *
 * Because the canvas cannot receive events, cursor interaction is fed from `PointerProvider`'s
 * one global listener into `frameState`, and `FluidBlob` raycasts manually. `eventSource` below
 * is configured anyway so that R3F's own event system still works if a future scene needs a
 * clickable 3D object.
 *
 * -----------------------------------------------------------------------------
 * 2. LAZY MOUNT — the brief's "WebGL canvas must lazy-load"
 * -----------------------------------------------------------------------------
 * The canvas does not render on the server and does not render on the client's first paint.
 * Three gates, in order:
 *
 *   a. `mounted` — set in an effect, so the canvas never exists during hydration. Rendering a
 *      `<Canvas>` on the server produces markup React then throws away, and acquiring a GL
 *      context during hydration competes with it for the main thread.
 *   b. `webglEnabled` — from `useCapabilities`. False for reduced-motion, no-WebGL, and the
 *      Sanity kill-switch.
 *   c. `deferred` — an idle-callback gate, so context creation happens after first paint.
 *      Acquiring a WebGL context is 20–120ms of synchronous main-thread work; doing it before
 *      first paint puts it directly into LCP. After, it costs nothing the user can perceive.
 *
 * Combined effect: LCP is a static poster and text. The canvas fades in over it.
 *
 * -----------------------------------------------------------------------------
 * 3. DPR — the brief's `dpr={[1, 1.5]}`
 * -----------------------------------------------------------------------------
 * A tuple is a *range*: R3F clamps `window.devicePixelRatio` into it, and `AdaptiveDpr` inside
 * `PerfGuard` rescales within it when frames slip. The mid tier is exactly `[1, 1.5]`.
 *
 * Why cap below native at all: this scene is fragment-bound — a full-screen surface running FBM
 * noise, fresnel and iridescence, plus four post passes. Fragment cost scales with the square of
 * DPR, so rendering a 3× retina phone natively is 9× the work of DPR 1 for an image the user
 * cannot resolve the difference in. 1.5 is the point where the blob's gradients stop showing
 * banding; beyond it you are paying for nothing.
 */

/** Delay before allowing context creation if `requestIdleCallback` is unavailable (Safari). */
const IDLE_FALLBACK_MS = 400;

export interface SceneCanvasProps {
  /**
   * A poster image URL, shown when WebGL is unavailable or before the first frame lands.
   * Normally the current project's `heroMedia.poster` from Sanity.
   */
  posterUrl?: string | null;
  /** Alt text for the poster. Empty string marks it decorative, which it usually is. */
  posterAlt?: string;
  /** Extra classes on the wrapper, for pages that need a different stacking context. */
  className?: string;
}

export function SceneCanvas({ posterUrl, posterAlt = '', className }: SceneCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  const webglEnabled = useUIStore((s) => s.webglEnabled);
  const webglReady = useUIStore((s) => s.webglReady);
  const tier = useUIStore((s) => s.tier);

  const [mounted, setMounted] = useState(false);
  const [deferred, setDeferred] = useState(false);

  /* ----------------------------------------------------------------------
   * Gate (a): never during SSR or hydration.
   * -------------------------------------------------------------------- */
  useEffect(() => setMounted(true), []);

  /* ----------------------------------------------------------------------
   * Gate (c): wait for idle.
   * -------------------------------------------------------------------- */
  useEffect(() => {
    if (!mounted) return;

    /**
     * `requestIdleCallback` yields until the browser has nothing better to do, which is precisely
     * the semantics we want: never delay content, never compete with hydration. The `timeout`
     * guarantees it fires even on a page that stays busy — without one, a heavy hydration can
     * starve it indefinitely and the canvas simply never appears.
     *
     * Safari has no `requestIdleCallback` (still, as of 2026), hence the timeout fallback.
     */
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const w = window as IdleWindow;

    if (typeof w.requestIdleCallback === 'function') {
      const handle = w.requestIdleCallback(() => setDeferred(true), { timeout: 1200 });
      return () => w.cancelIdleCallback?.(handle);
    }

    const timer = window.setTimeout(() => setDeferred(true), IDLE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [mounted]);

  /* ----------------------------------------------------------------------
   * Mirror `webglReady` onto `<html data-webgl>`.
   *
   * `tailwind.config.ts` declares a `webgl-ready:` variant keyed on `[data-webgl="ready"]`, and
   * this is its only writer. Sections use it to hand off from a static treatment to the live one
   * — a hero's CSS gradient fading out once the shader is genuinely painting, for instance —
   * which has to be expressible in CSS because the alternative is every section subscribing to
   * the store and re-rendering on a value it only needs for a class name.
   *
   * `PerfGuard` owns the flag itself: it sets it true after the first real frame and false again
   * on context loss, so the attribute tracks what is actually on screen rather than what we
   * intended to render.
   * -------------------------------------------------------------------- */
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.webgl = webglReady ? 'ready' : 'idle';
    return () => {
      delete root.dataset.webgl;
    };
  }, [webglReady]);

  const shouldRenderCanvas = mounted && deferred && webglEnabled;
  const settings = TIER_SETTINGS[tier];

  return (
    <div
      ref={wrapperRef}
      /**
       * A stable hook for anything that needs to address the WebGL layer without knowing its
       * classes — currently the print stylesheet, which hides every fixed overlay because a
       * full-viewport near-black div prints as an entire page of ink.
       */
      data-canvas-root
      /**
       * `-z-10` puts the layer behind content in the same stacking context. `pointer-events-none`
       * is on the wrapper rather than only the canvas so the poster does not intercept clicks
       * either. `contain: strict` tells the browser this subtree cannot affect outside layout,
       * which lets it skip the wrapper during layout passes triggered by content changes.
       */
      className={['pointer-events-none fixed inset-0 -z-10 overflow-hidden', className]
        .filter(Boolean)
        .join(' ')}
      style={{ contain: 'strict' }}
      aria-hidden="true"
    >
      {/* ------------------------------------------------------------------
        * Fallback layer. Always rendered, faded out once WebGL is live.
        *
        * Kept mounted rather than swapped: it is the poster during load, the permanent visual on
        * reduced-motion and no-WebGL devices, AND what is revealed if the GL context is lost
        * mid-session. Three jobs, one element, no state machine.
        * ---------------------------------------------------------------- */}
      <CanvasFallback
        posterUrl={posterUrl}
        posterAlt={posterAlt}
        hidden={shouldRenderCanvas && webglReady}
      />

      {shouldRenderCanvas ? (
        <Canvas
          /**
           * The DPR range. `AdaptiveDpr` rescales inside it under load; R3F clamps
           * `devicePixelRatio` into it at mount. Per-tier, so a low-end device never
           * supersamples — see the note in the file header.
           */
          dpr={settings.dpr}
          /**
           * `frameloop="always"` because the scene animates continuously. `PerfGuard` switches it
           * to `'never'` when the canvas leaves the viewport or the tab is hidden, which is where
           * the actual saving is. `'demand'` would be wrong: it renders only on `invalidate()`,
           * and a shader driven by a time uniform would need one every frame anyway.
           */
          frameloop="always"
          /**
           * Events sourced from the document, not the canvas.
           *
           * The canvas has `pointer-events: none`, so it receives no events of its own. Pointing
           * R3F at `documentElement` with `eventPrefix="client"` means R3F reads `clientX/clientY`
           * and projects them into the canvas' own coordinate space, so 3D hit-testing still
           * works for any future interactive object — through the DOM content sitting on top.
           */
          eventSource={document.documentElement}
          eventPrefix="client"
          camera={{
            fov: 45,
            near: 0.1,
            /**
             * Far plane at 40, not the default 2000. Depth buffer precision is distributed
             * hyperbolically between near and far: a needlessly distant far plane throws away
             * precision near the camera, which is where every object in this scene is. The
             * symptom is z-fighting between the particle field and the blob's silhouette.
             */
            far: 40,
            position: [0, 0, 4.2],
          }}
          gl={{
            /**
             * MSAA off. There is no geometric aliasing worth fixing here — the blob's edge comes
             * from a fresnel falloff, the particles are radial sprites — and on the high tier the
             * post-processing pipeline renders to its own buffers anyway, where the canvas' MSAA
             * setting does nothing. Enabling it costs memory and bandwidth for no visible change.
             */
            antialias: false,
            /**
             * Opaque canvas. `alpha: false` lets the driver skip per-pixel blending against the
             * page background and allows the browser to composite the canvas as an opaque layer,
             * which is measurably cheaper. The scene has a solid dark backdrop, so there is
             * nothing to see through.
             */
            alpha: false,
            /**
             * Asks a dual-GPU laptop for the discrete chip. Note the trade: on battery this
             * increases power draw, which is exactly why `useCapabilities` honours `saveData` and
             * downgrades on coarse-pointer devices — the request is only made where the full
             * scene is going to run anyway.
             */
            powerPreference: 'high-performance',
            /**
             * No stencil, no depth-buffer preservation. Nothing here uses stencil, and
             * `preserveDrawingBuffer` (needed only for `toDataURL` screenshots) forces the driver
             * to keep the back buffer around after present — a real cost for a feature we do not
             * use.
             */
            stencil: false,
            preserveDrawingBuffer: false,
            /**
             * `failIfMajorPerformanceCaveat` deliberately NOT set. When true, the context request
             * fails outright on a software rasteriser — but `useCapabilities` already detects
             * SwiftShader/llvmpipe and routes those devices to the poster. Leaving this false
             * means an unrecognised-but-functional configuration still gets a scene rather than a
             * hard failure.
             */
          }}
          onCreated={({ gl, scene }) => {
            /**
             * ACES Filmic tone mapping. The fragment shader deliberately produces values above
             * 1.0 in the highlights (that is what makes the bloom threshold meaningful), and
             * ACES rolls those off into a shoulder instead of clipping them to flat white.
             * Linear tone mapping on this material produces blown, chalky specular patches.
             *
             * Set here rather than via the `gl` prop so `toneMappingExposure` can be set in the
             * same place — the two are meaningless apart.
             */
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.05;

            /**
             * Output colour space. This is the three.js default since r152, and it is restated
             * explicitly because the fragment shader ends with `#include <colorspace_fragment>`,
             * whose behaviour depends on it. Making the dependency visible is worth one line.
             */
            gl.outputColorSpace = THREE.SRGBColorSpace;

            /**
             * Clear colour matched to the CSS background token. Any mismatch shows as a hairline
             * seam at the canvas edge, or as a one-frame flash of a different black during the
             * fallback cross-fade.
             */
            gl.setClearColor(new THREE.Color('#08080B'), 1);

            // Fog is not used — the fragment shader does its own depth-independent atmospheric
            // work — but leaving `scene.fog` null explicitly documents that it was a choice.
            scene.fog = null;
          }}
        >
          <Experience wrapperRef={wrapperRef} />
          <GLDebug />
        </Canvas>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Fallback
 * ------------------------------------------------------------------------- */

interface CanvasFallbackProps {
  posterUrl?: string | null;
  posterAlt?: string;
  hidden: boolean;
}

/**
 * The no-WebGL / pre-first-frame visual.
 *
 * Pure CSS when no poster is supplied. Two overlapping radial gradients in the scene's palette
 * approximate the blob's silhouette and colour well enough that the page still looks composed
 * rather than broken — which is the actual requirement. A grey box with a spinner communicates
 * "this site is failing"; a soft violet-and-acid bloom communicates "this is the design".
 *
 * Note there is no animation on this layer at all. It is what a `prefers-reduced-motion` visitor
 * sees permanently, so it must be genuinely static.
 */
function CanvasFallback({ posterUrl, posterAlt = '', hidden }: CanvasFallbackProps) {
  return (
    <div
      className={[
        'absolute inset-0 transition-opacity duration-700 ease-out',
        hidden ? 'opacity-0' : 'opacity-100',
      ].join(' ')}
      /**
       * `aria-hidden` on the wrapper already removes this from the accessibility tree, so the
       * poster carries an empty alt and no role. It is decorative in every case: the meaningful
       * content is the headline in front of it.
       */
    >
      {posterUrl ? (
        <img
          src={posterUrl}
          alt={posterAlt}
          /**
           * Plain `<img>`, not `next/image`. This element is often not rendered at all (WebGL
           * path), and `next/image` would still emit its preload and sizing machinery. It is also
           * always a full-bleed cover with a known URL, so none of what `next/image` optimises
           * applies.
           */
          className="h-full w-full object-cover"
          decoding="async"
          fetchPriority="low"
        />
      ) : null}

      {/* Procedural bloom, layered over the poster if there is one. */}
      <div
        className="absolute inset-0"
        style={{
          background: [
            // The subject: a soft violet mass slightly above centre.
            'radial-gradient(38% 44% at 50% 44%, rgb(91 43 232 / 0.55) 0%, rgb(91 43 232 / 0) 68%)',
            // Acid rim, offset — suggests the fresnel edge without drawing an outline.
            'radial-gradient(30% 34% at 62% 34%, rgb(200 255 61 / 0.22) 0%, rgb(200 255 61 / 0) 62%)',
            // Base. Matches the GL clear colour exactly.
            'radial-gradient(120% 120% at 50% 50%, #0C0C14 0%, #08080B 100%)',
          ].join(', '),
        }}
      />

      {/**
       * Static grain, as an inline SVG data URI.
       *
       * `feTurbulence` is evaluated once by the browser's SVG rasteriser and cached, so this is a
       * fixed cost of a few hundred bytes and no per-frame work — unlike the shader's animated
       * grain, which is the whole point of it being in the shader. Without any grain the
       * gradients above band visibly on 8-bit displays, especially in the dark falloff.
       */}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}
