import { defineArrayMember, defineField, defineType } from 'sanity';

/**
 * Strip Unicode combining diacritical marks (U+0300–U+036F) after an NFD decomposition.
 *
 * Implemented as a code-point filter rather than a regex character class so the source
 * contains no literal combining glyphs — those are invisible in most editors and get
 * silently re-normalised by some git/editor configurations, which would break slugging in
 * a way that is very hard to see in a diff.
 *
 * Must run *before* the `[^a-z0-9]+ → '-'` pass. Otherwise "café zénith" decomposes to
 * "cafe<acute> ze<acute>nith" and each orphaned mark becomes its own dash: "cafe-ze-nith".
 */
function stripDiacritics(input: string): string {
  let out = '';
  for (const ch of input.normalize('NFD')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x300 && code <= 0x36f) continue;
    out += ch;
  }
  return out;
}

/**
 * `project` — a case study.
 *
 * Field groups keep the Studio form navigable: an editor filling in results shouldn't have
 * to scroll past 3D transform offsets to get there.
 */
export const project = defineType({
  name: 'project',
  title: 'Project',
  type: 'document',
  groups: [
    { name: 'core', title: 'Overview', default: true },
    { name: 'visual', title: 'Visual & 3D' },
    { name: 'content', title: 'Case study' },
    { name: 'meta', title: 'Credits & SEO' },
  ],
  fields: [
    /* ----------------------------- Overview ----------------------------- */
    defineField({
      name: 'title',
      title: 'Project title',
      type: 'string',
      group: 'core',
      validation: (Rule) => Rule.required().max(80),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      group: 'core',
      options: {
        source: 'title',
        maxLength: 72,
        // Explicit slugifier: the default leaves unicode intact, which produces
        // percent-encoded URLs for any client name with an accent in it.
        slugify: (input) =>
          stripDiacritics(input.toLowerCase())
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 72),
      },
      description: 'The URL: /work/<slug>. Changing this after launch breaks inbound links.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'client',
      title: 'Client',
      type: 'object',
      group: 'core',
      options: { columns: 2 },
      fields: [
        defineField({ name: 'name', type: 'string', validation: (Rule) => Rule.required() }),
        defineField({
          name: 'industry',
          type: 'string',
          options: {
            list: [
              'Finance',
              'Health',
              'SaaS',
              'E-commerce',
              'Hospitality',
              'Culture & Arts',
              'Real Estate',
              'AI & Data',
              'Sport',
              'Other',
            ],
          },
        }),
        defineField({
          name: 'logo',
          type: 'image',
          description: 'SVG or transparent PNG, monochrome. Used in the client wall marquee.',
        }),
        defineField({
          name: 'website',
          type: 'url',
          validation: (Rule) => Rule.uri({ scheme: ['https'] }),
        }),
      ],
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'tagline',
      title: 'One-line summary',
      type: 'string',
      group: 'core',
      description:
        'The single sentence on the work grid card. Lead with the outcome, not the deliverable.',
      validation: (Rule) => Rule.required().max(120),
    }),
    defineField({
      name: 'year',
      title: 'Year',
      type: 'number',
      group: 'core',
      initialValue: () => new Date().getFullYear(),
      validation: (Rule) => Rule.required().min(2015).max(2100).integer(),
    }),
    defineField({
      name: 'services',
      title: 'Services delivered',
      type: 'array',
      group: 'core',
      of: [defineArrayMember({ type: 'reference', to: [{ type: 'service' }] })],
      description:
        'References, not free text — this is what powers the “related work” list on each service page.',
      validation: (Rule) => Rule.unique().min(1),
    }),
    defineField({
      name: 'technologies',
      title: 'Technologies',
      type: 'array',
      group: 'core',
      of: [defineArrayMember({ type: 'string' })],
      options: {
        layout: 'tags',
        list: [
          'Next.js',
          'React',
          'TypeScript',
          'Three.js',
          'React Three Fiber',
          'GLSL',
          'WebGL',
          'WebGPU',
          'GSAP',
          'Lenis',
          'Framer Motion',
          'Tailwind CSS',
          'Sanity',
          'Shopify Hydrogen',
          'Node.js',
          'Python',
          'PostgreSQL',
          'Supabase',
          'Vercel',
          'Cloudflare',
          'OpenAI',
          'Anthropic Claude',
          'WhatsApp Business API',
          'Stripe',
          'Blender',
          'Spline',
          'Figma',
        ],
      },
      description:
        'Free text is allowed, but pick from the list where possible so the filter chips on /work stay tidy.',
      validation: (Rule) => Rule.unique(),
    }),
    defineField({
      name: 'featured',
      title: 'Feature on homepage',
      type: 'boolean',
      group: 'core',
      initialValue: false,
    }),
    defineField({
      name: 'order',
      title: 'Manual sort order',
      type: 'number',
      group: 'core',
      description:
        'Lower sorts first. Leave blank to fall back to year descending, then publish date.',
    }),
    defineField({
      name: 'liveUrl',
      title: 'Live site URL',
      type: 'url',
      group: 'core',
      validation: (Rule) => Rule.uri({ scheme: ['https'] }),
    }),

    /* --------------------------- Visual & 3D ---------------------------- */
    defineField({
      name: 'heroMedia',
      title: 'Hero media',
      type: 'heroMedia',
      group: 'visual',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'thumbnail',
      title: 'Grid thumbnail',
      type: 'image',
      group: 'visual',
      options: { hotspot: true },
      description:
        'Portrait-ish crop (4:5) reads best in the work grid. Distinct from the hero — the hero is usually too wide to survive the crop.',
      fields: [
        defineField({ name: 'alt', type: 'string', validation: (Rule) => Rule.required() }),
      ],
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'thumbnailVideo',
      title: 'Grid hover video',
      type: 'file',
      group: 'visual',
      options: { accept: 'video/mp4,video/webm' },
      description:
        'Optional 3–5s silent loop that plays on card hover. Keep under 1.5MB — several of these preload on the work index.',
    }),
    defineField({
      name: 'colorPalette',
      title: 'Colour palette',
      type: 'colorPalette',
      group: 'visual',
      description:
        'Drives both the page CSS variables and the hero shader tints, so the 3D actually matches the brand instead of sitting on top of it.',
    }),
    defineField({
      name: 'sceneId',
      title: 'Hero scene preset',
      type: 'string',
      group: 'visual',
      initialValue: 'fluid-default',
      description:
        'Selects the WebGL scene variant. Must match a key in `SCENE_REGISTRY` (src/components/canvas/registry.ts) — invalid values fall back to fluid-default rather than crashing the canvas.',
      options: {
        list: [
          { title: 'Fluid blob — default', value: 'fluid-default' },
          { title: 'Fluid blob — turbulent', value: 'fluid-turbulent' },
          { title: 'Fluid blob — liquid chrome', value: 'fluid-chrome' },
          { title: 'Displaced grid', value: 'grid-terrain' },
          { title: 'Particle nebula', value: 'particles-nebula' },
          { title: 'Model showcase', value: 'model-showcase' },
        ],
      },
    }),

    /* --------------------------- Case study ----------------------------- */
    defineField({
      name: 'intro',
      title: 'Introduction',
      type: 'richText',
      group: 'content',
      description: 'The two or three paragraphs directly under the hero.',
    }),
    defineField({
      name: 'challenge',
      title: 'The challenge',
      type: 'text',
      rows: 4,
      group: 'content',
    }),
    defineField({
      name: 'approach',
      title: 'Our approach',
      type: 'text',
      rows: 4,
      group: 'content',
    }),
    defineField({
      name: 'modules',
      title: 'Case study modules',
      type: 'array',
      group: 'content',
      of: [
        defineArrayMember({ type: 'textModule' }),
        defineArrayMember({ type: 'mediaModule' }),
        defineArrayMember({ type: 'statsModule' }),
        defineArrayMember({ type: 'quoteModule' }),
        defineArrayMember({ type: 'modelModule' }),
        defineArrayMember({ type: 'embedModule' }),
      ],
      description:
        'Compose the page beat by beat. Alternate text and media — three media modules in a row reads as a mood board, not a case study.',
    }),

    /* ------------------------- Credits & SEO ---------------------------- */
    defineField({
      name: 'credits',
      title: 'Credits',
      type: 'array',
      group: 'meta',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'credit',
          fields: [
            defineField({ name: 'role', type: 'string', validation: (Rule) => Rule.required() }),
            defineField({ name: 'people', type: 'array', of: [{ type: 'string' }], options: { layout: 'tags' } }),
          ],
          preview: {
            select: { role: 'role', people: 'people' },
            prepare: ({ role, people }) => ({
              title: role,
              subtitle: Array.isArray(people) ? people.join(', ') : undefined,
            }),
          },
        }),
      ],
    }),
    defineField({
      name: 'awards',
      title: 'Awards & recognition',
      type: 'array',
      group: 'meta',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'award',
          fields: [
            defineField({
              name: 'name',
              type: 'string',
              options: {
                list: [
                  'Awwwards Site of the Day',
                  'Awwwards Honorable Mention',
                  'Awwwards Developer Award',
                  'CSS Design Awards',
                  'FWA of the Day',
                  'Webby',
                  'Other',
                ],
              },
              validation: (Rule) => Rule.required(),
            }),
            defineField({ name: 'year', type: 'number' }),
            defineField({ name: 'url', type: 'url' }),
          ],
          preview: {
            select: { name: 'name', year: 'year' },
            prepare: ({ name, year }) => ({ title: name, subtitle: year ? String(year) : undefined }),
          },
        }),
      ],
    }),
    defineField({ name: 'seo', type: 'seo', group: 'meta' }),
    defineField({
      name: 'publishedAt',
      title: 'Published at',
      type: 'datetime',
      group: 'meta',
      initialValue: () => new Date().toISOString(),
      validation: (Rule) => Rule.required(),
    }),
  ],

  orderings: [
    {
      title: 'Curated order',
      name: 'curated',
      by: [
        { field: 'order', direction: 'asc' },
        { field: 'year', direction: 'desc' },
      ],
    },
    { title: 'Newest first', name: 'newest', by: [{ field: 'publishedAt', direction: 'desc' }] },
    { title: 'Client A–Z', name: 'client', by: [{ field: 'client.name', direction: 'asc' }] },
  ],

  preview: {
    select: {
      title: 'title',
      client: 'client.name',
      year: 'year',
      media: 'thumbnail',
      featured: 'featured',
    },
    prepare({ title, client, year, media, featured }) {
      return {
        title: `${featured ? '★ ' : ''}${title ?? 'Untitled'}`,
        subtitle: [client, year].filter(Boolean).join(' · '),
        media,
      };
    },
  },
});
