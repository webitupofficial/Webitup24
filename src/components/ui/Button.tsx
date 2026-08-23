'use client';

import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils/cn';

/**
 * components/ui/Button.tsx
 *
 * The base button. Purely presentational — no motion, no magnetism. `MagneticButton` composes
 * this with `useMagnetic`, which keeps the two concerns separable: a form submit button wants the
 * styling and emphatically does not want to move away from the cursor.
 *
 * =============================================================================
 * WHY `asChild` (Radix Slot)
 * =============================================================================
 * A button that navigates must render an `<a>`; a button that submits must render a `<button>`.
 * The usual workarounds are a `component` prop (loses type safety on the underlying element's
 * props) or nesting an `<a>` inside a `<button>` (invalid HTML, and produces two tab stops with
 * conflicting activation semantics — Enter fires the link, Space fires the button).
 *
 * `Slot` merges this component's props onto its single child instead of rendering an element of
 * its own, so `<Button asChild><Link href="/work">Work</Link></Button>` produces exactly one
 * `<a>` with the button's classes and the link's behaviour. Correct semantics, one tab stop, and
 * `next/link`'s prefetching intact.
 */

const buttonVariants = cva(
  /**
   * Base classes.
   *
   * `isolate` creates a stacking context, which the `::before` fill overlay in the primary
   * variant needs in order to sit above the background but below the label without a z-index
   * arms race against whatever the button is placed inside.
   *
   * `focus-visible` rather than `focus`: a mouse click should not leave a focus ring, but keyboard
   * navigation absolutely must show one. Removing the outline without replacing it is the most
   * common accessibility failure on sites that look like this one.
   *
   * The ring is offset by 3px and uses the acid token so it is visible against both the dark
   * surface and the light bone variant.
   */
  [
    'group relative isolate inline-flex items-center justify-center gap-2',
    'select-none whitespace-nowrap overflow-hidden',
    'font-sans font-medium tracking-tight',
    'transition-[color,background-color,border-color,opacity] duration-300 ease-swift',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acid focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
    'disabled:pointer-events-none disabled:opacity-40',
    // Hint the compositor only for the transform the magnetic hook will write. A blanket
    // `will-change: auto` on every button promotes dozens of layers and costs more than it saves.
    'gpu',
  ].join(' '),
  {
    variants: {
      variant: {
        /**
         * Primary — acid fill that wipes in from the bottom on hover.
         *
         * The wipe is a scaled `::before`, not a background-position or width animation: only
         * `transform` and `opacity` can be animated on the compositor. Animating `width` or
         * `background-position` triggers layout or paint on every frame of the hover.
         */
        primary: [
          'bg-acid text-ink',
          'before:absolute before:inset-0 before:-z-10 before:bg-bone',
          'before:origin-bottom before:scale-y-0 before:transition-transform before:duration-500 before:ease-expo',
          'hover:before:scale-y-100',
        ].join(' '),

        /** Secondary — hairline outline, fills with bone on hover. */
        secondary: [
          'border border-hairline bg-transparent text-bone',
          'before:absolute before:inset-0 before:-z-10 before:bg-bone',
          'before:origin-bottom before:scale-y-0 before:transition-transform before:duration-500 before:ease-expo',
          'hover:border-bone hover:text-ink hover:before:scale-y-100',
        ].join(' '),

        /** Ghost — text only. For tertiary actions and in-prose links. */
        ghost: 'bg-transparent text-bone/70 hover:text-bone',

        /**
         * Link — an underline that draws in from the left.
         *
         * `bg-gradient` + `background-size` transition rather than a `::after` scale, because this
         * variant is used inline in running text where a transformed pseudo-element would be
         * clipped at line breaks. Background-size on a gradient survives wrapping.
         */
        link: [
          'text-bone underline-offset-4',
          'bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat',
          'transition-[background-size] duration-500 ease-expo',
          'hover:bg-[length:100%_1px]',
        ].join(' '),

        /** Inverse — for placement on a light section. */
        inverse: [
          'bg-ink text-bone',
          'before:absolute before:inset-0 before:-z-10 before:bg-violet',
          'before:origin-bottom before:scale-y-0 before:transition-transform before:duration-500 before:ease-expo',
          'hover:before:scale-y-100',
        ].join(' '),
      },

      size: {
        /**
         * Every size keeps a minimum 44px touch target — the WCAG 2.5.5 / iOS HIG figure. `sm` is
         * visually smaller via type and horizontal padding, not by shrinking the hit area below
         * that floor.
         */
        sm: 'h-11 px-4 text-[0.8125rem]',
        md: 'h-12 px-6 text-sm',
        lg: 'h-14 px-8 text-base',
        /** Square, for icon-only actions. Always needs an `aria-label`. */
        icon: 'h-12 w-12 p-0',
        /** Unstyled box, for the `link` variant used inline. */
        inline: 'h-auto p-0 text-inherit',
      },

      shape: {
        pill: 'rounded-full',
        square: 'rounded-none',
        soft: 'rounded-lg',
      },
    },

    defaultVariants: {
      variant: 'primary',
      size: 'md',
      shape: 'pill',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the child element instead of a `<button>`, merging props onto it. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, shape, asChild = false, type, ...props },
  ref
) {
  const Component = asChild ? Slot : 'button';

  return (
    <Component
      ref={ref}
      /**
       * Default `type="button"`.
       *
       * HTML's default is `type="submit"`, so any button inside a form without an explicit type
       * submits it. That is the cause of a large share of "the page reloads when I click the
       * filter" bugs. Only forwarded when we are actually rendering a `<button>` — passing `type`
       * to a Slot that wraps an `<a>` would emit an invalid attribute.
       */
      {...(asChild ? {} : { type: type ?? 'button' })}
      className={cn(buttonVariants({ variant, size, shape }), className)}
      {...props}
    />
  );
});

export { buttonVariants };
