import Link from 'next/link';
import { Reveal } from '@/components/interactive/Reveal';
import { SplitTextReveal } from '@/components/interactive/SplitTextReveal';
import { ArrowUpRight } from '@/components/interactive/MagneticButton';
import type { HomeService } from '@/types/content';

export interface ServicesSectionProps {
  services?: HomeService[] | null;
  eyebrow?: string;
  heading?: string;
  lead?: string;
  id?: string;
}

const DEFAULT_SERVICES: HomeService[] = [
  {
    _id: 'srv-1',
    title: 'Real-Time 3D & WebGL',
    slug: '3d-webgl',
    shortDescription:
      'Immersive digital landscapes, custom GLSL shaders, spatial product showcases, and interactive 3D experiences engineered for 60fps performance across every device tier.',
    order: 1,
    accentColor: '#CCFF00',
    deliverables: [
      { _key: 'd1', title: 'Custom GLSL Shaders' },
      { _key: 'd2', title: 'React Three Fiber & Drei' },
      { _key: 'd3', title: '3D Product Configurator' },
      { _key: 'd4', title: 'Hardware Tier Adaptation' },
    ],
  },
  {
    _id: 'srv-2',
    title: 'Creative Engineering',
    slug: 'creative-engineering',
    shortDescription:
      'High-performance Next.js architectures, fluid micro-interactions, custom cursor physics, and reactive state management that turn websites into tactile digital art.',
    order: 2,
    accentColor: '#7952FF',
    deliverables: [
      { _key: 'd5', title: 'Next.js App Router Architecture' },
      { _key: 'd6', title: 'GSAP & Lenis Smooth Motion' },
      { _key: 'd7', title: 'Headless Sanity CMS Integration' },
      { _key: 'd8', title: 'Micro-Animations & Physics' },
    ],
  },
  {
    _id: 'srv-3',
    title: 'Design Systems & Brand Identity',
    slug: 'design-systems',
    shortDescription:
      'Scalable, bespoke design tokens, kinetic typography systems, and modular component libraries that command authority and preserve brand precision at scale.',
    order: 3,
    accentColor: '#FF6B00',
    deliverables: [
      { _key: 'd9', title: 'Kinetic Typography & Motion Rules' },
      { _key: 'd10', title: 'Cross-Platform Design Tokens' },
      { _key: 'd11', title: 'Modular UI Primitives' },
      { _key: 'd12', title: 'Interactive Prototypes' },
    ],
  },
  {
    _id: 'srv-4',
    title: 'Speed & Conversion Optimization',
    slug: 'performance',
    shortDescription:
      'Sub-second first paint budgets, zero layout shift architectures, aggressive asset streaming, and bespoke technical SEO designed for organic discovery and maximum conversion.',
    order: 4,
    accentColor: '#00F0FF',
    deliverables: [
      { _key: 'd13', title: 'Core Web Vitals Perfection' },
      { _key: 'd14', title: 'Draco GLTF Compression' },
      { _key: 'd15', title: 'Edge JSON-LD Structured Data' },
      { _key: 'd16', title: 'Zero-CLS Image Streaming' },
    ],
  },
];

export function ServicesSection({
  services,
  eyebrow = 'Capabilities & Craft',
  heading = 'Engineering that bends\nreality to your brand.',
  lead = 'We bridge the divide between high-end digital aesthetics and rock-solid software architecture.',
  id = 'services',
}: ServicesSectionProps) {
  const items = services && services.length > 0 ? services : DEFAULT_SERVICES;

  return (
    <section
      id={id}
      className="relative z-content py-section border-t border-hairline/40 bg-ink/40 backdrop-blur-[2px]"
      aria-labelledby={`${id}-heading`}
    >
      <div className="shell">
        {/* Header */}
        <div className="mb-16 max-w-3xl md:mb-24">
          {eyebrow ? <p className="eyebrow mb-5">{eyebrow}</p> : null}
          <SplitTextReveal
            as="h2"
            mode="lines"
            id={`${id}-heading`}
            className="max-w-[20ch] text-balance font-display text-display-md font-semibold leading-[0.92] tracking-[-0.035em] text-bone"
          >
            {heading}
          </SplitTextReveal>
          {lead ? (
            <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted">{lead}</p>
          ) : null}
        </div>

        {/* Services List */}
        <Reveal stagger staggerEach={0.08} distance={30} className="divide-y divide-hairline">
          {items.map((service, index) => {
            const num = String(index + 1).padStart(2, '0');
            return (
              <div
                key={service._id}
                className="group relative py-12 md:py-16 transition-colors duration-500 hover:bg-surface/30 px-4 -mx-4 rounded-xl"
              >
                <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
                  {/* Service Number & Title */}
                  <div className="lg:col-span-5 flex items-baseline gap-6">
                    <span className="font-mono text-xs text-acid tabular-nums font-semibold tracking-wider">
                      /{num}
                    </span>
                    <h3 className="font-display text-2xl md:text-3xl font-medium tracking-tight text-bone group-hover:text-bone transition-colors duration-300">
                      {service.title}
                    </h3>
                  </div>

                  {/* Description */}
                  <div className="lg:col-span-4">
                    <p className="text-base leading-relaxed text-muted/90 group-hover:text-bone/80 transition-colors duration-300">
                      {service.shortDescription}
                    </p>
                  </div>

                  {/* Deliverables Tags & Action */}
                  <div className="lg:col-span-3 flex flex-col gap-4 lg:items-end justify-between">
                    {service.deliverables && service.deliverables.length > 0 ? (
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        {service.deliverables.slice(0, 3).map((d) => (
                          <span
                            key={d._key}
                            className="rounded-full bg-elevated/70 border border-hairline/60 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-bone/70 group-hover:border-acid/40 group-hover:text-bone transition-colors duration-300"
                          >
                            {d.title}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {service.slug ? (
                      <Link
                        href={`/services/${service.slug}`}
                        className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-widest text-muted group-hover:text-acid transition-colors duration-300 mt-2"
                      >
                        <span>Explore details</span>
                        <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}
