import Link from 'next/link';
import { MagneticButton } from '@/components/interactive/MagneticButton';
import { ArrowUpRight } from '@/components/interactive/MagneticButton';

export default function NotFound() {
  return (
    <div className="relative flex min-h-[100svh] flex-col items-center justify-center text-center px-6 overflow-hidden">
      {/* Ambient background glow */}
      <div
        className="decorative absolute inset-0 -z-10 opacity-30"
        style={{
          background:
            'radial-gradient(40% 40% at 50% 50%, rgb(91 43 232 / 0.25) 0%, transparent 70%)',
        }}
      />

      <p className="font-mono text-xs uppercase tracking-[0.3em] text-acid mb-4">
        404 — Void Encountered
      </p>

      <h1 className="font-display text-display-md md:text-display-lg font-semibold tracking-[-0.04em] text-bone max-w-lg leading-none">
        Lost in spatial coordinates.
      </h1>

      <p className="mt-6 max-w-md text-lg text-muted">
        The route you are navigating does not exist or has dissolved into the digital ether.
      </p>

      <div className="mt-10">
        <MagneticButton asChild variant="primary" size="lg" magnetic>
          <Link href="/">
            <span data-magnetic-label className="pointer-events-none inline-flex items-center gap-2">
              Return to Nexus
              <ArrowUpRight className="h-4 w-4" />
            </span>
          </Link>
        </MagneticButton>
      </div>
    </div>
  );
}
