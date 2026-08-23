'use client';

import { useEffect } from 'react';

import { frameState } from '@/lib/store/frameState';
import { useUIStore, type DeviceTier, type MotionLevel } from '@/lib/store/useUIStore';

/**
 * lib/hooks/useCapabilities.ts
 *
 * Resolves, exactly once after mount, what this device and this visitor can actually handle,
 * and writes the answer into the UI store. Everything downstream — canvas DPR, geometry
 * subdivision, post-processing, custom cursor, Lenis lerp — reads from that single decision.
 *
 * The detection runs on the client only. It cannot run on the server (no GPU, no matchMedia)
 * and it must not run during render (it touches the DOM), which is why the store starts in
 * its most conservative state and this hook upgrades it in an effect.
 */

/* ---------------------------------------------------------------------------
 * GPU tier detection
 * ------------------------------------------------------------------------- */

/**
 * Classify the GPU.
 *
 * There is no reliable API for this. The honest options are:
 *   (a) `WEBGL_debug_renderer_info` → a renderer string like "Apple M2" or
 *       "ANGLE (Intel(R) UHD Graphics 620)". Increasingly privacy-restricted (Safari 17+
 *       returns a generic string, and Firefox's `privacy.resistFingerprinting` blocks it),
 *       but when present it is by far the most informative signal.
 *   (b) Proxies: device memory, core count, screen size, `pointer: coarse`.
 *   (c) Measure actual frame times and adapt — which we also do, via PerformanceMonitor.
 *
 * We use (a) where available, fall back to (b), and always let (c) correct us. Getting this
 * wrong in the safe direction costs a slightly plainer scene; getting it wrong in the unsafe
 * direction costs a 12fps first impression, so every ambiguous case resolves downward.
 */
function detectGPUTier(): DeviceTier {
  // Escape hatch for QA — lets you reproduce a low-tier render on a workstation.
  const forced = process.env.NEXT_PUBLIC_FORCE_DEVICE_TIER;
  if (forced === 'high' || forced === 'mid' || forced === 'low') return forced;

  // --- Hard disqualifiers -------------------------------------------------
  // Save-Data means the user has asked, at the OS or browser level, for less. Honour it.
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  if (conn?.saveData) return 'low';
  if (conn?.effectiveType && /^(slow-)?2g$/.test(conn.effectiveType)) return 'low';

  // deviceMemory is coarse (rounded to 0.25/0.5/1/2/4/8) and absent in Safari, but when it
  // reports ≤4GB the device is genuinely constrained.
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 2;

  // --- Probe the GL renderer string ---------------------------------------
  let renderer = '';
  try {
    // A throwaway 1x1 context. Must be explicitly released: browsers cap live WebGL
    // contexts (~16 in Chrome) and leaking probe contexts will eventually cause the real
    // canvas to fail to acquire one — a bug that only shows up after a few soft navigations.
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // A throwing getContext means WebGL is disabled or blocklisted. Treat as low; the
    // separate `supportsWebGL` check below will disable the canvas entirely.
    return 'low';
  }

  const r = renderer.toLowerCase();

  // Known-weak integrated and mobile parts. Matching on renderer substrings is inherently a
  // maintenance burden, so the list is kept to families that are both common and genuinely
  // slow at fragment-heavy work — not an attempt at a full GPU database.
  const weak =
    /(mali-[t4-6]|adreno \(tm\) [2-5]\d\d|powervr|intel.*(hd|uhd) graphics (5|6)\d\d|apple a[7-9]|swiftshader|llvmpipe|basic render)/;
  // SwiftShader/llvmpipe are software rasterisers — never run the full scene on those.
  const software = /(swiftshader|llvmpipe|basic render|software)/;

  if (software.test(r)) return 'low';
  if (weak.test(r)) return 'low';

  // Discrete and modern Apple silicon.
  const strong = /(nvidia|geforce|rtx|radeon (rx|pro)|apple m[1-9]|arc a\d|adreno \(tm\) 7\d\d)/;
  if (strong.test(r) && cores >= 6) return 'high';

  // --- Proxy heuristics when the renderer string is unavailable -----------
  if (memory !== undefined && memory <= 4) return 'low';
  if (cores <= 4) return 'mid';
  if (cores >= 8 && (memory === undefined || memory >= 8)) return 'high';
  return 'mid';
}

/** Is there a usable WebGL context at all? */
function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------------
 * Motion preference
 * ------------------------------------------------------------------------- */

/**
 * Three levels rather than the binary `prefers-reduced-motion` gives us:
 *
 *   'full' — everything: shader distortion, parallax, smooth scroll, custom cursor.
 *   'lite' — structure-preserving only. Opacity and small (<8px) transforms; NO parallax,
 *            NO smooth-scroll interception, NO large-scale movement, static shader.
 *   'none' — no WebGL at all; poster images. Reserved for explicit reduced-motion.
 *
 * `prefers-reduced-motion: reduce` is a request to avoid *motion*, not to avoid *design*.
 * Stripping a site to unstyled HTML over-serves the preference; users who set it still want
 * a considered page. But a vestibular trigger is a genuine accessibility harm, so the
 * distinction we draw is: things that move large distances or move continuously go away;
 * things that fade or move imperceptibly stay.
 */
