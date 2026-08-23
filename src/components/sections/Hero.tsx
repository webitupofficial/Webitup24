import Link from 'next/link';

import { SplitTextReveal } from '@/components/interactive/SplitTextReveal';
import { ArrowUpRight, MagneticButton } from '@/components/interactive/MagneticButton';
import { linkAttrs, resolveLink, type LinkInput } from '@/lib/utils/links';

/**
 * =============================================================================
 * Hero — the first screen, and the site's whole first impression.
 * =============================================================================
 *
 * Deliberately transparent. The WebGL canvas is a `fixed` layer *behind* `<main>` (see
 * `SceneCanvas`), so the hero does not contain the 3D scene — it sits in front of it and lets it
 * show through. That inversion is the entire reason the scene can persist across navigations while
 * each page supplies its own foreground.
 *
 * -----------------------------------------------------------------------------
 * A SERVER COMPONENT WITH CLIENT ISLANDS
 * -----------------------------------------------------------------------------
 * The structure, copy and links are server-rendered — fully crawlable, and readable with a broken
 * bundle. The only client pieces are the two animation primitives it composes: `SplitTextReveal`
 * for the headline and `MagneticButton` for the CTA. Both take serialisable props, so the boundary
 * is clean.
 *
 * The headline uses `immediate` + `waitForIntro`: it is above the fold, so a scroll trigger would
 * fire instantly anyway, and gating it on the preloader's hand-off is what lets the reveal be
 * *sequenced* against the intro rather than racing it.
 *
 * -----------------------------------------------------------------------------
 * THE `webgl-ready` HAND-OFF
 * -----------------------------------------------------------------------------
 * A CSS gradient wash sits behind the copy and fades out via the `webgl-ready:` variant once the
 * shader is genuinely painting (`<html data-webgl="ready">`, written by `SceneCanvas`). So a
 * visitor on the poster fallback keeps a composed, legible backdrop, and a visitor with the live
 * scene sees it take over — with no JavaScript in this component deciding which.
 */

export interface HeroProps {
  /** Small mono label above the headline. */
  eyebrow?: string | null;
  /** The headline. Plain string — `\n` forces line breaks (see `SplitTextReveal`). Required. */
  title: string;
  /** Supporting sentence under the headline. */
  lead?: string | null;
  /** Primary action. */
  cta?: LinkInput | null;
  /** Secondary action, rendered as a quieter text link beside the CTA. */
  secondaryCta?: LinkInput | null;
  /** `siteSettings.availability` — the "open for work" pill. */
  availability?: { isAvailable?: boolean | null; label?: string | null } | null;
}

export function Hero({ eyebrow, title, lead, cta, secondaryCta, availability }: HeroProps) {
  const primary = cta ? resolveLink(cta) : null;
  const secondary = secondaryCta ? resolveLink(secondaryCta) : null;

  return (
    <section
      /**
       * `min-h-[100svh]`, not `100vh`. On mobile Safari `100vh` is the *largest* viewport (toolbar
       * retracted), so a `100vh` hero is always a little too tall on load and the CTA is pushed
       * under the browser chrome. `svh` is the small viewport — the hero fits on first paint.
       */
      className="relative flex min-h-[100svh] flex-col justify-center overflow-hidden"
      aria-label="Introduction"
    >
      {/**
       * The fallback wash. A soft radial in the scene palette, faded out once the live shader is up.
       * `decorative` marks it aria-hidden + pointer-events-none. It is behind the content
       * (`-z-10` within this section's stacking context) but in front of the fixed canvas.
       */}
      <div
        className="decorative absolute inset-0 -z-10 opacity-100 transition-opacity duration-1000 ease-out webgl-ready:opacity-0"
        style={{
          background:
            'radial-gradient(60% 55% at 50% 42%, rgb(91 43 232 / 0.20) 0%, rgb(91 43 232 / 0) 70%)',
        }}
      />

      <div className="shell w-full py-24 md:py-32">
        {/* Eyebrow + availability row */}
        <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}

          {availability?.isAvailable && availability.label ? (
            <p className="flex items-center gap-2 font-mono text-label uppercase text-bone">
              <span className="relative flex h-2 w-2">
                {/* Ping ring only under full motion; the solid dot is always there. */}
                <span className="absolute inline-flex h-full w-full rounded-full bg-acid opacity-60 motion-full:animate-pulse-ring" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-acid" />
              </span>
              {availability.label}
            </p>
          ) : null}
        </div>

        {/* The headline. `text-balance` keeps authored line lengths even. */}
        <SplitTextReveal
          as="h1"
          mode="lines"
          immediate
          waitForIntro
          className="max-w-[18ch] text-balance font-display text-display-lg font-semibold leading-[0.9] tracking-[-0.04em] text-bone"
        >
          {title}
        </SplitTextReveal>

        {lead ? (
          <p className="mt-8 max-w-xl text-pretty text-lg leading-relaxed text-muted md:text-xl">
            {lead}
          </p>
        ) : null}

        {/* Action row */}
        {primary && !primary.broken ? (
          <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-4">
            <MagneticButton asChild variant="primary" size="lg" magnetic={primary.magnetic}>
              <Link {...linkAttrs(primary)}>
                <span
                  data-magnetic-label
                  className="pointer-events-none inline-flex items-center gap-2"
                >
                  {primary.label}
                  <ArrowUpRight className="h-4 w-4" />
                </span>
              </Link>
            </MagneticButton>

            {secondary && !secondary.broken ? (
              <Link
                {...linkAttrs(secondary)}
                className="group inline-flex items-center gap-2 text-base text-bone/80 transition-colors duration-300 hover:text-acid"
              >
                {secondary.label}
                <span
                  aria-hidden="true"
                  className="inline-block transition-transform duration-300 ease-expo group-hover:translate-x-1"
                >
                  →
                </span>
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {/**
       * Scroll cue. Pinned to the bottom of the hero, gated to full motion — a reduced-motion
       * visitor gets a static line, not a bouncing one. `aria-hidden`: "scroll down" is not
       * information a screen-reader user needs announced.
       */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center"
        aria-hidden="true"
      >
        <span className="flex flex-col items-center gap-3 font-mono text-label uppercase tracking-[0.2em] text-muted/70">
          Scroll
          <span className="relative block h-10 w-px overflow-hidden bg-hairline">
            <span className="absolute inset-x-0 top-0 h-4 bg-acid motion-full:animate-scroll-cue" />
          </span>
        </span>
      </div>
    </section>
  );
}
