import { defineQuery } from 'next-sanity';

/**
 * GROQ queries.
 *
 * All wrapped in `defineQuery` — it is an identity function at runtime whose only job is to
 * tag the string so `sanity typegen generate` can emit a precise result type for it. That
 * turns every projection below into a compile-time contract with the schema: rename a field
 * in the schema and `npm run typegen && npm run typecheck` tells you exactly which component
 * broke, instead of you finding out from an `undefined` in production.
 *
 * Conventions:
 *   • Projections are explicit. `...` is banned — it ships unused fields over the wire and
 *     makes typegen output useless.
 *   • Images are projected with `lqip` and `aspectRatio` from the asset metadata so we can
 *     render a blur placeholder and reserve layout space without a second request. This is
 *     the single highest-leverage CLS fix on an image-heavy portfolio.
 */

/* --------------------------------------------------------------------------
 * Fragments
 * ------------------------------------------------------------------------ */

/** Image + everything needed for a zero-CLS, blurred-placeholder render. */
const IMAGE_FRAGMENT = /* groq */ `
  "url": asset->url,
  "lqip": asset->metadata.lqip,
  "aspectRatio": asset->metadata.dimensions.aspectRatio,
  "width": asset->metadata.dimensions.width,
  "height": asset->metadata.dimensions.height,
  "dominant": asset->metadata.palette.dominant.background,
  alt,
  hotspot,
  crop,
  asset
`;

/** File asset (video, .glb). `size` lets the client decide whether to stream it at all. */
const FILE_FRAGMENT = /* groq */ `
  "url": asset->url,
  "size": asset->size,
  "mimeType": asset->mimeType,
  "originalFilename": asset->originalFilename
`;

const MODEL_FRAGMENT = /* groq */ `
  "asset": asset{${FILE_FRAGMENT}},
  poster{${IMAGE_FRAGMENT}},
  scale,
  rotationOffset,
  autoRotate,
  material,
  triangleBudget
`;

const HERO_MEDIA_FRAGMENT = /* groq */ `
  kind,
  image{${IMAGE_FRAGMENT}},
  video{${FILE_FRAGMENT}},
  videoPoster{${IMAGE_FRAGMENT}},
  model{${MODEL_FRAGMENT}},
  shaderPreset
`;

const PALETTE_FRAGMENT = /* groq */ `
  preferDark,
  "tokens": tokens[]{ name, hex }
`;

const SEO_FRAGMENT = /* groq */ `
  metaTitle,
  metaDescription,
  keywords,
  noIndex,
  ogImage{${IMAGE_FRAGMENT}}
`;

/**
 * Portable Text with resolved link targets.
 *
 * The nested `markDefs` projection resolves internal references to real slugs *inside the
 * query*. Without it every rich-text renderer needs its own async reference lookup, which
 * on a page with 30 inline links is 30 waterfall requests.
 */
const RICH_TEXT_FRAGMENT = /* groq */ `
  ...,
  markDefs[]{
    ...,
    _type == "linkAnnotation" => { href, newTab }
  }
`;

/** Case-study / page modules. Each branch projects only what its renderer consumes. */
const MODULES_FRAGMENT = /* groq */ `
  _key,
  _type,
  _type == "textModule" => {
    eyebrow, heading, layout,
    body[]{${RICH_TEXT_FRAGMENT}}
  },
  _type == "mediaModule" => {
    layout, parallax,
    items[]{${IMAGE_FRAGMENT}, caption}
  },
  _type == "statsModule" => {
    heading,
    stats[]{ _key, value, label, detail }
  },
  _type == "quoteModule" => {
    quote, author, role,
    avatar{${IMAGE_FRAGMENT}}
  },
  _type == "modelModule" => {
    caption, interactive,
    model{${MODEL_FRAGMENT}}
  },
  _type == "embedModule" => { url, aspectRatio, caption }
`;

/** The shape consumed by the work grid card. Kept lean — this runs 12–40 times. */
const PROJECT_CARD_FRAGMENT = /* groq */ `
  _id,
  title,
  "slug": slug.current,
  tagline,
  year,
  featured,
  order,
  technologies,
  "client": client{ name, industry },
  thumbnail{${IMAGE_FRAGMENT}},
  thumbnailVideo{${FILE_FRAGMENT}},
  colorPalette{${PALETTE_FRAGMENT}},
  sceneId,
  "serviceNames": services[]->title,
  "awardCount": count(awards)
`;

