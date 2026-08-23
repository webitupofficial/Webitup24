'use client';

import Link from 'next/link';
import { useCallback, useRef } from 'react';

import { SanityImage } from '@/components/media/SanityImage';
import { useUIStore } from '@/lib/store/useUIStore';
import { cn } from '@/lib/utils/cn';
import { paletteStyle } from '@/lib/utils/palette';
import type { ProjectCard as ProjectCardData } from '@/types/content';

/**
 * =============================================================================
 * ProjectCard — one case study in the work grid
 * =============================================================================
 *
 * A client component, for exactly two reasons — both of which are genuine interactivity and neither
 * of which can be done in CSS:
 *
 *   1. The cursor swap. Hovering a card puts the custom cursor into `view` mode with the project's
 *      own label, which is the site's primary "this is clickable, and here is what it is" signal.
 *      That state lives in the UI store, so it has to be set from an event handler.
 *   2. The hover video. `thumbnailVideo` is played on enter and *reset* on leave. CSS can autoplay
 *      a video but it cannot start one conditionally, and an always-playing video per card means
 *      twelve simultaneous decodes — which is how a work grid drops to 20fps on a laptop.
 *
 * Everything else — the layout, the hover scale, the tag row — is CSS on a `group`.
 *
 * -----------------------------------------------------------------------------
 * WHY THE PALETTE IS SCOPED TO THE CARD
 * -----------------------------------------------------------------------------
 * `paletteStyle(tokens)` emits `--case-accent` and friends as inline custom properties on this
 * article, so each card's hover accent is its own project's colour with no per-card CSS class and no
 * global mutation. `overrideGlobals` is deliberately off: a card should tint its own accents, not
 * repaint the surface colour of the grid it sits in.
 */

export interface ProjectCardProps {
  project: ProjectCardData;
  /** Index in the grid — drives the displayed numeral and the intrinsic `sizes` hint. */
  index?: number;
  /** Editorial emphasis: a featured card spans wider and gets a taller aspect box. */
  size?: 'default' | 'wide' | 'tall';
  /** Passed to `next/image` — only the first card or two on a page should be true. */
  priority?: boolean;
  /** `sizes` hint for the thumbnail. Defaults to a sane two-column assumption. */
  sizes?: string;
}

/** Aspect box per size. Kept as a lookup so the grid and the card cannot disagree. */
const ASPECT: Record<NonNullable<ProjectCardProps['size']>, string> = {
  default: 'aspect-[4/3]',
  wide: 'aspect-[16/10]',
  tall: 'aspect-[3/4]',
};

