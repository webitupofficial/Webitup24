import type { ImageSource } from '@/sanity/lib/image';
import type { PaletteToken } from '@/components/canvas/registry';

/**
 * =============================================================================
 * types/content.ts — hand-written result types for the GROQ projections
 * =============================================================================
 *
 * `queries.ts` wraps every query in `defineQuery`, which exists so `sanity typegen generate` can
 * emit exact result types into `sanity.types.ts`. In a checkout where typegen has been run, the
 * components below could import those generated types directly.
 *
 * These interfaces are the hand-authored stand-in that keeps the app type-safe *before* that
 * codegen step runs (there is no Sanity project id wired up in this environment to generate
 * against), and they double as living documentation of exactly what each projection returns. They
 * mirror the fragments in `queries.ts` field-for-field — if you change a projection there, change
 * the matching interface here, and `tsc` points at every component that assumed the old shape.
 *
 * Everything is nullable that GROQ can return null for: an absent scalar projects as `null`, an
 * optional object as `null`, and a dereference to a deleted document as `null`. Being honest about
 * that here is what forces the components to null-check rather than crash on the one project whose
 * `client` was never filled in.
 */

/* ---------------------------------------------------------------------------
 * Primitives — the reusable fragments
 * ------------------------------------------------------------------------- */

/**
 * An image as projected by `IMAGE_FRAGMENT`. Extends `ImageSource` (which `SanityImage` and
 * `urlFor` consume) with the metadata the projection injects for zero-CLS, blur-up rendering.
 */
export interface ImageValue extends ImageSource {
  url?: string | null;
  width?: number | null;
  height?: number | null;
  /** Dominant background colour from the asset palette — a cheap themed placeholder tint. */
  dominant?: string | null;
}

/** A file asset as projected by `FILE_FRAGMENT` — video or `.glb`. */
export interface FileValue {
  url?: string | null;
  size?: number | null;
  mimeType?: string | null;
  originalFilename?: string | null;
}

/** `colorPalette{PALETTE_FRAGMENT}`. */
export interface PaletteValue {
  preferDark?: boolean | null;
  tokens?: PaletteToken[] | null;
}

/* ---------------------------------------------------------------------------
 * Project card — PROJECT_CARD_FRAGMENT
 * ------------------------------------------------------------------------- */

/** The lean shape rendered by the work grid. Runs 6–40× per page, so it carries no rich text. */
export interface ProjectCard {
  _id: string;
  title?: string | null;
  slug?: string | null;
  tagline?: string | null;
  year?: number | null;
  featured?: boolean | null;
  order?: number | null;
  technologies?: string[] | null;
  client?: { name?: string | null; industry?: string | null } | null;
  thumbnail?: ImageValue | null;
  thumbnailVideo?: FileValue | null;
  colorPalette?: PaletteValue | null;
  sceneId?: string | null;
  /** `services[]->title` — resolved service names, for the card's tag row. */
  serviceNames?: (string | null)[] | null;
  awardCount?: number | null;
}

/* ---------------------------------------------------------------------------
 * Services — homePageQuery `services`
 * ------------------------------------------------------------------------- */

export interface ServiceDeliverable {
  _key: string;
  title?: string | null;
  description?: string | null;
}

export interface HomeService {
  _id: string;
  title?: string | null;
  slug?: string | null;
  shortDescription?: string | null;
  order?: number | null;
  /** Lucide icon name string, chosen in the Studio. */
  icon?: string | null;
  /** Key into `SERVICE_ELEMENTS` — which procedural 3D primitive accompanies the service. */
  elementId?: string | null;
  /** Authored accent hex, drives the row's hover tint. */
  accentColor?: string | null;
  deliverables?: ServiceDeliverable[] | null;
}

/* ---------------------------------------------------------------------------
 * Testimonials, stats, clients — the rest of homePageQuery
 * ------------------------------------------------------------------------- */

export interface TestimonialItem {
  _key: string;
  quote?: string | null;
  author?: string | null;
  role?: string | null;
  avatar?: ImageValue | null;
}

/** One project's collected `quoteModule`s, plus the client it belongs to. */
export interface TestimonialGroup {
  items?: TestimonialItem[] | null;
  clientName?: string | null;
}

export interface HomeStats {
  projectCount?: number | null;
  clientCount?: number | null;
  awardCount?: number | null;
  earliestYear?: number | null;
}

export interface ClientLogo {
  name?: string | null;
  logo?: ImageValue | null;
}

/** The whole homepage payload — one round-trip, `homePageQuery`. */
export interface HomePageData {
  featured?: ProjectCard[] | null;
  services?: HomeService[] | null;
  testimonials?: TestimonialGroup[] | null;
  stats?: HomeStats | null;
  clients?: ClientLogo[] | null;
}
