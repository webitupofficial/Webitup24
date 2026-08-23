'use client';

import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef } from 'react';

import type { AnchorClickHandler, HeaderNavItem, SocialLink } from './Header';
import { ArrowUpRight, MagneticButton } from '@/components/interactive/MagneticButton';
import { useUIStore } from '@/lib/store/useUIStore';
import { cn } from '@/lib/utils/cn';
import { linkAttrs, resolveLink, type LinkInput } from '@/lib/utils/links';

/**
 * =============================================================================
 * MobileMenu — the full-screen navigation overlay.
 * =============================================================================
 *
 * Present at every breakpoint, not just below `lg`. On a large display it carries the contact
 * details, the socials and the CTA alongside the nav, which a horizontal header bar cannot — so the
 * inline desktop nav is the shortcut and this is the complete route.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS IS HAND-BUILT AND NOT A RADIX DIALOG
 * -----------------------------------------------------------------------------
 * `@radix-ui/react-dialog` is in the dependency tree and is the right answer for most modals. It is
 * the wrong answer here for one specific, concrete reason: its scroll lock is `react-remove-scroll`,
 * which sets `overflow: hidden` on `<body>` and compensates for the vanished scrollbar by adding
 * `padding-right` to `<body>`.
 *
 * On this layout that compensation is visible. The header and the WebGL canvas are `position:
 * fixed`, so body padding does not move them, while the content does move — the layers come apart
 * for a frame every time the menu opens. And with Lenis running, `overflow: hidden` on the scroll
 * container is not how you stop scrolling anyway: `lenis.stop()` is, and the two mechanisms
 * disagree about what the scroll position is when the menu closes.
 *
 * So the four things Radix would give us are implemented explicitly below, each with its own note:
 * scroll lock, focus containment, focus restoration, and Escape-to-close. That is roughly 80 lines,
 * all of it visible, rather than a dependency whose lock strategy we would have to fight.
 *
 * -----------------------------------------------------------------------------
 * WHY FRAMER MOTION HERE AND GSAP EVERYWHERE ELSE
 * -----------------------------------------------------------------------------
 * This is an enter/exit animation on a conditionally-mounted subtree, which is the one thing GSAP
 * genuinely cannot do cleanly in React: the element has to still be in the DOM while it animates
 * out, so something has to defer the unmount. `AnimatePresence` is that something. GSAP owns
 * everything scroll-linked, where its ScrollTrigger integration is unmatched; Framer owns
 * mount/unmount, where its `AnimatePresence` is.
 */

export interface MobileMenuProps {
  nav?: HeaderNavItem[] | null;
  secondaryNav?: HeaderNavItem[] | null;
  cta?: LinkInput | null;
  email?: string | null;
  socials?: SocialLink[] | null;
  availability?: { isAvailable?: boolean | null; label?: string | null } | null;
  onAnchorClick: AnchorClickHandler;
}

