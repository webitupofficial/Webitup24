import type { Metadata } from 'next';
import { sanityFetch } from '@/sanity/lib/live';
import { allServicesQuery, siteSettingsQuery } from '@/sanity/lib/queries';
import { buildMetadata } from '@/lib/utils/seo';
import { ServicesSection } from '@/components/sections/ServicesSection';
import { SplitTextReveal } from '@/components/interactive/SplitTextReveal';
import { CtaSection } from '@/components/sections/CtaSection';
import type { HomeService } from '@/types/content';

export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const { data: settings } = await sanityFetch({ query: siteSettingsQuery }).catch(() => ({
    data: null,
  }));

  return buildMetadata({
    title: 'Capabilities & Services — WebItUp24',
    description: 'Bespoke real-time 3D, WebGL shader engineering, kinetic design systems, and creative development.',
    path: '/services',
    settings,
  });
}

export default async function ServicesPage() {
  const { data: services } = (await sanityFetch({
    query: allServicesQuery,
  }).catch(() => ({ data: null }))) as { data: HomeService[] | null };

  return (
    <div className="pt-28 md:pt-36">
      <div className="shell mb-12">
        <p className="eyebrow mb-5">Our Expertise</p>
        <SplitTextReveal
          as="h1"
          mode="lines"
          className="max-w-[16ch] text-balance font-display text-display-md md:text-display-lg font-semibold leading-[0.9] tracking-[-0.04em] text-bone"
        >
          Capabilities crafted for digital distinction.
        </SplitTextReveal>
        <p className="mt-8 max-w-xl text-lg text-muted">
          From concept and spatial art direction to bulletproof production engineering, we deliver experiences that command attention.
        </p>
      </div>

      <ServicesSection services={services} />

      <CtaSection />
    </div>
  );
}
