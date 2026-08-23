'use client';

import { useEffect } from 'react';

import { useSceneStore, type SceneConfigState } from '@/lib/store/useSceneStore';
import type { CameraKeyframe } from './CameraRig';
import type { PaletteToken } from './registry';
import { preloadModel } from '@/lib/three/loaders';

/**
 * SceneConfig — how a page tells the persistent canvas what to render.
 *
 * Renders nothing. Drop it anywhere in a page's tree:
 *
 * ```tsx
 * <SceneConfig
 *   sceneId={project.sceneId}
 *   paletteTokens={project.colorPalette?.tokens}
 *   seed={hashString(project.slug)}
 *   modelUrl={project.heroMedia?.model?.url}
 * />
 * ```
 *
 * =========================================================================
 * WHY A COMPONENT RATHER THAN A HOOK OR A DIRECT `setScene` CALL
 * =========================================================================
 * A component gets React's mount/unmount lifecycle for free, and that lifecycle is exactly what
 * the problem needs. The canvas outlives every page, so a page that sets a scene MUST unset it on
 * the way out — otherwise navigating from a project page to the contact page leaves the contact
 * page wearing the project's palette and camera path.
 *
 * Calling `setScene` in a page body would run during render (a side effect in render — wrong, and
 * doubly wrong under StrictMode's double-invoke) with no natural place to hang the cleanup.
 * A hook would work but reads as though it returns something. A component makes the intent
 * declarative and the reset automatic: *this page's scene is this, for as long as this page is
 * mounted.*
 *
 * =========================================================================
 * ORDERING
 * =========================================================================
 * This effect runs on mount, before the layout's effects (React runs child effects first), so the
 * scene config is already correct by the time `SceneCanvas` mounts on a cold load. On a client
 * navigation the canvas is already alive and simply picks up the new store values on its next
 * render — which is why the shader colours are damped rather than assigned in `FluidBlob`: the
 * change arrives as a cross-fade, not a cut.
 */

export interface SceneConfigProps {
  sceneId?: string | null;
  paletteTokens?: PaletteToken[] | null;
  seed?: number;
  cameraPath?: CameraKeyframe[] | null;
  revealed?: boolean;
  intensity?: number;
  modelUrl?: string | null;
}

export function SceneConfig({
  sceneId = null,
  paletteTokens = null,
  seed = 0,
  cameraPath = null,
  revealed = true,
  intensity = 1,
  modelUrl = null,
}: SceneConfigProps) {
  const setScene = useSceneStore((s) => s.setScene);
  const resetScene = useSceneStore((s) => s.resetScene);

  useEffect(() => {
    setScene({ sceneId, paletteTokens, seed, cameraPath, revealed, intensity, modelUrl });
    return () => resetScene();
    /**
     * `paletteTokens` and `cameraPath` are array props, so a parent re-render with a fresh
     * literal would re-run this effect. Harmless — `setScene` is a shallow merge and the values
     * are identical — but it also means callers should pass stable references (server-rendered
     * data is stable; inline literals in a client component are not). Documented rather than
     * defended against with a deep-compare, which would cost more than the re-run it prevents.
     */
  }, [setScene, resetScene, sceneId, paletteTokens, seed, cameraPath, revealed, intensity, modelUrl]);

  /**
   * Warm the model cache as soon as we know a model is coming.
   *
   * Separate from the config effect because it must NOT be undone on unmount: a cached GLB is
   * exactly what makes returning to this page instant, and evicting it on navigation away throws
   * that away for no benefit. `preloadModel` is idempotent per URL.
   */
  useEffect(() => {
    if (modelUrl) preloadModel(modelUrl);
  }, [modelUrl]);

  return null;
}

/**
 * Deterministic 32-bit string hash, for deriving a per-page shader seed from a slug.
 *
 * `Math.random()` would reseed the noise field on every mount, so a project's hero would look
 * different each visit — and the same project would look different in a screenshot taken twice.
 * Deriving from the slug makes the surface a stable property of the content.
 *
 * FNV-1a: three operations per character, well-distributed in its low bits, and short enough to
 * read. Not cryptographic and not trying to be.
 */
export function hashString(input: string | null | undefined): number {
  if (!input) return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // `Math.imul` for a true 32-bit multiply. Plain `*` overflows into a float above 2^53 and
    // the low bits — the ones that matter — become garbage.
    hash = Math.imul(hash, 0x01000193);
  }
  // `>>> 0` to unsigned, then scaled into a range the shader's noise offset uses meaningfully.
  // Large seeds are fine for simplex noise, but keeping it modest avoids float precision loss in
  // GLSL's mediump on mobile, where a value above ~65k quantises visibly.
  return ((hash >>> 0) % 10_000) / 100;
}

/** Convenience: the store type, re-exported so pages need one import. */
export type { SceneConfigState };
