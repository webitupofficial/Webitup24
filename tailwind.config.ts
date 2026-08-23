import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * WebItUp24 design tokens.
 *
 * Direction: near-black canvas, warm off-white type, acid-lime primary with a violet
 * counterpoint. The palette is deliberately narrow — on a site where a WebGL shader is
 * the loudest element, the DOM layer has to stay quiet or the whole thing turns to mud.
 *
 * Colours are declared as CSS custom properties in globals.css and referenced here so a
 * `colorPalette` from Sanity can override them per-case-study at runtime (see
 * `applyPaletteTokens` in src/lib/utils/palette.ts).
 */
const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx,mdx}',
    './src/components/**/*.{ts,tsx}',
    './src/sanity/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // `<alpha-value>` keeps Tailwind's opacity modifiers (`bg-ink/40`) working
        // against custom properties that store raw channel triplets.
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        elevated: 'rgb(var(--c-elevated) / <alpha-value>)',
        bone: 'rgb(var(--c-bone) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        acid: 'rgb(var(--c-acid) / <alpha-value>)',
        violet: 'rgb(var(--c-violet) / <alpha-value>)',
        ember: 'rgb(var(--c-ember) / <alpha-value>)',
        hairline: 'rgb(var(--c-hairline) / <alpha-value>)',
      },
      fontFamily: {
        // Wired up by next/font in src/app/layout.tsx.
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        /**
         * Fluid display scale. `clamp()` with a vw middle term means headline sizing is
         * resolution-independent and never needs a breakpoint override — which matters
         * because SplitTextReveal measures line boxes and re-splitting on every
         * breakpoint change is a layout-thrash source.
         */
        'display-sm': ['clamp(2.25rem, 1.4rem + 4vw, 4rem)', { lineHeight: '0.95', letterSpacing: '-0.03em' }],
        'display-md': ['clamp(3rem, 1.2rem + 7.5vw, 7rem)', { lineHeight: '0.9', letterSpacing: '-0.035em' }],
        'display-lg': ['clamp(4rem, 0.5rem + 12vw, 11rem)', { lineHeight: '0.86', letterSpacing: '-0.04em' }],
        'display-xl': ['clamp(5rem, -1rem + 18vw, 18rem)', { lineHeight: '0.82', letterSpacing: '-0.045em' }],
        'label': ['0.6875rem', { lineHeight: '1', letterSpacing: '0.16em' }],
      },
      spacing: {
        // Section rhythm. One knob, so vertical pacing stays consistent site-wide.
        section: 'clamp(6rem, 12vh, 12rem)',
        gutter: 'clamp(1.25rem, 4vw, 4.5rem)',
      },
      maxWidth: {
        shell: '96rem',
        prose: '68ch',
      },
      transitionTimingFunction: {
        // The two curves used for everything. `expo` for entrances, `swift` for hovers.
        expo: 'cubic-bezier(0.16, 1, 0.3, 1)',
        swift: 'cubic-bezier(0.4, 0, 0.2, 1)',
        'in-out-quart': 'cubic-bezier(0.76, 0, 0.24, 1)',
      },
      keyframes: {
        'marquee-x': {
          from: { transform: 'translate3d(0,0,0)' },
          to: { transform: 'translate3d(-50%,0,0)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translate3d(0,1.5rem,0)' },
          to: { opacity: '1', transform: 'translate3d(0,0,0)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.8)', opacity: '0.7' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
        // The hero scroll cue: an acid segment that falls the length of the track, fading in
        // at the top and out at the bottom, then repeats. The percentages are tuned to the
        // 40px track / 16px segment in Hero.tsx — 250% is exactly one segment past the floor.
        'scroll-cue': {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '20%': { opacity: '1' },
          '80%': { opacity: '1' },
          '100%': { transform: 'translateY(250%)', opacity: '0' },
        },
      },
      animation: {
        'marquee-x': 'marquee-x var(--marquee-duration, 32s) linear infinite',
        'fade-up': 'fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) both',
        'pulse-ring': 'pulse-ring 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite',
        'scroll-cue': 'scroll-cue 2.1s cubic-bezier(0.4, 0, 0.2, 1) infinite',
      },
      backgroundImage: {
        'grain': "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
      },
      zIndex: {
        canvas: '1',
        content: '10',
        header: '40',
        overlay: '60',
        /**
         * The header *while the full-screen menu is open*.
         *
         * Above `overlay` on purpose: the menu slides down out of the bar, so the wordmark and the
         * close button have to stay visible and — critically — clickable. At `z-header` the overlay
         * covers the trigger, and the only way out of the menu is Escape or a nav link, which is a
         * dead end for anyone using a pointer.
         */
        'header-open': '70',
        cursor: '90',
        preloader: '100',
      },
    },
  },
  plugins: [
    animate,
    /**
     * Utilities that are awkward or impossible to express with arbitrary values.
     */
    function ({ addUtilities, addVariant }: any) {
      addUtilities({
        // The classic masked line-reveal primitive. SplitTextReveal applies these.
        '.mask-line': { overflow: 'hidden', display: 'block' },
        // Promote to its own compositor layer *without* the permanent-layer cost of
        // will-change. Applied by GSAP only while a tween is in flight.
        '.gpu': { transform: 'translate3d(0,0,0)', backfaceVisibility: 'hidden' },
        // Makes an element inert to pointer and selection. Applied to the duplicated text
        // nodes that split-text leaves behind — note that hiding them from the
        // accessibility tree needs a real `aria-hidden` attribute in the markup, which is
        // not something CSS can do, so SplitTextReveal sets both.
        '.decorative': { pointerEvents: 'none', userSelect: 'none' },
        '.text-balance': { textWrap: 'balance' },
        '.text-pretty': { textWrap: 'pretty' },
        // Scrollbar suppression for the Lenis wrapper.
        '.no-scrollbar': {
          scrollbarWidth: 'none',
          '-ms-overflow-style': 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        },
      });

      /**
       * `motion-safe:`/`motion-reduce:` ship with Tailwind, but we also need a variant
       * keyed to our *runtime* decision, which folds in reduced-motion AND low device
       * tier AND battery saver. SmoothScrollProvider sets `data-motion` on <html>.
       */
      addVariant('motion-full', '[data-motion="full"] &');
      addVariant('motion-lite', '[data-motion="lite"] &');
      // True only once the WebGL context has actually rendered a frame.
      addVariant('webgl-ready', '[data-webgl="ready"] &');
    },
  ],
};

export default config;
