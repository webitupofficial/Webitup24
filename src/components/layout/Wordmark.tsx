import { cn } from '@/lib/utils/cn';

/**
 * =============================================================================
 * Wordmark — the logo lockup, used by the header, the footer and the preloader.
 * =============================================================================
 *
 * NOT a client component, deliberately. It has no state and no handlers, so keeping it out of
 * `'use client'` means the footer (a Server Component) can render it without pulling a client
 * chunk, while the header (a client component) can still import it — a server module imported
 * from a client module is simply compiled into that client chunk.
 *
 * -----------------------------------------------------------------------------
 * WHY TYPE RATHER THAN AN SVG FILE
 * -----------------------------------------------------------------------------
 * The mark is set in the display face with a live accent glyph, so it inherits the same fluid
 * type scale, the same font loading and the same colour tokens as everything else. An SVG would
 * be a second source of truth for the brand's shape, would not respond to `currentColor`
 * transitions on hover, and would need re-exporting every time the type scale moved.
 *
 * `settings.logo` overrides this when an editor uploads a real logo — see `logoUrl`. The
 * typographic mark is the fallback, not a placeholder: it is what the site ships with.
 */

export interface WordmarkProps {
  /** Optional uploaded logo from `siteSettings.logo`. Renders instead of the type when present. */
  logoUrl?: string | null;
  /** Accessible name. Also the alt text when a logo image is used. */
  siteName?: string;
  /**
   * `sm` for the header (fits inside `--header-h`), `lg` for the footer and the preloader, where
   * the mark is a display element in its own right.
   */
  size?: 'sm' | 'lg';
  className?: string;
}

export function Wordmark({
  logoUrl,
  siteName = 'WebItUp24',
  size = 'sm',
  className,
}: WordmarkProps) {
  if (logoUrl) {
    return (
      /**
       * Plain `<img>` rather than `next/image`. The logo is a single small asset requested on
       * every page, so it is served from Sanity's CDN and cached after the first request;
       * `next/image`'s resizing pipeline adds a hop and a second cache for no benefit at this
       * size. `height` is fixed and `width` is auto so any aspect ratio the editor uploads is
       * respected without distortion.
       */
      <img
        src={logoUrl}
        alt={siteName}
        className={cn('w-auto object-contain', size === 'sm' ? 'h-7' : 'h-12', className)}
        // Eagerly loaded and high priority: it is in the header, above the fold, on every page.
        loading="eager"
        fetchPriority="high"
        decoding="async"
      />
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-baseline font-display font-semibold leading-none tracking-[-0.045em]',
        size === 'sm' ? 'text-xl' : 'text-display-sm',
        className
      )}
    >
      {/**
       * Split across three spans so the middle syllable and the numerals can be coloured
       * independently. `aria-hidden` is not needed — the text content reads correctly as
       * "WebItUp24" to a screen reader because the spans introduce no whitespace between them.
       */}
      <span>Web</span>
      <span className="text-acid">It</span>
      <span>Up</span>
      <span
        className={cn(
          /**
           * The numerals are set in mono and optically raised. Two reasons: the display face's
           * lining figures are much wider than its lowercase, which makes "24" dominate the
           * lockup; and mono's tabular figures keep the mark's width identical whatever the
           * numerals are, which matters because this element sits in a fixed-height header.
           */
          'font-mono font-medium tracking-tight text-muted',
          size === 'sm' ? 'ml-0.5 text-sm' : 'ml-1 text-2xl'
        )}
      >
        24
      </span>
    </span>
  );
}
