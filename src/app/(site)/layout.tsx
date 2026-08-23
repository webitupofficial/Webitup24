import { draftMode } from 'next/headers';
import { VisualEditing } from 'next-sanity';

import { AppProviders } from '@/components/providers/AppProviders';
import { SceneCanvas } from '@/components/canvas/SceneCanvas';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { sanityFetch, SanityLive } from '@/sanity/lib/live';
import { siteSettingsQuery } from '@/sanity/lib/queries';
import { jsonLdScript, organizationJsonLd } from '@/lib/utils/seo';

/**
 * =============================================================================
 * (site) layout — the experience shell.
 * =============================================================================
 *
 * Everything that makes this feel like the site rather than a document lives here, and nothing
 * that does lives in the root layout. The split is by route group: `/studio` sits OUTSIDE `(site)`,
 * so the Sanity Studio inherits the root layout's fonts and reset and NONE of the below — no Lenis
 * hijacking its scroll containers, no custom cursor fighting its drag handles, no fullscreen WebGL
 * canvas painting under its panels.
 *
 * -----------------------------------------------------------------------------
 * THIS IS A SERVER COMPONENT, AND STAYS ONE
 * -----------------------------------------------------------------------------
 * It is `async` and fetches `siteSettings` on the server. `AppProviders` is the single client
 * boundary; passing the page through it as `children` does NOT make the page client-rendered —
 * React hands the server-rendered payload down as an opaque prop, so a server-only case-study page
 * still streams normally from inside the wrapper. The header and footer are likewise fed their data
 * as plain serialisable props from the one fetch here, rather than each fetching for itself.
 *
 * -----------------------------------------------------------------------------
 * WHY THE FIXED LAYERS CAN LIVE INSIDE THE SCROLL PROVIDER
 * -----------------------------------------------------------------------------
 * `SceneCanvas` and `Header` are `position: fixed`, and normally a fixed element inside a scroll
 * wrapper is a trap — if the wrapper carries a `transform`, the fixed element is positioned against
 * *it* rather than the viewport. It is safe here because Lenis runs in document mode (real native
 * `window.scrollTo`, no transformed container — see `SmoothScrollProvider`), so there is no
 * transformed ancestor for `position: fixed` to bind to. The one layer that is still kept outside
 * the provider is the cursor, and `AppProviders` does that itself.
 */

/**
 * Revalidate the shell hourly. `siteSettings` changes rarely; this is the ISR window within which
 * an editor's change to the nav, the CTA or the motion kill-switches goes live without a redeploy.
 * Individual content routes set their own, shorter, revalidation.
 */
export const revalidate = 3600;

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  /**
   * One fetch feeds the whole shell. `sanityFetch` returns cached data when draft mode is off and a
   * live-subscribed result when it is on — the `<SanityLive />` element at the bottom is the
   * transport that makes the second case work, which is why it must be mounted here.
   */
  const [{ data: settings }, { isEnabled: isDraft }] = await Promise.all([
    sanityFetch({ query: siteSettingsQuery }).catch(() => ({ data: null })),
    draftMode().catch(() => ({ isEnabled: false })),
  ]);

  const motion = settings?.motionDefaults;
  const logoUrl = settings?.logo?.url ?? null;
  const siteName = settings?.siteName ?? undefined;

  /**
   * The Organization + WebSite graph, emitted once for the whole site. Built from the same settings
   * object and serialised with `jsonLdScript` — never a bare `JSON.stringify` — so a CMS field
   * containing `</script>` or a stray U+2028 cannot break out of the script element. See seo.ts.
   */
  const orgLd = organizationJsonLd({
    siteName: settings?.siteName,
    tagline: settings?.tagline,
    email: settings?.email,
    phone: settings?.phone,
    logoUrl,
    location: settings?.location,
    socials: settings?.socials,
    organization: settings?.organization,
  });

  return (
    <AppProviders
      /**
       * The motion kill-switches, straight from the CMS. Each falls back to "on" so a fresh dataset
       * with no `siteSettings` singleton still gets the full experience — `useCapabilities` is the
       * real gate that turns things off on incapable hardware; these are the editorial override on
       * top of it. `scrollLerp` falls back to `undefined`, which `AppProviders` reads as "use the
       * per-tier default" rather than as a value.
       */
      enableWebGL={motion?.enableWebGL ?? true}
      enablePostProcessing={motion?.enablePostProcessing ?? true}
      scrollLerp={motion?.scrollLerp ?? undefined}
      cursor={motion?.enableCustomCursor ?? true}
    >
      {/**
       * The WebGL layer. Mounted once, here, and never unmounted by navigation — the scene persists
       * across route changes, which is what lets a hero transition continue rather than restart when
       * moving between pages. It self-gates on capability and idle time (see `SceneCanvas`), so
       * mounting it unconditionally costs nothing on devices that will never run it.
       */}
      <SceneCanvas />

      <Header
        siteName={siteName}
        logoUrl={logoUrl}
        nav={settings?.primaryNav}
        cta={settings?.ctaLink}
        availability={settings?.availability}
        secondaryNav={settings?.footerNav}
        email={settings?.email}
        socials={settings?.socials}
      />

      {/**
       * `#main` — the skip link's target (the link itself is in the root layout, first in tab
       * order). `scroll-mt` is not needed here; `scroll-padding-top` on `html` handles the fixed
       * header offset for every in-page anchor, this one included.
       */}
      <main id="main">{children}</main>

      <Footer
        siteName={siteName}
        logoUrl={logoUrl}
        tagline={settings?.tagline}
        cta={settings?.ctaLink}
        marqueeWords={settings?.marqueeWords}
        footerNav={settings?.footerNav}
        socials={settings?.socials}
        email={settings?.email}
        phone={settings?.phone}
        whatsapp={settings?.whatsapp}
        location={settings?.location}
        footerNote={settings?.footerNote}
      />

      {/**
       * Film grain, over everything but the content. A single fixed CSS layer that unifies the flat
       * DOM sections and the WebGL canvas into one image — most of why a 3D background reads as part
       * of the site rather than a video behind it. Fully static, so it survives reduced motion.
       */}
      <div className="grain-overlay" aria-hidden="true" />

      {/**
       * Structured data. Rendered in the body (permitted for `application/ld+json`) rather than the
       * head so it stays adjacent to the layout that owns it. `dangerouslySetInnerHTML` with the
       * escaped string is the correct and only way to emit JSON-LD — React would otherwise
       * HTML-escape the JSON and corrupt it.
       */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(orgLd) }}
      />

      {/**
       * The Live Content API transport. Inert when draft mode is off (a plain cached fetch); the
       * subscription that streams Studio edits into the page when it is on. Must be mounted for
       * draft mode to be anything more than a normal fetch.
       */}
      <SanityLive />

      {/**
       * Presentation-tool overlays: the click-to-edit affordances and the stega decoder. Mounted
       * ONLY inside a draft-mode session — shipping it to every visitor would send the editing
       * runtime to production traffic that can do nothing with it.
       */}
      {isDraft ? <VisualEditing /> : null}
    </AppProviders>
  );
}
