'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

import { MobileMenu } from './MobileMenu';
import { Wordmark } from './Wordmark';
import { ArrowUpRight, MagneticButton } from '@/components/interactive/MagneticButton';
import { scrollTo } from '@/components/providers/SmoothScrollProvider';
import { gsap } from '@/lib/gsap';
import { frameState } from '@/lib/store/frameState';
import { useUIStore } from '@/lib/store/useUIStore';
import { cn } from '@/lib/utils/cn';
import { linkAttrs, resolveLink, type LinkInput } from '@/lib/utils/links';

/**
 * =============================================================================
 * Header — fixed chrome, zero React renders per scroll frame.
 * =============================================================================
 *
 * Behaviour:
 *   • Transparent over the hero, blurred elevated backdrop once scrolled.
 *   • Slides out of the way on sustained downward scroll, returns on any upward scroll.
 *   • Full-screen menu at every breakpoint; the inline nav is a desktop shortcut, not the only way.
 *
 * -----------------------------------------------------------------------------
 * 1. WHY THE SCROLL STATE IS TWO DATA ATTRIBUTES, NOT REACT STATE
 * -----------------------------------------------------------------------------
 * The obvious implementation is `useState` plus a scroll listener. It works, and it is the wrong
 * trade here: every `setState` re-renders the header, and the header contains a `MagneticButton`
 * whose `useMagnetic` hook holds live GSAP `quickTo` instances. Re-rendering it mid-hover is
 * survivable but it is pointless churn on the one component guaranteed to be mounted during every
 * scroll on every page.
 *
 * Instead the ticker writes attributes straight to the DOM node and CSS does the styling. React
 * renders this component when its *props* change — i.e. on navigation — and never because of
 * scroll. The transitions then run on the compositor even while the main thread is busy hydrating
 * a case study.
 *
 * Two attributes rather than one `data-state` enum, because the two behaviours are genuinely
 * orthogonal: `data-scrolled` is "is there content behind me" (drives the backdrop) and
 * `data-hidden` is "has the user scrolled down deliberately" (drives the translate). Collapsing
 * them into one enum forces states like "scrolled but not hidden" to be spelled out, and makes it
 * impossible to have a backdrop on a header that is mid-hide.
 *
 * -----------------------------------------------------------------------------
 * 2. WHY A gsap.ticker CALLBACK, NOT A SCROLL LISTENER
 * -----------------------------------------------------------------------------
 * `SmoothScrollProvider` already drives Lenis from `gsap.ticker` and publishes `scrollY` into
 * `frameState` on both its Lenis and its native-scroll paths. Sampling that once per frame beats a
 * second `scroll` listener on three counts:
 *
 *   • It cannot fire more often than the screen refreshes, so the work is bounded. A `scroll`
 *     listener on a high-resolution trackpad fires several times per frame.
 *   • It reads the same value the shader reads, in the same frame, so the header and the canvas
 *     can never disagree about where the page is.
 *   • It behaves identically under reduced motion, where Lenis does not exist — the provider's
 *     native path writes the same field.
 *
 * -----------------------------------------------------------------------------
 * 3. WHY THE DIRECTION DETECTION HAS HYSTERESIS
 * -----------------------------------------------------------------------------
 * Hiding on any positive frame delta produces a header that flickers. Lenis eases, so the tail of
 * a scroll animation alternates sign as it converges; iOS' rubber-band produces genuine direction
 * reversals at the document ends; and a trackpad's inertial phase is not monotonic.
 *
 * So deltas accumulate into a signed counter that only acts once it passes a threshold, and resets
 * when the direction flips. Jitter cancels itself out; a deliberate scroll crosses the threshold
 * within two or three frames.
 */

/** Pixels scrolled before the backdrop appears. Roughly the header's own height. */
const BACKDROP_AFTER = 64;

/**
 * Never auto-hide inside this distance from the top. Without it a short flick on the hero hides
 * the header before the user has had a chance to look at it.
 */
const HIDE_AFTER = 220;

/** Accumulated pixels in one direction before the header commits to hiding or showing. */
const DIRECTION_THRESHOLD = 12;

export interface HeaderNavItem extends LinkInput {
  _key?: string;
}

