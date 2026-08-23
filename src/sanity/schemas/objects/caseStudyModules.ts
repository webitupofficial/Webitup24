import { defineArrayMember, defineField, defineType } from 'sanity';

/**
 * Hero media — a discriminated union over image / video / 3D model.
 *
 * `kind` drives which downstream renderer the case-study page mounts, and crucially it
 * drives *what we preload*. A 3D hero needs the .glb warmed before first paint; a video
 * hero needs a poster and a `preload="metadata"` tag. Modelling that as one nullable blob
 * would mean guessing at runtime.
 */
export const heroMedia = defineType({
  name: 'heroMedia',
  title: 'Hero media',
  type: 'object',
  fields: [
    defineField({
      name: 'kind',
      title: 'Hero type',
      type: 'string',
      initialValue: 'image',
      options: {
        layout: 'radio',
        list: [
          { title: 'Still image', value: 'image' },
          { title: 'Video loop', value: 'video' },
          { title: 'Interactive 3D model', value: 'model' },
          { title: 'Shader only (no asset)', value: 'shader' },
        ],
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'image',
      type: 'image',
      options: { hotspot: true },
      hidden: ({ parent }) => parent?.kind !== 'image',
      fields: [
        defineField({
          name: 'alt',
          type: 'string',
          title: 'Alt text',
          description: 'Describe the image for screen readers and search engines.',
          validation: (Rule) => Rule.required(),
        }),
      ],
    }),
    defineField({
      name: 'video',
      title: 'Video file',
      type: 'file',
      options: { accept: 'video/mp4,video/webm' },
      hidden: ({ parent }) => parent?.kind !== 'video',
      description:
        'Silent, ≤12s, ≤4MB. Encode with `-crf 28 -movflags +faststart`. Provide WebM if you can — roughly 30% smaller than H.264 at matched quality.',
    }),
    defineField({
      name: 'videoPoster',
      title: 'Video poster',
      type: 'image',
      hidden: ({ parent }) => parent?.kind !== 'video',
      description: 'First frame. Prevents a black flash before the video decodes.',
    }),
    defineField({
      name: 'model',
      title: '3D model',
      type: 'model3d',
      hidden: ({ parent }) => parent?.kind !== 'model',
    }),
    defineField({
      name: 'shaderPreset',
      title: 'Shader preset',
      type: 'string',
      initialValue: 'fluid',
      hidden: ({ parent }) => parent?.kind !== 'shader',
      options: {
        list: [
          { title: 'Fluid blob (default hero)', value: 'fluid' },
          { title: 'Displaced grid / terrain', value: 'grid' },
          { title: 'Particle field', value: 'particles' },
          { title: 'Ribbon flow', value: 'ribbon' },
        ],
      },
    }),
  ],
  preview: {
    select: { kind: 'kind', image: 'image', poster: 'videoPoster', modelPoster: 'model.poster' },
    prepare({ kind, image, poster, modelPoster }) {
      return { title: `Hero: ${kind}`, media: image ?? poster ?? modelPoster };
    },
  },
});

/**
 * Rich text. Two annotation types only (link + inline code) and a short block list — a
 * portable-text config with 15 marks produces inconsistent-looking pages, because editors
 * will use all 15.
 */
export const richText = defineType({
  name: 'richText',
  title: 'Rich text',
  type: 'array',
  of: [
    defineArrayMember({
      type: 'block',
      styles: [
        { title: 'Body', value: 'normal' },
        { title: 'Heading', value: 'h3' },
        { title: 'Subheading', value: 'h4' },
        { title: 'Lead (large intro)', value: 'blockquote' },
      ],
      lists: [
        { title: 'Bullet', value: 'bullet' },
        { title: 'Numbered', value: 'number' },
      ],
      marks: {
        decorators: [
          { title: 'Bold', value: 'strong' },
          { title: 'Italic', value: 'em' },
          { title: 'Code', value: 'code' },
          // Custom decorator — renders with the acid accent + an animated underline.
          { title: 'Highlight', value: 'highlight' },
        ],
        annotations: [
          {
            name: 'linkAnnotation',
            title: 'Link',
            type: 'object',
            fields: [
              defineField({
                name: 'href',
                type: 'url',
                validation: (Rule) =>
                  Rule.required().uri({
                    scheme: ['http', 'https', 'mailto', 'tel'],
                    allowRelative: true,
                  }),
              }),
              defineField({
                name: 'newTab',
                title: 'Open in new tab',
                type: 'boolean',
                initialValue: false,
              }),
            ],
          },
        ],
      },
    }),
  ],
});

/* ---------------------------------------------------------------------------
 * Case-study modules
 *
 * Each module is a self-contained visual beat with its own scroll behaviour. The page
 * renderer maps `_type` → component (see PortableTextRenderer / CaseStudyModules), so
 * adding a module is: define it here, register it in schemas/index.ts, add one case to the
 * renderer switch. No layout code changes.
 * ------------------------------------------------------------------------- */

const textModule = defineType({
  name: 'textModule',
  title: 'Text',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow label', type: 'string' }),
    defineField({ name: 'heading', type: 'string' }),
    defineField({ name: 'body', type: 'richText' }),
    defineField({
      name: 'layout',
      type: 'string',
      initialValue: 'centered',
      options: {
        layout: 'radio',
        list: [
          { title: 'Centered, narrow', value: 'centered' },
          { title: 'Two column (heading left, body right)', value: 'split' },
          { title: 'Full-bleed oversized statement', value: 'statement' },
        ],
      },
    }),
  ],
  preview: {
    select: { heading: 'heading', layout: 'layout' },
    prepare: ({ heading, layout }) => ({
      title: heading ?? 'Text module',
      subtitle: `Text · ${layout ?? 'centered'}`,
    }),
  },
});

