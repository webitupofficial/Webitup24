import createImageUrlBuilder from '@sanity/image-url';
import type { Image as SanityImageType } from 'sanity';

import { dataset, projectId } from '@/sanity/env';

const builder = createImageUrlBuilder({ projectId, dataset });

/** Anything with an `_ref`-bearing asset is a valid source. */
export type ImageSource = SanityImageType & {
  asset?: { _ref?: string; _id?: string };
  alt?: string;
  hotspot?: { x: number; y: number };
  // Injected by our GROQ projections (see queries.ts) so we can render an LQIP without a
  // second round-trip.
  lqip?: string | null;
  aspectRatio?: number | null;
};

/**
 * Build a Sanity CDN URL.
 *
 * Always pass a width. An unconstrained `urlFor(img).url()` returns the *original* asset —
 * on a portfolio site that routinely means shipping a 6000px, 12MB PNG to a phone.
 */
export function urlFor(source: ImageSource) {
  return builder.image(source).auto('format').fit('max');
}

/**
 * Single-shot helper for the common case.
 * `dpr(2)` is capped at 2 on purpose: beyond that the byte cost outruns any perceptible
 * gain, and Sanity bills by transform.
 */
export function imageUrl(
  source: ImageSource,
  width: number,
  opts: { height?: number; quality?: number; dpr?: 1 | 2 } = {}
): string {
  const { height, quality = 82, dpr = 1 } = opts;
  let b = urlFor(source).width(width).quality(quality).dpr(dpr);
  if (height) b = b.height(height).fit('crop').crop('focalpoint');
  return b.url();
}

/**
 * `sizes`-aware srcSet. Next's <Image> handles this for us in most places, but we need it
 * raw for `<video poster>`, OG images, and WebGL textures loaded via TextureLoader.
 */
export function imageSrcSet(source: ImageSource, widths: number[]): string {
  return widths.map((w) => `${imageUrl(source, w)} ${w}w`).join(', ');
}

/** Extracts `width`/`height` from a Sanity asset `_ref`, which encodes them in the id. */
export function dimensionsFromRef(ref?: string): { width: number; height: number } | null {
  if (!ref) return null;
  // image-<hash>-<width>x<height>-<ext>
  const match = /-(\d+)x(\d+)-/.exec(ref);
  if (!match || !match[1] || !match[2]) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}