/**
 * One entry from `siteSettings.socials`, exactly as `siteSettingsQuery` projects it.
 *
 * Declared here and re-exported rather than written inline, because `MobileMenu` receives this
 * array verbatim — an inline shape in each file is two declarations of one contract, and they drift
 * the moment one side starts reading a field the other did not list.
 */
export interface SocialLink {
  _key?: string;
  platform?: string | null;
  url?: string | null;
  /** The display form (`@webitup24`). Falls back to `platform`, then to the raw URL. */
  handle?: string | null;
}

export interface HeaderProps {
  siteName?: string;
  logoUrl?: string | null;
  nav?: HeaderNavItem[] | null;
  cta?: LinkInput | null;
  availability?: { isAvailable?: boolean | null; label?: string | null } | null;
  /** `siteSettings.footerNav`, shown as secondary links inside the full-screen menu. */
  secondaryNav?: HeaderNavItem[] | null;
  email?: string | null;
  socials?: SocialLink[] | null;
}

/** Shared handler type, so `MobileMenu` and the desktop nav treat anchors identically. */
export type AnchorClickHandler = (
  event: React.MouseEvent<HTMLAnchorElement>,
  href: string
) => void;

export function Header({
  siteName = 'WebItUp24',
  logoUrl,
  nav,
  cta,
  availability,
  secondaryNav,
  email,
  socials,
}: HeaderProps) {
  const elRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  const menuOpen = useUIStore((s) => s.menuOpen);
  const setMenuOpen = useUIStore((s) => s.setMenuOpen);
  const setHeaderHidden = useUIStore((s) => s.setHeaderHidden);

  /**
   * The menu flag in a ref as well as in the store.
   *
   * The ticker callback has to read it, and it must NOT be in the effect's dependency array:
   * re-creating the callback on every menu toggle would reset the accumulator and lose the `lastY`
   * baseline, so the header would lurch on the first frame after the menu closed. A ref written
   * during render is the standard way to hand a long-lived callback a fresh value.
   */
  const menuOpenRef = useRef(menuOpen);
  menuOpenRef.current = menuOpen;

  /* ------------------------------------------------------------------------
   * Scroll behaviour
   * ---------------------------------------------------------------------- */
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    let lastY = frameState.scrollY;
    let accumulated = 0;
    /** Last values written to the DOM, so the attributes are only touched on a real transition. */
    let scrolled: boolean | null = null;
    let hidden: boolean | null = null;

    const setScrolled = (next: boolean) => {
      if (next === scrolled) return;
      scrolled = next;
      el.dataset.scrolled = String(next);
    };

    const setHidden = (next: boolean) => {
      if (next === hidden) return;
      hidden = next;
      el.dataset.hidden = String(next);
      /**
       * Mirrored into the store for anything that has to react in JS rather than CSS — a case
       * study's sticky chapter rail offsets itself by the header height and needs to know when
       * that space is released. Written only on transition, so this is a handful of store updates
       * per page rather than one per frame.
       */
      setHeaderHidden(next);
    };

    const onTick = () => {
      const y = frameState.scrollY;
      const delta = y - lastY;
      lastY = y;

      setScrolled(y > BACKDROP_AFTER);

      /* --- The two conditions that override direction entirely --------- */

      if (y <= BACKDROP_AFTER) {
        accumulated = 0;
        setHidden(false);
        return;
      }

      /**
       * Menu open, or keyboard focus is somewhere inside the header.
       *
       * The focus check is the accessibility-critical half. A keyboard user generates no scroll at
       * all, so nothing here would otherwise re-show the header — but a user who has scrolled down
       * and then shift-tabs back up to the nav must not have it slide away underneath the focus
       * ring. The same guard covers a screen reader reading the header with a virtual cursor.
       */
      if (menuOpenRef.current || el.contains(document.activeElement)) {
        accumulated = 0;
        setHidden(false);
        return;
      }

      /* --- Direction, with hysteresis ---------------------------------- */

      /**
       * A frame with no movement carries no direction information, and feeding 0 into the
       * accumulator would be actively harmful: `Math.sign(0)` is 0, so a still frame reads as a
       * direction change and wipes whatever progress a slow scroll had built up — which makes the
       * threshold unreachable below a certain scroll speed. Bail instead.
       */
      if (delta === 0) return;

      // Reset when the sign flips, so opposing jitter cancels rather than sums.
      if (Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0;
      accumulated += delta;

      if (accumulated > DIRECTION_THRESHOLD) {
        if (y > HIDE_AFTER) {
          setHidden(true);
          accumulated = 0;
        }
        // Below HIDE_AFTER we deliberately keep accumulating rather than resetting, so a single
        // long flick from the top still hides the header the moment it clears the threshold.
      } else if (accumulated < -DIRECTION_THRESHOLD) {
        setHidden(false);
        accumulated = 0;
      }
    };

    // Run once synchronously so a hard refresh partway down the page starts in the right state
    // rather than flashing the transparent variant for a frame.
    onTick();
    gsap.ticker.add(onTick);

    return () => {
      gsap.ticker.remove(onTick);
      setHeaderHidden(false);
    };
  }, [setHeaderHidden]);

  /* ------------------------------------------------------------------------
   * Close the menu on navigation.
   *
   * `next/link` inside the menu changes the route without unmounting the menu — it is rendered by
   * the layout, not by the page — so nothing else would close it. Keyed on `pathname` rather than
   * handled in each link's `onClick`, so browser back/forward and programmatic navigation are
   * covered too.
   * ---------------------------------------------------------------------- */
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname, setMenuOpen]);

  /**
   * Anchor links go through Lenis rather than the browser.
   *
   * A native `#id` jump sets `window.scrollY` directly, which Lenis does not observe: its internal
   * `animatedScroll` stays where it was, so the next wheel event snaps the page back to the old
   * position. Routing anchors through `scrollTo` keeps one source of truth for scroll.
   */
  const onAnchorClick = useCallback<AnchorClickHandler>(
    (event, href) => {
      // Let modified clicks (new tab, download, save) behave natively.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = document.querySelector(href);
      // Anchor points at something on another page — let the browser navigate normally.
      if (!target) return;

      event.preventDefault();
      setMenuOpen(false);

      /**
       * Offset by the header height. `scroll-padding-top` in globals.css covers native anchor
       * jumps, but Lenis' `scrollTo` bypasses the UA's scroll-padding entirely, so the offset has
       * to be supplied here or the section lands underneath the header.
       */
      const headerHeight = elRef.current?.offsetHeight ?? 80;
      scrollTo(href, { offset: -headerHeight - 16 });

      // Keep the URL in sync without a navigation, so the anchor stays shareable.
      window.history.replaceState(null, '', href);
    },
    [setMenuOpen]
  );

  const navItems = (nav ?? []).map((item, index) => ({
    key: item._key ?? `nav-${index}`,
    resolved: resolveLink(item),
  }));

  const resolvedCta = cta ? resolveLink(cta) : null;

  return (
    <>
      <header
        ref={elRef}
        /**
         * Initial values matter: they are what the server renders and what the first paint shows.
         * Both false is correct for the overwhelmingly common case of a page loaded at the top,
         * and the effect corrects them within the first frame for a mid-page refresh.
         */
        data-scrolled="false"
        data-hidden="false"
        /**
         * Written from React state rather than from the ticker, because it changes on interaction
         * (never per-frame) and because globals.css uses it to drop the scrolled backdrop while the
         * menu is open — a translucent bar sitting on top of the menu's own surface reads as a seam
         * across the top of the overlay.
         */
        data-menu-open={menuOpen ? 'true' : 'false'}
        className={cn(
          /**
           * `header-shell` carries the backdrop, which lives in globals.css because it needs an
           * `@supports (backdrop-filter)` block — expressing that as two competing Tailwind
           * variants would leave the winner dependent on Tailwind's internal variant sort order.
           */
          'header-shell fixed inset-x-0 top-0 h-[var(--header-h)]',
          /**
           * The bar lifts above the overlay while the menu is open.
           *
           * Not cosmetic: at `z-header` (40) the `z-overlay` (60) menu covers the close button, so a
           * pointer user has no way to dismiss it — only Escape or committing to a nav link. This is
           * also the intended composition, with the menu sliding out from underneath a bar that
           * stays put.
           */
          menuOpen ? 'z-header-open' : 'z-header',
          /**
           * `transform` and colour only. Both are compositor-friendly; animating `height` or
           * `padding` — the other common way to build a shrinking header — forces layout on every
           * frame of the transition, on the element sitting above the entire page.
           */
          'transition-[transform,background-color,border-color] duration-500 ease-expo',
          'data-[hidden=true]:-translate-y-full'
        )}
      >
        <div className="shell flex h-full items-center justify-between gap-6">
          {/* -------------------------------------------------------------
            * Wordmark
            * ----------------------------------------------------------- */}
          <Link
            href="/"
            className="-mx-2 inline-flex items-center rounded-full px-2 py-1 text-bone transition-opacity duration-300 hover:opacity-70"
            aria-label={`${siteName} — home`}
          >
            <Wordmark logoUrl={logoUrl} siteName={siteName} size="sm" />
          </Link>

          {/* -------------------------------------------------------------
            * Desktop navigation
            *
            * `hidden lg:flex` rather than a JS breakpoint check: rendering both and letting CSS
            * choose means no hydration mismatch, no layout shift on first paint, and the nav is
            * present in the HTML for a crawler either way.
            * ----------------------------------------------------------- */}
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {navItems.map(({ key, resolved }, index) => {
              if (resolved.broken) {
                /**
                 * A link whose target was deleted in the Studio. Rendered as inert text rather
                 * than as an `<a href="#">`: a nav item that navigates nowhere is worse than one
                 * that is visibly not a link, and it shows up in review instead of silently
                 * reloading the page.
                 */
                return (
                  <span
                    key={key}
                    className="px-4 py-2 text-sm text-muted/50"
                    title="This link's target no longer exists"
                  >
                    {resolved.label}
                  </span>
                );
              }

              const isCurrent = isCurrentPath(pathname, resolved.href, resolved.anchor);

              return (
                <Link
                  key={key}
                  {...linkAttrs(resolved)}
                  onClick={resolved.anchor ? (e) => onAnchorClick(e, resolved.href) : undefined}
                  /**
                   * `aria-current="page"` and not just a class. The underline marking the current
                   * section is invisible to a screen reader; this is the part that actually
                   * communicates "you are here".
                   */
                  {...(isCurrent ? { 'aria-current': 'page' as const } : {})}
                  className={cn(
                    'group relative rounded-full px-4 py-2 text-sm transition-colors duration-300',
                    isCurrent ? 'text-bone' : 'text-muted hover:text-bone'
                  )}
                >
                  {/* The index numeral — a piece of editorial detail that costs nothing and makes
                    * the nav read as authored rather than generated. Mono's tabular figures keep
                    * the label from shifting between items. */}
                  <span
                    className="mr-1.5 font-mono text-[0.625rem] text-muted/60"
                    aria-hidden="true"
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {resolved.label}

                  {/**
                   * The underline. Animates `transform` only, and `scale-x-100` is pinned for the
                   * current item so its underline never animates away on hover-out.
                   */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute inset-x-4 bottom-1 h-px origin-left bg-acid transition-transform duration-500 ease-expo',
                      isCurrent ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'
                    )}
                  />
                </Link>
              );
            })}
          </nav>

          {/* -------------------------------------------------------------
            * Right cluster
            * ----------------------------------------------------------- */}
          <div className="flex items-center gap-3">
            {availability?.isAvailable && availability.label ? (
              <AvailabilityPill label={availability.label} />
            ) : null}

            {resolvedCta && !resolvedCta.broken ? (
              <MagneticButton
                asChild
                variant="primary"
                size="sm"
                /**
                 * Hidden on the narrowest screens: the menu carries the same CTA at full size, and
                 * three competing targets in a 375px header means none of them is comfortably
                 * tappable.
                 */
                className="hidden sm:inline-flex"
                /**
                 * Opt-in, from `link.magnetic` (whose schema `initialValue` is false). The
                 * schema's own description asks for magnetism to be used sparingly, so the
                 * decision belongs to whoever is looking at the page — not to this component.
                 */
                magnetic={resolvedCta.magnetic}
              >
                <Link {...linkAttrs(resolvedCta)}>
                  {/* `asChild` hands the internals to us, so the label wrapper the magnetic hook
                    * looks for has to be supplied here — see `MagneticButton`'s note on Slot. */}
                  <span
                    data-magnetic-label
                    className="pointer-events-none inline-flex items-center gap-2"
                  >
                    {resolvedCta.label}
                    <ArrowUpRight className="h-3 w-3" />
                  </span>
                </Link>
              </MagneticButton>
            ) : null}

            <MenuTrigger open={menuOpen} onToggle={() => setMenuOpen(!menuOpen)} />
          </div>
        </div>
      </header>

      <MobileMenu
        nav={nav}
        secondaryNav={secondaryNav}
        cta={cta}
        email={email}
        socials={socials}
        availability={availability}
        onAnchorClick={onAnchorClick}
      />
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Current-route matching
 * ------------------------------------------------------------------------- */