/* --------------------------------------------------------------------------
 * Site settings
 * ------------------------------------------------------------------------ */

/**
 * `*[_type == "siteSettings"][0]` rather than a document-id lookup, so a fresh dataset that
 * has not had the singleton created yet returns null instead of erroring. Every consumer
 * treats null as "use hardcoded defaults" — the site never hard-fails on missing content.
 */
export const siteSettingsQuery = defineQuery(`
  *[_type == "siteSettings"][0]{
    siteName,
    tagline,
    manifesto,
    logo{${IMAGE_FRAGMENT}},
    email,
    phone,
    whatsapp,
    location,
    footerNote,
    marqueeWords,
    availability,
    socials[]{ _key, platform, url, handle },
    primaryNav[]{
      _key, label, kind, anchor, href, contact, magnetic,
      "internalSlug": internal->slug.current,
      "internalType": internal->_type
    },
    footerNav[]{
      _key, label, kind, anchor, href, contact,
      "internalSlug": internal->slug.current,
      "internalType": internal->_type
    },
    ctaLink{
      label, kind, anchor, href, contact, magnetic,
      "internalSlug": internal->slug.current,
      "internalType": internal->_type
    },
    defaultSeo{${SEO_FRAGMENT}},
    organization{ legalName, foundingYear, sameAs },
    verification,
    motionDefaults
  }
`);

/* --------------------------------------------------------------------------
 * Projects
 * ------------------------------------------------------------------------ */

export const featuredProjectsQuery = defineQuery(`
  *[_type == "project" && featured == true && !(_id in path("drafts.**"))]
    | order(coalesce(order, 9999) asc, year desc)[0...6]{
      ${PROJECT_CARD_FRAGMENT}
    }
`);

export const allProjectsQuery = defineQuery(`
  *[_type == "project" && !(_id in path("drafts.**"))]
    | order(coalesce(order, 9999) asc, year desc, publishedAt desc){
      ${PROJECT_CARD_FRAGMENT}
    }
`);

/** Slugs only — for `generateStaticParams`. Cheap enough to run on every build. */
export const projectSlugsQuery = defineQuery(`
  *[_type == "project" && defined(slug.current)]{ "slug": slug.current }
`);

export const projectBySlugQuery = defineQuery(`
  *[_type == "project" && slug.current == $slug][0]{
    _id,
    _updatedAt,
    title,
    "slug": slug.current,
    tagline,
    year,
    liveUrl,
    technologies,
    challenge,
    approach,
    sceneId,
    publishedAt,
    "client": client{
      name, industry, website,
      logo{${IMAGE_FRAGMENT}}
    },
    heroMedia{${HERO_MEDIA_FRAGMENT}},
    thumbnail{${IMAGE_FRAGMENT}},
    colorPalette{${PALETTE_FRAGMENT}},
    intro[]{${RICH_TEXT_FRAGMENT}},
    modules[]{${MODULES_FRAGMENT}},
    credits[]{ _key, role, people },
    awards[]{ _key, name, year, url },
    "services": services[]->{ _id, title, "slug": slug.current, elementId, accentColor },
    seo{${SEO_FRAGMENT}},

    /**
     * Next / previous in the curated order, resolved server-side.
     *
     * Doing this in GROQ rather than fetching the full list client-side means the
     * case-study page makes exactly one request. The order(...) inside each subquery has
     * to match the index ordering or the "next" link lies.
     */
    "next": *[_type == "project" && !(_id in path("drafts.**")) && coalesce(order, 9999) > coalesce(^.order, 9999)]
      | order(coalesce(order, 9999) asc)[0]{ title, "slug": slug.current, thumbnail{${IMAGE_FRAGMENT}} },
    "prev": *[_type == "project" && !(_id in path("drafts.**")) && coalesce(order, 9999) < coalesce(^.order, 9999)]
      | order(coalesce(order, 9999) desc)[0]{ title, "slug": slug.current, thumbnail{${IMAGE_FRAGMENT}} },

    /** Related work: shares at least one service, excluding self. */
    "related": *[
      _type == "project" &&
      _id != ^._id &&
      !(_id in path("drafts.**")) &&
      count(services[@._ref in ^.^.services[]._ref]) > 0
    ] | order(coalesce(order, 9999) asc)[0...3]{ ${PROJECT_CARD_FRAGMENT} }
  }
`);

