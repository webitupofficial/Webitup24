import Link from 'next/link';

import { ArrowUpRight, MagneticButton } from '@/components/interactive/MagneticButton';
import { SplitTextReveal } from '@/components/interactive/SplitTextReveal';
import { Wordmark } from './Wordmark';
import type { HeaderNavItem, SocialLink } from './Header';
import { cn } from '@/lib/utils/cn';
import { linkAttrs, resolveLink, type LinkInput } from '@/lib/utils/links';

/**
 * =============================================================================
 * Footer — the site's closing statement and contact surface.
 * =============================================================================
 *
 * A SERVER COMPONENT, and that is the whole point of the file. It has no state, no effects and no
 * handlers of its own, so it ships as zero client JavaScript — the marquee is a CSS animation, the
 * anchor jumps ride `scroll-padding-top` (set on `html` in globals.css, so a native `#section`
 * navigation lands *below* the fixed header without any JS), and the only interactive islands are
 * the two client components it renders as children: `SplitTextReveal` for the closing headline and
 * `MagneticButton` for the CTA.
 *
 * Rendering those client components from a server component is the ordinary RSC composition: the
 * server emits their markup, React hydrates just those subtrees, and everything around them stays
 * static HTML. It works precisely because every prop crossing the boundary here is serialisable —
 * strings, booleans, and child elements whose props are themselves strings. No function is ever
 * handed down, which is the one thing that boundary forbids.
 *
 * -----------------------------------------------------------------------------
 * WHY THE FOOTER TAKES FLAT PROPS, NOT THE settings OBJECT
 * -----------------------------------------------------------------------------
 * The layout destructures `siteSettings` and hands this component the eight or so fields it uses,
 * exactly as it does for the header. That keeps the footer decoupled from the GROQ projection's
 * shape: a field rename in the query surfaces as a type error at the *one* call site in the layout,
 * not buried inside a component that reached into `settings.socials[0].handle`.
 */

export interface FooterProps {
  siteName?: string;
  logoUrl?: string | null;
  /** Short site descriptor, set under the wordmark. */
  tagline?: string | null;
  /**
   * The oversized closing line. NOT currently a CMS field — there is no natural one, and inventing
   * `footerHeadline` for a single string that changes once a year is not worth a schema migration.
   * A prop with a strong default keeps it overridable the moment such a field is added.
   */
  ctaHeadline?: string;
  /** `siteSettings.ctaLink`. The primary action; falls back to a mailto on `email` if absent. */
  cta?: LinkInput | null;
  /** `siteSettings.marqueeWords`. The scrolling band; hidden entirely if empty. */
  marqueeWords?: string[] | null;
  /** `siteSettings.footerNav`. Same nav-item shape as the header, minus magnetism. */
  footerNav?: HeaderNavItem[] | null;
  socials?: SocialLink[] | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  location?: string | null;
  /** `siteSettings.footerNote`. A line of small print beside the copyright — legal name, credit. */
  footerNote?: string | null;
}

const DEFAULT_HEADLINE = 'Let’s build\nsomething\nworth remembering.';

