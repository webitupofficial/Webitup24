import { Reveal } from '@/components/interactive/Reveal';
import { SplitTextReveal } from '@/components/interactive/SplitTextReveal';
import { SanityImage } from '@/components/media/SanityImage';
import type { TestimonialGroup } from '@/types/content';

export interface TestimonialsSectionProps {
  testimonials?: TestimonialGroup[] | null;
  eyebrow?: string;
  heading?: string;
}

const DEFAULT_TESTIMONIALS = [
  {
    quote:
      'WebItUp24 turned our product experience into a cinematic journey. The WebGL performance on mobile blew our conversion targets out of the water.',
    author: 'Elena Rostova',
    role: 'VP of Product, Aura Spatial',
    clientName: 'Aura',
  },
  {
    quote:
      'The attention to kinetic rhythm and micro-detail is unmatched. It feels less like browsing a website and more like steering a precision-crafted instrument.',
    author: 'Marcus Vance',
    role: 'Co-Founder & CEO, Kinetic Labs',
    clientName: 'Kinetic',
  },
  {
    quote:
      'Our brand perception instantly elevated to a category leader overnight. Working with this team set a brand-new standard for our digital engineering.',
    author: 'Devon Takahashi',
    role: 'Creative Director, Hyperion AI',
    clientName: 'Hyperion',
  },
];

export function TestimonialsSection({
  testimonials,
  eyebrow = 'Voices',
  heading = 'What happens when engineering\nmeets uncompromising taste.',
}: TestimonialsSectionProps) {
  // Flatten testimonials from CMS or fallback
  const items =
    testimonials && testimonials.length > 0 && testimonials[0]?.items && (testimonials[0].items?.length ?? 0) > 0
      ? testimonials.flatMap((g) =>
          (g.items || []).map((t) => ({
            quote: t.quote || '',
            author: t.author || 'Anonymous',
            role: t.role || '',
            clientName: g.clientName || '',
            avatar: t.avatar as any,
          }))
        )
      : DEFAULT_TESTIMONIALS;

  return (
    <section className="relative z-content py-section border-t border-hairline/40">
      <div className="shell">
        <div className="mb-16 max-w-3xl md:mb-20">
          {eyebrow ? <p className="eyebrow mb-4">{eyebrow}</p> : null}
          <SplitTextReveal
            as="h2"
            mode="lines"
            className="text-balance font-display text-display-md font-semibold leading-[0.92] tracking-[-0.035em] text-bone"
          >
            {heading}
          </SplitTextReveal>
        </div>

        <Reveal
          stagger
          staggerEach={0.12}
          distance={30}
          className="grid grid-cols-1 gap-8 md:grid-cols-3"
        >
          {items.slice(0, 3).map((item: any, idx) => (
            <div
              key={idx}
              className="group relative flex flex-col justify-between rounded-2xl border border-hairline bg-surface/40 p-8 md:p-10 backdrop-blur-sm transition-all duration-500 hover:border-hairline/80 hover:bg-elevated/60"
            >
              <div className="relative">
                {/* Quote Mark */}
                <span className="block font-serif text-5xl leading-none text-acid/60 select-none mb-4">
                  “
                </span>
                <p className="text-lg leading-relaxed text-bone/90 font-sans">
                  {item.quote}
                </p>
              </div>

              <div className="mt-8 pt-6 border-t border-hairline/60 flex items-center gap-4">
                {item.avatar?.asset ? (
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-hairline">
                    <SanityImage
                      image={item.avatar}
                      alt={item.author}
                      fill
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-elevated border border-hairline font-mono text-sm font-semibold text-acid">
                    {(item.author || 'A').slice(0, 1)}
                  </div>
                )}

                <div>
                  <h4 className="font-display font-medium text-bone text-base">
                    {item.author}
                  </h4>
                  <p className="text-xs text-muted/80">
                    {item.role} {item.clientName ? `• ${item.clientName}` : ''}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
