'use client';

import { create } from 'zustand';

import type { PaletteToken } from '@/components/canvas/registry';
import type { CameraKeyframe } from '@/components/canvas/CameraRig';

/**
 * lib/store/useSceneStore.ts
 *
 * What the canvas should currently be rendering.
 *
 * =========================================================================
 * WHY A STORE INSTEAD OF PROPS
 * =========================================================================
 * The `<Canvas>` is mounted once, in the site layout, and persists across every route. That is
 * deliberate and non-negotiable for the feel of the site: remounting it per page means a fresh
 * WebGL context, a shader recompile and a geometry upload on every navigation — a 200–400ms
 * black rectangle where the hero should be, on every single click.
 *
 * But the *configuration* for the scene (which preset, which palette, which camera path) comes
 * from the page, and in the App Router a page cannot pass props up to its layout. There is no
 * prop path from `app/work/[slug]/page.tsx` to a `<SceneCanvas>` in `app/(site)/layout.tsx`.
 *
 * The options are React context (a provider in the layout, consumers in pages — but the page is
 * a *child*, so it would have to write to context, which context does not do), a portal-based
 * approach like tunnel-rat (works, but means the page's JSX is teleported into the R3F tree and
 * the two reconcilers' lifecycles get tangled), or a store the page writes and the canvas reads.
 *
 * The store is the least clever option and by a wide margin the easiest to debug: at any moment
 * you can inspect exactly one object and know what the canvas thinks it is drawing.
 *
 * Values here change on navigation — a few times a minute at most — so a reactive store is
 * exactly the right tool. Contrast `frameState`, which changes 60–1000 times a second and must
 * never touch React.
 */

export interface SceneConfigState {
  /** Preset id from Sanity. `null` means "the default signature scene". */
  sceneId: string | null;
  /** Project palette override for the shader colours. */
  paletteTokens: PaletteToken[] | null;
  /** Per-page noise offset, so two pages sharing a preset do not render identically. */
  seed: number;
  /** Camera path override. `null` uses the default homepage choreography. */
  cameraPath: CameraKeyframe[] | null;
  /**
   * Whether the blob should be revealed. The preloader holds this false until hand-off, and a
   * page with no hero (the contact form, a legal page) sets it false to collapse the scene
   * without unmounting the canvas.
   */
  revealed: boolean;
  /** Global shader intensity, from `siteSettings.motionDefaults.shaderIntensity`. */
  intensity: number;
  /** Optional GLB to display as the subject, for `model-showcase` scenes. */
  modelUrl: string | null;

  /** Partial update — pages set only what they care about. */
  setScene: (config: Partial<Omit<SceneConfigState, 'setScene' | 'resetScene'>>) => void;
  /** Restore defaults. Called when a page that set a scene unmounts. */
  resetScene: () => void;
}

const DEFAULTS = {
  sceneId: null,
  paletteTokens: null,
  seed: 0,
  cameraPath: null,
  revealed: true,
  intensity: 1,
  modelUrl: null,
} as const;

export const useSceneStore = create<SceneConfigState>((set) => ({
  ...DEFAULTS,
  setScene: (config) => set(config),
  resetScene: () => set({ ...DEFAULTS }),
}));

/**
 * Non-reactive read. For `useFrame` and event handlers, where subscribing would be wrong.
 */
export const getSceneConfig = () => useSceneStore.getState();
