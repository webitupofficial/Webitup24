import { defineLive } from 'next-sanity';

import { client } from '@/sanity/lib/client';
import { token } from '@/sanity/lib/token';

/**
 * Live Content API bridge.
 *
 * `defineLive` gives us one fetcher with two behaviours, chosen per-request:
 *
 *   • Draft mode ON  → subscribes over the Live Content API. Edits in the Studio stream
 *                      into the running page with no refetch and no reload. Stega is
 *                      enabled so Presentation can map text back to fields.
 *   • Draft mode OFF → a plain cached fetch. Results land in Next's Data Cache and are
 *                      invalidated by tag via /api/revalidate. Zero runtime cost over a
 *                      static render.
 *
 * This is why `<SanityLive />` must be mounted in the site layout — it is the subscription
 * transport. Without it, draft mode silently degrades to a normal fetch.
 */
export const { sanityFetch, SanityLive } = defineLive({
  client,
  // Reads unpublished documents when draft mode is active.
  serverToken: token,
  // Authorises the browser-side live subscription. Same viewer token; it is only ever
  // sent to the client inside a draft-mode session.
  browserToken: token,
});
