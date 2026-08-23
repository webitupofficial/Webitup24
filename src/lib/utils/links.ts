/**
 * =============================================================================
 * lib/utils/links.ts — resolving the polymorphic `link` object to an href
 * =============================================================================
 *
 * `schemas/objects/link.ts` models a link as a discriminated union on `kind`: internal
 * reference, external URL, on-page anchor, or email/phone. That is the right shape for an
 * editor — one field to choose, then only the relevant input — but it means every consumer
 * (header, footer, hero CTA, rich text, project card) needs the same four-branch resolution.
 *
 * This is that resolution, once. The alternative — resolving inside each component — produced
 * the exact bug this file exists to prevent on the previous build: three different components
 * each deciding independently whether `mailto:` needed a `target="_blank"`.
 *
 * -----------------------------------------------------------------------------
 * WHY IT TAKES THE *PROJECTED* SHAPE
 * -----------------------------------------------------------------------------
 * GROQ resolves the reference for us. `queries.ts` projects every link as:
 *
 *   { label, kind, anchor, href, contact, magnetic, internalSlug, internalType }
 *
 * — i.e. the reference is already dereferenced to a slug and a document type in the same
 * request. So this function is pure and synchronous, with no client left to call. Resolving
 * references at render time instead would mean one round trip per nav item.
 */

/** The document types `link.internal` can point at. */
export type LinkableType = 'project' | 'service' | 'page';

/**
 * A link as projected by `queries.ts`.
 *
 * Every field is optional and nullable: GROQ returns `null` for absent fields, an editor can
 * save a half-filled link (validation is a warning, not a lock), and a reference to a deleted
 * document projects `internalSlug` as `null` while `kind` still says `internal`.
 */
export interface LinkInput {
  label?: string | null;
  kind?: string | null;
  href?: string | null;
  anchor?: string | null;
  contact?: string | null;
  magnetic?: boolean | null;
  internalSlug?: string | null;
  internalType?: string | null;
}

export interface ResolvedLink {
  /** The `href` to render. Never empty — see `FALLBACK_HREF`. */
  href: string;
  label: string;
  /** True for `http(s)` URLs pointing off-site. Drives `target`/`rel`. */
  external: boolean;
  /** True for `#anchor` links, which are handled by Lenis rather than by the browser. */
  anchor: boolean;
  /** `mailto:` or `tel:`. Never gets `target="_blank"` — see the note in `resolveLink`. */
  contact: boolean;
  magnetic: boolean;
  /**
   * True when the link could not be resolved to a real target — a reference to a deleted
   * document, or a `kind` with its field left blank. The caller should render it as inert text
   * rather than as a link to nowhere.
   */
  broken: boolean;
}

/**
 * Route prefix per document type.
 *
 * Mirrors the `app/` directory: `app/(site)/work/[slug]`, `app/(site)/services/[slug]`, and
 * `app/(site)/[slug]` for generic pages. Kept as a lookup rather than a switch so adding a
 * document type is one line, and so the `page` → root-level mapping is visible as the empty
 * string it actually is.
 */
const ROUTE_PREFIX: Record<LinkableType, string> = {
  project: '/work',
  service: '/services',
  page: '',
};

/**
 * Where a link resolves to when it cannot be resolved.
 *
 * `'#'` and not `''`: an empty `href` on an `<a>` resolves to the *current page* per the URL
 * spec, so a broken nav item would silently reload the page — which reads as a mysterious flash
 * rather than as a broken link. `'#'` is inert. Callers should be checking `broken` and
 * rendering a `<span>`; this is the second line of defence.
 */
const FALLBACK_HREF = '#';

/**
 * Build the route for an internal reference.
 *
 * The `home` special case: a `page` whose slug is `home` lives at `/`, not `/home`. That
 * convention is what lets the home page be CMS-authored (`homePageQuery`) while still being the
 * site root, and without it every internal link to it would 404.
 */
function internalHref(type: string | null | undefined, slug: string | null | undefined): string | null {
  if (!slug) return null;

  if (type === 'page') {
    return slug === 'home' ? '/' : `/${slug}`;
  }

  if (type === 'project' || type === 'service') {
    return `${ROUTE_PREFIX[type]}/${slug}`;
  }

  // An unrecognised `_type` — a document type added to `link.to` in the schema but not here.
  // Returning null rather than guessing means it renders as inert text, which is visible in
  // review; guessing `/${slug}` would produce a plausible-looking 404 in production.
  return null;
}

/**
 * Turn an editor-entered email or phone number into a scheme URL.
 *
 * Detection is on `@` rather than on a full email regex: the field's only two possible contents
 * are an email address or a phone number, and no valid phone number contains `@`. A stricter
 * pattern would reject legitimate addresses and offers nothing here.
 *
 * Phone numbers are stripped to `+` and digits, because `tel:` ignores formatting characters but
 * some Android dialers mis-parse spaces and parentheses — while the *displayed* label keeps the
 * editor's formatting, which is the part a human reads.
 */
