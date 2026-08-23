import 'server-only';

/**
 * Viewer token, server-only.
 *
 * `import 'server-only'` makes it a *build error* to pull this into a Client Component —
 * a guarantee that a lint rule can't give you. If you ever see this token in a browser
 * bundle, this import was removed.
 */
export const token = process.env.SANITY_API_READ_TOKEN;

if (!token) {
  // A warning rather than a throw: the public site renders fine without it. Only draft
  // mode, the Live Content API, and Presentation need a token.
  console.warn(
    '[sanity/token] SANITY_API_READ_TOKEN is not set. Draft mode and live preview will be disabled.'
  );
}

/** Narrowing helper for the draft-mode routes. */
export function requireToken(): string {
  if (!token) {
    throw new Error(
      '[sanity/token] SANITY_API_READ_TOKEN is required for draft mode. Add it to .env.local.'
    );
  }
  return token;
}
