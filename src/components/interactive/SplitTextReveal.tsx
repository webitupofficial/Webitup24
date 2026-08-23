'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

import { DURATION, EASE, REVEAL_TRIGGER, STAGGER, ScrollTrigger, gsap } from '@/lib/gsap';
import { useUIStore } from '@/lib/store/useUIStore';
import { cn } from '@/lib/utils/cn';

/**
 * =============================================================================
 * SplitTextReveal — deliverable #5, part 3: "split-text staggered reveals for headlines"
 * =============================================================================
 *
 * Splits a headline into lines, words or characters and reveals them on a staggered
 * ScrollTrigger.
 *
 * -----------------------------------------------------------------------------
 * WHY A CUSTOM SPLITTER RATHER THAN GSAP SplitText
 * -----------------------------------------------------------------------------
 * SplitText is a Club GreenSock plugin — it requires a paid membership and a private npm
 * registry token in CI, which is a real deployment constraint to hand a client. The splitting
 * itself is a screenful of DOM work; the plugin's value is in edge cases (nested markup, RTL,
 * emoji grapheme clusters) that this component sidesteps by accepting a plain string.
 *
 * -----------------------------------------------------------------------------
 * WHY `children` IS TYPED AS `string`
 * -----------------------------------------------------------------------------
 * Deliberate, and the single most important design decision here. Splitting arbitrary React
 * children means walking the rendered DOM with a TreeWalker, splitting text nodes in place, and
 * — for line mode — reconstructing each inline ancestor chain inside every line wrapper so that
 * an `<em>` spanning a line break survives. That is where custom splitters go wrong, silently,
 * on the one headline that happens to have a link in it.
 *
 * A string cannot go wrong: the DOM is built from scratch, `textContent` at a time. Rich text
 * belongs in `PortableTextRenderer`, which is not trying to animate per-character.
 *
 * `\n` in the string is honoured as a hard line break, which covers the actual reason people
 * reach for markup in a headline.
 *
 * -----------------------------------------------------------------------------
 * SSR, SEO AND THE NO-FLASH REQUIREMENT
 * -----------------------------------------------------------------------------
 * The server renders the plain string inside the chosen tag — one text node, fully crawlable,
 * fully readable with JavaScript disabled or broken. The split happens in a *layout* effect, so
 * the DOM is restructured and the hidden state is applied in the same commit, before the browser
 * paints. The user never sees unsplit-then-hidden text, which is the flash that makes most
 * split-text implementations look broken on a slow connection.
 *
 * -----------------------------------------------------------------------------
 * WEBFONTS AND LINE MEASUREMENT
 * -----------------------------------------------------------------------------
 * Line mode groups words by their measured vertical position, so it is only correct once the
 * webfont that determines those line breaks has loaded. Measuring against the fallback font
 * produces lines that break in the wrong places and then never correct themselves.
 *
 * Rather than delay the split until `document.fonts.ready` (which reintroduces the flash), it
 * splits immediately and re-splits once fonts settle. The reveal is scroll-triggered, so in
 * practice the correction lands long before anything is visible.
 */

/* ---------------------------------------------------------------------------
 * Batched ScrollTrigger refresh
 * ------------------------------------------------------------------------- */

/**
 * Splitting changes document height slightly — line wrappers are block-level, and half-leading
 * does not always sum to exactly the original height. Every ScrollTrigger on the page therefore
 * has stale start/end positions afterwards.
 *
 * `ScrollTrigger.refresh()` recalculates *all* of them, so a page with eight headlines each
 * calling it directly would do eight full recalculations during load. Module-scoped debounce means
 * one, after the last split settles.
 */
let refreshTimer: number | null = null;

function scheduleRefresh(): void {
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    ScrollTrigger.refresh();
  }, 120);
}

/* ---------------------------------------------------------------------------
 * Splitting
 * ------------------------------------------------------------------------- */

type SplitMode = 'lines' | 'words' | 'chars';

/** A word, or an explicit break from a `\n`. */
type Token = { kind: 'word'; value: string } | { kind: 'break' };

/**
 * Tokenise. Collapses runs of spaces and tabs (as HTML would) but keeps `\n` as a hard break.
 *
 * Note the filter drops empty strings, which `split` produces at both ends of the input and
 * around consecutive separators. Without it, empty word spans get created and the stagger has
 * invisible gaps in it — a genuinely baffling bug to look at.
 */
