import type { Metadata } from 'next';
import { sanityFetch } from '@/sanity/lib/live';
import { homePageQuery, siteSettingsQuery } from '@/sanity/lib/queries';
import { buildMetadata } from '@/lib/utils/seo';

import { Hero } from '@/components/sections/Hero';
import { WorkGrid } from '@/components/sections/WorkGrid';
import { ServicesSection } from '@/components/sections/ServicesSection';
import { StatsSection } from '@/components/sections/StatsSection';
import { TestimonialsSection } from '@/components/sections/TestimonialsSection';
import { ClientsSection } from '@/components/sections/ClientsSection';
import { CtaSection } from '@/components/sections/CtaSection';

import type { HomePageData, ProjectCard } from '@/types/content';

export const revalidate = 60;

const FALLBACK_PROJECTS: ProjectCard[] = [
  {
    _id: 'project-aura',
    title: 'Aura Spatial Systems',
    slug: 'aura-spatial',
    tagline: 'Spatial computing interface & real-time WebGL product configurator.',
    year: 2025,
    featured: true,
    order: 1,
    technologies: ['Three.js', 'GLSL Shaders', 'Next.js 15', 'WebGPU'],
    client: { name: 'Aura Systems', industry: 'Spatial Hardware' },
    serviceNames: ['Real-Time 3D', 'Creative Engineering'],
    awardCount: 3,
  },
  {
    _id: 'project-hyperion',
    title: 'Hyperion Neural AI',
    slug: 'hyperion-ai',
    tagline: 'Telemetry intelligence platform with kinetic typography and dark UI.',
    year: 2025,
    featured: true,
    order: 2,
    technologies: ['Next.js', 'GSAP', 'Design Systems', 'Tailwind'],
    client: { name: 'Hyperion Labs', industry: 'Artificial Intelligence' },
    serviceNames: ['Design Systems', 'Creative Engineering'],
    awardCount: 2,
  },
  {
    _id: 'project-vektor',
    title: 'Vektor Soundscapes',
    slug: 'vektor-sound',
    tagline: 'Interactive spatial audio synthesizer and experiential web laboratory.',
    year: 2024,
    featured: true,
    order: 3,
    technologies: ['Web Audio API', 'Canvas 2D', 'Lenis', 'R3F'],
    client: { name: 'Vektor Audio', industry: 'Acoustic Hardware' },
    serviceNames: ['Interactive Experience', 'Real-Time 3D'],
    awardCount: 4,
  },
  {
    _id: 'project-monolith',
    title: 'Monolith Studio',
    slug: 'monolith-studio',
    tagline: 'Brutalist digital monograph with smooth-scrolling spatial layouts.',
    year: 2024,
    featured: true,
    order: 4,
    technologies: ['Lenis Scroll', 'React 19', 'Sanity CMS'],
    client: { name: 'Monolith Group', industry: 'Architecture' },
    serviceNames: ['Creative Development', 'Editorial Design'],
    awardCount: 1,
  },
];

export async function generateMetadata(): Promise<Metadata> {
  const { data: settings } = await sanityFetch({ query: siteSettingsQuery }).catch(() => ({
    data: null,
  }));

  return buildMetadata({
    title: `${settings?.siteName ?? 'WebItUp24'} — Digital Experiences Engineered to be Remembered`,
    description: settings?.tagline,
    settings,
  });
}

export default async function HomePage() {
  const [{ data: homeData }, { data: settings }] = (await Promise.all([
    sanityFetch({ query: homePageQuery }).catch(() => ({ data: null })),
    sanityFetch({ query: siteSettingsQuery }).catch(() => ({ data: null })),
  ])) as [{ data: HomePageData | null }, { data: any }];

  const projects =
    homeData?.featured && homeData.featured.length > 0
      ? homeData.featured
      : FALLBACK_PROJECTS;

  return (
    <>
      {/* Hero */}
      <Hero
        eyebrow={settings?.manifesto ?? 'Creative Digital Agency'}
        title="We build digital experiences engineered to be remembered."
        lead="Specializing in real-time 3D, fluid kinetic motion, and high-performance web engineering for pioneering brands."
        cta={
          settings?.ctaLink ?? {
            label: 'Explore Selected Work',
            kind: 'anchor',
            anchor: 'work',
            magnetic: true,
          }
        }
        secondaryCta={{
          label: 'Our Capabilities',
          kind: 'anchor',
          anchor: 'services',
        }}
        availability={
          settings?.availability ?? {
            isAvailable: true,
            label: 'Available for Q3/Q4 projects',
          }
        }
      />

      {/* Selected Work */}
      <WorkGrid
        id="work"
        projects={projects}
        eyebrow="Selected Work"
        heading="Bespoke craft,\nuncompromising speed."
        lead="A curated collection of spatial web applications, custom 3D configurators, and brand flagships."
        viewAllHref="/work"
        viewAllLabel="View all projects"
        variant="editorial"
      />

      {/* Services Section */}
      <ServicesSection
        id="services"
        services={homeData?.services}
        eyebrow="Capabilities & Craft"
        heading="Engineering that bends\nreality to your brand."
        lead="We bridge the divide between high-end digital aesthetics and rock-solid software architecture."
      />

      {/* Stats Counter */}
      <StatsSection stats={homeData?.stats} />

      {/* Testimonials */}
      <TestimonialsSection testimonials={homeData?.testimonials} />

      {/* Clients Marquee */}
      <ClientsSection clients={homeData?.clients} />

      {/* Bold CTA Section */}
      <CtaSection
        email={settings?.email ?? 'hello@webitup24.com'}
        ctaHref={settings?.email ? `mailto:${settings.email}` : 'mailto:hello@webitup24.com'}
      />
    </>
  );
}
