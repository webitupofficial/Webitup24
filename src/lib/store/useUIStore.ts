'use client';

import { create } from 'zustand';

/**
 * lib/store/useUIStore.ts
 *
 * Zustand store for DISCRETE state only — things that change on human timescales and
 * genuinely should re-render React: menu open/closed, cursor mode, device tier, whether the
 * preloader has finished.
 *
 * Per-frame continuous values live in `frameState.ts` and must not be added here. The split
 * is the whole point: this store is allowed to be a normal reactive store precisely because
 * nothing in it updates more than a few times a second.
 */

export type DeviceTier = 'high' | 'mid' | 'low';
export type MotionLevel = 'full' | 'lite' | 'none';

/**
 * Cursor modes. The custom cursor is a single element that morphs, rather than a set of
 * elements that swap — morphing is what makes it feel like one object with intent.
 */
export type CursorMode =
  | 'default'
  | 'hover'   // over any interactive element
  | 'view'    // over a project card — shows "VIEW"
  | 'drag'    // over a draggable/orbit region
  | 'text'    // over selectable copy — collapses to a caret
  | 'hidden'; // over a native control (form input, video scrubber)

interface UIState {
  /* ---- Capability & preference (resolved once, on mount) ---- */
  tier: DeviceTier;
  motion: MotionLevel;
  webglEnabled: boolean;
  webglReady: boolean;
  postProcessingEnabled: boolean;

  /* ---- Session ---- */
  /** True once the preloader has handed off. Gates the hero's intro timeline. */
  introComplete: boolean;
  /** 0..1 asset-loading progress, from drei's useProgress. */
  loadProgress: number;

  /* ---- Chrome ---- */
  menuOpen: boolean;
  cursorMode: CursorMode;
  /** Optional label rendered inside the cursor, e.g. "VIEW CASE". */
  cursorLabel: string | null;
  /** Set by the header on scroll direction change. */
  headerHidden: boolean;

  /* ---- Actions ---- */
  setTier: (tier: DeviceTier) => void;
  setMotion: (motion: MotionLevel) => void;
  setWebglEnabled: (enabled: boolean) => void;
  setWebglReady: (ready: boolean) => void;
  setPostProcessingEnabled: (enabled: boolean) => void;
  setIntroComplete: (complete: boolean) => void;
  setLoadProgress: (progress: number) => void;
  setMenuOpen: (open: boolean) => void;
  toggleMenu: () => void;
  setCursor: (mode: CursorMode, label?: string | null) => void;
  setHeaderHidden: (hidden: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  /**
   * Initial values must be identical on server and client, or hydration mismatches.
   * So we start pessimistic — `low` tier, `none` motion, WebGL off — and let the
   * `useCapabilities` hook (called once in `AppProviders`) upgrade after mount. Starting
   * optimistic and downgrading would flash a full-fat scene on a device that cannot run it,
   * which is worse than a beat of delay.
   */
  tier: 'low',
  motion: 'none',
  webglEnabled: false,
  webglReady: false,
  postProcessingEnabled: false,

  introComplete: false,
  loadProgress: 0,

  menuOpen: false,
  cursorMode: 'default',
  cursorLabel: null,
  headerHidden: false,

  setTier: (tier) => set({ tier }),
  setMotion: (motion) => set({ motion }),
  setWebglEnabled: (webglEnabled) => set({ webglEnabled }),
  setWebglReady: (webglReady) => set({ webglReady }),
  setPostProcessingEnabled: (postProcessingEnabled) => set({ postProcessingEnabled }),
  setIntroComplete: (introComplete) => set({ introComplete }),
  setLoadProgress: (loadProgress) => set({ loadProgress }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  toggleMenu: () => set((s) => ({ menuOpen: !s.menuOpen })),
  setCursor: (cursorMode, cursorLabel = null) => set({ cursorMode, cursorLabel }),
  setHeaderHidden: (headerHidden) => set({ headerHidden }),
}));

/* ---------------------------------------------------------------------------
 * Selector hooks.
 *
 * Always subscribe through a narrow selector. `useUIStore()` with no selector subscribes to
 * the entire store, so toggling the menu would re-render every component that only cared
 * about the device tier.
 * ------------------------------------------------------------------------- */
export const useTier = () => useUIStore((s) => s.tier);
export const useMotionLevel = () => useUIStore((s) => s.motion);
export const useWebglEnabled = () => useUIStore((s) => s.webglEnabled);
export const useIntroComplete = () => useUIStore((s) => s.introComplete);
export const useCursorMode = () => useUIStore((s) => s.cursorMode);

/**
 * Non-reactive read, for use inside event handlers and useFrame where a subscription would
 * be wrong. `getState()` is the escape hatch zustand provides for exactly this.
 */
export const getUIState = () => useUIStore.getState();
