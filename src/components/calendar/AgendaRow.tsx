import { useEffect, useId, useRef } from "react";
import type { AgendaEvent, AgendaPeriod } from "@/lib/events/event-agenda";
import {
  formatCalendarDay,
  formatCalendarDayParts,
  formatClockTime,
} from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { describeRsvpFailure } from "./agenda-client";
import { EventDetailPanel } from "./EventDetailPanel";
import {
  type EventOrganizer,
  EventOrganizerActions,
} from "./EventOrganizerActions";
import { EventRsvp } from "./EventRsvp";
import { useEventDetail } from "./use-event-detail";
import { useEventRsvp } from "./use-event-rsvp";

/**
 * Una fila de la agenda (#311, RF-7, AC-046): el bloque de fecha, el título
 * con su tipo, la hora y el lugar, el RSVP y los conteos. El bloque de fecha
 * es para la vista; el lector de pantalla oye la fecha entera.
 *
 * Responde quien es de la audiencia de un evento que sigue en pie. A un
 * cancelado no se le responde, y quien organiza ve también los eventos que no
 * son para él (B7): esos no llevan botones. A un pasado tampoco (#312).
 *
 * El título es el botón que despliega la fila con las notas y quién va
 * (#312, RF-8): un botón dentro del encabezado, el patrón del acordeón, así
 * Enter y Espacio lo abren y el lector de pantalla anuncia si está
 * desplegada. Con el ratón se pulsa en cualquier punto de la tarjeta.
 *
 * A quien organiza, la fila desplegada de un evento futuro que sigue en pie
 * le ofrece editarlo y cancelarlo (#316).
 */

function DateBlock({
  translate,
  startsOn,
}: {
  readonly translate: Translator;
  readonly startsOn: string;
}): React.JSX.Element {
  const parts = formatCalendarDayParts(translate.locale, startsOn);
  return (
    <time className="agenda-date" dateTime={startsOn}>
      <span aria-hidden="true" className="agenda-date-weekday">
        {parts.weekday}
      </span>
      <span aria-hidden="true" className="agenda-date-day">
        {parts.day}
      </span>
      <span aria-hidden="true" className="agenda-date-month">
        {parts.month}
      </span>
      <span className="visually-hidden">
        {formatCalendarDay(translate.locale, startsOn)}
      </span>
    </time>
  );
}

export function AgendaRow({
  translate,
  event,
  period,
  shouldTakeFocus,
  organizer,
}: {
  readonly translate: Translator;
  readonly event: AgendaEvent;
  readonly period: AgendaPeriod;
  /** La primera fila de una página recién cargada: recibe el foco para que
   * quien pulsó "Ver más" siga leyendo desde ahí. */
  readonly shouldTakeFocus: boolean;
  /** Nulo para quien no organiza eventos. */
  readonly organizer: EventOrganizer | null;
}): React.JSX.Element {
  const { isExpanded, detail, toggle, retry, receive } = useEventDetail(
    event.id,
  );
  const { state, respond } = useEventRsvp(event, receive);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const detailId = useId();
  const isCancelled = event.status === "cancelled";
  const canRespond = period === "upcoming" && event.inAudience && !isCancelled;
  const canManage = organizer !== null && period === "upcoming" && !isCancelled;

  useEffect(() => {
    if (shouldTakeFocus) {
      titleRef.current?.focus();
    }
  }, [shouldTakeFocus]);

  return (
    <li className="agenda-row">
      <DateBlock translate={translate} startsOn={event.startsOn} />
      <div className="agenda-body">
        <div className="agenda-heading">
          <h2 ref={titleRef} className="agenda-title" tabIndex={-1}>
            <button
              type="button"
              className="agenda-toggle"
              aria-expanded={isExpanded}
              aria-controls={detailId}
              onClick={toggle}
            >
              {event.title}
              <span className="agenda-chevron" aria-hidden="true" />
            </button>
          </h2>
          <span className={`agenda-type agenda-type-${event.eventType}`}>
            {translate(`event.type.${event.eventType}`)}
          </span>
          {isCancelled ? (
            <span className="agenda-cancelled">
              {translate("calendar.event.cancelled")}
            </span>
          ) : null}
        </div>
        <p className="agenda-when">
          {translate("calendar.event.timeAndPlace", {
            time: formatClockTime(translate.locale, event.startTime),
            location: event.location,
          })}
        </p>
        <div className="agenda-footer">
          {canRespond ? (
            <EventRsvp
              translate={translate}
              title={event.title}
              savedResponse={state.tally.myResponse}
              pendingResponse={state.pendingResponse}
              onRespond={respond}
            />
          ) : null}
          <p className="agenda-counts">
            {translate("calendar.event.counts", {
              going: translate("calendar.event.going", {
                count: state.tally.goingCount,
              }),
              maybe: translate("calendar.event.maybe", {
                count: state.tally.maybeCount,
              }),
            })}
          </p>
        </div>
        {canRespond ? (
          <p className="agenda-rsvp-status" role="status">
            {state.pendingResponse === null
              ? null
              : translate("calendar.rsvp.saving")}
          </p>
        ) : null}
        {state.failure === null ? null : (
          <p className="auth-error agenda-rsvp-error" role="alert">
            {describeRsvpFailure(translate, state.failure)}
          </p>
        )}
        <div id={detailId} className="agenda-detail" hidden={!isExpanded}>
          {isExpanded ? (
            <EventDetailPanel
              translate={translate}
              detail={detail}
              onRetry={retry}
            />
          ) : null}
          {canManage &&
          detail.kind === "loaded" &&
          detail.opened.audience !== null ? (
            <EventOrganizerActions
              translate={translate}
              event={event}
              details={{
                notes: detail.opened.notes,
                audience: detail.opened.audience,
              }}
              goingCount={state.tally.goingCount}
              organizer={organizer}
            />
          ) : null}
        </div>
      </div>
    </li>
  );
}