function detectMotionLevel(tier: DeviceTier): MotionLevel {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return 'none';

  // Coarse pointer + low tier = a cheap phone. Continuous WebGL there also drains battery
  // fast enough that users notice, which is its own form of harm.
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (tier === 'low') return coarse ? 'none' : 'lite';
  if (tier === 'mid' && coarse) return 'lite';
  return 'full';
}

/* ---------------------------------------------------------------------------
 * The hook
 * ------------------------------------------------------------------------- */

export interface CapabilityOverrides {
  /** From Sanity siteSettings.motionDefaults — a runtime kill-switch, no redeploy needed. */
  enableWebGL?: boolean;
  enablePostProcessing?: boolean;
}

export function useCapabilities(overrides: CapabilityOverrides = {}): void {
  const setTier = useUIStore((s) => s.setTier);
  const setMotion = useUIStore((s) => s.setMotion);
  const setWebglEnabled = useUIStore((s) => s.setWebglEnabled);
  const setPostProcessingEnabled = useUIStore((s) => s.setPostProcessingEnabled);

  const { enableWebGL = true, enablePostProcessing = true } = overrides;

  useEffect(() => {
    const tier = detectGPUTier();
    const motion = detectMotionLevel(tier);
    const hasWebGL = supportsWebGL();

    frameState.isTouch = window.matchMedia('(pointer: coarse)').matches;

    setTier(tier);
    setMotion(motion);
    setWebglEnabled(enableWebGL && hasWebGL && motion !== 'none');
    // Post-processing is the first thing to go: bloom + CA + grain is roughly a third of
    // GPU frame time, and it is the layer users are least likely to consciously miss.
    setPostProcessingEnabled(enablePostProcessing && tier === 'high' && motion === 'full');

    // Expose the decision as data attributes so CSS can respond without a React render.
    // This is what the `motion-full:` / `motion-lite:` Tailwind variants key off.
    const root = document.documentElement;
    root.dataset.motion = motion;
    root.dataset.tier = tier;

    /**
     * Respond to the preference changing mid-session. Users genuinely do toggle
     * reduced-motion while a page is open — usually because the page made them feel unwell,
     * which makes reacting immediately rather than on next navigation the entire point.
     */
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => {
      const nextMotion = detectMotionLevel(tier);
      setMotion(nextMotion);
      setWebglEnabled(enableWebGL && hasWebGL && nextMotion !== 'none');
      setPostProcessingEnabled(
        enablePostProcessing && tier === 'high' && nextMotion === 'full'
      );
      root.dataset.motion = nextMotion;
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [enableWebGL, enablePostProcessing, setTier, setMotion, setWebglEnabled, setPostProcessingEnabled]);
}

/* ---------------------------------------------------------------------------
 * Tier → render settings
 * ------------------------------------------------------------------------- */

export interface TierSettings {
  /** Icosphere subdivision level. Vertex count scales as (n+1)^2. */
  blobDetail: number;
  /** FBM octaves compiled into the shader. */
  fbmOctaves: number;
  /** Canvas dpr range, passed straight to <Canvas dpr={...} />. */
  dpr: [number, number];
  particleCount: number;
  /** Enables the transmission/refraction material path. Expensive: extra render target. */
  allowTransmission: boolean;
  shadows: boolean;
  /** Lenis lerp. Lower is smoother but costs more scroll-driven work per frame. */
  scrollLerp: number;
}

export const TIER_SETTINGS: Record<DeviceTier, TierSettings> = {
  high: {
    blobDetail: 40,      // ~32k triangles — smooth enough that displacement never facets
    fbmOctaves: 3,
    dpr: [1, 1.75],
    particleCount: 2400,
    allowTransmission: true,
    shadows: false,      // Off even on high: a soft shadow map costs more than it adds here
    scrollLerp: 0.09,
  },
  mid: {
    blobDetail: 24,      // ~11.5k triangles
    fbmOctaves: 3,
    dpr: [1, 1.5],
    particleCount: 1200,
    allowTransmission: false,
    shadows: false,
    scrollLerp: 0.1,
  },
  low: {
    blobDetail: 12,      // ~2.8k triangles. Faceting is visible; the reduced distortion
                         // amplitude on this tier keeps it from mattering.
    fbmOctaves: 2,
    dpr: [1, 1],         // Never supersample on a device that is already struggling
    particleCount: 0,
    allowTransmission: false,
    shadows: false,
    scrollLerp: 0.14,    // Closer to native — cheap, and low-tier devices often have
                         // high-latency input where heavy easing feels broken
  },
};