/**
 * Is `href` the section the user is currently in?
 *
 * The naive `pathname.startsWith(href)` marks `/work` as current on `/workshop`, because string
 * prefixes do not respect path segments. Requiring the next character to be `/` fixes it. The home
 * page is exact-match only, or it would be "current" everywhere.
 *
 * Anchor links are never current: they point within the page, and highlighting one would require
 * scroll-spy — a different feature with a different failure mode (two sections in view at once).
 */
function isCurrentPath(pathname: string, href: string, isAnchor: boolean): boolean {
  if (isAnchor) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/* ---------------------------------------------------------------------------
 * Availability pill
 * ------------------------------------------------------------------------- */

/**
 * "Available for new work", with a pulsing dot.
 *
 * The pulse animates `transform` and `opacity` only, and it is the sole piece of ambient looping
 * motion in the header — which is why it is behind `motion-full:`. Under reduced motion the dot is
 * simply solid: the same information, without a repeating animation in the user's peripheral
 * vision, which is precisely the class of motion the preference exists to remove.
 */
function AvailabilityPill({ label }: { label: string }) {
  return (
    <span className="hidden items-center gap-2 rounded-full border border-hairline px-3 py-1.5 md:inline-flex">
      <span className="relative flex h-1.5 w-1.5 items-center justify-center">
        <span
          className="absolute inset-0 rounded-full bg-acid motion-full:animate-pulse-ring"
          aria-hidden="true"
        />
        <span className="relative h-1.5 w-1.5 rounded-full bg-acid" />
      </span>
      <span className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-muted">
        {label}
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Menu trigger
 * ------------------------------------------------------------------------- */

/**
 * The hamburger→close morph.
 *
 * Two bars, not three: a middle bar has to cross-fade out during the rotation, and a fade in the
 * middle of a 500ms morph reads as a glitch. Two bars rotate into an X cleanly.
 *
 * `aria-expanded` and `aria-controls` are what make this a real disclosure control. Without them a
 * screen reader announces "button" and gives no indication that activating it revealed anything —
 * and, critically, no indication of the current state, so the user cannot tell whether the menu is
 * already open.
 */
function MenuTrigger({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="site-menu"
      aria-label={open ? 'Close menu' : 'Open menu'}
      className={cn(
        'group relative flex h-11 w-11 items-center justify-center rounded-full border border-hairline',
        'transition-colors duration-300 hover:border-bone/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acid focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        /**
         * Present at every breakpoint. The full-screen menu is a better experience than a cramped
         * inline nav even on a large display — it can carry the contact details, the socials and
         * the CTA — so the inline nav is a shortcut and this is always the complete route.
         */
        'lg:h-10 lg:w-10'
      )}
    >
      <span className="relative block h-3 w-4">
        <span
          aria-hidden="true"
          className={cn(
            'absolute left-0 block h-px w-full bg-bone transition-all duration-500 ease-expo',
            open ? 'top-1/2 rotate-45' : 'top-0.5 rotate-0'
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'absolute left-0 block h-px w-full bg-bone transition-all duration-500 ease-expo',
            open ? 'top-1/2 -rotate-45' : 'top-[calc(100%-1px)] rotate-0'
          )}
        />
      </span>
    </button>
  );
}