const mediaModule = defineType({
  name: 'mediaModule',
  title: 'Media',
  type: 'object',
  fields: [
    defineField({
      name: 'items',
      title: 'Images / videos',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'image',
          options: { hotspot: true },
          fields: [
            defineField({ name: 'alt', type: 'string', validation: (Rule) => Rule.required() }),
            defineField({ name: 'caption', type: 'string' }),
          ],
        }),
      ],
      validation: (Rule) => Rule.min(1).max(4),
    }),
    defineField({
      name: 'layout',
      type: 'string',
      initialValue: 'full',
      options: {
        layout: 'radio',
        list: [
          { title: 'Full-bleed single', value: 'full' },
          { title: 'Contained single', value: 'contained' },
          { title: 'Side-by-side pair', value: 'pair' },
          { title: 'Offset collage', value: 'collage' },
          { title: 'Horizontal scroll strip', value: 'strip' },
        ],
      },
    }),
    defineField({
      name: 'parallax',
      title: 'Parallax strength',
      type: 'number',
      initialValue: 0.15,
      description:
        '0 = static, 1 = extreme. Above ~0.3 the image visibly detaches from the page and reads as a bug. 0.1–0.2 is the range that feels expensive.',
      validation: (Rule) => Rule.min(0).max(1),
    }),
  ],
  preview: {
    select: { media: 'items.0', layout: 'layout', count: 'items.length' },
    prepare: ({ media, layout }) => ({ title: 'Media module', subtitle: `Media · ${layout}`, media }),
  },
});

const statsModule = defineType({
  name: 'statsModule',
  title: 'Results / stats',
  type: 'object',
  fields: [
    defineField({ name: 'heading', type: 'string', initialValue: 'The numbers' }),
    defineField({
      name: 'stats',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'stat',
          fields: [
            defineField({
              name: 'value',
              type: 'string',
              description: 'Include the unit: “+218%”, “0.4s”, “4.2M”. Digits animate on scroll.',
              validation: (Rule) => Rule.required(),
            }),
            defineField({ name: 'label', type: 'string', validation: (Rule) => Rule.required() }),
            defineField({ name: 'detail', type: 'string', title: 'Footnote' }),
          ],
          preview: {
            select: { value: 'value', label: 'label' },
            prepare: ({ value, label }) => ({ title: value, subtitle: label }),
          },
        }),
      ],
      validation: (Rule) => Rule.min(2).max(4).error('Two to four stats. More than four and none of them land.'),
    }),
  ],
  preview: { prepare: () => ({ title: 'Results / stats' }) },
});

const quoteModule = defineType({
  name: 'quoteModule',
  title: 'Testimonial',
  type: 'object',
  fields: [
    defineField({
      name: 'quote',
      type: 'text',
      rows: 4,
      validation: (Rule) => Rule.required().max(320).warning('Long quotes lose their punch.'),
    }),
    defineField({ name: 'author', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'role', type: 'string', description: 'e.g. CEO, Lumina Finance' }),
    defineField({ name: 'avatar', type: 'image', options: { hotspot: true } }),
  ],
  preview: {
    select: { quote: 'quote', author: 'author', media: 'avatar' },
    prepare: ({ quote, author, media }) => ({ title: author ?? 'Quote', subtitle: quote, media }),
  },
});

const embedModule = defineType({
  name: 'embedModule',
  title: 'Embed / prototype',
  type: 'object',
  fields: [
    defineField({
      name: 'url',
      type: 'url',
      description: 'Figma prototype, Vimeo, YouTube, or CodeSandbox URL.',
      validation: (Rule) => Rule.required().uri({ scheme: ['https'] }),
    }),
    defineField({
      name: 'aspectRatio',
      type: 'string',
      initialValue: '16/9',
      options: { list: ['16/9', '4/3', '1/1', '9/16'] },
    }),
    defineField({
      name: 'caption',
      type: 'string',
    }),
  ],
  preview: {
    select: { url: 'url' },
    prepare: ({ url }) => ({ title: 'Embed', subtitle: url }),
  },
});

const modelModule = defineType({
  name: 'modelModule',
  title: 'Inline 3D model',
  type: 'object',
  description: 'Mounts a scoped WebGL viewport inside the article flow.',
  fields: [
    defineField({ name: 'model', type: 'model3d', validation: (Rule) => Rule.required() }),
    defineField({ name: 'caption', type: 'string' }),
    defineField({
      name: 'interactive',
      title: 'Allow drag to orbit',
      type: 'boolean',
      initialValue: true,
      description:
        'Off = the model responds to scroll only. Keep off inside long text sections: an orbit-capture region in the middle of an article traps touch scrolling on mobile.',
    }),
  ],
  preview: {
    select: { media: 'model.poster' },
    prepare: ({ media }) => ({ title: 'Inline 3D model', media }),
  },
});

/** Every module type, in the order they appear in the Studio's "add item" menu. */
export const caseStudyModules = [
  textModule,
  mediaModule,
  statsModule,
  quoteModule,
  modelModule,
  embedModule,
];
