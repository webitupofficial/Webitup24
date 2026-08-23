import { defineArrayMember, defineField, defineType } from 'sanity';

/**
 * `service` — one capability, one interactive 3D element.
 *
 * The brief's `interactive3dElementId` is modelled as `elementId`: a constrained key that
 * the canvas layer resolves against a compile-time registry. Using an enum rather than free
 * text is the difference between "editor renames a service and the 3D silently vanishes"
 * and "editor cannot produce an invalid state".
 */
export const service = defineType({
  name: 'service',
  title: 'Service',
  type: 'document',
  groups: [
    { name: 'core', title: 'Overview', default: true },
    { name: 'visual', title: '3D & visual' },
    { name: 'detail', title: 'Deliverables & process' },
  ],
  fields: [
    defineField({
      name: 'title',
      type: 'string',
      group: 'core',
      validation: (Rule) => Rule.required().max(48),
    }),
    defineField({
      name: 'slug',
      type: 'slug',
      group: 'core',
      options: { source: 'title', maxLength: 48 },
      description: 'The URL: /services/<slug>',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'shortDescription',
      title: 'Short description',
      type: 'text',
      rows: 2,
      group: 'core',
      description: 'One or two sentences for the services list on the homepage.',
      validation: (Rule) => Rule.required().max(200),
    }),
    defineField({
      name: 'description',
      title: 'Full description',
      type: 'richText',
      group: 'core',
      description: 'The body copy on the dedicated service page.',
    }),
    defineField({
      name: 'order',
      title: 'Display order',
      type: 'number',
      group: 'core',
      description: 'Lower sorts first. Controls the accordion order on the homepage.',
      validation: (Rule) => Rule.required().integer(),
    }),
    defineField({
      name: 'icon',
      title: 'Glyph',
      type: 'string',
      group: 'core',
      description: 'A single character or short symbol used in the list marker. e.g. ◆, 01, ↗',
    }),

    /* --------------------------- 3D & visual ---------------------------- */
    defineField({
      name: 'elementId',
      title: 'Interactive 3D element',
      type: 'string',
      group: 'visual',
      description:
        'Which WebGL element represents this service. Resolved against SERVICE_ELEMENTS in src/components/canvas/registry.ts — an unknown value falls back to the torus rather than throwing inside the render loop.',
      options: {
        list: [
          { title: 'Morphing torus knot — Web Design', value: 'torus-knot' },
          { title: 'Wireframe lattice — Development', value: 'lattice' },
          { title: 'Orbiting node graph — SEO', value: 'node-graph' },
          { title: 'Refracting prism — Brand Identity', value: 'prism' },
          { title: 'Particle stream — Performance', value: 'particle-stream' },
          { title: 'Neural mesh — AI Automation', value: 'neural-mesh' },
          { title: 'Liquid metal blob — generic', value: 'blob' },
        ],
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'accentColor',
      title: 'Accent colour',
      type: 'string',
      group: 'visual',
      description:
        'Hex. Tints both the 3D element and the hover state of this service’s row.',
      initialValue: '#C8FF3D',
      validation: (Rule) =>
        Rule.regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).error(
          'Must be a hex colour including the leading #.'
        ),
    }),
    defineField({
      name: 'model',
      title: 'Custom model (optional)',
      type: 'model3d',
      group: 'visual',
      description:
        'Overrides the procedural element above with an uploaded .glb. Leave empty to use the built-in geometry, which is cheaper and always available.',
    }),

    /* ----------------------- Deliverables & process --------------------- */
    defineField({
      name: 'deliverables',
      title: 'Deliverables',
      type: 'array',
      group: 'detail',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'deliverable',
          fields: [
            defineField({
              name: 'title',
              type: 'string',
              validation: (Rule) => Rule.required(),
            }),
            defineField({
              name: 'description',
              type: 'text',
              rows: 2,
            }),
          ],
          preview: {
            select: { title: 'title', subtitle: 'description' },
          },
        }),
      ],
      description: 'What the client actually receives. Concrete artefacts, not adjectives.',
      validation: (Rule) => Rule.min(2).error('List at least two deliverables.'),
    }),
    defineField({
      name: 'processSteps',
      title: 'Process',
      type: 'array',
      group: 'detail',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'step',
          fields: [
            defineField({ name: 'label', type: 'string', validation: (Rule) => Rule.required() }),
            defineField({ name: 'detail', type: 'text', rows: 2 }),
            defineField({
              name: 'duration',
              type: 'string',
              description: 'e.g. “1–2 weeks”',
            }),
          ],
          preview: { select: { title: 'label', subtitle: 'duration' } },
        }),
      ],
    }),
    defineField({
      name: 'startingPrice',
      title: 'Starting price',
      type: 'string',
      group: 'detail',
      description:
        'Optional. Free text so you can write “from £6,000” or “project-based”. Rendered only if set.',
    }),
    defineField({ name: 'seo', type: 'seo', group: 'detail' }),
  ],

  orderings: [{ title: 'Display order', name: 'order', by: [{ field: 'order', direction: 'asc' }] }],

  preview: {
    select: { title: 'title', description: 'shortDescription', order: 'order', element: 'elementId' },
    prepare({ title, description, order, element }) {
      return {
        title: `${typeof order === 'number' ? `${String(order).padStart(2, '0')} · ` : ''}${title ?? 'Untitled'}`,
        subtitle: element ? `3D: ${element}` : description,
      };
    },
  },
});
