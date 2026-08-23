import type { Metadata } from 'next';

import { siteUrl } from '@/sanity/env';
import { imageUrl, type ImageSource } from '@/sanity/lib/image';

/**
 * =============================================================================
 * lib/utils/seo.ts — the metadata fallback chain
 * =============================================================================
 *
 * The `seo` object in Sanity is deliberately small (see `schemas/objects/seo.ts`): every field
 * an editor *can* fill is a field they *must* think about. That only works if there is a
 * well-defined chain of defaults behind it, which is what this file is.
 *
 * For every page, in order:
 *
 *   title       seo.metaTitle → page title → siteSettings.siteName
 *   description seo.metaDescription → page tagline/excerpt → siteSettings.tagline
 *   og:image    seo.ogImage → the page's own hero/thumbnail → a generated card (/api/og)
 *   robots      seo.noIndex → indexable
 *
 * -----------------------------------------------------------------------------
 * WHY EVERYTHING IS BUILT AGAINST STRUCTURAL TYPES
 * -----------------------------------------------------------------------------
 * These helpers take plain structural shapes (`{ metaTitle?: string | null }`) rather than the
 * types `sanity typegen` emits. Two reasons:
 *
 *   1. Typegen output does not exist until `npm run typegen` has run against a real dataset, so
 *      importing it here would make a fresh clone fail to typecheck before it can fetch
 *      anything.
 *   2. The same helper is called with a `project`, a `service` and a `page`, whose generated
 *      types are three unrelated interfaces that happen to share these fields. A structural
 *      parameter accepts all three without a union that has to be updated per document type.
 *
 * `null` is allowed everywhere alongside `undefined` because GROQ returns `null` for an absent
 * field, not `undefined` — a distinction that silently breaks `??` chains typed as optional-only.
 */

/* ---------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

/**
 * Fallbacks used when `siteSettings` has not been created yet (a fresh dataset) or when a
 * helper is called outside a request that fetched it — the OG image route, for instance.
 *
 * Every one of these is overridden by real content in production. They exist so the site never
 * renders a page titled `undefined`, which is the actual failure mode of a missing singleton.
 */
export const SITE_NAME = 'WebItUp24';
export const SITE_TAGLINE = 'Digital experiences engineered to be remembered.';
export const SITE_DESCRIPTION =
  'WebItUp24 is a digital studio building immersive, high-performance websites and products — real-time 3D, considered motion, and engineering that holds up.';

/** Twitter/X handle, used for `twitter:site`. Empty string disables the tag. */
export const SITE_TWITTER = '';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/* ---------------------------------------------------------------------------
 * URLs
 * ------------------------------------------------------------------------- */

/**
 * Resolve a path against the site origin.
 *
 * Absolute URLs matter more than they look. `metadataBase` covers `openGraph.url` and canonical
 * tags, but JSON-LD, RSS and any hand-built `og:image` must be absolute or crawlers and social
 * unfurlers silently drop them — and there is no error, just a share card with no image.
 */
