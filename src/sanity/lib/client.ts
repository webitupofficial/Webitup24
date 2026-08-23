import { createClient } from 'next-sanity';

import { apiVersion, dataset, projectId, studioUrl } from '@/sanity/env';

/**
 * The one client instance. Safe to import from Server Components, Route Handlers, and
 * (read-only, unauthenticated) Client Components.
 */
export const client = createClient({
  projectId,
  dataset,
  apiVersion,

  /**
   * `useCdn: false` looks wrong but is correct here.
   *
   * We fetch exclusively from Server Components wrapped in Next's Data Cache with tag-based
   * invalidation (see lib/live.ts + api/revalidate). Next's cache is *already* our CDN, and
   * it is strongly consistent with our webhooks. Layering Sanity's eventually-consistent
   * API CDN underneath adds up to 60s of staleness that our revalidation webhook cannot
   * clear — you'd publish in the Studio, the webhook would fire, Next would refetch, and
   * still get the old document.
   */
  useCdn: false,

  perspective: 'published',

  stega: {
    /**
     * Steganographic content-source maps. Encodes an invisible pointer to the originating
     * Sanity field into every string we render, which is what lets the Presentation tool
     * turn arbitrary text on the page into a click-to-edit target.
     *
     * Enabled only when draft mode is on — `defineLive` in lib/live.ts flips this per
     * request. Leaving it on in production would bloat every string with zero-width chars.
     */
    enabled: false,
    studioUrl,
  },
});

/**
 * Write-capable client for form submissions (contact enquiries).
 * Requires an Editor-scoped token — deliberately a separate variable from the read token
 * so the read token can stay Viewer-scoped.
 */
export function getWriteClient() {
  const writeToken = process.env.SANITY_API_WRITE_TOKEN;
  if (!writeToken) {
    throw new Error('[sanity/client] SANITY_API_WRITE_TOKEN is required for mutations.');
  }
  return client.withConfig({ token: writeToken, useCdn: false });
}
