import type { PaletteToken } from '@/components/canvas/registry';

/**
 * lib/utils/palette.ts
 *
 * The DOM-layer counterpart to `applyPaletteToScene` in `components/canvas/registry.ts`.
 *
 * A project's `colorPalette` has to reach two very different consumers:
 *
 *   • the WebGL layer, as `uColorA/B/C` — handled by `applyPaletteToScene`
 *   • the DOM layer, as CSS custom properties — handled here
 *
 * Both read the same authored tokens, which is the only reason a case study's page chrome and its
 * hero shader ever look like they were designed together.
 *
 * =============================================================================
 * WHY THIS RETURNS A STYLE OBJECT RATHER THAN WRITING TO `:root`
 * =============================================================================
 * The tempting implementation is an effect that sets custom properties on
 * `document.documentElement`. It has three problems, and the third is fatal:
 *
 *   1. It cannot run on the server, so the first paint uses the default palette and then swaps —
 *      a full-page colour flash on every case study.
 *   2. It is global, so it must be undone on unmount, and any overlap between an outgoing and an
 *      incoming route leaves whichever cleanup ran last in charge.
 *   3. `:root` is outside every React boundary, so two case studies open in a view transition (or
 *      a modal preview of one project over another) cannot both be correct.
 *
 * Returning a plain style object makes the palette *scoped* and *server-rendered*: a case-study
 * layout spreads it onto its own wrapper, the variables cascade to that subtree only, and they
 * disappear when the element does. No effect, no cleanup, no flash.
 *
 * `applyPaletteTokens` is kept for the one genuinely imperative case — the global shell, where
 * `siteSettings` colours need to reach `<html>` itself.
 *
 * =============================================================================
 * WHY BOTH HEX AND CHANNEL-TRIPLET FORMS
 * =============================================================================
 * `tailwind.config.ts` declares colours as `rgb(var(--c-acid) / <alpha-value>)`, which requires
 * the variable to hold `"200 255 61"` — bare channels, no `rgb()` wrapper — so that Tailwind's
 * opacity modifiers (`bg-acid/40`) work. But hand-written CSS, inline gradients and SVG fills all
 * want a normal colour string.
 *
 * Emitting both (`--case-accent` and `--case-accent-rgb`) costs a few bytes and removes an entire
 * category of "why is my colour `200 255 61` and not lime" bug.
 */

/* ---------------------------------------------------------------------------
 * Hex parsing
 * ------------------------------------------------------------------------- */

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Parse a 3- or 6-digit hex string into 0–255 channels.
 *
 * Returns null rather than throwing on bad input. Hex is validated in the Sanity schema, but
 * validated-at-write is not valid-at-read: datasets get imported, migrated and hand-edited, and a
 * throw here would take down a server-rendered page for one malformed colour.
 */
export function hexToRgb(hex: string): [number, number, number] | null {
  if (!HEX_RE.test(hex)) return null;

  const body = hex.slice(1);

  // Expand the shorthand form: #C83 → #CC8833. Doubling each digit is the spec's own definition,
  // not an approximation.
  const full =
    body.length === 3
      ? body
          .split('')
          .map((c) => c + c)
          .join('')
      : body;

  const value = Number.parseInt(full, 16);
  // `parseInt` on a hex-validated string cannot produce NaN, but the check costs nothing and makes
  // the non-null return type below honest rather than assumed.
  if (!Number.isFinite(value)) return null;

  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** `"#C8FF3D"` → `"200 255 61"`, the form Tailwind's `<alpha-value>` colours need. */
export function hexToChannels(hex: string): string | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgb.join(' ') : null;
}

/**
 * Relative luminance, per WCAG 2.x.
 *
 * The gamma expansion matters. Averaging the raw sRGB channels — which is what most "is this
 * colour dark?" helpers do — reports the acid lime and a mid grey as similarly bright, and then
 * puts white text on the lime where it fails contrast badly. Linearising first is the difference
 * between a heuristic and a correct answer.
 */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;

  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Pick a readable foreground for an authored background.
 *
 * The 0.36 threshold rather than the naive 0.5: a colour with luminance 0.4 has a contrast ratio
 * of about 5.4:1 against black and only 2.4:1 against white, so the crossover where white becomes
 * the better choice sits well below the midpoint. Editors pick accent colours without checking
 * contrast, and this is what stops a lime button from shipping with white text on it.
 */
export function readableOn(hex: string, dark = '#08080B', light = '#F4F1EA'): string {
  return luminance(hex) > 0.36 ? dark : light;
}

/* ---------------------------------------------------------------------------
 * Token → CSS variable mapping
 * ------------------------------------------------------------------------- */

/**
 * Which CSS variable each authored token drives.
 *
 * The `--case-*` names are fixed by the Studio: `colorToken`'s field description tells editors
 * that “accent” becomes `var(--case-accent)`. Renaming them here would make the Studio's own
 * documentation wrong, which is a worse outcome than a slightly awkward name.
 */
