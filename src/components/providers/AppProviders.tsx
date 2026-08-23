'use client';

import { PointerProvider } from './PointerProvider';
import { SmoothScrollProvider } from './SmoothScrollProvider';
import { FluidCursor } from '@/components/interactive/FluidCursor';
import { useCapabilities } from '@/lib/hooks/useCapabilities';

/**
 * =============================================================================
 * AppProviders — the one client boundary the whole site sits inside.
 * =============================================================================
 *
 * Everything client-side that must exist exactly once, in a fixed order, lives here:
 *
 *   1. `useCapabilities()` — resolves device tier + motion level and writes them to the UI
 *      store and to `<html data-motion data-tier>`.
 *   2. `PointerProvider`   — the single global pointer listener, feeding `frameState`.
 *   3. `SmoothScrollProvider` — Lenis, driven from `gsap.ticker`, publishing scroll state.
 *   4. `FluidCursor`       — the custom cursor, which reads both of the above.
 *
 * -----------------------------------------------------------------------------
 * WHY THE ORDER MATTERS (AND WHY IT ISN'T NESTING FOR NESTING'S SAKE)
 * -----------------------------------------------------------------------------
 * React runs effects child-first. So the nesting here is deliberately *inverted* relative to
 * the order things need to initialise in: `useCapabilities` is a hook in this component's own
 * body, which means its effect runs LAST — after every child has mounted.
 *
 * That is the correct order, not an accident of syntax. The store starts pessimistic
 * (`motion: 'none'`, `tier: 'low'`, WebGL off — see `useUIStore`), so:
 *
 *   • `SmoothScrollProvider` mounts, sees `motion === 'none'`, and takes its native-scroll
 *     path — no Lenis instance, no scroll interception.
 *   • Then `useCapabilities` resolves the real values and calls `setMotion('full')`.
 *   • That state change re-runs `SmoothScrollProvider`'s effect, whose cleanup removes the
 *     native listener before the Lenis path sets itself up.
 *
 * The net effect is that the first frame after hydration is always the safe configuration, and
 * the upgrade to the full experience happens as an ordinary state transition with real cleanup
 * — rather than the alternative, where a provider initialises against half-resolved
 * capabilities and has to be torn down and rebuilt.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS IS ONE COMPONENT AND NOT FOUR IN THE LAYOUT
 * -----------------------------------------------------------------------------
 * `app/layout.tsx` is a Server Component. Each `'use client'` component referenced from it
 * becomes its own client entry point in the bundle graph. Funnelling them through one boundary
 * keeps the layout a pure server tree (so `children` — the actual page — stays server-rendered
 * and streamable) while giving the client exactly one root chunk.
 *
 * Critically, `children` passing through a client component does NOT make it client-rendered.
 * The server renders the page and hands the resulting payload down as an opaque prop, so a
 * server-only case-study page still streams normally from inside this wrapper.
 *
 * -----------------------------------------------------------------------------
 * WHY SETTINGS ARE PROPS AND NOT A FETCH
 * -----------------------------------------------------------------------------
 * The motion kill-switches come from Sanity `siteSettings.motionDefaults`. Fetching them here
 * would mean a client-side request before the site can decide whether to run WebGL — i.e. a
 * network round trip inserted directly into the critical path. Instead the layout (a Server
 * Component, which already has the settings for the header and footer) passes them down as
 * plain serialisable props: zero extra bytes on the wire, available on the very first render.
 */

export interface AppProvidersProps {
  children: React.ReactNode;

  /**
   * From `siteSettings.motionDefaults.enableWebGL`. A content-editable kill switch: if the
   * scene ever misbehaves in production, an editor can turn it off in the Studio and every
   * visitor gets the poster fallback within the ISR window — no redeploy, no code change.
   */
  enableWebGL?: boolean;

  /** From `siteSettings.motionDefaults.enablePostProcessing`. Same reasoning, finer grain. */
  enablePostProcessing?: boolean;

  /**
   * From `siteSettings.motionDefaults.scrollLerp`. Undefined means "use the per-tier default"
   * from `TIER_SETTINGS`, which is almost always the right answer — this exists so scroll feel
   * can be tuned against the real site without a deploy cycle.
   */
  scrollLerp?: number;

  /**
   * Render the custom cursor. Off inside the Sanity Studio route, where the cursor would fight
   * the Studio's own drag handles, resize affordances and text carets — all of which depend on
   * the native cursor communicating what they do.
   */
  cursor?: boolean;
}

export function AppProviders({
  children,
  enableWebGL = true,
  enablePostProcessing = true,
  scrollLerp,
  cursor = true,
}: AppProvidersProps) {
  /**
   * Runs after all children have mounted (see the ordering note above). Writes to the UI store
   * and to `<html>`'s dataset; deliberately returns nothing, because every consumer reads the
   * store rather than a return value — a component that only needs the tier should not
   * re-render because the motion level changed.
   */
  useCapabilities({ enableWebGL, enablePostProcessing });

  return (
    <>
      {/*
        * Renders null. Placed before `SmoothScrollProvider` so its listener attaches first —
        * pointer state is read by the cursor and by magnetic buttons on the very first frame,
        * and starting from a real position rather than (0,0) avoids a visible snap.
        */}
      <PointerProvider />

      <SmoothScrollProvider lerp={scrollLerp}>{children}</SmoothScrollProvider>

      {/*
        * Last in the tree, and intentionally outside `SmoothScrollProvider`'s children: the
        * cursor is `position: fixed` and must not inherit any transform, containing block or
        * stacking context that a scroll wrapper might introduce. A `fixed` element inside a
        * transformed ancestor is positioned relative to that ancestor rather than the viewport,
        * which is the single most common way a custom cursor ends up lagging behind the pointer.
        *
        * It self-suppresses on touch devices and under reduced motion — mounting it
        * unconditionally is safe and keeps the tree shape stable across tier changes.
        */}
      {cursor ? <FluidCursor /> : null}
    </>
  );
}
