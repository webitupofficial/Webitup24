import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sanityFetch } from '@/sanity/lib/live';
import { serviceBySlugQuery, serviceSlugsQuery, siteSettingsQuery } from '@/sanity/lib/queries';
import { buildMetadata, serviceJsonLd, jsonLdScript } from '@/lib/utils/seo';
import { SplitTextReveal } from '@/components/interactive/SplitTextReveal';
import { Reveal } from '@/components/interactive/Reveal';
import { WorkGrid } from '@/components/sections/WorkGrid';
import { CtaSection } from '@/components/sections/CtaSection';

export const revalidate = 60;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const { data: slugs } = (await sanityFetch({
    query: serviceSlugsQuery,
  }).catch(() => ({ data: [] }))) as { data: { slug: string }[] | null };

  return (slugs || []).map((s: { slug: string }) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const [{ data: service }, { data: settings }] = (await Promise.all([
    sanityFetch({ query: serviceBySlugQuery, params: { slug } }).catch(() => ({ data: null })),
    sanityFetch({ query: siteSettingsQuery }).catch(() => ({ data: null })),
  ])) as [{ data: any }, { data: any }];

  const title = service?.title ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());

  return buildMetadata({
    title: `${title} — Service & Capabilities`,
    description: service?.shortDescription ?? `Explore ${title} services by WebItUp24.`,
    path: `/services/${slug}`,
    settings,
  });
}

export default async function ServiceDetailPage({ params }: PageProps) {
  const { slug } = await params;

  const { data: service } = (await sanityFetch({
    query: serviceBySlugQuery,
    params: { slug },
  }).catch(() => ({ data: null }))) as { data: any };

  const title =
    service?.title ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  const description =
    service?.shortDescription ??
    'We engineer world-class digital experiences with customized GLSL shaders, 60fps WebGL rendering, and responsive spatial interactivity.';

  const deliverables = service?.deliverables ?? [
    { _key: '1', title: 'Architecture & Technical Discovery', description: 'Deep technical audits, performance budgeting, and framework planning.' },
    { _key: '2', title: 'Interactive Prototype', description: 'Clickable and testable shader prototypes with physics simulation.' },
    { _key: '3', title: 'Full Production Build', description: 'Next.js 15 App Router integration with headless CMS and automated deployments.' },
    { _key: '4', title: 'Optimization & SEO Audit', description: 'Core Web Vitals tuning, JSON-LD structured data, and cross-browser testing.' },
  ];

  const jsonLd = serviceJsonLd({
    title,
    path: `/services/${slug}`,
    description,
  });

  return (
    <div className="pt-28 md:pt-36">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />

      <div className="shell">
        <div className="flex items-center gap-3 text-xs font-mono text-acid tracking-wider uppercase mb-6">
          <Link href="/services" className="hover:underline text-muted">
            ← All Services
          </Link>
          <span>/</span>
          <span>Capability</span>
        </div>

        <SplitTextReveal
          as="h1"
          mode="lines"
          className="max-w-[18ch] text-balance font-display text-display-md md:text-display-lg font-semibold leading-[0.9] tracking-[-0.04em] text-bone"
        >
          {title}
        </SplitTextReveal>

        <p className="mt-8 max-w-2xl text-xl leading-relaxed text-muted/90">
          {description}
        </p>

        {service?.startingPrice ? (
          <div className="mt-8 inline-flex items-center gap-3 rounded-full border border-hairline bg-surface/60 px-5 py-2">
            <span className="font-mono text-xs uppercase tracking-wider text-muted">Starting Engagement:</span>
            <span className="font-mono text-sm font-semibold text-acid">{service.startingPrice}</span>
          </div>
        ) : null}

        {/* Deliverables Grid */}
        <div className="mt-20 md:mt-28">
          <p className="eyebrow mb-6">What We Deliver</p>
          <Reveal stagger staggerEach={0.1} distance={25} className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {deliverables.map((item: any, i: number) => (
              <div
                key={item._key || i}
                className="rounded-2xl border border-hairline bg-surface/40 p-8 transition-colors hover:border-acid/40 hover:bg-elevated/50"
              >
                <span className="font-mono text-xs text-acid tabular-nums">0{i + 1}</span>
                <h3 className="mt-4 font-display text-xl font-medium text-bone">{item.title}</h3>
                {item.description ? (
                  <p className="mt-3 text-sm leading-relaxed text-muted">{item.description}</p>
                ) : null}
              </div>
            ))}
          </Reveal>
        </div>
      </div>

      {/* Associated Case Studies */}
      {service?.work && service.work.length > 0 ? (
        <div className="mt-24">
          <WorkGrid
            projects={service.work}
            eyebrow="Associated Work"
            heading={`Featured ${title}\ncase studies`}
            variant="uniform"
          />
        </div>
      ) : null}

      <div className="mt-16">
        <CtaSection />
      </div>
    </div>
  );
}