export function absoluteUrl(path = '/'): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${siteUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

/* ---------------------------------------------------------------------------
 * Structural input shapes
 * ------------------------------------------------------------------------- */

/** The projection of `seo` returned by `SEO_FRAGMENT`. */
export interface SeoInput {
  metaTitle?: string | null;
  metaDescription?: string | null;
  keywords?: string[] | null;
  noIndex?: boolean | null;
  ogImage?: (ImageSource & { url?: string | null }) | null;
}

export interface BuildMetadataArgs {
  /** The page's own title. Used when `seo.metaTitle` is absent. */
  title?: string | null;
  /** The page's own summary — a project tagline, a service excerpt. */
  description?: string | null;
  /** The authored `seo` object, if the document has one. */
  seo?: SeoInput | null;
  /** Path on this site, e.g. `/work/northwind`. Drives the canonical URL. */
  path?: string;
  /**
   * The page's own lead image, used for the share card when `seo.ogImage` is absent. Pass the
   * hero or thumbnail — a real photograph of the work outperforms a generated card every time.
   */
  image?: (ImageSource & { url?: string | null }) | null;
  /** `article` for case studies and posts, `website` for everything else. */
  type?: 'website' | 'article';
  /** ISO date, for `article:published_time`. */
  publishedTime?: string | null;
  modifiedTime?: string | null;
  /**
   * Site-wide defaults, normally `siteSettings`. Optional so a page can build metadata without
   * a second fetch — the constants above are used instead.
   */
  settings?: {
    siteName?: string | null;
    tagline?: string | null;
    defaultSeo?: SeoInput | null;
  } | null;
  /**
   * Force `noindex` regardless of content. Used by the draft-mode preview shell and the 404,
   * neither of which should ever enter an index.
   */
  forceNoIndex?: boolean;
}

/* ---------------------------------------------------------------------------
 * Text normalisation
 * ------------------------------------------------------------------------- */

/**
 * Collapse whitespace and hard-truncate at a word boundary.
 *
 * Editors paste descriptions out of documents, which arrive with newlines and double spaces
 * that render literally in a `<meta>` tag. Truncating at a word boundary rather than mid-word
 * matters because search engines append their own ellipsis — a description cut to
 * `…engineering that ho` reads as a bug in the site, not as a truncation by Google.
 */
function clean(value: string | null | undefined, max = 300): string | undefined {
  if (!value) return undefined;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  if (collapsed.length <= max) return collapsed;

  const cut = collapsed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/* ---------------------------------------------------------------------------
 * OG image resolution
 * ------------------------------------------------------------------------- */

/**
 * Build the share-card image, in priority order.
 *
 * The exact 1200×630 crop is not optional: platforms do not letterbox, they centre-crop, so a
 * 3:2 hero shared to LinkedIn loses the top and bottom of the composition. Requesting the crop
 * from Sanity with `fit('crop').crop('focalpoint')` means the editor's chosen hotspot decides
 * what survives — which is the entire reason `options: { hotspot: true }` is on the field.
 */
function resolveOgImage(args: BuildMetadataArgs): {
  url: string;
  width: number;
  height: number;
  alt: string;
} {
  const alt = clean(args.seo?.metaTitle ?? args.title, 120) ?? SITE_NAME;

  const candidate = args.seo?.ogImage ?? args.image ?? args.settings?.defaultSeo?.ogImage ?? null;

  if (candidate?.asset) {
    return {
      url: imageUrl(candidate, OG_WIDTH, { height: OG_HEIGHT, quality: 88 }),
      width: OG_WIDTH,
      height: OG_HEIGHT,
      alt: clean(candidate.alt, 120) ?? alt,
    };
  }

  /**
   * Generated fallback. The schema's own field description promises this ("If blank, we
   * generate one from the page title at the edge"), and a promise in a Studio description is a
   * contract with the editor — they will leave the field blank on that basis.
   */
  const params = new URLSearchParams({ title: args.title ?? SITE_NAME });
  const subtitle = clean(args.description, 110);
  if (subtitle) params.set('subtitle', subtitle);

  return {
    url: absoluteUrl(`/api/og?${params.toString()}`),
    width: OG_WIDTH,
    height: OG_HEIGHT,
    alt,
  };
}

/* ---------------------------------------------------------------------------
 * The builder
 * ------------------------------------------------------------------------- */

/**
 * Produce a Next.js `Metadata` object for a page.
 *
 * Used from `generateMetadata` in every route. Returning `Metadata` rather than raw tags means
 * Next handles deduplication against the root layout's metadata, so a page only has to state
 * what differs.
 */
export function buildMetadata(args: BuildMetadataArgs = {}): Metadata {
  const {
    path = '/',
    type = 'website',
    publishedTime,
    modifiedTime,
    settings,
    forceNoIndex = false,
  } = args;

  const siteName = clean(settings?.siteName, 60) ?? SITE_NAME;

  /**
   * Title. The root layout sets a `template` of `%s — WebItUp24`, and returning a bare string
   * here lets that template apply. The home page passes `absolute` itself to avoid
   * "WebItUp24 — WebItUp24".
   */
  const title = clean(args.seo?.metaTitle ?? args.title, 70);

  const description =
    clean(args.seo?.metaDescription ?? args.description, 165) ??
    clean(settings?.defaultSeo?.metaDescription, 165) ??
    clean(settings?.tagline, 165) ??
    SITE_DESCRIPTION;

  const url = absoluteUrl(path);
  const og = resolveOgImage(args);
  const noIndex = forceNoIndex || args.seo?.noIndex === true;

  const keywords = args.seo?.keywords?.length
    ? args.seo.keywords
    : (settings?.defaultSeo?.keywords ?? undefined);

  return {
    ...(title ? { title } : {}),
    description,

    /**
     * `alternates.canonical` on every page, always self-referential.
     *
     * Case-study URLs pick up query strings from campaign tags and from the Presentation tool's
     * preview parameters. Without a canonical, each of those is a separate URL to a crawler and
     * the page's authority is split across them.
     */
    alternates: { canonical: url },

    ...(keywords?.length ? { keywords } : {}),

    openGraph: {
      type,
      url,
      siteName,
      ...(title ? { title } : {}),
      description,
      locale: 'en_GB',
      images: [{ url: og.url, width: og.width, height: og.height, alt: og.alt }],
      ...(type === 'article' && publishedTime ? { publishedTime } : {}),
      ...(type === 'article' && modifiedTime ? { modifiedTime } : {}),
    },

    twitter: {
      /**
       * `summary_large_image` rather than `summary`: the small card crops to a square and a
       * 1200×630 asset loses a third of its width. There is no downside — the large card is
       * supported everywhere and degrades to the small one where it is not.
       */
      card: 'summary_large_image',
      ...(SITE_TWITTER ? { site: SITE_TWITTER, creator: SITE_TWITTER } : {}),
      ...(title ? { title } : {}),
      description,
      images: [og.url],
    },

    robots: noIndex
      ? { index: false, follow: false, nocache: true }
      : {
          index: true,
          follow: true,
          /**
           * Explicit `googleBot` limits. `max-image-preview: large` is what lets a case study's
           * hero appear at full size in Discover and image results, which for a visual studio is
           * the single highest-value SEO setting available — and it defaults to a thumbnail.
           */
          googleBot: {
            index: true,
            follow: true,
            'max-image-preview': 'large',
            'max-snippet': -1,
            'max-video-preview': -1,
          },
        },
  };
}

/* ---------------------------------------------------------------------------
 * JSON-LD
 *
 * Emitted as a `<script type="application/ld+json">` by the layouts. Kept as plain object
 * builders rather than strings so the shapes are typo-checkable and composable.
 *
 * On serialisation: these are rendered with `jsonLdScript` below, never with a bare
 * `JSON.stringify`. See that function for why.
 * ------------------------------------------------------------------------- */

export interface OrganizationInput {
  siteName?: string | null;
  tagline?: string | null;
  email?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  location?: string | null;
  socials?: { url?: string | null }[] | null;
  organization?: {
    legalName?: string | null;
    foundingYear?: number | null;
    sameAs?: string[] | null;
  } | null;
}

/**
 * `Organization` + `WebSite`, emitted once in the site layout.
 *
 * The `@graph` form with explicit `@id`s rather than two separate script blocks: it lets the
 * `WebSite` node reference the `Organization` node as its publisher instead of duplicating it,
 * which is what makes a knowledge-panel association possible at all.
 */
export function organizationJsonLd(input: OrganizationInput = {}) {
  const name = input.siteName ?? SITE_NAME;
  const orgId = `${siteUrl}/#organization`;
  const siteId = `${siteUrl}/#website`;

  const sameAs = [
    ...(input.organization?.sameAs ?? []),
    ...(input.socials?.map((s) => s?.url).filter((u): u is string => Boolean(u)) ?? []),
  ];

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': orgId,
        name,
        ...(input.organization?.legalName ? { legalName: input.organization.legalName } : {}),
        url: siteUrl,
        ...(input.tagline ? { slogan: input.tagline } : {}),
        description: clean(input.tagline) ?? SITE_DESCRIPTION,
        ...(input.logoUrl ? { logo: { '@type': 'ImageObject', url: input.logoUrl } } : {}),
        ...(input.organization?.foundingYear
          ? { foundingDate: String(input.organization.foundingYear) }
          : {}),
        ...(input.email || input.phone
          ? {
              contactPoint: {
                '@type': 'ContactPoint',
                contactType: 'sales',
                ...(input.email ? { email: input.email } : {}),
                ...(input.phone ? { telephone: input.phone } : {}),
                availableLanguage: ['en'],
              },
            }
          : {}),
        ...(input.location ? { areaServed: input.location } : {}),
        // Deduplicated: the same profile is frequently in both `sameAs` and `socials`.
        ...(sameAs.length ? { sameAs: Array.from(new Set(sameAs)) } : {}),
      },
      {
        '@type': 'WebSite',
        '@id': siteId,
        url: siteUrl,
        name,
        publisher: { '@id': orgId },
        inLanguage: 'en-GB',
      },
    ],
  };
}

