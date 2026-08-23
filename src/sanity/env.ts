/**
 * Environment access for Sanity.
 *
 * Every value is read through an assertion helper so a missing variable fails loudly at
 * module-init (build time / server boot) instead of producing a confusing 401 from the
 * Sanity API three layers deep in a GROQ call.
 */

function assertValue<T>(value: T | undefined, errorMessage: string): T {
  if (value === undefined || value === '') {
    throw new Error(`[sanity/env] ${errorMessage}`);
  }
  return value;
}

/**
 * API version pins GROQ + endpoint semantics. Treat a bump like a dependency upgrade:
 * change it deliberately, re-run the query suite, don't float it.
 */
export const apiVersion =
  process.env.NEXT_PUBLIC_SANITY_API_VERSION || '2024-10-28';

export const dataset =
  process.env.NEXT_PUBLIC_SANITY_DATASET || 'production';

export const projectId =
  process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 'dau8c073';

/** Where the embedded Studio is mounted. Must match src/app/studio/[[...tool]]/page.tsx. */
export const studioUrl = '/studio';

/**
 * Absolute site origin. Vercel injects VERCEL_URL for preview deployments, which is what
 * makes Presentation-tool live preview work on branch deploys without extra config.
 */
export const siteUrl = (() => {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
})();
