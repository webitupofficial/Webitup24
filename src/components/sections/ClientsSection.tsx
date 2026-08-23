import { Reveal } from '@/components/interactive/Reveal';
import type { ClientLogo } from '@/types/content';

export interface ClientsSectionProps {
  clients?: ClientLogo[] | null;
  eyebrow?: string;
}

const DEFAULT_CLIENTS = [
  'AURA SPATIAL',
  'KINETIC LABS',
  'HYPERION AI',
  'POLYGON ZERO',
  'NEURONIC',
  'SYNAPSE DIGITAL',
  'VERBUM STUDIO',
  'CHROMA WORKS',
];

export function ClientsSection({
  clients,
  eyebrow = 'Trusted by pioneering teams',
}: ClientsSectionProps) {
  const list =
    clients && clients.length > 0
      ? clients.map((c) => c.name).filter((n): n is string => Boolean(n))
      : DEFAULT_CLIENTS;

  return (
    <section className="relative z-content py-16 border-t border-hairline/40 overflow-hidden">
      <div className="shell mb-8 text-center">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      </div>

      <Reveal distance={15} className="relative w-full">
        {/* Subtle marquee wrapper */}
        <div className="flex w-max animate-marquee-x gap-12 whitespace-nowrap [--marquee-duration:28s]">
          {[...list, ...list].map((name, i) => (
            <div
              key={i}
              className="flex items-center gap-12 select-none opacity-60 transition-opacity hover:opacity-100"
            >
              <span className="font-mono text-sm tracking-[0.25em] uppercase text-bone">
                {name}
              </span>
              <span className="h-1 w-1 rounded-full bg-acid/60" aria-hidden="true" />
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
