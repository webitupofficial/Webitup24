import { defineArrayMember, defineField, defineType } from 'sanity';

/**
 * `page` — generic editorial route (/about, /approach, /privacy).
 *
 * Exists so the marketing team can add a page without a deploy, and so `link` has
 * something meaningful to reference for internal navigation. Reuses the same case-study
 * modules, which keeps the renderer surface at exactly one switch statement.
 */
export const page = defineType({
  name: 'page',
  title: 'Page',
  type: 'document',
  fields: [
    defineField({ name: 'title', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({
      name: 'slug',
      type: 'slug',
      options: { source: 'title', maxLength: 72 },
      description:
        'Root-level route: /<slug>. Avoid colliding with reserved routes — work, services, studio, api.',
      validation: (Rule) =>
        Rule.required().custom((slug: { current?: string } | undefined) => {
          const reserved = ['work', 'services', 'studio', 'api', 'contact', '_next'];
          return slug?.current && reserved.includes(slug.current)
            ? `"${slug.current}" is a reserved route.`
            : true;
        }),
    }),
    defineField({
      name: 'heading',
      title: 'Display heading',
      type: 'string',
      description: 'The large on-page headline. Defaults to the title if blank.',
    }),
    defineField({
      name: 'lead',
      title: 'Lead paragraph',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'showHeroScene',
      title: 'Show 3D hero scene',
      type: 'boolean',
      initialValue: false,
      description: 'Mounts the shared fluid scene behind the page header.',
    }),
    defineField({
      name: 'modules',
      title: 'Content modules',
      type: 'array',
      of: [
        defineArrayMember({ type: 'textModule' }),
        defineArrayMember({ type: 'mediaModule' }),
        defineArrayMember({ type: 'statsModule' }),
        defineArrayMember({ type: 'quoteModule' }),
        defineArrayMember({ type: 'modelModule' }),
        defineArrayMember({ type: 'embedModule' }),
      ],
    }),
    defineField({ name: 'seo', type: 'seo' }),
  ],
  preview: {
    select: { title: 'title', slug: 'slug.current' },
    prepare: ({ title, slug }) => ({ title: title ?? 'Untitled page', subtitle: slug ? `/${slug}` : undefined }),
  },
});