function contactHref(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  if (trimmed.includes('@')) return `mailto:${trimmed}`;

  const digits = trimmed.replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : null;
}

/**
 * Resolve a projected `link` object into everything a component needs to render it.
 *
 * Total: any input, including `null`, produces a `ResolvedLink`. A component should never have
 * to null-check before calling this, because the places links come from — a CMS array, an
 * optional `ctaLink` field — are exactly the places where `undefined` is normal.
 */
export function resolveLink(link: LinkInput | null | undefined): ResolvedLink {
  const label = link?.label?.trim() || 'Untitled';
  const magnetic = link?.magnetic === true;

  const base = { label, magnetic, external: false, anchor: false, contact: false };

  if (!link) return { ...base, href: FALLBACK_HREF, broken: true };

  switch (link.kind) {
    case 'external': {
      const href = link.href?.trim();
      if (!href) return { ...base, href: FALLBACK_HREF, broken: true };
      return { ...base, href, external: isExternal(href), broken: false };
    }

    case 'anchor': {
      // Tolerate an editor typing "#contact" despite the field description saying otherwise.
      const id = link.anchor?.trim().replace(/^#/, '');
      if (!id) return { ...base, href: FALLBACK_HREF, broken: true };
      return { ...base, href: `#${id}`, anchor: true, broken: false };
    }

    case 'contact': {
      const href = contactHref(link.contact);
      if (!href) return { ...base, href: FALLBACK_HREF, broken: true };
      /**
       * Deliberately never external, even though it leaves the page. `target="_blank"` on a
       * `mailto:` opens a blank tab that immediately becomes orphaned when the mail client takes
       * over — the user is left with an empty window they have to close. Same for `tel:`.
       */
      return { ...base, href, contact: true, broken: false };
    }

    case 'internal':
    default: {
      /**
       * `default` falls through to internal handling because `kind` has `initialValue:
       * 'internal'` in the schema, and documents created before the field existed have no `kind`
       * at all. Treating a missing discriminant as the default value is what keeps those
       * documents working rather than silently rendering as broken.
       */
      const href = internalHref(link.internalType, link.internalSlug);
      if (!href) return { ...base, href: FALLBACK_HREF, broken: true };
      return { ...base, href, broken: false };
    }
  }
}

/**
 * Is this href off-site?
 *
 * Protocol-relative (`//example.com`) counts: it is a real form that appears in pasted URLs and
 * it does leave the site. Anything that is not `http(s)` or protocol-relative — `mailto:`,
 * `tel:`, `#anchor`, `/path` — is not external, and must not get `target="_blank"`.
 */
export function isExternal(href: string): boolean {
  if (href.startsWith('//')) return true;
  if (!/^https?:\/\//i.test(href)) return false;

  /**
   * A link authored as an absolute URL to our own domain is internal. Editors paste full URLs
   * out of the address bar constantly, and treating those as external means the site opens
   * itself in a new tab — losing the client-side navigation and the scroll state with it.
   *
   * Compared against `NEXT_PUBLIC_SITE_URL` rather than `location.origin` so the answer is the
   * same on the server and the client. `URL` parsing rather than string matching, so
   * `https://webitup24.com.evil.test` is correctly external.
   */
  try {
    const target = new URL(href);
    const self = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://webitup24.com');
    return target.host !== self.host;
  } catch {
    // Unparseable. Treat as external: opening it in a new tab is the safer failure, because the
    // alternative is a client-side navigation to a malformed route.
    return true;
  }
}

/**
 * The `rel` value for an external link.
 *
 * `noopener` is the security-relevant one: without it the opened page gets a `window.opener`
 * handle back to ours and can navigate it (tabnabbing). Modern browsers imply `noopener` for
 * `target="_blank"`, but stating it covers older engines and makes the intent reviewable.
 *
 * `noreferrer` is included because these are client and press links, and not leaking which
 * internal page a visitor came from is the polite default. It is dropped for links we
 * deliberately want to attribute — pass `attribute: true`.
 */
export function externalRel(options: { attribute?: boolean } = {}): string {
  return options.attribute ? 'noopener' : 'noopener noreferrer';
}

/**
 * Props to spread on an `<a>` for a resolved link. Keeps `target`/`rel` decisions in one place
 * instead of at each of the dozen call sites.
 */
export function linkAttrs(resolved: ResolvedLink): {
  href: string;
  target?: '_blank';
  rel?: string;
} {
  if (!resolved.external) return { href: resolved.href };
  return { href: resolved.href, target: '_blank', rel: externalRel() };
}
