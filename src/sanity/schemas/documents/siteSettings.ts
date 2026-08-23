import { defineArrayMember, defineField, defineType } from 'sanity';
import { CogIcon } from '@sanity/icons';

/**
 * `siteSettings` — a singleton.
 *
 * Enforced as a singleton in two places, because one is not enough:
 *   • `structure.ts` pins the Studio to the document id `siteSettings`, so the UI offers no
 *     "create new" affordance and no list view.
 *   • `__experimental_actions` removes create/delete, so even a hand-crafted URL into the
 *     Studio can't produce a second one.
 *
 * Everything the whole site needs and no page owns individually lives here.
 */
export const siteSettings = defineType({
  name: 'siteSettings',
  title: 'Site settings',
  type: 'document',
  icon: CogIcon,
  groups: [
    { name: 'identity', title: 'Identity', default: true },
    { name: 'contact', title: 'Contact' },
    { name: 'nav', title: 'Navigation' },
    { name: 'seo', title: 'SEO & metadata' },
    { name: 'motion', title: 'Motion & 3D defaults' },
  ],
  fields: [
    /* ----------------------------- Identity ----------------------------- */
    defineField({
      name: 'siteName',
      title: 'Site name',
      type: 'string',
      group: 'identity',
      initialValue: 'WebItUp24',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'tagline',
      title: 'Tagline',
      type: 'string',
      group: 'identity',
      initialValue: 'Crafting Websites That Move People',
      description: 'Appended to the site name in the browser tab and used in the footer.',
      validation: (Rule) => Rule.required().max(90),
    }),
    defineField({
      name: 'manifesto',
      title: 'Manifesto',
      type: 'text',
      rows: 4,
      group: 'identity',
      description: 'The short "who we are" paragraph. Appears in the footer and the About block.',
    }),
    defineField({
      name: 'logo',
      title: 'Logo (SVG)',
      type: 'image',
      group: 'identity',
      options: { accept: '.svg' },
      description: 'Monochrome SVG. Colour is applied with currentColor at render time.',
    }),

    /* ----------------------------- Contact ------------------------------ */
    defineField({
      name: 'email',
      title: 'Primary email',
      type: 'string',
      group: 'contact',
      initialValue: 'info@webitup24.com',
      validation: (Rule) => Rule.required().email(),
    }),
    defineField({
      name: 'phone',
      title: 'Phone',
      type: 'string',
      group: 'contact',
      description: 'E.164 format for the tel: link, e.g. +447700900123',
    }),
    defineField({
      name: 'whatsapp',
      title: 'WhatsApp number',
      type: 'string',
      group: 'contact',
      description:
        'Digits only, no + or spaces — this goes straight into a wa.me URL. Relevant since AI/WhatsApp automation is a service you sell.',
    }),
    defineField({
      name: 'location',
      title: 'Location line',
      type: 'string',
      group: 'contact',
      initialValue: 'Based everywhere creativity lives.',
    }),
    defineField({
      name: 'socials',
      title: 'Social profiles',
      type: 'array',
      group: 'contact',
      of: [defineArrayMember({ type: 'socialLink' })],
      description:
        'Only add profiles that actually exist — the current site links four placeholder “#” anchors, which reads as unfinished.',
    }),
    defineField({
      name: 'availability',
      title: 'Availability status',
      type: 'object',
      group: 'contact',
      options: { columns: 2 },
      fields: [
        defineField({ name: 'isAvailable', title: 'Taking new work', type: 'boolean', initialValue: true }),
        defineField({
          name: 'label',
          type: 'string',
          initialValue: 'Available for Q4 2026',
          description: 'Shown next to the pulsing dot in the header.',
        }),
      ],
    }),

    /* ---------------------------- Navigation ---------------------------- */
    defineField({
      name: 'primaryNav',
      title: 'Header navigation',
      type: 'array',
      group: 'nav',
      of: [defineArrayMember({ type: 'link' })],
      validation: (Rule) => Rule.max(6).warning('More than six items and the header stops being scannable.'),
    }),
    defineField({
      name: 'footerNav',
      title: 'Footer navigation',
      type: 'array',
      group: 'nav',
      of: [defineArrayMember({ type: 'link' })],
    }),
    defineField({
      name: 'ctaLink',
      title: 'Header CTA',
      type: 'link',
      group: 'nav',
    }),
    defineField({
      name: 'marqueeWords',
      title: 'Marquee words',
      type: 'array',
      group: 'nav',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      initialValue: ['Design', 'Development', 'SEO', 'Brand', 'Performance', 'AI Automation'],
      description: 'The scrolling word band between sections.',
    }),

    /* ------------------------- SEO & metadata --------------------------- */
    defineField({
      name: 'defaultSeo',
      title: 'Default SEO',
      type: 'seo',
      group: 'seo',
      description:
        'Fallbacks for any page that has not set its own. The whole site inherits from here.',
    }),
    defineField({
      name: 'organization',
      title: 'Organisation (structured data)',
      type: 'object',
      group: 'seo',
      description: 'Emitted as JSON-LD. Feeds Google’s knowledge panel and rich results.',
      fields: [
        defineField({ name: 'legalName', type: 'string' }),
        defineField({ name: 'foundingYear', type: 'number' }),
        defineField({
          name: 'sameAs',
          title: 'Canonical profile URLs',
          type: 'array',
          of: [{ type: 'url' }],
          description: 'Wikidata, Crunchbase, LinkedIn company page — anything authoritative.',
        }),
      ],
    }),
    defineField({
      name: 'verification',
      title: 'Search console verification',
      type: 'object',
      group: 'seo',
      options: { collapsible: true, collapsed: true },
      fields: [
        defineField({ name: 'google', type: 'string' }),
        defineField({ name: 'bing', type: 'string' }),
      ],
    }),

    /* --------------------- Motion & 3D defaults ------------------------- */
    defineField({
      name: 'motionDefaults',
      title: 'Motion & 3D defaults',
      type: 'object',
      group: 'motion',
      description:
        'Global kill-switches. These exist so you can dial the experience down from the Studio during a traffic spike or a client demo on bad hardware — no redeploy.',
      fields: [
        defineField({
          name: 'enableWebGL',
          title: 'Enable WebGL',
          type: 'boolean',
          initialValue: true,
          description: 'Off = every 3D scene renders its poster image instead. The nuclear option.',
        }),
        defineField({
          name: 'enablePostProcessing',
          title: 'Enable post-processing',
          type: 'boolean',
          initialValue: true,
          description: 'Bloom, chromatic aberration, grain. Roughly 25–35% of GPU frame time.',
        }),
        defineField({
          name: 'enableCustomCursor',
          title: 'Enable custom cursor',
          type: 'boolean',
          initialValue: true,
          description: 'Auto-disabled on touch devices regardless of this setting.',
        }),
        defineField({
          name: 'scrollLerp',
          title: 'Smooth-scroll easing',
          type: 'number',
          initialValue: 0.1,
          description:
            'Lenis lerp factor. 0.05 = very floaty, 0.2 = nearly native. Below ~0.06 users report the page feeling broken.',
          validation: (Rule) => Rule.min(0.02).max(0.5),
        }),
        defineField({
          name: 'shaderIntensity',
          title: 'Shader distortion intensity',
          type: 'number',
          initialValue: 1,
          description: 'Global multiplier on the fluid displacement amplitude. 0–2.',
          validation: (Rule) => Rule.min(0).max(2),
        }),
      ],
    }),

    /* --------------------------- Legal/misc ----------------------------- */
    defineField({
      name: 'footerNote',
      title: 'Footer note',
      type: 'string',
      group: 'identity',
      initialValue: 'Designed with intent.',
    }),
  ],

  preview: {
    prepare: () => ({ title: 'Site settings' }),
  },
});