export function ProjectCard({
  project,
  index = 0,
  size = 'default',
  priority = false,
  sizes = '(min-width: 1024px) 45vw, (min-width: 640px) 90vw, 100vw',
}: ProjectCardProps) {
  const setCursor = useUIStore((s) => s.setCursor);
  const motion = useUIStore((s) => s.motion);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { slug, title, tagline, year, client, thumbnail, thumbnailVideo, serviceNames, awardCount } =
    project;

  /**
   * A card with no slug cannot be linked. It happens: a draft saved before the slug was generated,
   * or a document whose slug was cleared. Rendering it as an unlinked tile keeps the grid's rhythm
   * intact and makes the gap visible in review, rather than shipping a link to `/work/undefined`.
   */
  const href = slug ? `/work/${slug}` : null;

  const onEnter = useCallback(() => {
    setCursor('view', 'View case');

    /**
     * Play, guarded and fire-and-forget.
     *
     * `play()` returns a promise that REJECTS if the element is removed, the tab is backgrounded,
     * or the browser's autoplay policy declines — and an unhandled rejection in a hover handler is
     * a console error on a perfectly working site. Swallowing it is correct here: the poster image
     * underneath is the fallback, and there is nothing to recover.
     */
    const video = videoRef.current;
    if (video && motion === 'full') void video.play().catch(() => {});
  }, [setCursor, motion]);

  const onLeave = useCallback(() => {
    setCursor('default');

    const video = videoRef.current;
    if (!video) return;
    video.pause();
    // Rewind, so the next hover starts from the first frame rather than resuming mid-shot. A
    // half-played loop on re-entry reads as a glitch.
    video.currentTime = 0;
  }, [setCursor]);

  /** Only the meaningful service names — GROQ projects a null for any deleted reference. */
  const tags = (serviceNames ?? []).filter((name): name is string => Boolean(name)).slice(0, 3);

  const inner = (
    <>
      {/* ------------------------------------------------------------------
        * Media
        * ---------------------------------------------------------------- */}
      <div
        className={cn(
          'relative w-full overflow-hidden rounded-xl bg-ink',
          ASPECT[size]
        )}
      >
        {/**
         * The still. Scales up on hover *inside* the clipping box, so the frame stays put and only
         * the image moves — the difference between an editorial hover and a wobbling card.
         * `motion-full:` gates it: on the lite tier the image is static.
         */}
        <div className="absolute inset-0 transition-transform duration-[900ms] ease-expo motion-full:group-hover:scale-[1.04]">
          <SanityImage
            image={thumbnail}
            // Empty alt: the card's accessible name comes from the heading and the link, so
            // describing the image again produces "Nova Bank Nova Bank" on a screen reader.
            alt=""
            fill
            sizes={sizes}
            priority={priority}
            className="h-full w-full"
          />
        </div>

        {/**
         * The hover video, layered over the still and faded in by CSS while JS handles playback.
         * `muted` + `playsInline` are load-bearing, not stylistic: without both, iOS refuses to
         * play inline and opens the native fullscreen player instead. `preload="none"` means the
         * bytes are not fetched until a hover actually happens — on a twelve-card grid that is the
         * difference between 400KB and 12MB of initial video.
         */}
        {thumbnailVideo?.url ? (
          <video
            ref={videoRef}
            src={thumbnailVideo.url}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-700 ease-out motion-full:group-hover:opacity-100"
          />
        ) : null}

        {/**
         * Accent wash keyed to the project's own palette, revealed on hover. `--case-accent` comes
         * from the inline style below and falls back to the acid token for a project with no
         * authored palette.
         */}
        <div
          className="decorative absolute inset-0 opacity-0 transition-opacity duration-700 ease-out group-hover:opacity-100"
          style={{
            background:
              'linear-gradient(to top, rgb(var(--case-accent-rgb, var(--c-acid)) / 0.16), transparent 55%)',
          }}
        />

        {/* Award badge, top-right. Only when the project actually has awards. */}
        {awardCount && awardCount > 0 ? (
          <span className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full bg-ink/70 px-3 py-1.5 font-mono text-label uppercase text-bone backdrop-blur-md">
            <span aria-hidden="true">✦</span>
            {awardCount} {awardCount === 1 ? 'award' : 'awards'}
          </span>
        ) : null}
      </div>

      {/* ------------------------------------------------------------------
        * Caption
        * ---------------------------------------------------------------- */}
      <div className="mt-5 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-3">
            <span className="font-mono text-label text-muted/60" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            {client?.name ? (
              <span className="truncate font-mono text-label uppercase text-muted">
                {client.name}
              </span>
            ) : null}
          </div>

          <h3 className="font-display text-2xl font-medium leading-tight tracking-tight text-bone transition-colors duration-300 group-hover:text-acid md:text-3xl">
            {title ?? 'Untitled project'}
          </h3>

          {tagline ? (
            <p className="mt-2 line-clamp-2 max-w-md text-pretty text-sm leading-relaxed text-muted md:text-base">
              {tagline}
            </p>
          ) : null}

          {tags.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-x-2 gap-y-1.5">
              {tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full border border-hairline px-2.5 py-1 font-mono text-[0.625rem] uppercase tracking-wider text-muted"
                >
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {year ? (
          <span className="shrink-0 font-mono text-label text-muted/70" aria-hidden="true">
            {year}
          </span>
        ) : null}
      </div>
    </>
  );

  return (
    <article
      /**
       * `group` is the hover root for every child transition, and the palette lands here so the
       * accent variables cascade to the whole card. `isolate` gives the media's absolute layers
       * their own stacking context, independent of whatever the grid does.
       */
      className={cn('group relative isolate', size === 'wide' && 'md:col-span-2')}
      style={paletteStyle(project.colorPalette?.tokens)}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {href ? (
        <Link
          href={href}
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acid focus-visible:ring-offset-4 focus-visible:ring-offset-surface"
          /**
           * The whole card is one link, so the heading, the image and the tags are a single tab
           * stop announcing one destination — rather than three stops to the same URL, which is
           * what nesting separate links in the media and the title produces.
           */
          aria-label={title ? `View case study: ${title}` : 'View case study'}
        >
          {inner}
        </Link>
      ) : (
        <div className="block">{inner}</div>
      )}
    </article>
  );
}
