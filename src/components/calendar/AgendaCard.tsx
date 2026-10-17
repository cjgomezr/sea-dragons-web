import { MapPin } from "@phosphor-icons/react/dist/ssr/MapPin";
import { Repeat } from "@phosphor-icons/react/dist/ssr/Repeat";
import type { AgendaEvent } from "@/lib/events/event-agenda";
import { formatCompactClockRange } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { EventCover } from "./EventCover";

/**
 * La tarjeta de un evento en la agenda del móvil (#656, "#2a" del handoff de
 * E24): la barra del color del tipo, la miniatura de 52 px y, al lado, una
 * primera línea con "6:00–7:30 pm", la repetición y mi respuesta, el título
 * en hasta dos líneas y el lugar con su pin. El tipo no va solo en el color:
 * el lector de pantalla oye su nombre.
 *
 * El lugar no es un enlace, como en la fila de escritorio: en el móvil sería
 * un objetivo táctil pequeño encima de la tarjeta, y el mapa ya lo abre
 * "Cómo llegar" en la pantalla del evento. El título lo pone la fila, que es
 * dueña de su botón y de su foco.
 */

/** El icono de repetición, con su nombre para el lector de pantalla. */
export function RepeatMark({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <span className="agenda-repeat">
      <Repeat aria-hidden="true" focusable="false" size={14} />
      <span className="visually-hidden">
        {translate("calendar.event.repeats")}
      </span>
    </span>
  );
}

export function AgendaCardContent({
  translate,
  event,
  title,
  answer,
}: {
  readonly translate: Translator;
  readonly event: AgendaEvent;
  /** El título con el botón que abre la pantalla del evento. */
  readonly title: React.ReactNode;
  /** Mi respuesta, a la derecha de la primera línea. */
  readonly answer: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <span className="agenda-bar" aria-hidden="true" />
      <div className="agenda-thumbnail">
        <EventCover
          url={event.coverThumbUrl}
          eventType={event.eventType}
          iconSize={24}
        />
      </div>
      <div className="agenda-card-body">
        <div className="agenda-card-line">
          <span className="agenda-card-time">
            {formatCompactClockRange(
              translate.locale,
              event.startTime,
              event.endTime,
            )}
          </span>
          {event.seriesId === null ? null : (
            <RepeatMark translate={translate} />
          )}
          <span className="visually-hidden">
            {translate(`event.type.${event.eventType}`)}
          </span>
          {event.status === "cancelled" ? (
            <span className="agenda-cancelled">
              {translate("calendar.event.cancelled")}
            </span>
          ) : null}
          {answer}
        </div>
        {title}
        <p className="agenda-card-place">
          <MapPin aria-hidden="true" focusable="false" size={14} />
          <span className="agenda-place-name">{event.location}</span>
        </p>
      </div>
    </>
  );
}