const TOKEN_VARS: Record<string, string> = {
  bg: '--case-bg',
  fg: '--case-fg',
  accent: '--case-accent',
  accent2: '--case-accent-2',
  shaderA: '--case-shader-a',
  shaderB: '--case-shader-b',
  shaderC: '--case-shader-c',
};

/**
 * Which *global* token each authored token additionally overrides.
 *
 * This is what makes a case study actually re-skin rather than just gaining three unused
 * variables. Note that `shaderA/B/C` are absent: they exist for the WebGL layer and overriding a
 * global DOM colour with a shader tint would tint the page with a colour never intended to be
 * read against.
 */
const GLOBAL_OVERRIDES: Record<string, string> = {
  bg: '--c-surface',
  fg: '--c-bone',
  accent: '--c-acid',
  accent2: '--c-violet',
};

export interface PaletteStyleOptions {
  /**
   * Also override the global `--c-*` tokens, re-skinning every Tailwind colour utility inside the
   * scope. Off by default: a section that only wants `--case-accent` for one border should not
   * silently repaint every `bg-surface` inside it.
   */
  overrideGlobals?: boolean;
  /** Emit `--case-fg-on-accent`, a readable foreground for the accent. */
  deriveContrast?: boolean;
}

/**
 * Build the custom-property declarations for a palette.
 *
 * Server-safe and synchronous. Spread the result into a `style` prop:
 *
 * ```tsx
 * <article style={paletteStyle(project.colorPalette?.tokens, { overrideGlobals: true })}>
 * ```
 *
 * Returns an empty object for an empty or absent palette, so the caller never needs a conditional.
 *
 * The `Record<string, string>` cast is required because `React.CSSProperties` has no index
 * signature for custom properties — React has always passed unknown `--*` keys straight through to
 * the DOM, but the type has never admitted it.
 */
export function paletteStyle(
  tokens: PaletteToken[] | null | undefined,
  options: PaletteStyleOptions = {}
): React.CSSProperties {
  const { overrideGlobals = false, deriveContrast = true } = options;
  const style: Record<string, string> = {};

  if (!tokens?.length) return style as React.CSSProperties;

  for (const token of tokens) {
    const name = token?.name;
    const hex = token?.hex;
    if (!name || !hex) continue;

    const channels = hexToChannels(hex);
    // A malformed hex is skipped entirely rather than partially applied. Emitting the hex form but
    // not the channel form would leave Tailwind utilities resolving to `rgb(undefined / 1)`, which
    // renders as transparent black — a much more confusing failure than the colour simply not
    // changing.
    if (!channels) continue;

    const varName = TOKEN_VARS[name];
    if (varName) {
      style[varName] = hex;
      style[`${varName}-rgb`] = channels;
    }

    if (overrideGlobals) {
      const globalVar = GLOBAL_OVERRIDES[name];
      // Global tokens are declared as channel triplets (see the file header), so the *channel*
      // form is what goes here — assigning the hex would break every `bg-x/50` in the subtree.
      if (globalVar) style[globalVar] = channels;
    }

    if (deriveContrast && name === 'accent') {
      style['--case-fg-on-accent'] = readableOn(hex);
    }
  }

  return style as React.CSSProperties;
}

/**
 * Imperative form, for the global shell.
 *
 * Prefer `paletteStyle`. This exists because `siteSettings` colours have to reach `<html>`, which
 * no React component owns, and because live preview needs to repaint the shell when an editor
 * changes a colour without remounting the tree.
 *
 * Returns a cleanup function that removes exactly the properties it set — not a snapshot-restore,
 * because two overlapping callers restoring each other's snapshots is how a palette gets stuck.
 * Removing only your own keys lets the cascade resolve the rest, which is what it is for.
 */
export function applyPaletteTokens(
  element: HTMLElement,
  tokens: PaletteToken[] | null | undefined,
  options: PaletteStyleOptions = {}
): () => void {
  const style = paletteStyle(tokens, options) as unknown as Record<string, string>;
  const applied: string[] = [];

  for (const [property, value] of Object.entries(style)) {
    element.style.setProperty(property, value);
    applied.push(property);
  }

  return () => {
    for (const property of applied) element.style.removeProperty(property);
  };
}

/**
 * Pull a single token's hex out of a palette.
 *
 * Used where a component needs one colour as a value rather than as a variable — an inline SVG
 * gradient stop, a `THREE.Color`, an OG-image generator running outside the DOM entirely.
 */
export function paletteValue(
  tokens: PaletteToken[] | null | undefined,
  name: string,
  fallback: string
): string {
  if (!tokens?.length) return fallback;
  const found = tokens.find((token) => token?.name === name);
  return found?.hex && HEX_RE.test(found.hex) ? found.hex : fallback;
}