/**
 * `BreadcrumbList` for nested routes.
 *
 * Worth emitting even though the site has no visual breadcrumb: Google replaces the URL line in
 * a result with the breadcrumb trail when one is present, so `webitup24.com › Work › Northwind`
 * appears instead of a raw slug.
 */
export function breadcrumbJsonLd(trail: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export interface CreativeWorkInput {
  title: string;
  path: string;
  description?: string | null;
  imageUrl?: string | null;
  year?: number | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
  clientName?: string | null;
  technologies?: string[] | null;
}

/** `CreativeWork` for a case study. */
export function creativeWorkJsonLd(input: CreativeWorkInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: input.title,
    url: absoluteUrl(input.path),
    ...(input.description ? { description: clean(input.description) } : {}),
    ...(input.imageUrl ? { image: input.imageUrl } : {}),
    ...(input.publishedAt ? { datePublished: input.publishedAt } : {}),
    ...(input.updatedAt ? { dateModified: input.updatedAt } : {}),
    ...(input.year && !input.publishedAt ? { dateCreated: String(input.year) } : {}),
    creator: { '@id': `${siteUrl}/#organization` },
    ...(input.clientName
      ? { sourceOrganization: { '@type': 'Organization', name: input.clientName } }
      : {}),
    ...(input.technologies?.length ? { keywords: input.technologies.join(', ') } : {}),
  };
}

