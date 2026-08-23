import type { Metadata } from 'next';
import { sanityFetch } from '@/sanity/lib/live';
import { allProjectsQuery, siteSettingsQuery } from '@/sanity/lib/queries';
import { buildMetadata } from '@/lib/utils/seo';
import { WorkGrid } from '@/components/sections/WorkGrid';
import { SplitTextReveal } from '@/components/interactive/SplitTextReveal';
import type { ProjectCard } from '@/types/content';

export const revalidate = 60;

const FALLBACK_PROJECTS: ProjectCard[] = [
  {
    _id: 'p-1',
    title: 'Aura Spatial Systems',
    slug: 'aura-spatial',
    tagline: 'Next-gen spatial computing interface & real-time WebGL product configurator.',
    year: 2025,
    technologies: ['Three.js', 'GLSL', 'Next.js 15', 'WebGPU'],
    client: { name: 'Aura Systems', industry: 'Spatial Hardware' },
    serviceNames: ['Real-Time 3D', 'Creative Engineering'],
    awardCount: 3,
  },
  {
    _id: 'p-2',
    title: 'Hyperion Neural AI',
    slug: 'hyperion-ai',
    tagline: 'Telemetry intelligence platform with kinetic typography and dark UI.',
    year: 2025,
    technologies: ['Next.js', 'GSAP', 'Design Systems', 'Tailwind'],
    client: { name: 'Hyperion Labs', industry: 'Artificial Intelligence' },
    serviceNames: ['Design Systems', 'Creative Engineering'],
    awardCount: 2,
  },
  {
    _id: 'p-3',
    title: 'Vektor Soundscapes',
    slug: 'vektor-sound',
    tagline: 'Interactive spatial audio synthesizer and experiential web laboratory.',
    year: 2024,
    technologies: ['Web Audio API', 'Canvas 2D', 'Lenis', 'R3F'],
    client: { name: 'Vektor Audio', industry: 'Acoustic Hardware' },
    serviceNames: ['Interactive Experience', 'Real-Time 3D'],
    awardCount: 4,
  },
  {
    _id: 'p-4',
    title: 'Monolith Studio',
    slug: 'monolith-studio',
    tagline: 'Brutalist digital monograph with smooth-scrolling spatial layouts.',
    year: 2024,
    technologies: ['Lenis Scroll', 'React 19', 'Sanity CMS'],
    client: { name: 'Monolith Group', industry: 'Architecture' },
    serviceNames: ['Creative Development', 'Editorial Design'],
    awardCount: 1,
  },
  {
    _id: 'p-5',
    title: 'Synapse Protocol',
    slug: 'synapse-protocol',
    tagline: 'Decentralized liquidity engine visualized with real-time particle graphs.',
    year: 2024,
    technologies: ['GLSL Shaders', 'Three.js', 'TypeScript'],
    client: { name: 'Synapse', industry: 'Fintech' },
    serviceNames: ['Real-Time 3D', 'Creative Engineering'],
    awardCount: 2,
  },
  {
    _id: 'p-6',
    title: 'Chronos Horology',
    slug: 'chronos-horology',
    tagline: 'Luxury Swiss watch configurator with interactive exploded gear mechanics.',
    year: 2023,
    technologies: ['React Three Fiber', 'Draco GLTF', 'Next.js'],
    client: { name: 'Chronos Genève', industry: 'Luxury Goods' },
    serviceNames: ['3D Product Experience', 'E-Commerce'],
    awardCount: 3,
  },
];

export async function generateMetadata(): Promise<Metadata> {
  const { data: settings } = await sanityFetch({ query: siteSettingsQuery }).catch(() => ({
    data: null,
  }));

  return buildMetadata({
    title: 'Selected Work — Digital Portfolio',
    description: 'Explore our curated portfolio of real-time 3D web applications, interactive design systems, and creative engineering.',
    path: '/work',
    settings,
  });
}

export default async function WorkIndexPage() {
  const { data: projectsData } = (await sanityFetch({ query: allProjectsQuery }).catch(
    () => ({ data: null })
  )) as { data: ProjectCard[] | null };

  const projects =
    projectsData && projectsData.length > 0 ? projectsData : FALLBACK_PROJECTS;

  return (
    <div className="pt-28 md:pt-36">
      <div className="shell mb-12">
        <p className="eyebrow mb-5">Archive & Case Studies</p>
        <SplitTextReveal
          as="h1"
          mode="lines"
          className="max-w-[16ch] text-balance font-display text-display-md md:text-display-lg font-semibold leading-[0.9] tracking-[-0.04em] text-bone"
        >
          Engineering meets tactile digital art.
        </SplitTextReveal>
        <p className="mt-8 max-w-xl text-lg text-muted">
          Every project is built from first principles with tailored GLSL shaders, fluid typography, and sub-second load times.
        </p>
      </div>

      <WorkGrid
        projects={projects}
        variant="editorial"
        className="!pt-8"
      />
    </div>
  );
}
