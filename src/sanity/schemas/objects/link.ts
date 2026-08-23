import { defineField, defineType } from 'sanity';

/**
 * Polymorphic link. One object that resolves to an internal route, an external URL, an
 * anchor on the current page, or a mailto/tel — chosen by `kind`, with the irrelevant
 * fields hidden. Avoids the classic CMS smell of four nullable URL fields where an editor
 * fills the wrong one.
 */
export const link = defineType({
  name: 'link',
  title: 'Link',
  type: 'object',
  fields: [
    defineField({
      name: 'label',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'kind',
      title: 'Link type',
      type: 'string',
      initialValue: 'internal',
      options: {
        layout: 'radio',
        list: [
          { title: 'Page on this site', value: 'internal' },
          { title: 'External URL', value: 'external' },
          { title: 'Anchor on this page', value: 'anchor' },
          { title: 'Email or phone', value: 'contact' },
        ],
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'internal',
      title: 'Target page',
      type: 'reference',
      to: [{ type: 'project' }, { type: 'service' }, { type: 'page' }],
      hidden: ({ parent }) => parent?.kind !== 'internal',
      validation: (Rule) =>
        Rule.custom((value, ctx) =>
          (ctx.parent as { kind?: string })?.kind === 'internal' && !value
            ? 'Pick a target page.'
            : true
        ),
    }),
    defineField({
      name: 'href',
      title: 'URL',
      type: 'url',
      hidden: ({ parent }) => parent?.kind !== 'external',
      validation: (Rule) => Rule.uri({ scheme: ['http', 'https'] }),
    }),
    defineField({
      name: 'anchor',
      title: 'Section id',
      type: 'string',
      description: 'Without the #. Must match a section id in the page — e.g. "contact".',
      hidden: ({ parent }) => parent?.kind !== 'anchor',
    }),
    defineField({
      name: 'contact',
      title: 'Email address or phone number',
      type: 'string',
      hidden: ({ parent }) => parent?.kind !== 'contact',
    }),
    defineField({
      name: 'magnetic',
      title: 'Magnetic hover',
      type: 'boolean',
      initialValue: false,
      description:
        'Applies the cursor-attraction effect. Use sparingly — on more than two or three elements per viewport it stops reading as special.',
    }),
  ],
  preview: {
    select: { label: 'label', kind: 'kind', href: 'href', anchor: 'anchor', contact: 'contact' },
    prepare({ label, kind, href, anchor, contact }) {
      const target = href ?? (anchor ? `#${anchor}` : undefined) ?? contact ?? 'internal ref';
      return { title: label ?? 'Untitled link', subtitle: `${kind} → ${target}` };
    },
  },
});

/** Named social profile. Icon is chosen client-side from `platform`. */
export const socialLink = defineType({
  name: 'socialLink',
  title: 'Social profile',
  type: 'object',
  fields: [
    defineField({
      name: 'platform',
      type: 'string',
      options: {
        list: [
          { title: 'X / Twitter', value: 'x' },
          { title: 'Instagram', value: 'instagram' },
          { title: 'LinkedIn', value: 'linkedin' },
          { title: 'YouTube', value: 'youtube' },
          { title: 'Dribbble', value: 'dribbble' },
          { title: 'Behance', value: 'behance' },
          { title: 'GitHub', value: 'github' },
          { title: 'Awwwards', value: 'awwwards' },
          { title: 'WhatsApp', value: 'whatsapp' },
        ],
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'url',
      type: 'url',
      validation: (Rule) =>
        Rule.required().uri({ scheme: ['http', 'https', 'mailto', 'tel'] }),
    }),
    defineField({
      name: 'handle',
      title: 'Handle',
      type: 'string',
      description: 'Displayed in the footer, e.g. @webitup24',
    }),
  ],
  preview: {
    select: { platform: 'platform', url: 'url' },
    prepare: ({ platform, url }) => ({ title: platform, subtitle: url }),
  },
});
