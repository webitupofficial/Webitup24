import type { MetadataRoute } from 'next';
import { sanityFetch } from '@/sanity/lib/live';
import { sitemapQuery } from '@/sanity/lib/queries';
import { siteUrl } from '@/sanity/env';

export const revalidate = 86400; // Daily sitemap revalidation

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await sanityFetch<any>({ query: sitemapQuery }).catch(() => ({
    data: { projects: [], services: [], pages: [] },
  }));

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${siteUrl}`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${siteUrl}/work`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${siteUrl}/services`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
  ];

  const projectRoutes: MetadataRoute.Sitemap = (data?.projects || []).map((p: any) => ({
    url: `${siteUrl}/work/${p.slug}`,
    lastModified: p._updatedAt ? new Date(p._updatedAt) : new Date(),
    changeFrequency: 'monthly',
    priority: 0.85,
  }));

  const serviceRoutes: MetadataRoute.Sitemap = (data?.services || []).map((s: any) => ({
    url: `${siteUrl}/services/${s.slug}`,
    lastModified: s._updatedAt ? new Date(s._updatedAt) : new Date(),
    changeFrequency: 'monthly',
    priority: 0.75,
  }));

  const pageRoutes: MetadataRoute.Sitemap = (data?.pages || []).map((pg: any) => ({
    url: `${siteUrl}/${pg.slug}`,
    lastModified: pg._updatedAt ? new Date(pg._updatedAt) : new Date(),
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  return [...staticRoutes, ...projectRoutes, ...serviceRoutes, ...pageRoutes];
}
