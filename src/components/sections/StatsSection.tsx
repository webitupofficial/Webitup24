import { Reveal } from '@/components/interactive/Reveal';
import { SplitTextReveal } from '@/components/interactive/SplitTextReveal';
import type { HomeStats } from '@/types/content';

export interface StatsSectionProps {
  stats?: HomeStats | null;
  eyebrow?: string;
  heading?: string;
}

export function StatsSection({
  stats,
  eyebrow = 'Track Record',
  heading = 'Numbers that speak in precision.',
}: StatsSectionProps) {
  const projectCount = stats?.projectCount ?? 42;
  const clientCount = stats?.clientCount ?? 28;
  const awardCount = stats?.awardCount ?? 16;
  const earliestYear = stats?.earliestYear ?? 2021;
  const yearsActive = new Date().getFullYear() - earliestYear + 1;

  const statCards = [
    {
      value: `${projectCount}+`,
      label: 'Digital Experiences Shipped',
      detail: 'Across WebGL, bespoke Next.js web applications, and immersive 3D eCommerce.',
    },
    {
      value: '60fps',
      label: 'Adaptive Frame Performance',
      detail: 'Optimized GLSL shaders and frame-budgeted particle pipelines on mobile and desktop.',
    },
    {
      value: `${awardCount}`,
      label: 'Design Accolades & Honours',
      detail: 'Recognized by Awwwards, FWA of the Day, CSS Design Awards, and Site of the Day.',
    },
    {
      value: `${yearsActive} yrs`,
      label: 'Mastery of Digital Craft',
      detail: 'Partnering globally with high-growth technology leaders and boundary-pushing brands.',
    },
  ];

  return (
    <section className="relative z-content py-section border-t border-hairline/40 bg-surface/20">
      <div className="shell">
        <div className="mb-16 max-w-2xl md:mb-20">
          {eyebrow ? <p className="eyebrow mb-4">{eyebrow}</p> : null}
          <SplitTextReveal
            as="h2"
            mode="lines"
            className="text-balance font-display text-display-sm font-semibold tracking-[-0.03em] text-bone"
          >
            {heading}
          </SplitTextReveal>
        </div>

        <Reveal
          stagger
          staggerEach={0.1}
          distance={25}
          className="grid grid-cols-1 gap-px bg-hairline/60 sm:grid-cols-2 lg:grid-cols-4 rounded-2xl overflow-hidden border border-hairline"
        >
          {statCards.map((stat, i) => (
            <div
              key={i}
              className="group relative bg-ink/90 p-8 sm:p-10 transition-colors duration-500 hover:bg-elevated/80 flex flex-col justify-between"
            >
              <div>
                <p className="font-mono text-4xl sm:text-5xl font-semibold tracking-tight text-bone group-hover:text-acid transition-colors duration-300">
                  {stat.value}
                </p>
                <h3 className="mt-4 font-display text-lg font-medium text-bone/90">
                  {stat.label}
                </h3>
              </div>
              <p className="mt-6 text-sm leading-relaxed text-muted/80">
                {stat.detail}
              </p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
