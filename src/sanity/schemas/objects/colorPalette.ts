import { defineField, defineType } from 'sanity';

/**
 * A single named colour token.
 *
 * We store a plain hex string rather than using `@sanity/color-input`, for two reasons:
 *   1. Zero extra Studio plugin to keep in sync across Sanity major versions.
 *   2. The value goes straight into a GLSL uniform and a CSS custom property. A hex
 *      string is the lowest-friction format for both; a Sanity colour object would need
 *      unwrapping in two places.
 *
 * The regex validation is what makes it safe to feed directly to `new THREE.Color()`.
 */
export const colorToken = defineType({
  name: 'colorToken',
  title: 'Colour token',
  type: 'object',
  fields: [
    defineField({
      name: 'name',
      title: 'Token name',
      type: 'string',
      description:
        'Semantic role, not the colour itself. Used as the CSS variable name: “accent” → var(--case-accent).',
      options: {
        list: [
          { title: 'Background', value: 'bg' },
          { title: 'Foreground / text', value: 'fg' },
          { title: 'Accent (primary)', value: 'accent' },
          { title: 'Accent (secondary)', value: 'accent2' },
          { title: 'Shader tint A', value: 'shaderA' },
          { title: 'Shader tint B', value: 'shaderB' },
          { title: 'Shader tint C', value: 'shaderC' },
        ],
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'hex',
      title: 'Hex value',
      type: 'string',
      description: 'Six-digit hex, with the hash. e.g. #C8FF3D',
      validation: (Rule) =>
        Rule.required().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
          name: 'hex colour',
          invert: false,
        }).error('Must be a 3- or 6-digit hex colour including the leading #.'),
    }),
  ],
  preview: {
    select: { name: 'name', hex: 'hex' },
    prepare({ name, hex }) {
      return { title: `${name ?? 'unnamed'}`, subtitle: hex ?? '—' };
    },
  },
});

/**
 * The palette attached to a project. Drives:
 *   • CSS custom properties on the case-study route (DOM layer)
 *   • `uColorA/B/C` uniforms on the fluid shader (WebGL layer)
 *
 * Both consume the same source of truth, which is the only way the 3D and the page ever
 * actually look like they belong to each other.
 */
export const colorPalette = defineType({
  name: 'colorPalette',
  title: 'Colour palette',
  type: 'object',
  options: { collapsible: true, collapsed: false },
  fields: [
    defineField({
      name: 'tokens',
      title: 'Tokens',
      type: 'array',
      of: [{ type: 'colorToken' }],
      description:
        'Add at minimum bg, fg and accent. The three shader tints fall back to accent shades if omitted.',
      validation: (Rule) =>
        Rule.max(7).custom((tokens: { name?: string }[] | undefined) => {
          if (!tokens) return true;
          const names = tokens.map((t) => t.name).filter(Boolean);
          const dupes = names.filter((n, i) => names.indexOf(n) !== i);
          return dupes.length ? `Duplicate token name: ${dupes.join(', ')}` : true;
        }),
    }),
    defineField({
      name: 'preferDark',
      title: 'Dark case-study shell',
      type: 'boolean',
      initialValue: true,
      description:
        'Off = light shell. Also flips the shader’s environment intensity and the cursor blend mode so the custom cursor stays visible.',
    }),
  ],
});
