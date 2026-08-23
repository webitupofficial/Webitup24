import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * lib/utils/cn.ts
 *
 * Merge class names with Tailwind conflict resolution.
 *
 * `clsx` handles the conditional/array/object forms; `tailwind-merge` resolves *conflicts*, which
 * is the part that actually matters. Given `cn('px-4', 'px-8')` plain concatenation yields
 * `"px-4 px-8"` and the winner is whichever Tailwind emitted later in the stylesheet — not the
 * one the caller passed last. That makes a `className` prop on a component unreliable: sometimes
 * an override works, sometimes it silently does not, depending on utility order in the build.
 *
 * `twMerge` understands Tailwind's groups and keeps only the last of each conflicting group, so
 * `cn('px-4', props.className)` behaves the way every caller assumes it already does.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
