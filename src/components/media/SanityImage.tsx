import Image from 'next/image';

import {
  dimensionsFromRef,
  urlFor,
  type ImageSource,
} from '@/sanity/lib/image';
import { cn } from '@/lib/utils/cn';

/**
 * =============================================================================
 * SanityImage — the one image primitive, everywhere.
 * =============================================================================
 *
 * Wraps `next/image` around a Sanity image projection, with two things every image on the site
 * needs and neither of which `next/image` gives you for free against a headless CMS:
 *
 *   1. A blur-up placeholder from the LQIP that `IMAGE_FRAGMENT` already projected — so no image
 *      pops in from blank, and there is no second request to generate the placeholder.
 *   2. Reserved layout from the asset's real aspect ratio — so the page does not reflow when the
 *      image lands. This is the single highest-leverage CLS fix on an image-heavy portfolio, which
 *      is exactly why the GROQ layer goes to the trouble of projecting `aspectRatio` and `lqip`.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS IS A SERVER COMPONENT (AND WHY IT DOES NOT USE A CUSTOM LOADER)
 * -----------------------------------------------------------------------------
 * It renders no interactivity, so it stays on the server — an image-heavy page ships zero client JS
 * for its images. That rules out the tempting `loader={(args) => urlFor(...)}` prop: a function
 * cannot cross the server→client boundary into `next/image`, and adding `'use client'` here purely
 * to keep the closure would pull the entire image tree into the client bundle.
 *
 * Instead it hands `next/image` a single Sanity URL capped at a sane source width and lets Next's
 * configured optimizer (see `next.config.mjs` — `remotePatterns` for `cdn.sanity.io`, AVIF/WebP,
 * the breakpoint-matched `deviceSizes`) produce the responsive `srcset`. Sanity serves one
 * reasonably-sized source; Next downscales it to each breakpoint. The alternative — Sanity doing
 * the resizing via a client loader — is marginally fewer bytes at the cost of making every image on
 * the site a client component, which is the wrong trade for this codebase.
 */

/** The source width handed to Next's optimizer. Next downscales from here to each `deviceSize`; it
 *  never upscales, so this also caps the largest variant. 2560 covers a 2× 1280px column and a
 *  full-bleed 1440p hero without shipping a 6000px original into the optimizer. */
const SOURCE_WIDTH = 2560;

/** Fallback aspect ratio when neither the ref nor the projection carries dimensions. */
const FALLBACK_RATIO = 16 / 10;

export interface SanityImageProps {
  /** The projected image object from a GROQ `IMAGE_FRAGMENT`. Null-safe: renders nothing if empty. */
  image?: (ImageSource & { url?: string | null }) | null;
  /**
   * Alt text override. When omitted, the asset's own `alt` is used. Pass `alt=""` explicitly to
   * mark a decorative image — that is a real, different statement from "alt unknown".
   */
  alt?: string;
  /** `sizes` hint. Required in practice for correct variant selection — default assumes full width. */
  sizes?: string;
  className?: string;
  /**
   * Fill the positioned parent (parent must be `relative`/`absolute`). For full-bleed media where
   * the container, not the image, dictates the box. Mutually exclusive with intrinsic sizing.
   */
  fill?: boolean;
  /** LCP images only — the hero. Emits a preload and opts out of lazy loading. Use sparingly. */
  priority?: boolean;
  /** `object-fit` when `fill`. Cover by default — the usual intent for a bleed. */
  objectFit?: 'cover' | 'contain';
  quality?: number;
}

export function SanityImage({
  image,
  alt,
  sizes = '100vw',
  className,
  fill = false,
  priority = false,
  objectFit = 'cover',
  quality = 82,
}: SanityImageProps) {
  /**
   * No asset → nothing. Returning null rather than a broken-image icon is deliberate: a missing
   * optional image (a project without a client logo, say) should leave no trace, not a gap.
   */
  if (!image?.asset) return null;

  const src = urlFor(image).width(SOURCE_WIDTH).quality(quality).url();

  /**
   * The blur placeholder. Only switched on when an LQIP is present — `placeholder="blur"` with no
   * `blurDataURL` throws, so a projection that somehow lacks one degrades to no placeholder rather
   * than to an error.
   */
  const blur = image.lqip
    ? ({ placeholder: 'blur', blurDataURL: image.lqip } as const)
    : ({ placeholder: 'empty' } as const);

  // Alt precedence: explicit prop (including "") → asset alt → "". Empty string is a valid,
  // intentional value, so the check is `undefined`, not falsy.
  const resolvedAlt = alt !== undefined ? alt : (image.alt ?? '');

  if (fill) {
    return (
      <Image
        src={src}
        alt={resolvedAlt}
        fill
        sizes={sizes}
        priority={priority}
        className={cn(objectFit === 'cover' ? 'object-cover' : 'object-contain', className)}
        {...blur}
      />
    );
  }

  /**
   * Intrinsic dimensions, for the aspect-ratio box that prevents reflow. In priority order:
   *   1. The width×height encoded in the asset `_ref` — exact, free, always present on a real asset.
   *   2. The projected `aspectRatio` against a nominal width — for a synthetic or partial source.
   *   3. A 16:10 fallback — so the component still renders rather than throwing on `undefined`.
   */
  const fromRef = dimensionsFromRef(image.asset._ref);
  const ratio = image.aspectRatio ?? (fromRef ? fromRef.width / fromRef.height : FALLBACK_RATIO);
  const width = fromRef?.width ?? SOURCE_WIDTH;
  const height = fromRef?.height ?? Math.round(width / ratio);

  return (
    <Image
      src={src}
      alt={resolvedAlt}
      width={width}
      height={height}
      sizes={sizes}
      priority={priority}
      className={className}
      {...blur}
    />
  );
}