export function Footer({
  siteName = 'WebItUp24',
  logoUrl,
  tagline,
  ctaHeadline = DEFAULT_HEADLINE,
  cta,
  marqueeWords,
  footerNav,
  socials,
  email,
  phone,
  whatsapp,
  location,
  footerNote,
}: FooterProps) {
  /**
   * Resolve the CTA to a real destination. If the editor left `ctaLink` empty but an email exists,
   * the button becomes a mailto rather than vanishing — the footer's entire job is to be reachable,
   * so the action degrades to the most direct form of contact rather than to nothing.
   */
  const resolvedCta = cta ? resolveLink(cta) : null;
  const ctaUsable = resolvedCta && !resolvedCta.broken;
  const ctaHref = ctaUsable ? resolvedCta.href : email ? `mailto:${email}` : null;
  const ctaLabel = ctaUsable ? resolvedCta.label : 'Start a project';

  const navItems = (footerNav ?? []).map((item, index) => ({
    key: item._key ?? `footer-nav-${index}`,
    resolved: resolveLink(item),
  }));

  /**
   * Build-time year on a static/ISR page. It is the copyright's own reason to exist, and being
   * frozen at build is correct — the alternative is opting the whole route into dynamic rendering
   * for a number that is stale for at most a few weeks each January.
   */
  const year = new Date().getFullYear();

  const contactRows = [
    email ? { label: 'Email', value: email, href: `mailto:${email}` } : null,
    phone ? { label: 'Phone', value: phone, href: `tel:${phone.replace(/[^+\d]/g, '')}` } : null,
    whatsapp
      ? {
          label: 'WhatsApp',
          value: whatsapp,
          // `wa.me` wants the number with no `+`, spaces or punctuation.
          href: `https://wa.me/${whatsapp.replace(/[^\d]/g, '')}`,
          external: true,
        }
      : null,
  ].filter(Boolean) as { label: string; value: string; href: string; external?: boolean }[];

  return (
    <footer
      /**
       * `bg-ink` — a shade deeper than the page's `bg-surface`, so the footer reads as the floor the
       * content sits on. `relative` + `z-content` lifts it above the fixed WebGL canvas, which is
       * otherwise the topmost thing at the bottom of a short page and would show through.
       */
      className="relative z-content mt-px bg-ink text-bone"
    >
      {/* ====================================================================
        * Marquee band
        *
        * Full-bleed, clipped, and — crucially — `aria-hidden`. It is decoration built from words
        * the editor already stated elsewhere; announcing a scrolling loop of them to a screen
        * reader is noise. It is also skipped entirely when there are no words, rather than
        * rendering an empty animated strip.
        * ================================================================== */}
      {marqueeWords && marqueeWords.length > 0 ? (
        <div
          className="overflow-hidden border-y border-hairline py-6 md:py-8"
          aria-hidden="true"
        >
          <div
            className={cn(
              // `w-max` so the track is as wide as its content rather than the viewport, which is
              // what lets a -50% translate equal exactly one copy of the sequence.
              'flex w-max items-center gap-8 md:gap-14',
              // The keyframe (see tailwind.config) runs 0 → -50%; globals.css freezes it under
              // `prefers-reduced-motion`, so this needs no JS guard. Pause on hover is a small
              // affordance for anyone trying to actually read a word as it passes.
              'animate-marquee-x hover:[animation-play-state:paused]'
            )}
          >
            {/**
             * The sequence, rendered TWICE. The animation translates the track by half its width,
             * so the second copy occupies exactly the space the first vacates and the loop has no
             * seam. Two static copies + one transform is the cheapest seamless marquee there is —
             * no measurement, no clones created in JS, no resize handler.
             */}
            {[0, 1].map((copy) => (
              <div key={copy} className="flex items-center gap-8 md:gap-14">
                {marqueeWords.map((word, index) => (
                  <span
                    key={`${copy}-${index}`}
                    className="flex items-center gap-8 font-display text-4xl font-medium tracking-tight text-bone/80 md:gap-14 md:text-6xl"
                  >
                    {word}
                    {/* A dot between words, part of the same span so it travels with it. */}
                    <span className="text-acid" aria-hidden="true">
                      ✦
                    </span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="shell py-20 md:py-28">
        {/* ==================================================================
          * CTA band — the closing headline and the primary action.
          * ================================================================ */}
        <div className="flex flex-col gap-10 border-b border-hairline pb-16 md:flex-row md:items-end md:justify-between md:gap-16">
          <SplitTextReveal
            as="h2"
            mode="words"
            staggerFrom="start"
            /**
             * `text-balance` keeps the three authored lines from breaking into ragged widths on
             * intermediate viewports. The `\n`s in the default headline are honoured as hard breaks
             * by SplitTextReveal (see its note), so the shape is authored, not accidental.
             */
            className="max-w-[16ch] text-balance font-display text-display-md font-semibold leading-[0.95] tracking-[-0.03em] text-bone"
          >
            {ctaHeadline}
          </SplitTextReveal>

          {ctaHref ? (
            <div className="shrink-0">
              <MagneticButton
                asChild
                variant="primary"
                size="lg"
                // The CMS `magnetic` flag when the CTA came from Sanity; on by default for the
                // synthesised mailto fallback, since that button is the footer's focal point.
                magnetic={ctaUsable ? resolvedCta.magnetic : true}
              >
                <Link {...(ctaUsable ? linkAttrs(resolvedCta) : { href: ctaHref })}>
                  <span
                    data-magnetic-label
                    className="pointer-events-none inline-flex items-center gap-2"
                  >
                    {ctaLabel}
                    <ArrowUpRight className="h-4 w-4" />
                  </span>
                </Link>
              </MagneticButton>
            </div>
          ) : null}
        </div>

        {/* ==================================================================
          * Link + contact grid
          * ================================================================ */}
        <div className="grid grid-cols-1 gap-12 py-16 md:grid-cols-12 md:gap-8">
          {/* Brand column */}
          <div className="flex flex-col gap-5 md:col-span-5">
            <Wordmark logoUrl={logoUrl} siteName={siteName} size="lg" />
            {tagline ? (
              <p className="max-w-sm text-pretty text-lg leading-relaxed text-muted">{tagline}</p>
            ) : null}
            {location ? (
              <p className="eyebrow mt-2 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-muted" aria-hidden="true" />
                {location}
              </p>
            ) : null}
          </div>

          {/* Sitemap column */}
          {navItems.length > 0 ? (
            <nav className="md:col-span-3 md:col-start-7" aria-label="Footer">
              <h3 className="eyebrow mb-5">Sitemap</h3>
              <ul className="flex flex-col gap-3">
                {navItems.map(({ key, resolved }) =>
                  resolved.broken ? null : (
                    <li key={key}>
                      <Link
                        {...linkAttrs(resolved)}
                        className="group inline-flex items-center gap-1.5 text-lg text-bone/80 transition-colors duration-300 hover:text-acid"
                      >
                        {resolved.label}
                        {resolved.external ? (
                          <ArrowUpRight
                            className="h-3 w-3 -translate-y-px opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                            aria-hidden="true"
                          />
                        ) : null}
                      </Link>
                    </li>
                  )
                )}
              </ul>
            </nav>
          ) : null}

          {/* Contact column */}
          <div className="md:col-span-3">
            <h3 className="eyebrow mb-5">Contact</h3>
            <ul className="flex flex-col gap-4">
              {contactRows.map((row) => (
                <li key={row.label} className="flex flex-col gap-0.5">
                  <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted/70">
                    {row.label}
                  </span>
                  <a
                    href={row.href}
                    {...(row.external
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : {})}
                    className="text-lg text-bone/80 transition-colors duration-300 hover:text-acid"
                  >
                    {row.value}
                  </a>
                </li>
              ))}

              {socials && socials.length > 0 ? (
                <li className="mt-2 flex flex-col gap-0.5">
                  <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted/70">
                    Social
                  </span>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1">
                    {socials.map((social, index) =>
                      social?.url ? (
                        <li key={social._key ?? `footer-social-${index}`}>
                          <a
                            href={social.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-lg text-bone/80 transition-colors duration-300 hover:text-acid"
                          >
                            {social.platform ?? social.handle ?? social.url}
                          </a>
                        </li>
                      ) : null
                    )}
                  </ul>
                </li>
              ) : null}
            </ul>
          </div>
        </div>

        {/* ==================================================================
          * Bottom bar
          * ================================================================ */}
        <div className="flex flex-col gap-4 border-t border-hairline pt-8 text-sm text-muted md:flex-row md:items-center md:justify-between">
          <p>
            © {year} {siteName}
            {footerNote ? <span className="text-muted/60"> — {footerNote}</span> : null}
          </p>

          {/**
           * The back-to-top control. A plain anchor to the skip target, so it works with JS off and
           * — because `html` carries `scroll-padding-top` — lands cleanly. `motion-full` gates only
           * the hover nudge, not the link itself.
           */}
          <a
            href="#main"
            className="group inline-flex items-center gap-2 font-mono text-label uppercase tracking-wider text-muted transition-colors duration-300 hover:text-bone"
          >
            Back to top
            <span
              className="inline-block transition-transform duration-300 ease-expo group-hover:-translate-y-0.5"
              aria-hidden="true"
            >
              ↑
            </span>
          </a>
        </div>
      </div>
    </footer>
  );
}
