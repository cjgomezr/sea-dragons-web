import { Confetti } from "@phosphor-icons/react/dist/ssr/Confetti";
import { Timer } from "@phosphor-icons/react/dist/ssr/Timer";
import { Trophy } from "@phosphor-icons/react/dist/ssr/Trophy";
import { UsersThree } from "@phosphor-icons/react/dist/ssr/UsersThree";
import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import type { EventType } from "@/lib/events/event-creation";

/** Los tamaños del handoff de E24: la miniatura de la fila y la imagen del
 * panel. */
export type EventCoverIconSize = 24 | 76;

const TYPE_GLYPHS: Readonly<Record<EventType, PhosphorGlyph>> = {
  training: Timer,
  competition: Trophy,
  social: Confetti,
  meeting: UsersThree,
};

/** El fondo de un evento sin imagen (#641, D4 del PRD de E24): un degradado
 * y un icono por tipo. Es decorativo; el tipo lo nombra su etiqueta. El
 * degradado y el color del icono los pone la hoja de estilos; el tamaño,
 * quien lo usa. */
export function EventCoverFallback({
  eventType,
  iconSize,
}: {
  readonly eventType: EventType;
  readonly iconSize: EventCoverIconSize;
}): React.JSX.Element {
  const Glyph = TYPE_GLYPHS[eventType];
  return (
    <div className={`event-cover-fallback event-cover-fallback-${eventType}`}>
      <Glyph
        aria-hidden="true"
        focusable="false"
        size={iconSize}
        color="currentColor"
      />
    </div>
  );
}