function tokenise(text: string): Token[] {
  const tokens: Token[] = [];

  for (const [i, block] of text.split('\n').entries()) {
    if (i > 0) tokens.push({ kind: 'break' });
    for (const word of block.split(/[ \t]+/)) {
      if (word.length > 0) tokens.push({ kind: 'word', value: word });
    }
  }

  return tokens;
}

/**
 * Create a word element.
 *
 * `inline-block` because a split word must be transformable, and `transform` has no effect on a
 * non-replaced inline element. `whitespace-pre` so a word containing a non-breaking space or an
 * en-dash is not re-wrapped by the browser.
 *
 * Content is set with `textContent`, never `innerHTML`. This text comes from Sanity, and a
 * headline is exactly the sort of field an editor might paste HTML into. `textContent` makes that
 * inert by construction rather than by sanitisation.
 */
function makeWord(value: string, className: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.style.display = 'inline-block';
  el.textContent = value;
  return el;
}

/** Wrap an element in an overflow-hidden mask, returning the mask. */
function mask(child: HTMLElement, block: boolean): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'mask-line';
  // `.mask-line` is `display: block`. Word masks must be inline-block instead, or every word
  // becomes its own line — which is a very fast way to destroy a headline's layout.
  if (!block) el.style.display = 'inline-block';
  // Masks clip the reveal, so they must not clip descenders or diacritics of the settled text.
  // A little vertical breathing room, negated by an equal margin so layout is unchanged.
  el.style.paddingBottom = '0.12em';
  el.style.marginBottom = '-0.12em';
  el.appendChild(child);
  return el;
}

/**
 * Build the split DOM and return the elements to animate.
 *
 * The root's existing content is replaced wholesale — safe because the SSR content is a single
 * text node reproducible from `text`, which is what `restore` relies on.
 */
