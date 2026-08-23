import { defineField, defineType } from 'sanity';

/**
 * Reusable SEO object.
 *
 * Deliberately small. Every field an editor *can* fill is a field they *must* think about,
 * and most pages should inherit sane defaults from siteSettings rather than being
 * hand-tuned. `src/lib/utils/seo.ts` implements that fallback chain.
 */
export const seo = defineType({
  name: 'seo',
  title: 'SEO & Social',
  type: 'object',
  options: { collapsible: true, collapsed: true },
  fields: [
    defineField({
      name: 'metaTitle',
      title: 'Meta title',
      type: 'string',
      description:
        'Overrides the page title in search results and the browser tab. Leave blank to use the page’s own title. Aim for under 60 characters.',
      validation: (Rule) => Rule.max(70).warning('Titles over 70 characters get truncated by Google.'),
    }),
    defineField({
      name: 'metaDescription',
      title: 'Meta description',
      type: 'text',
      rows: 3,
      description: 'The snippet under the search result. 120–158 characters is the sweet spot.',
      validation: (Rule) =>
        Rule.max(165).warning('Descriptions over 165 characters get truncated.'),
    }),
    defineField({
      name: 'ogImage',
      title: 'Social share image',
      type: 'image',
      description:
        'Shown when the page is shared. 1200×630 exactly. If blank, we generate one from the page title at the edge.',
      options: { hotspot: true },
    }),
    defineField({
      name: 'keywords',
      title: 'Keywords',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      description:
        'Low SEO value in 2026 — kept because it feeds our internal related-projects matching.',
    }),
    defineField({
      name: 'noIndex',
      title: 'Hide from search engines',
      type: 'boolean',
      initialValue: false,
      description: 'Adds `noindex, nofollow`. Use for unlisted client presentations.',
    }),
  ],
});
