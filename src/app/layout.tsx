import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Inter_Tight, JetBrains_Mono } from 'next/font/google';

import { siteUrl } from '@/sanity/env';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from '@/lib/utils/seo';

import './globals.css';

/**
 * =============================================================================
 * Root layout
 * =============================================================================
 *
 * Deliberately thin. It owns four things and nothing else:
 *
 *   • `<html>` and `<body>`, including the `lang` attribute and the font variables
 *   • the global stylesheet import
 *   • site-wide `metadata` and `viewport`
 *   • nothing client-side at all
 *
 * Providers, chrome (header/footer), the WebGL canvas and the Sanity live-preview machinery all
 * live in `app/(site)/layout.tsx`. The split is what keeps `/studio` clean: the Sanity Studio is
 * a full application with its own scroll containers, its own drag interactions and its own
 * cursor semantics, and mounting Lenis, a custom cursor and a fullscreen WebGL canvas underneath
 * it breaks all three. Because `/studio` sits outside the `(site)` route group, it inherits this
 * layout — the fonts and the reset — and none of that.
 *
 * -----------------------------------------------------------------------------
 * NO `suppressHydrationWarning`
 * -----------------------------------------------------------------------------
 * Worth stating explicitly, because most projects with a `data-*` attribute on `<html>` add it.
 * We do not need it: `useCapabilities` writes `data-motion`/`data-tier` and `FluidCursor` writes
 * `data-cursor` from *effects*, which run after hydration has already reconciled. Nothing about
 * the server-rendered `<html>` differs from the client's first render.
 *
 * Adding it "just in case" is not free — it suppresses warnings for the entire subtree of that
 * element, which on `<html>` means the whole document, and it is precisely the warning you want
 * if a real mismatch ever appears in the shell.
 */

/* ---------------------------------------------------------------------------
 * Typefaces
 *
 * Three faces, three jobs:
 *
 *   display — Bricolage Grotesque. Variable, high-contrast, tight apertures at large sizes.
 *             Only used above ~2rem, where its personality reads as intent rather than noise.
 *   sans    — Inter Tight. The workhorse. Tight rather than regular Inter because it sits next
 *             to a display face with -0.04em tracking, and normal Inter looks loose beside it.
 *   mono    — JetBrains Mono. Eyebrows, metadata, counters, the cursor label.
 *
 * `next/font` self-hosts these at build time: no request to fonts.googleapis.com at runtime, so
 * no third-party connection in the critical path and no `font-display` flash from a CDN that is
 * slower than your own origin. It also generates a size-adjusted local fallback automatically,
 * which is what keeps the swap from shifting layout.
 *
 * UPGRADE PATH: a licensed display face is the single highest-impact change available to this
 * design, and it is a two-line diff — swap the `display` const for `next/font/local` pointing at
 * a woff2 in `src/app/fonts/`. Everything downstream reads `var(--font-display)` and does not
 * care where it came from.
 * ------------------------------------------------------------------------- */

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  /**
   * `swap` rather than `optional` or `block`. This is the headline face: `optional` means a slow
   * connection never sees it at all, and on a site whose typography *is* the design that is the
   * wrong trade. The size-adjusted fallback keeps the swap from being a layout shift.
   */
  display: 'swap',
  variable: '--font-display',
  /**
   * Preloaded — it renders the largest text on the first screen, so it is on the critical path
   * by definition. Next emits a `<link rel="preload">` for the subset actually used.
   */
  preload: true,
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
});

const sans = Inter_Tight({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
  preload: true,
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
  /**
   * Not preloaded. Mono only ever renders 11px eyebrows and metadata — real text, but text whose
   * fallback (`ui-monospace`) is metrically close enough that the swap is imperceptible. Skipping
   * the preload keeps two competing font requests off the critical path instead of three.
   */
  preload: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'monospace'],
});

/* ---------------------------------------------------------------------------
 * Metadata
 * ------------------------------------------------------------------------- */

