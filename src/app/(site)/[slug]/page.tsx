import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { sanityFetch } from '@/sanity/lib/live';
import { pageBySlugQuery, pageSlugsQuery, siteSettingsQuery } from '@/sanity/lib/queries';
import { buildMetadata } from '@/lib/utils/seo';
import { SplitTextReveal } from '@/components/interactive/SplitTextReveal';
import { Reveal } from '@/components/interactive/Reveal';
import { CtaSection } from '@/components/sections/CtaSection';

export const revalidate = 60;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const { data: slugs } = (await sanityFetch({
    query: pageSlugsQuery,
  }).catch(() => ({ data: [] }))) as { data: { slug: string }[] | null };

  return (slugs || []).map((s: { slug: string }) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const [{ data: page }, { data: settings }] = (await Promise.all([
    sanityFetch({ query: pageBySlugQuery, params: { slug } }).catch(() => ({ data: null })),
    sanityFetch({ query: siteSettingsQuery }).catch(() => ({ data: null })),
  ])) as [{ data: any }, { data: any }];

  const title = page?.title ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());

  return buildMetadata({
    title: page?.heading ?? `${title} — WebItUp24`,
    description: page?.lead ?? `Learn more about ${title} at WebItUp24.`,
    seo: page?.seo,
    path: `/${slug}`,
    settings,
  });
}

export default async function GenericPage({ params }: PageProps) {
  const { slug } = await params;

  const { data: page } = (await sanityFetch({
    query: pageBySlugQuery,
    params: { slug },
  }).catch(() => ({ data: null }))) as { data: any };

  const title =
    page?.title ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  const heading = page?.heading ?? title;
  const lead =
    page?.lead ??
    'We partner with ambitious teams to architect, design, and engineer world-class digital flagship experiences.';

  return (
    <div className="pt-28 md:pt-36">
      <div className="shell max-w-4xl">
        <p className="eyebrow mb-5">{title}</p>
        <SplitTextReveal
          as="h1"
          mode="lines"
          className="text-balance font-display text-display-md md:text-display-lg font-semibold leading-[0.9] tracking-[-0.04em] text-bone"
        >
          {heading}
        </SplitTextReveal>
        <p className="mt-8 text-xl leading-relaxed text-muted/90">{lead}</p>

        {/* Content Body */}
        <Reveal distance={25} className="mt-16 prose prose-invert max-w-none text-muted/80">
          <div className="rounded-2xl border border-hairline bg-surface/30 p-8 md:p-12 space-y-6">
            <h2 className="font-display text-2xl font-medium text-bone">Philosophy & Vision</h2>
            <p className="text-base leading-relaxed">
              At WebItUp24, we believe that software should be memorable. In a world saturated with generic templates, we create distinct, physics-driven digital instruments that leave a lasting emotional impression.
            </p>
            <p className="text-base leading-relaxed">
              Every detail — from our GPU-accelerated vertex shaders to our typographic rhythm and sub-millisecond cursor physics — is tuned to elevate the prestige of your brand.
            </p>
          </div>
        </Reveal>
      </div>

      <div className="mt-20">
        <CtaSection />
      </div>
    </div>
  );
}