function buildSplit(root: HTMLElement, text: string, mode: SplitMode): HTMLElement[] {
  const tokens = tokenise(text);
  root.textContent = '';

  /* ------------------------------------------------------------------
   * chars
   * ------------------------------------------------------------------
   * Per-character spans break screen-reader pronunciation — VoiceOver reads "W-e b-u-i-l-d" —
   * so the visual copy is hidden from the accessibility tree and an `sr-only` copy carries the
   * text. This is the only mode that needs the duplicate: word and line spans preserve real
   * whitespace between them and are announced normally.
   *
   * `Array.from(word)` rather than `word.split('')`: `split('')` cuts surrogate pairs in half, so
   * any character outside the BMP (an emoji, a mathematical alphanumeric) becomes two broken code
   * units and renders as replacement glyphs. `Array.from` iterates code points.
   */
  if (mode === 'chars') {
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = text;
    root.appendChild(sr);

    const visual = document.createElement('span');
    visual.setAttribute('aria-hidden', 'true');
    root.appendChild(visual);

    const chars: HTMLElement[] = [];

    tokens.forEach((token, i) => {
      if (token.kind === 'break') {
        visual.appendChild(document.createElement('br'));
        return;
      }

      // A word wrapper keeps characters from being broken across lines mid-word.
      const wordEl = makeWord('', 'split-word');
      for (const ch of Array.from(token.value)) {
        const charEl = makeWord(ch, 'split-char');
        wordEl.appendChild(charEl);
        chars.push(charEl);
      }
      visual.appendChild(wordEl);

      const next = tokens[i + 1];
      if (next && next.kind === 'word') visual.appendChild(document.createTextNode(' '));
    });

    return chars;
  }

  /* ------------------------------------------------------------------
   * words
   * ---------------------------------------------------------------- */
  if (mode === 'words') {
    const words: HTMLElement[] = [];

    tokens.forEach((token, i) => {
      if (token.kind === 'break') {
        root.appendChild(document.createElement('br'));
        return;
      }

      const wordEl = makeWord(token.value, 'split-word');
      root.appendChild(mask(wordEl, false));
      words.push(wordEl);

      const next = tokens[i + 1];
      if (next && next.kind === 'word') root.appendChild(document.createTextNode(' '));
    });

    return words;
  }

  /* ------------------------------------------------------------------
   * lines — two passes
   * ------------------------------------------------------------------
   * Pass 1 lays out bare word spans and measures them. Pass 2 rebuilds from the *token* list
   * using the measured grouping, so the final DOM is constructed cleanly rather than by moving
   * nodes around — no orphaned whitespace, no partially-reparented masks.
   */
  const probes: HTMLElement[] = [];

  tokens.forEach((token, i) => {
    if (token.kind === 'break') {
      root.appendChild(document.createElement('br'));
      return;
    }
    const wordEl = makeWord(token.value, 'split-word');
    root.appendChild(wordEl);
    probes.push(wordEl);
    const next = tokens[i + 1];
    if (next && next.kind === 'word') root.appendChild(document.createTextNode(' '));
  });

  /**
   * One batched read of every probe.
   *
   * Reading all rects before writing anything means a single forced layout instead of one per
   * word. Interleaving reads and writes here is the textbook layout-thrash pattern and on a long
   * headline it is measurable.
   *
   * `getBoundingClientRect().top` rather than `offsetTop`: viewport-relative, so it is consistent
   * regardless of what the nearest positioned ancestor happens to be.
   */
  const tops = probes.map((el) => el.getBoundingClientRect().top);

  /**
   * Group into lines. A 2px tolerance absorbs subpixel differences between words on the same
   * line — superscripts, differing glyph bounding boxes, and fractional device pixel ratios all
   * produce tops that differ slightly within one visual line.
   */
  const groups: string[][] = [];
  let current: string[] = [];
  let lineTop = Number.NaN;
  let probeIndex = 0;

  for (const token of tokens) {
    if (token.kind === 'break') {
      // A hard break always starts a new line, regardless of measurement.
      if (current.length > 0) groups.push(current);
      current = [];
      lineTop = Number.NaN;
      continue;
    }

    const top = tops[probeIndex] ?? 0;
    probeIndex += 1;

    if (Number.isNaN(lineTop) || Math.abs(top - lineTop) <= 2) {
      if (Number.isNaN(lineTop)) lineTop = top;
    } else {
      groups.push(current);
      current = [];
      lineTop = top;
    }

    current.push(token.value);
  }
  if (current.length > 0) groups.push(current);

  // Pass 2.
  root.textContent = '';
  const lines: HTMLElement[] = [];

  for (const group of groups) {
    const lineEl = document.createElement('span');
    lineEl.className = 'split-line';
    lineEl.style.display = 'block';
    lineEl.textContent = group.join(' ');
    root.appendChild(mask(lineEl, true));
    lines.push(lineEl);
  }

  return lines;
}

/** Undo a split. The SSR content is one text node, so this reproduces it exactly. */
function restore(root: HTMLElement, text: string): void {
  root.textContent = text;
}

/* ---------------------------------------------------------------------------
 * From-states
 * ------------------------------------------------------------------------- */

/**
 * The hidden state per mode, and the stagger that suits it.
 *
 * Masked modes (`lines`, `words`) move by percentage of their own height and do NOT fade: the
 * mask already hides them completely, and adding opacity makes the element visible *through* the
 * mask edge during the first frames, which reads as a smudge rather than a reveal.
 *
 * `chars` is unmasked — masking every character means an inline-block per character per mask,
 * which doubles the element count and makes kerning impossible — so it fades and rotates instead.
 * The rotation is around the character's own bottom edge, so the line reads as tipping upright.
 */
/**
 * GSAP tween variables, structurally.
 *
 * Not `gsap.TweenVars`. That type lives in a namespace which is only reliably in scope when
 * nothing local shadows the name `gsap` — and this module imports a binding called exactly that
 * from `@/lib/gsap`, so the namespace lookup depends on whether a re-export preserves the
 * namespace meaning of the symbol. `TweenVars` declares `[key: string]: any`, so a plain record is
 * assignable to it and the ambiguity disappears.
 */
type TweenVars = Record<string, number | string>;

const FROM_STATE: Record<SplitMode, TweenVars> = {
  lines: { yPercent: 108 },
  words: { yPercent: 112 },
  chars: {
    yPercent: 45,
    opacity: 0,
    rotateX: -62,
    transformPerspective: 800,
    transformOrigin: '50% 100%',
  },
};

const TO_STATE: Record<SplitMode, TweenVars> = {
  lines: { yPercent: 0 },
  words: { yPercent: 0 },
  chars: { yPercent: 0, opacity: 1, rotateX: 0 },
};

