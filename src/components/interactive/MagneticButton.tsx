'use client';

import { forwardRef, useCallback } from 'react';
import { Slot } from '@radix-ui/react-slot';
import type { VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils/cn';
import { useMagnetic, type UseMagneticOptions } from '@/lib/hooks/useMagnetic';
import { buttonVariants } from '@/components/ui/Button';

/**
 * =============================================================================
 * MagneticButton — deliverable #5, part 1: "magnetic hover buttons"
 * =============================================================================
 *
 * `Button` styled + `useMagnetic` behaviour + a layered label that leads the body.
 *
 * -----------------------------------------------------------------------------
 * THE THREE LAYERS, AND WHY THEY ARE THREE
 * -----------------------------------------------------------------------------
 * The effect reads as one gesture but is three transforms at different rates, which is the whole
 * trick — a single element sliding toward the cursor looks like a bug, three nested elements
 * moving at 1×, 1.8× and 0× look like a physical object with a loose surface:
 *
 *   1. The root moves toward the cursor (`useMagnetic`, `strength` × distance, capped).
 *   2. The label moves *further* in the same direction (`innerStrength`), so it appears to lag
 *      behind the frame and catch up — the visual signature of the effect.
 *   3. The `::before` fill wipe is a pure hover state on the root and does not translate at all,
 *      so the fill stays locked to the button's own box while the label floats inside it.
 *
 * -----------------------------------------------------------------------------
 * WHY THE LABEL IS ALWAYS WRAPPED IN A SPAN
 * -----------------------------------------------------------------------------
 * `useMagnetic` finds the inner element with a selector, so there has to be an element to find.
 * Wrapping unconditionally (rather than only when `magnetic` is on) keeps the DOM shape identical
 * whether or not motion is enabled, which means no layout shift when the tier is downgraded at
 * runtime and no second code path to keep in sync.
 *
 * -----------------------------------------------------------------------------
 * ACCESSIBILITY
 * -----------------------------------------------------------------------------
 * The `swap` variant duplicates the label text, so the two visible copies are wrapped in
 * `aria-hidden` and a single `sr-only` copy carries the accessible name. Without that a screen
 * reader announces "Start a project Start a project".
 *
 * The magnetic displacement itself is capped at `maxDistance` (22px by default) and the element
 * is `focus-visible`-ringed by the base `Button`, so keyboard users get an unmoved, clearly
 * focused target. Magnetism is pointer-only by construction — it is driven by pointer position,
 * so a focused-but-not-hovered button never moves.
 */

/** How much further the label travels than the button body. */
const LABEL_LEAD = 1.8;

/** Selector the hook uses to find the label. A data attribute, so styling never breaks it. */
const INNER_SELECTOR = '[data-magnetic-label]';

export interface MagneticButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>,
    VariantProps<typeof buttonVariants> {
  children?: React.ReactNode;
  /** Render the single child element instead of a `<button>`. See `Button`'s note on Slot. */
  asChild?: boolean;
  /**
   * Turn magnetism off while keeping the styling. For buttons inside a horizontally-scrolling
   * row, where a translating element fights the scroll, or anywhere the movement would be noise.
   */
  magnetic?: boolean;
  /**
   * Vertical label swap on hover: the label slides up and out while a duplicate slides in from
   * below. Requires string children — silently ignored otherwise, because the duplicate would
   * have to deep-clone arbitrary React nodes and any element with an `id` or a form control in it
   * would then exist twice.
   */
  swap?: boolean;
  /** Trailing icon/adornment. Sits inside the label wrapper, so it travels with the text. */
  icon?: React.ReactNode;
  /** Overrides passed straight through to `useMagnetic`. */
  magneticOptions?: Omit<UseMagneticOptions, 'innerSelector' | 'innerStrength' | 'disabled'>;
}

export const MagneticButton = forwardRef<HTMLButtonElement, MagneticButtonProps>(
  function MagneticButton(
    {
      children,
      className,
      variant,
      size,
      shape,
      asChild = false,
      magnetic = true,
      swap = false,
      icon,
      magneticOptions,
      type,
      ...props
    },
    forwardedRef
  ) {
    const magneticRef = useMagnetic<HTMLButtonElement>({
      ...magneticOptions,
      innerSelector: INNER_SELECTOR,
      innerStrength: LABEL_LEAD,
      disabled: !magnetic || props.disabled,
    });

    /**
     * Merge the hook's ref with the forwarded one.
     *
     * A callback ref rather than a `useImperativeHandle`: both consumers need the *actual* DOM
     * node, and the hook's ref is read inside an effect, so it has to be populated by the time
     * effects run — which a callback ref guarantees and a handle constructed in a layout effect
     * does not, ordering-wise.
     *
     * `useCallback` keyed on the forwarded ref: without it, every parent render produces a new
     * callback, React detaches the old one (calling it with `null`) and attaches the new one. The
     * hook's effect does not re-run on that, so it would be left holding a null ref and the
     * button would silently stop being magnetic after any unrelated re-render.
     */
    const setRefs = useCallback(
      (node: HTMLButtonElement | null) => {
        magneticRef.current = node;

        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef, magneticRef]
    );

    const Component = asChild ? Slot : 'button';

    /**
     * With `asChild` the caller owns the internals — wrapping their element's children would mean
     * cloning it, and we would be guessing at its structure. Instead the child is rendered as-is
     * and the caller can opt into the layered pull by putting `data-magnetic-label` on their own
     * inner span. `querySelector` returning null is handled by the hook.
     */
    const content = asChild ? (
      children
    ) : (
      <span
        data-magnetic-label
        /**
         * `inline-flex` so `icon` sits on the same baseline row. `pointer-events-none` because
         * this span is purely visual — without it, `pointermove` targets flip between the button
         * and the span as the label translates, which is harmless here but noisy in devtools and
         * a trap for anyone later adding a handler that reads `event.target`.
         */
        className="pointer-events-none relative inline-flex items-center gap-2"
      >
        {swap && typeof children === 'string' ? <SwapLabel text={children} /> : children}
        {icon ? <span aria-hidden="true">{icon}</span> : null}
      </span>
    );

    return (
      <Component
        ref={setRefs}
        {...(asChild ? {} : { type: type ?? 'button' })}
        className={cn(buttonVariants({ variant, size, shape }), className)}
        {...props}
      >
        {content}
      </Component>
    );
  }
);

/* ---------------------------------------------------------------------------
 * Swap label
 * ------------------------------------------------------------------------- */

/**
 * Two stacked copies of the label; on hover the first exits upward as the second enters from
 * below.
 *
 * Implementation notes:
 *
 * - The outer span is `overflow-hidden` with `grid`, so its height is the natural line box of one
 *   copy. Both copies occupy the same grid cell (`col-start-1 row-start-1`), which means no
 *   absolute positioning and therefore no need to know the height in advance — the wrapper sizes
 *   itself to the text and the second copy inherits that box exactly. An absolutely-positioned
 *   duplicate would collapse the wrapper to zero height at certain font sizes.
 * - `translate-y-full`/`-translate-y-full` in percentage terms, so it scales with the type size
 *   with no magic pixel values.
 * - `group-hover:` — the group is the base `Button`'s class list, so the swap is driven by hover
 *   on the button, not on the label (which is `pointer-events-none` and could never be hovered).
 * - Both copies get `will-change`-free transforms; they are short, discrete hover transitions, so
 *   permanently promoting two layers per button is not worth it.
 */
function SwapLabel({ text }: { text: string }) {
  return (
    <>
      {/* The accessible name. One copy, invisible, never transformed. */}
      <span className="sr-only">{text}</span>

      <span aria-hidden="true" className="grid overflow-hidden">
        <span className="col-start-1 row-start-1 transition-transform duration-500 ease-expo group-hover:-translate-y-full">
          {text}
        </span>
        <span className="col-start-1 row-start-1 translate-y-full transition-transform duration-500 ease-expo group-hover:translate-y-0">
          {text}
        </span>
      </span>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Arrow — the default adornment
 * ------------------------------------------------------------------------- */

/**
 * A diagonal arrow that slides out and is replaced by a copy sliding in, on the same 45° axis.
 * The canonical "view case" affordance.
 *
 * Inline SVG rather than an icon font or a component library: it is 12 lines, it inherits
 * `currentColor`, and it avoids shipping a dependency for one glyph. `strokeWidth` is in the SVG's
 * own units, so it scales with the button's font size rather than staying a fixed hairline.
 */
export function ArrowUpRight({ className }: { className?: string }) {
  return (
    <span className={cn('relative block h-[1em] w-[1em] overflow-hidden', className)}>
      {[0, 1].map((i) => (
        <svg
          key={i}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={cn(
            'absolute inset-0 h-full w-full transition-transform duration-500 ease-expo',
            // The second copy waits below-left, on the same diagonal the first one exits along,
            // so the motion reads as one arrow travelling rather than two crossing.
            i === 0
              ? 'group-hover:-translate-y-full group-hover:translate-x-full'
              : '-translate-x-full translate-y-full group-hover:translate-x-0 group-hover:translate-y-0'
          )}
        >
          <path d="M7 17 17 7" />
          <path d="M7 7h10v10" />
        </svg>
      ))}
    </span>
  );
}
