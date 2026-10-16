import type { EventType } from "@/lib/events/event-creation";
import type { Translator } from "@/lib/i18n/translator";

/** La etiqueta de tipo de un evento (#641, RF-1 del PRD de E24). El color del
 * tipo ayuda a reconocerla de un vistazo, pero es el texto el que la nombra.
 * El fondo lo pone la hoja de estilos por la clase del tipo. */
export function EventTypeTag({
  translate,
  eventType,
}: {
  readonly translate: Translator;
  readonly eventType: EventType;
}): React.JSX.Element {
  return (
    <span className={`event-type-tag event-type-tag-${eventType}`}>
      {translate(`event.type.${eventType}`)}
    </span>
  );
}