/* ---------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------- */

/** `useLayoutEffect` warns when it runs on the server; this is the standard shim. */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

type SplitTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span' | 'div';

export interface SplitTextRevealProps {
  /** The headline. Plain string by design — see the note in the file header. `\n` breaks lines. */
  children: string;
  /** Element to render. Pick by document outline, not by size — size is a class. */
  as?: SplitTag;
  /**
   * DOM id on the rendered element. Set this when a section labels itself with
   * `aria-labelledby` — the split rebuilds the element's *children*, never the element itself, so
   * an id placed here survives every re-split and resize.
   */
  id?: string;
  /** Granularity of the reveal. */
  mode?: SplitMode;
  className?: string;
  /** Delay before the first element moves, in seconds. */
  delay?: number;
  /** Per-element stagger. Defaults to the house value for the mode. */
  stagger?: number;
  /** Stagger origin. `'center'` and `'random'` suit large display type; `'start'` reads fastest. */
  staggerFrom?: 'start' | 'center' | 'end' | 'random';
  /** ScrollTrigger `start`. Defaults to the shared reveal window. */
  start?: string;
  /**
   * Reveal on mount rather than on scroll. For above-the-fold headlines, which are already in
   * view when the trigger would be evaluated — a scroll trigger on them fires instantly anyway,
   * but going through ScrollTrigger means the animation cannot be sequenced against the intro.
   */
  immediate?: boolean;
  /**
   * Hold the reveal until the preloader hands off. Only meaningful with `immediate`, and only
   * correct for the hero: gating a below-the-fold headline on the intro means it may already have
   * been scrolled past by the time it is allowed to animate.
   */
  waitForIntro?: boolean;
  /** Called once the reveal finishes. For chaining a hero's supporting copy. */
  onRevealed?: () => void;
}

