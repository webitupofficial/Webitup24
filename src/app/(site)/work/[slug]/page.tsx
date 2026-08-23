import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sanityFetch } from '@/sanity/lib/live';
import { projectBySlugQuery, projectSlugsQuery, siteSettingsQuery } from '@/sanity/lib/queries';
import { buildMetadata, creativeWorkJsonLd, jsonLdScript } from '@/lib/utils/seo';
import { SanityImage } from '@/components/media/SanityImage';
import { SplitTextReveal } from '@/components/interactive/SplitTextReveal';
import { Reveal } from '@/components/interactive/Reveal';
import { ArrowUpRight, MagneticButton } from '@/components/interactive/MagneticButton';
import { WorkGrid } from '@/components/sections/WorkGrid';

export const revalidate = 60;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const { data: slugs } = (await sanityFetch({
    query: projectSlugsQuery,
  }).catch(() => ({ data: [] }))) as { data: { slug: string }[] | null };

  return (slugs || []).map((s: { slug: string }) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const [{ data: project }, { data: settings }] = (await Promise.all([
    sanityFetch({ query: projectBySlugQuery, params: { slug } }).catch(() => ({ data: null })),
    sanityFetch({ query: siteSettingsQuery }).catch(() => ({ data: null })),
  ])) as [{ data: any }, { data: any }];

  if (!project) {
    return buildMetadata({
      title: `${slug.replace(/-/g, ' ')} — Case Study`,
      description: 'Explore this in-depth case study showcasing creative development and 3D web engineering.',
      path: `/work/${slug}`,
      settings,
    });
  }

  return buildMetadata({
    title: `${project.title} — Case Study`,
    description: project.tagline ?? project.challenge,
    seo: project.seo,
    image: project.thumbnail ?? project.heroMedia?.image,
    path: `/work/${slug}`,
    type: 'article',
    publishedTime: project.publishedAt,
    settings,
  });
}