/** Everything focusable, for the Tab containment loop. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function MobileMenu({
  nav,
  secondaryNav,
  cta,
  email,
  socials,
  availability,
  onAnchorClick,
}: MobileMenuProps) {
  const open = useUIStore((s) => s.menuOpen);
  const setMenuOpen = useUIStore((s) => s.setMenuOpen);
  const motionLevel = useUIStore((s) => s.motion);

  const panelRef = useRef<HTMLDivElement>(null);
  /** The element focus came from, so it can be handed back on close. */
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => setMenuOpen(false), [setMenuOpen]);

  /* ------------------------------------------------------------------------
   * Scroll lock — deliberately NOT here.
   *
   * `SmoothScrollProvider` already locks scrolling centrally, keyed on the same `menuOpen` store
   * value this component reads: `lenis.stop()` on the smooth path, `document.body` overflow on the
   * reduced-motion path. Duplicating it here — on a different element, with a second cleanup — is
   * how the two managers end up disagreeing about the scroll position on close. One owner only.
   * ---------------------------------------------------------------------- */

  /* ------------------------------------------------------------------------
   * Focus management
   * ---------------------------------------------------------------------- */
  useEffect(() => {
    if (!open) return;

    // Remember where focus was, so it can be restored to the trigger rather than to <body>.
    // Returning focus to <body> would drop a keyboard user back at the top of the document.
    returnFocusRef.current = document.activeElement as HTMLElement | null;

    /**
     * Move focus into the panel on the next frame.
     *
     * Not synchronously: `AnimatePresence` mounts the panel in the same commit this effect runs in,
     * but the element is still at its initial transform. Focusing an element that is translated
     * off-screen makes some browsers scroll to reveal it, which fights the animation. One frame
     * later it is in place.
     */
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      // Fall back to the panel itself (it carries `tabIndex={-1}`) so focus is at least inside the
      // dialog — a modal with focus left outside it is announced as if it were not open at all.
      (first ?? panel).focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }

      if (event.key !== 'Tab') return;

      /* --- Tab containment ------------------------------------------------
       * The page behind is still in the tab order as far as the browser is concerned. Rather than
       * marking every sibling `inert` (which means reaching outside this component to mutate the
       * DOM it does not own), Tab is wrapped at the panel's boundaries: the last element's Tab goes
       * to the first, and the first element's Shift+Tab goes to the last.
       * ------------------------------------------------------------------ */
      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        // `offsetParent === null` catches `display: none` and detached elements. Needed because the
        // panel contains links that are hidden at some breakpoints, and tabbing to an invisible
        // element is the "focus disappeared" bug.
        (el) => el.offsetParent !== null || el === panel
      );

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // Explicit guards rather than `!`: `noUncheckedIndexedAccess` is on, and an empty-array
      // narrowing that TypeScript cannot see is exactly what it is there to catch.
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown);

      /**
       * Restore focus. Guarded on the element still being in the document: a link inside the menu
       * may have navigated, in which case React has replaced the page and the remembered node is
       * detached — calling `focus()` on it silently does nothing but the `isConnected` check makes
       * the intent explicit.
       */
      const target = returnFocusRef.current;
      if (target?.isConnected) target.focus();
    };
  }, [open, close]);

  /* ------------------------------------------------------------------------
   * Animation
   * ---------------------------------------------------------------------- */

  /**
   * Under `motion: 'none'` the panel appears and disappears with no transition at all. Note this is
   * a duration of 0 rather than a removal of the variants: keeping the same shape means there is
   * one code path to reason about, and `AnimatePresence` still coordinates the unmount correctly.
   */
  const reduced = motionLevel === 'none';
  const panelDuration = reduced ? 0 : 0.7;
  const itemStagger = reduced ? 0 : 0.055;

  const navItems = (nav ?? []).map((item, index) => ({
    key: item._key ?? `menu-${index}`,
    resolved: resolveLink(item),
  }));

  const secondaryItems = (secondaryNav ?? []).map((item, index) => ({
    key: item._key ?? `menu-secondary-${index}`,
    resolved: resolveLink(item),
  }));

  const resolvedCta = cta ? resolveLink(cta) : null;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          id="site-menu"
          ref={panelRef}
          /**
           * `role="dialog"` + `aria-modal` + a label. Without `aria-modal` a screen reader keeps
           * announcing the page behind as if it were still available, which — given Tab is trapped
           * — is a contradiction the user has no way to resolve.
           */
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
          // Focusable as a last resort, so focus is never left outside an open modal.
          tabIndex={-1}
          className={cn(
            'fixed inset-0 z-overlay flex flex-col overflow-y-auto overscroll-contain',
            /**
             * Near-opaque rather than fully opaque, with a heavy blur: the WebGL canvas stays
             * faintly visible behind the menu, which keeps the overlay feeling like a layer of this
             * site rather than a separate screen. `bg-ink` (not `bg-surface`) because the menu
             * should read as *deeper* than the page it covers.
             */
            'bg-ink/95 backdrop-blur-2xl',
            'focus:outline-none'
          )}
          initial={{ y: '-100%' }}
          animate={{ y: 0 }}
          exit={{ y: '-100%' }}
          transition={{
            duration: panelDuration,
            // The house entrance curve, as a cubic-bezier array — Framer does not take GSAP's
            // named eases, so this is `expo.out`'s equivalent and matches `ease-expo` in Tailwind.
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          {/**
           * Spacer matching the header height, so the menu's content starts below the wordmark and
           * the close button rather than underneath them. Using the same variable as the header
           * means the two cannot drift apart.
           */}
          <div className="h-[var(--header-h)] shrink-0" aria-hidden="true" />

          <div className="shell flex flex-1 flex-col justify-between gap-16 pb-16 pt-8">
            {/* -----------------------------------------------------------
              * Primary navigation — oversized, staggered.
              * --------------------------------------------------------- */}
            <nav aria-label="Site">
              <ul className="flex flex-col">
                {navItems.map(({ key, resolved }, index) => (
                  <motion.li
                    key={key}
                    initial={{ opacity: 0, y: reduced ? 0 : 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: reduced ? 0 : 0.8,
                      // Offset so the panel is most of the way down before the first item moves.
                      delay: reduced ? 0 : 0.18 + index * itemStagger,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className="border-b border-hairline/60 last:border-b-0"
                  >
                    {resolved.broken ? (
                      <span className="block py-4 text-display-sm text-muted/40">
                        {resolved.label}
                      </span>
                    ) : (
                      <Link
                        {...linkAttrs(resolved)}
                        onClick={(event) => {
                          if (resolved.anchor) onAnchorClick(event, resolved.href);
                          else close();
                        }}
                        className={cn(
                          'group flex items-baseline gap-4 py-4 md:gap-6',
                          'font-display text-display-sm text-bone transition-colors duration-300 hover:text-acid'
                        )}
                      >
                        <span
                          className="font-mono text-label text-muted/70 transition-colors duration-300 group-hover:text-acid"
                          aria-hidden="true"
                        >
                          {String(index + 1).padStart(2, '0')}
                        </span>

                        <span className="flex-1">{resolved.label}</span>

                        {/**
                         * The arrow slides in on hover. `translate` + `opacity` only, and it is
                         * `aria-hidden` because "arrow" adds nothing to a link that already
                         * announces its destination.
                         */}
                        <ArrowUpRight className="h-5 w-5 -translate-x-2 opacity-0 transition-all duration-500 ease-expo group-hover:translate-x-0 group-hover:opacity-100" />
                      </Link>
                    )}
                  </motion.li>
                ))}
              </ul>
            </nav>

            {/* -----------------------------------------------------------
              * Contact block
              * --------------------------------------------------------- */}
            <motion.div
              initial={{ opacity: 0, y: reduced ? 0 : 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reduced ? 0 : 0.8,
                delay: reduced ? 0 : 0.18 + navItems.length * itemStagger,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="grid gap-10 border-t border-hairline pt-10 md:grid-cols-3 md:items-end"
            >
              {/* Email — the single most important thing in the menu, so it gets its own column
                * and display sizing. */}
              <div className="md:col-span-2">
                <p className="eyebrow mb-3">Start a conversation</p>
                {email ? (
                  <a
                    href={`mailto:${email}`}
                    className="inline-block font-display text-2xl text-bone underline decoration-hairline decoration-1 underline-offset-8 transition-colors duration-300 hover:text-acid hover:decoration-acid md:text-3xl"
                  >
                    {email}
                  </a>
                ) : null}

                {availability?.isAvailable && availability.label ? (
                  <p className="mt-4 flex items-center gap-2 font-mono text-label uppercase text-muted">
                    <span className="h-1.5 w-1.5 rounded-full bg-acid" aria-hidden="true" />
                    {availability.label}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-6">
                {resolvedCta && !resolvedCta.broken ? (
                  <MagneticButton asChild variant="primary" size="lg" magnetic={resolvedCta.magnetic}>
                    <Link {...linkAttrs(resolvedCta)} onClick={close}>
                      <span
                        data-magnetic-label
                        className="pointer-events-none inline-flex items-center gap-2"
                      >
                        {resolvedCta.label}
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </span>
                    </Link>
                  </MagneticButton>
                ) : null}

                {socials?.length ? (
                  <ul className="flex flex-wrap gap-x-5 gap-y-2">
                    {socials.map((social, index) =>
                      social?.url ? (
                        <li key={social._key ?? `social-${index}`}>
                          <a
                            href={social.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-label uppercase text-muted transition-colors duration-300 hover:text-bone"
                          >
                            {social.handle ?? social.platform ?? social.url}
                          </a>
                        </li>
                      ) : null
                    )}
                  </ul>
                ) : null}
              </div>
            </motion.div>

            {/* -----------------------------------------------------------
              * Secondary links
              * --------------------------------------------------------- */}
            {secondaryItems.length ? (
              <nav aria-label="Secondary">
                <ul className="flex flex-wrap gap-x-6 gap-y-2">
                  {secondaryItems.map(({ key, resolved }) =>
                    resolved.broken ? null : (
                      <li key={key}>
                        <Link
                          {...linkAttrs(resolved)}
                          onClick={(event) => {
                            if (resolved.anchor) onAnchorClick(event, resolved.href);
                            else close();
                          }}
                          className="text-sm text-muted transition-colors duration-300 hover:text-bone"
                        >
                          {resolved.label}
                        </Link>
                      </li>
                    )
                  )}
                </ul>
              </nav>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
