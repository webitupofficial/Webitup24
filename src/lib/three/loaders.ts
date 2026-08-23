'use client';

import { useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { WebGLRenderer } from 'three';
import * as THREE from 'three';

/**
 * lib/three/loaders.ts
 *
 * Asset loading for compressed GLB: Draco geometry, KTX2/Basis textures, Meshopt.
 *
 * =============================================================================
 * WHY COMPRESSION IS NOT OPTIONAL
 * =============================================================================
 * A raw exported GLB from Blender or C4D is routinely 15–40MB. The same model with Draco
 * geometry compression and KTX2 textures lands at 1–3MB. On a 4G connection that is the
 * difference between a hero asset arriving in under a second and arriving after the visitor has
 * scrolled past it.
 *
 * The three formats solve three separate problems and are all worth having:
 *
 *   • Draco — compresses vertex attributes. 5–10× on geometry. Costs a ~200KB WASM decoder and
 *     a few ms of CPU on the main thread (or a worker) at load.
 *   • KTX2/Basis — GPU-compressed textures that transcode to whatever the device supports
 *     (ASTC on mobile, BC7 on desktop). Crucially this reduces *VRAM*, not just download size:
 *     a 2048² PNG occupies 16MB in memory regardless of how well it zipped, while the same
 *     texture as KTX2 stays compressed on the GPU at ~2.7MB. On a phone with a 256MB texture
 *     budget that is the difference between working and a context loss.
 *   • Meshopt — reorders indices for vertex-cache efficiency and quantises attributes. Smaller
 *     than Draco to decode (no WASM blob) and improves *render* throughput, not just load time.
 *
 * =============================================================================
 * WHY THE DECODERS ARE SELF-HOSTED
 * =============================================================================
 * The paths below point at `/public`, not at gstatic.com — which is what drei defaults to and
 * what every tutorial does. Three reasons, all of which have bitten real sites:
 *
 *   1. A third-party origin is a third-party outage. If gstatic is blocked (corporate proxy,
 *      GDPR-conscious network, a region that blocks Google) every model on the site fails to
 *      load, and the failure mode is a silent empty scene.
 *   2. It is a cross-origin request on the critical path, so it costs a DNS lookup, a TLS
 *      handshake and a connection — before the decoder can even start.
 *   3. A strict CSP has to whitelist it. Self-hosting means `script-src 'self'` and
 *      `worker-src 'self'` stay clean, which matters because the Draco decoder runs in a Worker.
 *
 * See the `postinstall` script in package.json, which copies both decoders out of the `three`
 * package into `public/` so they are always version-matched to the installed three.js. A
 * mismatched Draco decoder fails with a decode error that gives no hint about versions.
 */

/** Draco decoder directory. Trailing slash is required — three.js concatenates directly. */
export const DRACO_DECODER_PATH = '/draco/';

/** Basis Universal transcoder directory for KTX2. */
export const KTX2_TRANSCODER_PATH = '/basis/';

/* ---------------------------------------------------------------------------
 * KTX2Loader
 * ------------------------------------------------------------------------- */

/**
 * One KTX2Loader per renderer, cached.
 *
 * `detectSupport(renderer)` queries the GPU's supported compressed-texture extensions, so the
 * loader is renderer-specific — and it allocates a Worker pool internally. Creating one per
 * `useGLTF` call would spawn a new pool per model, and browsers cap concurrent workers.
 *
 * A WeakMap keyed on the renderer means the entry is collectable when the renderer is, so a
 * canvas remount (HMR, a route that unmounts the canvas) does not leak.
 */
const ktx2Cache = new WeakMap<WebGLRenderer, KTX2Loader>();

function getKTX2Loader(renderer: WebGLRenderer): KTX2Loader {
  const cached = ktx2Cache.get(renderer);
  if (cached) return cached;

  const loader = new KTX2Loader().setTranscoderPath(KTX2_TRANSCODER_PATH).detectSupport(renderer);
  ktx2Cache.set(renderer, loader);
  return loader;
}

/* ---------------------------------------------------------------------------
 * The hook
 * ------------------------------------------------------------------------- */

/**
 * `useGLTF` with Draco, Meshopt and KTX2 all wired up.
 *
 * Must be called inside a `<Canvas>` — it needs the renderer for KTX2 support detection, and it
 * suspends, so it needs a Suspense boundary above it.
 *
 * NOTE ON THE RETURNED SCENE: drei caches by URL, so two components loading the same model share
 * one `THREE.Group`. Mutating it (changing a material, setting a scale) mutates it for every
 * consumer, including the next route that loads the same asset. Always `clone()` — see
 * `ShowcaseModel`, which does.
 */
export function useConfiguredGLTF(url: string) {
  const gl = useThree((s) => s.gl);

  /**
   * `useCallback` so the extender identity is stable across renders. drei keys its loader cache
   * partly on this function; an inline arrow would produce a fresh identity every render and
   * defeat the cache, re-parsing the GLB on every parent re-render.
   */
  const extend = useCallback(
    (loader: any) => {
      loader.setKTX2Loader(getKTX2Loader(gl));
    },
    [gl]
  );

  // Args: (path, dracoDecoderPath, useMeshopt, extendLoader).
  // Passing a string as the second argument both enables Draco and sets the decoder path.
  return useGLTF(url, DRACO_DECODER_PATH, true, extend);
}

/**
 * Warm the cache before the model is needed.
 *
 * Call from a hover handler on a project card, or in an effect once the hero has settled. By the
 * time the visitor navigates, the GLB is parsed and the shader is compiled, so the model appears
 * on the first frame of the new route rather than a second into it.
 *
 * Deliberately does NOT accept the KTX2 extender: `preload` runs outside a canvas so there is no
 * renderer to detect support with. Textures are therefore fetched but not transcoded until the
 * real `useConfiguredGLTF` runs — which is still the bulk of the win, since the network is the
 * slow part.
 */
export function preloadModel(url: string): void {
  if (!url) return;
  useGLTF.preload(url, DRACO_DECODER_PATH, true);
}

/** Drop a model from drei's cache. For genuinely one-off assets that should not occupy VRAM. */
export function clearModel(url: string): void {
  useGLTF.clear(url);
}

/* ---------------------------------------------------------------------------
 * Cloning
 * ------------------------------------------------------------------------- */

/**
 * Clone a loaded scene for safe local use.
 *
 * `SkeletonUtils.clone` rather than `scene.clone()`: the plain `Object3D.clone()` copies the
 * node hierarchy but leaves every `SkinnedMesh` bound to the *original* skeleton, so two
 * instances of an animated model drive each other's bones and both deform into garbage. For a
 * static model the two are equivalent, and paying the marginally slower path unconditionally is
 * cheaper than discovering the difference when a client supplies a rigged asset.
 *
 * =========================================================================
 * WHAT A CLONE DOES AND DOES NOT OWN — read before writing any disposal code
 * =========================================================================
 * `clone()` in three.js is a *shallow* clone with respect to GPU resources. The new `Mesh` holds
 * the SAME `BufferGeometry` and the SAME `Material` object as the original, by reference. Only
 * the transform, the name and the parent/child links are copied.
 *
 * The consequence is the opposite of what the usual "always dispose what you create" instinct
 * suggests: calling `geometry.dispose()` on a clone frees the buffer that drei's cache is still
 * handing to every other consumer of that URL. The model then renders as nothing — on this page
 * and on every other page using the same asset — and only a hard reload fixes it. This is a
 * genuinely common mistake, and it is invisible until a second component loads the same model.
 *
 * So: a clone needs no disposal. What DOES need disposal is anything this app allocated itself —
 * a material we substituted, a texture we generated. Those are tracked explicitly and passed to
 * `disposeCreated`.
 */
export function cloneModel(scene: THREE.Object3D): THREE.Object3D {
  return SkeletonUtils.clone(scene);
}

/* ---------------------------------------------------------------------------
 * Disposal
 * ------------------------------------------------------------------------- */

/**
 * Dispose resources this app created itself — never resources that came from the loader cache.
 *
 * Callers keep their own list of what they allocated. That explicit accounting is the whole
 * point: an automatic `traverse`-and-dispose sweep cannot tell the difference between a material
 * we substituted and the one the GLB shipped with, and getting that distinction wrong is exactly
 * the cache-corruption bug described in `cloneModel` above.
 */
export function disposeCreated(resources: Iterable<{ dispose(): void }>): void {
  for (const resource of resources) {
    resource.dispose();
  }
}

/**
 * Count triangles in a scene graph.
 *
 * Used by the dev overlay and worth having on hand: the `triangleBudget` field in the Sanity
 * `model3d` schema is read-only guidance for editors, and this is what verifies whether an
 * uploaded asset actually respects it. "The model looks fine to me" and "the model is 1.8M
 * triangles" are frequently the same asset.
 */
export function countTriangles(root: THREE.Object3D): number {
  let total = 0;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry;
    total += geometry.index
      ? geometry.index.count / 3
      : (geometry.attributes.position?.count ?? 0) / 3;
  });
  return Math.round(total);
}