export const metadata: Metadata = {
  /**
   * `metadataBase` is load-bearing and easy to forget. Without it every relative URL Next
   * resolves — canonical tags, `og:image`, `og:url` — is emitted relative, and social unfurlers
   * and crawlers reject relative URLs silently. The symptom is a share card with no image and no
   * error anywhere.
   *
   * `siteUrl` resolves to `NEXT_PUBLIC_SITE_URL`, then Vercel's `VERCEL_URL` (so branch previews
   * are self-consistent), then localhost. See `sanity/env.ts`.
   */
  metadataBase: new URL(siteUrl),

  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    /**
     * Every page returning a bare `title` string gets suffixed. Pages that need full control
     * (the home page, which would otherwise read "WebItUp24 — WebItUp24") pass
     * `title: { absolute: '…' }`.
     */
    template: `%s — ${SITE_NAME}`,
  },

  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,

  /**
   * Overridden per-page by `buildMetadata`. Declared here so a route that forgets to define
   * metadata still emits something coherent rather than inheriting nothing.
   */
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'en_GB',
    url: siteUrl,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },

  twitter: { card: 'summary_large_image' },

  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },

  /**
   * Icons and the web manifest come from Next's file conventions rather than from here:
   * `app/icon.svg`, `app/apple-icon.png`, `app/favicon.ico` and `app/manifest.ts` are detected
   * automatically and get content-hashed URLs. Declaring them in this object as well would emit
   * a second, unhashed set of tags pointing at paths that may not exist.
   */

  formatDetection: {
    /**
     * Stops iOS Safari from auto-linking phone numbers, addresses and dates it *thinks* it
     * found. It styles them with its own blue underline, which on a near-black page with acid
     * accents is jarring — and it regularly mangles a year in a case-study meta row into a
     * tappable date. The real phone number is an explicit `tel:` link in the footer.
     */
    telephone: false,
    address: false,
    date: false,
  },

  /**
   * Populated from `siteSettings.verification` by the site layout when an editor adds one.
   * Declared as an empty object here purely so the shape is visible in one place.
   */
  verification: {},

  category: 'technology',
};

/* ---------------------------------------------------------------------------
 * Viewport
 * ------------------------------------------------------------------------- */

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,

  /**
   * `maximumScale: 5`, NOT 1, and `userScalable` left at its default of true.
   *
   * `maximum-scale=1` / `user-scalable=no` is the most common accessibility failure in
   * design-led sites: it disables pinch zoom entirely, which is a direct WCAG 2.1 1.4.4 failure
   * and a serious barrier for anyone with low vision. The usual reason for adding it — stopping
   * iOS from zooming when a small-font input is focused — is solved properly by never setting an
   * input's font-size below 16px, which the form styles do.
   *
   * 5 rather than unbounded because beyond ~5× the fixed-position header and cursor overlay
   * stop being usable, and iOS' own ceiling is around there anyway.
   */
  maximumScale: 5,

  /**
   * Matches `--c-surface`. This is what the mobile browser chrome tints itself, and a mismatch
   * shows as a visible band of a slightly different black above the page on iOS and Android.
   */
  themeColor: '#08080B',

  /** Paired with `color-scheme: dark` in globals.css — see the note there. */
  colorScheme: 'dark',
};

/* ---------------------------------------------------------------------------
 * The shell
 * ------------------------------------------------------------------------- */

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      /**
       * `en-GB` rather than `en`. It is the copy's actual dialect (the site says "organisation"),
       * and it drives the correct hyphenation dictionary and quote marks — which matters on a
       * page of very large, tightly-tracked headlines where a wrong break is visible.
       */
      lang="en-GB"
      /**
       * The three font variables, which is the only reason these classes exist — each
       * `next/font` call generates a class that declares its own `--font-*` custom property, and
       * `tailwind.config.ts` reads exactly these names.
       */
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      /**
       * Declared server-side so the contract is visible in the markup: `FluidCursor` is the sole
       * writer of this attribute and flips it to `"custom"` only while the custom cursor is
       * genuinely painted. Starting at `"native"` means the `cursor: none` rules in globals.css
       * cannot match before JavaScript has run — so a visitor with JS disabled, a failed bundle,
       * or a hydration error always keeps a working pointer.
       */
      data-cursor="native"
    >
      <body>
        {/**
         * The skip link, first in the DOM and first in tab order.
         *
         * On this site it is not a formality. The header contains a menu trigger and a CTA, and
         * the page below it opens with a WebGL canvas and a split headline — so without a skip
         * link, reaching the actual content by keyboard means tabbing through the whole of the
         * chrome on every navigation.
         *
         * `#main` is provided by `(site)/layout.tsx`; the Studio route has no `#main`, and a
         * skip link pointing at a missing target is a no-op rather than an error.
         */}
        <a href="#main" className="skip-link">
          Skip to content
        </a>

        {children}
      </body>
    </html>
  );
}
