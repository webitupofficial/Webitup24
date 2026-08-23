import Link from 'next/link';

import { ProjectCard } from '@/components/work/ProjectCard';
import { Reveal } from '@/components/interactive/Reveal';
import { SplitTextReveal } from '@/components/interactive/SplitTextReveal';
import { ArrowUpRight, MagneticButton } from '@/components/interactive/MagneticButton';
import { cn } from '@/lib/utils/cn';
import type { ProjectCard as ProjectCardData } from '@/types/content';

/**
 * =============================================================================
 * WorkGrid — the selected-work section, and the /work index's body
 * =============================================================================
 *
 * A Server Component. It renders client `ProjectCard`s, which is ordinary RSC composition — the grid
 * structure, the heading and the link are static HTML, and only the cards' hover behaviour hydrates.
 *
 * -----------------------------------------------------------------------------
 * THE LAYOUT RHYTHM
 * -----------------------------------------------------------------------------
 * A uniform grid of identical tiles reads as a catalogue. The editorial pattern this uses instead is
 * an alternating cadence, computed from the index rather than authored per card:
 *
 *   • Every fourth card (0, 4, 8…) spans both columns and takes the `wide` aspect box.
 *   • The rest are standard tiles.
 *   • Odd-index standard tiles are pushed down a little on desktop, so the two columns never
 *     align into a visible horizontal band.
 *
 * All of it is index arithmetic, so an editor adding a seventh project gets a composed layout
 * without touching anything. `variant="uniform"` opts out, for the /work index where a predictable
 * scan order matters more than editorial rhythm.
 */

export interface WorkGridProps {
  projects?: ProjectCardData[] | null;
  /** Section eyebrow. Omit on the /work index, where the page heading already says it. */
  eyebrow?: string;
  /** Section heading. `\n` breaks lines (see `SplitTextReveal`). Omit to render no header. */
  heading?: string;
  /** Supporting sentence beside the heading. */
  lead?: string;
  /** "View all work" style link under the grid. */
  viewAllHref?: string;
  viewAllLabel?: string;
  /** `editorial` (default) applies the alternating cadence; `uniform` renders equal tiles. */
  variant?: 'editorial' | 'uniform';
  /** Anchor id, so `siteSettings.primaryNav` can point an anchor link at this section. */
  id?: string;
  className?: string;
}

export function WorkGrid({
  projects,
  eyebrow = 'Selected work',
  heading,
  lead,
  viewAllHref,
  viewAllLabel = 'View all work',
  variant = 'editorial',
  id = 'work',
  className,
}: WorkGridProps) {
  const items = projects ?? [];

  /**
   * An empty grid renders nothing at all — not an empty-state card, not a heading with a void under
   * it. On a portfolio, a "no projects yet" message is worse than the section's absence, and this is
   * also what makes the homepage safe against a dataset where nothing has been marked featured.
   */
  if (items.length === 0) return null;

  return (
    <section
      id={id}
      className={cn('relative z-content py-section', className)}
      aria-labelledby={heading ? `${id}-heading` : undefined}
    >
      <div className="shell">
        {/* ================================================================
          * Header
          * ============================================================== */}
        {heading ? (
          <div className="mb-16 flex flex-col gap-8 md:mb-24 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              {eyebrow ? <p className="eyebrow mb-5">{eyebrow}</p> : null}
              <SplitTextReveal
                as="h2"
                mode="lines"
                // The id lands on the element SplitTextReveal renders, not on its split children,
                // so the `aria-labelledby` above resolves correctly and keeps doing so across
                // re-splits on resize.
                id={`${id}-heading`}
                className="max-w-[20ch] text-balance font-display text-display-md font-semibold leading-[0.95] tracking-[-0.03em] text-bone"
              >
                {heading}
              </SplitTextReveal>
              {lead ? (
                <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted">
                  {lead}
                </p>
              ) : null}
            </div>

            {/* Count, as a quiet editorial detail. `tabular-nums` so it does not jitter. */}
            <p className="shrink-0 font-mono text-label uppercase tabular-nums text-muted">
              {String(items.length).padStart(2, '0')} {items.length === 1 ? 'project' : 'projects'}
            </p>
          </div>
        ) : null}

        {/* ================================================================
          * Grid
          *
          * `Reveal` with `stagger` animates its DIRECT children, which is why the cards are mapped
          * straight into it with no intermediate wrapper — see the note in Reveal's header.
          * ============================================================== */}
        <Reveal
          stagger
          // Tighter than the default: a cascade across a two-column grid reads best when it is
          // barely perceptible per card, otherwise the last card arrives a full second late.
          staggerEach={0.07}
          distance={40}
          className="grid grid-cols-1 gap-x-8 gap-y-16 md:grid-cols-2 md:gap-y-24"
        >
          {items.map((project, index) => {
            const editorial = variant === 'editorial';
            // Every fourth card leads a block, full width.
            const isWide = editorial && index % 4 === 0;
            // Offset the right-hand column so the two never form a horizontal band.
            const isOffset = editorial && !isWide && index % 2 === 1;

            return (
              <div
                key={project._id}
                className={cn(
                  isWide && 'md:col-span-2',
                  // `md:` only — on a single-column phone layout an offset is just a gap.
                  isOffset && 'md:mt-24'
                )}
              >
                <ProjectCard
                  project={project}
                  index={index}
                  size={isWide ? 'wide' : 'default'}
                  /**
                   * Only the first card is a priority load. It is the one plausibly in or near the
                   * viewport on arrival; marking more than one defeats the purpose, because every
                   * `priority` image competes for the same early bandwidth as the LCP element.
                   */
                  priority={index === 0}
                  sizes={
                    isWide
                      ? '(min-width: 768px) 92vw, 100vw'
                      : '(min-width: 768px) 46vw, 100vw'
                  }
                />
              </div>
            );
          })}
        </Reveal>

        {/* ================================================================
          * View all
          * ============================================================== */}
        {viewAllHref ? (
          <Reveal className="mt-20 flex justify-center md:mt-28" distance={20}>
            <MagneticButton asChild variant="secondary" size="lg">
              <Link href={viewAllHref}>
                <span
                  data-magnetic-label
                  className="pointer-events-none inline-flex items-center gap-2"
                >
                  {viewAllLabel}
                  <ArrowUpRight className="h-4 w-4" />
                </span>
              </Link>
            </MagneticButton>
          </Reveal>
        ) : null}
      </div>
    </section>
  );
}