export interface ServiceJsonLdInput {
  title: string;
  path: string;
  description?: string | null;
}

/** `Service`, for a service detail page. */
export function serviceJsonLd(input: ServiceJsonLdInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: input.title,
    url: absoluteUrl(input.path),
    ...(input.description ? { description: clean(input.description) } : {}),
    provider: { '@id': `${siteUrl}/#organization` },
    serviceType: input.title,
  };
}

/* ---------------------------------------------------------------------------
 * Safe serialisation
 * ------------------------------------------------------------------------- */

/**
 * `</script>` cannot appear literally inside a `<script>` element — the HTML parser terminates
 * the element at the first occurrence, *including inside a JSON string value*. A CMS
 * description containing that sequence would end the script early and dump the remainder of the
 * JSON into the page as visible text, with everything after it parsed as markup.
 *
 * Escaping every `<` sidesteps it entirely. `JSON.parse` reads `<` back as `<`, so the
 * structured data a crawler sees is unchanged.
 */
const LT = /</g;

/**
 * U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR are legal inside a JSON string but are
 * line terminators in JavaScript source, so an unescaped one is a syntax error in the script
 * block — and they genuinely do arrive, pasted out of word processors into a CMS field.
 *
 * Built with `new RegExp` from a string rather than as a `/…/g` literal, and this is not a
 * style preference: because both characters ARE line terminators, they are not legal inside a
 * regular-expression literal at all — a literal containing one is a parse error, not a working
 * regex. Constructing from a string whose every byte is plain ASCII has the second benefit that
 * nothing invisible is sitting in this file waiting to be mangled by an editor or a formatter.
 */
const LINE_SEP = new RegExp('\u2028', 'g');
const PARA_SEP = new RegExp('\u2029', 'g');

/**
 * Serialise a JSON-LD object for injection into a `<script type="application/ld+json">` tag.
 *
 * Always use this rather than a bare `JSON.stringify` — see the two constants above for the
 * failure each escape prevents.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(LT, '\\u003c')
    .replace(LINE_SEP, '\\u2028')
    .replace(PARA_SEP, '\\u2029');
}