export default async function ProjectCaseStudyPage({ params }: PageProps) {
  const { slug } = await params;

  const { data: project } = (await sanityFetch({
    query: projectBySlugQuery,
    params: { slug },
  }).catch(() => ({ data: null }))) as { data: any };

  // Dynamic fallback for showcase if CMS project not yet populated
  const title = project?.title ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  const tagline =
    project?.tagline ??
    'A bespoke digital experience engineered with real-time 3D and precision kinetic motion.';
  const clientName = project?.client?.name ?? 'Studio Flagship';
  const year = project?.year ?? 2025;
  const technologies = project?.technologies ?? ['Three.js', 'GLSL', 'Next.js 15', 'Tailwind CSS'];
  const challenge =
    project?.challenge ??
    'Translate a high-end spatial product roadmap into a responsive, fluid web interface that maintains ultra-stable 60fps frame rates across low-end mobile devices and 4K displays.';
  const approach =
    project?.approach ??
    'We engineered custom GLSL vertex shaders, leveraged ACES Filmic tone mapping for photorealistic lighting, and built an adaptive performance tiering system to dynamically scale DPR and post-processing passes.';

  const jsonLd = creativeWorkJsonLd({
    title,
    path: `/work/${slug}`,
    description: tagline,
    year,
    publishedAt: project?.publishedAt,
    clientName,
    technologies,
  });

  return (
    <article className="pt-28 md:pt-36">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />

      {/* Case Study Header */}
      <div className="shell">
        <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-acid tracking-wider uppercase mb-6">
          <Link href="/work" className="hover:underline text-muted">
            ← Work Index
          </Link>
          <span>/</span>
          <span>{clientName}</span>
          <span>/</span>
          <span>{year}</span>
        </div>

        <SplitTextReveal
          as="h1"
          mode="lines"
          className="max-w-[18ch] text-balance font-display text-display-md md:text-display-lg font-semibold leading-[0.9] tracking-[-0.04em] text-bone"
        >
          {title}
        </SplitTextReveal>

        <p className="mt-8 max-w-2xl text-xl leading-relaxed text-muted/90">
          {tagline}
        </p>

        {/* Project Meta Bar */}
        <div className="mt-12 grid grid-cols-2 gap-8 border-y border-hairline py-8 sm:grid-cols-4">
          <div>
            <p className="font-mono text-label uppercase text-muted">Client</p>
            <p className="mt-2 font-display text-base text-bone">{clientName}</p>
          </div>
          <div>
            <p className="font-mono text-label uppercase text-muted">Year</p>
            <p className="mt-2 font-display text-base text-bone">{year}</p>
          </div>
          <div>
            <p className="font-mono text-label uppercase text-muted">Disciplines</p>
            <p className="mt-2 font-display text-base text-bone">
              {project?.services && project.services.length > 0
                ? project.services.map((s: any) => s.title).join(', ')
                : '3D WebGL, Creative Dev'}
            </p>
          </div>
          <div>
            <p className="font-mono text-label uppercase text-muted">Live Preview</p>
            {project?.liveUrl ? (
              <a
                href={project.liveUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 font-display text-base text-acid hover:underline"
              >
                <span>Visit site</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            ) : (
              <p className="mt-2 font-display text-base text-bone/60">Confidential</p>
            )}
          </div>
        </div>
      </div>

      {/* Hero Media Showcase */}
      <div className="shell mt-12 md:mt-16">
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-3xl border border-hairline bg-surface/60">
          {project?.thumbnail ? (
            <SanityImage
              image={project.thumbnail}
              fill
              priority
              alt={title}
              className="object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-surface">
              <div
                className="h-72 w-72 rounded-full opacity-40 blur-3xl"
                style={{ background: 'radial-gradient(circle, #CCFF00 0%, #5B2BE8 100%)' }}
              />
              <span className="font-mono text-sm tracking-widest uppercase text-bone/60 z-10">
                Interactive Showcase • {title}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Challenge & Approach Split */}
      <div className="shell mt-20 md:mt-32">
        <div className="grid grid-cols-1 gap-16 lg:grid-cols-2 lg:gap-24">
          <Reveal distance={30}>
            <p className="eyebrow mb-4">The Challenge</p>
            <h2 className="font-display text-2xl md:text-3xl font-medium text-bone mb-6">
              Setting a new benchmark for spatial interaction.
            </h2>
            <p className="text-lg leading-relaxed text-muted/90">{challenge}</p>
          </Reveal>

          <Reveal distance={30} delay={0.1}>
            <p className="eyebrow mb-4">Our Approach</p>
            <h2 className="font-display text-2xl md:text-3xl font-medium text-bone mb-6">
              Shader engineering & architecture without compromise.
            </h2>
            <p className="text-lg leading-relaxed text-muted/90">{approach}</p>
          </Reveal>
        </div>

        {/* Tech Stack Pills */}
        <div className="mt-16 pt-8 border-t border-hairline">
          <p className="font-mono text-label uppercase text-muted mb-4">Technologies & Tooling</p>
          <div className="flex flex-wrap gap-2">
            {technologies.map((tech: string, i: number) => (
              <span
                key={i}
                className="rounded-full border border-hairline bg-elevated/70 px-4 py-1.5 font-mono text-xs uppercase tracking-wider text-bone/80"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Related Work */}
      {project?.related && project.related.length > 0 ? (
        <div className="mt-28">
          <WorkGrid
            projects={project.related}
            eyebrow="Related Work"
            heading="Explore related\ncase studies"
            variant="uniform"
          />
        </div>
      ) : null}

      {/* Next / Previous Project Navigation */}
      <div className="shell mt-24 border-t border-hairline py-16 flex justify-between items-center">
        {project?.prev ? (
          <Link
            href={`/work/${project.prev.slug}`}
            className="group flex flex-col items-start gap-1 font-mono text-xs uppercase text-muted hover:text-acid"
          >
            <span className="text-muted/60">← Previous Project</span>
            <span className="font-display text-lg text-bone group-hover:text-acid transition-colors">
              {project.prev.title}
            </span>
          </Link>
        ) : (
          <div />
        )}

        {project?.next ? (
          <Link
            href={`/work/${project.next.slug}`}
            className="group flex flex-col items-end gap-1 font-mono text-xs uppercase text-muted hover:text-acid text-right"
          >
            <span className="text-muted/60">Next Project →</span>
            <span className="font-display text-lg text-bone group-hover:text-acid transition-colors">
              {project.next.title}
            </span>
          </Link>
        ) : (
          <Link
            href="/work"
            className="font-mono text-xs uppercase tracking-widest text-acid hover:underline"
          >
            View All Work →
          </Link>
        )}
      </div>
    </article>
  );
}