export function SplitTextReveal({
  children,
  as: Tag = 'h2',
  id,
  mode = 'lines',
  className,
  delay = 0,
  stagger,
  staggerFrom = 'start',
  start = REVEAL_TRIGGER.start,
  immediate = false,
  waitForIntro = false,
  onRevealed,
}: SplitTextRevealProps) {
  const rootRef = useRef<HTMLElement>(null);

  const motion = useUIStore((s) => s.motion);
  const introComplete = useUIStore((s) => s.introComplete);

  /**
   * `onRevealed` in a ref.
   *
   * An inline arrow function from the parent changes identity every render. In the dependency
   * array it would tear down and rebuild the entire split on any unrelated parent re-render;
   * omitted from the array it would go stale. A ref is the standard resolution.
   */
  const onRevealedRef = useRef(onRevealed);
  onRevealedRef.current = onRevealed;

  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    /* ----------------------------------------------------------------
     * motion: 'none' — no split, no animation, nothing to clean up.
     *
     * The text is already rendered by the server, so the reduced-motion path is simply "do
     * nothing", which is both the correct behaviour and the cheapest possible implementation.
     * -------------------------------------------------------------- */
    if (motion === 'none') return;

    /* ----------------------------------------------------------------
     * motion: 'lite' — one fade on the whole element.
     *
     * Splitting is skipped entirely rather than animated more gently. A user who asked for
     * reduced motion does not benefit from 40 staggered elements moving 4px each, and skipping
     * the split also skips the DOM churn and the forced layout, which is the other half of what
     * 'lite' is for (low-end devices).
     * -------------------------------------------------------------- */
    if (motion === 'lite') {
      const ctx = gsap.context(() => {
        gsap.set(root, { opacity: 0 });
        gsap.to(root, {
          opacity: 1,
          duration: DURATION.base,
          delay,
          ease: EASE.out,
          onComplete: () => onRevealedRef.current?.(),
          ...(immediate ? {} : { scrollTrigger: { trigger: root, start, once: true } }),
        });
      }, root);

      return () => ctx.revert();
    }

    /* ----------------------------------------------------------------
     * motion: 'full'
     * -------------------------------------------------------------- */
    // `ReturnType<typeof gsap.context>` rather than `gsap.Context`, for the same reason as
    // `TweenVars` above — derived from the value, so it needs no namespace in scope.
    let ctx: ReturnType<typeof gsap.context> | null = null;
    let cancelled = false;
    let resizeTimer: number | null = null;
    let observer: ResizeObserver | null = null;
    let lastWidth = root.getBoundingClientRect().width;

    const build = () => {
      // Revert before restructuring: the context holds references to elements that are about to
      // be discarded, and reverting afterwards would write inline styles onto detached nodes and
      // leave the *new* elements with whatever the tween last set.
      ctx?.revert();
      ctx = null;
      restore(root, children);

      const targets = buildSplit(root, children, mode);
      if (targets.length === 0) return;

      const each = stagger ?? STAGGER[mode];

      ctx = gsap.context(() => {
        gsap.set(targets, FROM_STATE[mode]);

        /**
         * A gate that is not the ScrollTrigger.
         *
         * When `waitForIntro` is set and the intro has not finished, the elements are left in
         * their hidden state and no tween is created. `introComplete` is in this effect's
         * dependency list, so the flip re-runs the effect and the tween is created then. That is
         * simpler and more robust than creating a paused timeline and holding a reference to it
         * across renders.
         */
        if (waitForIntro && !introComplete) return;

        gsap.to(targets, {
          ...TO_STATE[mode],
          duration: DURATION.reveal,
          delay,
          ease: EASE.out,
          stagger: { each, from: staggerFrom },
          /**
           * `clearProps` on completion.
           *
           * GSAP leaves an inline `transform` behind, which keeps the element on its own
           * compositor layer and — more importantly for a headline — makes the text render
           * through the layer's own rasterisation rather than the page's, which on some
           * Windows/Chrome combinations subtly changes subpixel antialiasing. Clearing it once
           * the reveal is done restores normal text rendering.
           */
          onComplete: () => {
            gsap.set(targets, { clearProps: 'transform,opacity' });
            onRevealedRef.current?.();
          },
          ...(immediate ? {} : { scrollTrigger: { trigger: root, start, once: true } }),
        });
      }, root);

      scheduleRefresh();
    };

    build();

    /* ----------------------------------------------------------------
     * Re-split when the measurement premises change. Line mode only — word and character
     * grouping does not depend on layout, so re-splitting them on resize would be pure cost.
     * -------------------------------------------------------------- */
    if (mode === 'lines') {
      /**
       * Correct the grouping once webfonts land. See the file header.
       *
       * The `status` check avoids a pointless rebuild on a warm cache, where fonts are already
       * loaded before the first effect runs — which is the common case and the one where a
       * rebuild is most visible.
       */
      if (document.fonts && document.fonts.status !== 'loaded') {
        document.fonts.ready.then(() => {
          if (!cancelled) build();
        });
      }

      observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;

        /**
         * Width only.
         *
         * Splitting changes the element's *height* (block-level line masks with padding). An
         * observer that reacted to height would rebuild, which changes the height, which fires
         * the observer — an infinite loop that pins a core at 100%. Comparing width is the guard,
         * and it is also the only dimension that can change line breaks.
         */
        const width = entry.contentRect.width;
        if (Math.abs(width - lastWidth) < 1) return;
        lastWidth = width;

        if (resizeTimer !== null) window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          resizeTimer = null;
          if (!cancelled) build();
        }, 180);
      });

      observer.observe(root);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      ctx?.revert();
      // Put the plain text back. Without this, a route transition can leave a detached-but-cached
      // subtree of split spans, and — on a back navigation that restores scroll — a headline that
      // is permanently mid-reveal.
      restore(root, children);
    };
  }, [
    children,
    mode,
    motion,
    introComplete,
    delay,
    stagger,
    staggerFrom,
    start,
    immediate,
    waitForIntro,
  ]);

  return (
    <Tag
      id={id}
      /**
       * One ref for every possible tag. `SplitTag` is a union of intrinsic elements whose
       * instance types differ (`HTMLHeadingElement`, `HTMLParagraphElement`, …), and there is no
       * ref type that satisfies all of them without a cast. `HTMLElement` is the honest common
       * supertype — nothing in this component touches a tag-specific member.
       */
      ref={rootRef as React.RefObject<HTMLHeadingElement>}
      /**
       * `.gpu` is deliberately absent. GSAP's `force3D: 'auto'` promotes each target for the
       * duration of its tween and demotes it after, which is what we want: a headline with 60
       * character spans permanently on 60 compositor layers costs real memory for an animation
       * that runs once.
       */
      className={cn('block', className)}
    >
      {children}
    </Tag>
  );
}
