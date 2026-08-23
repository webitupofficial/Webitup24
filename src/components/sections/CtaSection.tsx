import Link from 'next/link';
import { SplitTextReveal } from '@/components/interactive/SplitTextReveal';
import { ArrowUpRight, MagneticButton } from '@/components/interactive/MagneticButton';
import { Reveal } from '@/components/interactive/Reveal';

export interface CtaSectionProps {
  heading?: string;
  lead?: string;
  ctaText?: string;
  ctaHref?: string;
  email?: string | null;
}

export function CtaSection({
  heading = 'Have a vision?\nLet’s build something\nunforgettable.',
  lead = 'Currently taking on select projects for Q3 / Q4. Let’s talk architecture, motion, and visual dominance.',
  ctaText = 'Start a conversation',
  ctaHref = 'mailto:hello@webitup24.com',
  email = 'hello@webitup24.com',
}: CtaSectionProps) {
  return (
    <section className="relative z-content py-section border-t border-hairline/40 overflow-hidden bg-ink">
      {/* Background soft glow */}
      <div
        className="decorative absolute inset-0 -z-10 opacity-30"
        style={{
          background:
            'radial-gradient(50% 50% at 50% 50%, rgb(200 255 61 / 0.12) 0%, rgb(91 43 232 / 0.08) 45%, transparent 75%)',
        }}
      />

      <div className="shell text-center flex flex-col items-center">
        <p className="eyebrow mb-6">Initiate Collaboration</p>

        <SplitTextReveal
          as="h2"
          mode="lines"
          className="max-w-[18ch] text-balance font-display text-display-md md:text-display-lg font-semibold leading-[0.88] tracking-[-0.04em] text-bone"
        >
          {heading}
        </SplitTextReveal>

        <p className="mt-8 max-w-xl text-pretty text-lg leading-relaxed text-muted md:text-xl">
          {lead}
        </p>

        <Reveal distance={25} className="mt-12 flex flex-wrap items-center justify-center gap-6">
          <MagneticButton asChild variant="primary" size="lg" magnetic>
            <Link href={ctaHref}>
              <span data-magnetic-label className="pointer-events-none inline-flex items-center gap-2">
                {ctaText}
                <ArrowUpRight className="h-4 w-4" />
              </span>
            </Link>
          </MagneticButton>

          {email ? (
            <a
              href={`mailto:${email}`}
              className="inline-flex items-center gap-2 font-mono text-sm tracking-wider uppercase text-bone/70 hover:text-acid transition-colors duration-300 py-3 px-5 rounded-full border border-hairline hover:border-acid/40"
            >
              <span>{email}</span>
            </a>
          ) : null}
        </Reveal>
      </div>
    </section>
  );
}
