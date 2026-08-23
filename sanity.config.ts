/**
 * sanity.config.ts — Studio configuration.
 *
 * Lives at the repo root (not under src/) because `sanity` CLI commands expect it there,
 * and because the embedded Studio route imports it directly.
 *
 * The Studio is served by Next at /studio via src/app/studio/[[...tool]]/page.tsx, so
 * there is one deployment, one auth session, and one set of env vars — rather than a
 * separate Studio host to keep in sync.
 */
import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { visionTool } from '@sanity/vision';
import { presentationTool } from 'sanity/presentation';
import { media } from 'sanity-plugin-media';

import { apiVersion, dataset, projectId } from '@/sanity/env';
import { schemaTypes } from '@/sanity/schemas';
import { structure } from '@/sanity/structure';

export default defineConfig({
  basePath: '/studio',
  projectId,
  dataset,
  title: 'WebItUp24 Studio',

  schema: {
    types: schemaTypes,
    /**
     * Hide the singleton from every "create new document" affordance in the UI. Combined
     * with `__experimental_actions` on the type itself and the pinned id in structure.ts,
     * there is no path to a second siteSettings document.
     */
    templates: (templates) => templates.filter(({ schemaType }) => schemaType !== 'siteSettings'),
  },

  plugins: [
    structureTool({ structure }),

    /**
     * Presentation: side-by-side live preview with click-to-edit.
     *
     * `previewUrl.previewMode` points at the route handler that sets the draft-mode cookie.
     * The stega content-source maps encoded by `defineLive` are what make arbitrary text on
     * the rendered page clickable — that pairing is the whole feature.
     */
    presentationTool({
      previewUrl: {
        // Omitted `origin` → same origin as the Studio. Since the Studio is embedded in
        // this Next app, that is always correct, including on Vercel preview deploys.
        previewMode: {
          enable: '/api/draft-mode/enable',
          disable: '/api/draft-mode/disable',
        },
      },
      resolve: {
        // Maps a document to the route(s) it appears on, so Presentation can jump straight
        // to the right URL when an editor opens a document.
        mainDocuments: [
          {
            route: '/work/:slug',
            filter: '_type == "project" && slug.current == $slug',
          },
          {
            route: '/services/:slug',
            filter: '_type == "service" && slug.current == $slug',
          },
          {
            route: '/:slug',
            filter: '_type == "page" && slug.current == $slug',
          },
        ],
      },
    }),

    // GROQ playground. Gated to non-production so it isn't shipped to a client's editors.
    ...(process.env.NODE_ENV === 'development' ? [visionTool({ defaultApiVersion: apiVersion })] : []),

    // Asset browser with tagging + alt-text enforcement. Optional but transformative once
    // the media library passes ~100 items.
    media(),
  ],

  document: {
    /**
     * Keep the singleton out of "recently edited" and the global new-document dialog.
     */
    actions: (actions, { schemaType }) =>
      schemaType === 'siteSettings'
        ? actions.filter(({ action }) => action !== 'duplicate' && action !== 'delete' && action !== 'unpublish')
        : actions,

    productionUrl: async (prev, { document }) => {
      const doc = document as { _type?: string; slug?: { current?: string } };
      const base = process.env.SANITY_STUDIO_PREVIEW_URL || 'http://localhost:3000';
      if (doc._type === 'project' && doc.slug?.current) return `${base}/work/${doc.slug.current}`;
      if (doc._type === 'service' && doc.slug?.current) return `${base}/services/${doc.slug.current}`;
      if (doc._type === 'page' && doc.slug?.current) return `${base}/${doc.slug.current}`;
      return prev;
    },
  },
});