/* --------------------------------------------------------------------------
 * Services
 * ------------------------------------------------------------------------ */

export const allServicesQuery = defineQuery(`
  *[_type == "service" && !(_id in path("drafts.**"))] | order(order asc){
    _id,
    title,
    "slug": slug.current,
    shortDescription,
    order,
    icon,
    elementId,
    accentColor,
    startingPrice,
    "deliverableCount": count(deliverables),
    model{${MODEL_FRAGMENT}}
  }
`);

export const serviceSlugsQuery = defineQuery(`
  *[_type == "service" && defined(slug.current)]{ "slug": slug.current }
`);

export const serviceBySlugQuery = defineQuery(`
  *[_type == "service" && slug.current == $slug][0]{
    _id,
    _updatedAt,
    title,
    "slug": slug.current,
    shortDescription,
    order,
    icon,
    elementId,
    accentColor,
    startingPrice,
    description[]{${RICH_TEXT_FRAGMENT}},
    deliverables[]{ _key, title, description },
    processSteps[]{ _key, label, detail, duration },
    model{${MODEL_FRAGMENT}},
    seo{${SEO_FRAGMENT}},
    /** Case studies that list this service. Reverse of project.services. */
    "work": *[_type == "project" && references(^._id) && !(_id in path("drafts.**"))]
      | order(coalesce(order, 9999) asc)[0...4]{ ${PROJECT_CARD_FRAGMENT} }
  }
`);

/* --------------------------------------------------------------------------
 * Pages + sitemap
 * ------------------------------------------------------------------------ */

export const pageBySlugQuery = defineQuery(`
  *[_type == "page" && slug.current == $slug][0]{
    _id,
    _updatedAt,
    title,
    "slug": slug.current,
    heading,
    lead,
    showHeroScene,
    modules[]{${MODULES_FRAGMENT}},
    seo{${SEO_FRAGMENT}}
  }
`);

export const pageSlugsQuery = defineQuery(`
  *[_type == "page" && defined(slug.current)]{ "slug": slug.current }
`);

/** Everything routable, with mtimes, for app/sitemap.ts. One request, whole sitemap. */
export const sitemapQuery = defineQuery(`{
  "projects": *[_type == "project" && defined(slug.current) && seo.noIndex != true]{
    "slug": slug.current, _updatedAt
  },
  "services": *[_type == "service" && defined(slug.current) && seo.noIndex != true]{
    "slug": slug.current, _updatedAt
  },
  "pages": *[_type == "page" && defined(slug.current) && seo.noIndex != true]{
    "slug": slug.current, _updatedAt
  }
}`);

/**
 * Homepage: one round-trip for the whole above-and-below-fold payload.
 *
 * A composite query beats three parallel `sanityFetch` calls here because the Live Content
 * API opens one subscription per query — three queries means three websocket subscriptions
 * and three re-renders when an editor touches anything.
 */
export const homePageQuery = defineQuery(`{
  "featured": *[_type == "project" && featured == true && !(_id in path("drafts.**"))]
    | order(coalesce(order, 9999) asc, year desc)[0...6]{ ${PROJECT_CARD_FRAGMENT} },
  "services": *[_type == "service" && !(_id in path("drafts.**"))] | order(order asc){
    _id, title, "slug": slug.current, shortDescription, order, icon, elementId, accentColor,
    deliverables[]{ _key, title, description }
  },
  "testimonials": *[_type == "project" && defined(modules)]{
    "items": modules[_type == "quoteModule"]{
      _key, quote, author, role, avatar{${IMAGE_FRAGMENT}}
    },
    "clientName": client.name
  }[count(items) > 0],
  "stats": {
    "projectCount": count(*[_type == "project" && !(_id in path("drafts.**"))]),
    "clientCount": count(array::unique(*[_type == "project"].client.name)),
    "awardCount": count(*[_type == "project"].awards[]),
    "earliestYear": math::min(*[_type == "project"].year)
  },
  "clients": *[_type == "project" && defined(client.logo)]{
    "name": client.name,
    "logo": client.logo{${IMAGE_FRAGMENT}}
  }
}`);
