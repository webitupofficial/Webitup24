import { defineField, defineType } from 'sanity';

/**
 * A 3D asset reference plus the render hints the canvas needs.
 *
 * The important design decision: the *file* and its *presentation* live together. A .glb
 * without a known scale/orientation is useless to the renderer, and asking a front-end dev
 * to hard-code `scale={0.014}` per project is exactly the coupling a CMS is supposed to
 * remove. Editors upload, nudge three numbers, and the scene is correct.
 */
export const model3d = defineType({
  name: 'model3d',
  title: '3D model',
  type: 'object',
  options: { collapsible: true, collapsed: false },
  fields: [
    defineField({
      name: 'asset',
      title: 'Model file (.glb)',
      type: 'file',
      options: {
        accept: '.glb,.gltf',
        storeOriginalFilename: true,
      },
      description:
        'Draco-compressed .glb with KTX2 textures. Run `npm run gltf:optimize` before uploading — an unoptimised export is typically 8–20× larger.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'poster',
      title: 'Poster image',
      type: 'image',
      options: { hotspot: true },
      description:
        'Rendered still, shown while the model streams in and used as the permanent fallback on low-power devices and when the visitor prefers reduced motion. Not optional — it is what a third of your traffic will actually see.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'scale',
      title: 'Uniform scale',
      type: 'number',
      initialValue: 1,
      description: 'Multiplier applied on load. Fix wildly-off export units here.',
      validation: (Rule) => Rule.positive(),
    }),
    defineField({
      name: 'rotationOffset',
      title: 'Rotation offset (degrees)',
      type: 'object',
      options: { columns: 3 },
      fields: [
        defineField({ name: 'x', type: 'number', initialValue: 0 }),
        defineField({ name: 'y', type: 'number', initialValue: 0 }),
        defineField({ name: 'z', type: 'number', initialValue: 0 }),
      ],
      description: 'Degrees, not radians. Converted on load.',
    }),
    defineField({
      name: 'autoRotate',
      title: 'Idle auto-rotation',
      type: 'boolean',
      initialValue: true,
      description: 'Slow Y-axis drift when the pointer is idle.',
    }),
    defineField({
      name: 'material',
      title: 'Material treatment',
      type: 'string',
      initialValue: 'original',
      options: {
        layout: 'radio',
        list: [
          { title: 'Keep original materials', value: 'original' },
          { title: 'Liquid metal (chrome, palette-tinted)', value: 'chrome' },
          { title: 'Frosted glass (transmission)', value: 'glass' },
          { title: 'Matte clay (single accent colour)', value: 'clay' },
          { title: 'Wireframe', value: 'wireframe' },
        ],
      },
      description:
        'Glass uses MeshTransmissionMaterial — it costs an extra render pass. The canvas automatically downgrades it to chrome on low-tier devices.',
    }),
    defineField({
      name: 'triangleBudget',
      title: 'Triangle count',
      type: 'number',
      readOnly: true,
      description:
        'Filled in by the asset pipeline. Over ~150k and mobile frame time suffers — decimate the source instead of shipping it.',
    }),
  ],
  preview: {
    select: { filename: 'asset.asset.originalFilename', media: 'poster', material: 'material' },
    prepare({ filename, media, material }) {
      return {
        title: filename ?? 'No file uploaded',
        subtitle: material ? `Material: ${material}` : undefined,
        media,
      };
    },
  },
});
