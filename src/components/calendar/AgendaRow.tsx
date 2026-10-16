import { MapPin } from "@phosphor-icons/react/dist/ssr/MapPin";
import { Repeat } from "@phosphor-icons/react/dist/ssr/Repeat";
import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import {
  ATTENDANCE_PATH,
  ATTENDANCE_SESSION_QUERY_PARAM,
} from "@/lib/auth/routes";
import type { AgendaEvent, AgendaPeriod } from "@/lib/events/event-agenda";
import { isStillAhead } from "@/lib/events/event-occurrences";
import { buildMapsUrl } from "@/lib/events/event-place";
import type { RsvpResponse } from "@/lib/events/event-rsvp";
import {
  formatCalendarDay,
  formatCalendarDayParts,
  formatClockRange,
  formatClockTime,
} from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { BUILDABLE_EVENT_TYPES } from "@/lib/teams/team-ids";
import { clubMoment } from "@/lib/time/club-calendar";
import { describeRsvpFailure } from "./agenda-client";
import { EventCover } from "./EventCover";
import { EventDetailPanel } from "./EventDetailPanel";
import {
  type EventOrganizer,
  EventOrganizerActions,
} from "./EventOrganizerActions";
import { EventRsvp } from "./EventRsvp";
import { EventTeams } from "./EventTeams";
import { EventTypeTag } from "./EventTypeTag";
import { useEventDetail } from "./use-event-detail";
import { useEventRsvp } from "./use-event-rsvp";
import { useEventTeam } from "./use-event-team";

/**
 * Una fila de la agenda (#311, RF-7, AC-046), con la forma de E24 (#647,
 * RF-6): la barra del color del tipo, la hora de inicio y la de fin debajo,
 * la miniatura o el fondo del tipo, el título, la línea con la etiqueta, la
 * repetición y el lugar, y a la derecha mi respuesta y cuántos van. El color
 * acompaña: el tipo lo nombra su etiqueta y el cancelado, su palabra.
 *
 * El lugar es un enlace aparte al mapa, en otra pestaña. No llega a la fila:
 * pulsarlo no la despliega.
 *
 * Responde quien es de la audiencia de un evento que sigue en pie. A un
 * cancelado no se le responde, y quien organiza ve también los eventos que no
 * son para él (B7): esos no llevan botones. A un pasado tampoco (#312).
 *
 * El título es el botón que despliega la fila (#312, RF-8): un botón dentro
 * del encabezado, el patrón del acordeón, así Enter y Espacio lo abren y el
 * lector de pantalla anuncia si está desplegada. Con el ratón se pulsa en
 * cualquier punto de la tarjeta. Desplegada enseña los botones del RSVP con
 * los conteos, las notas y quién va. Es lo que llevará el panel de #648.
 *
 * A quien organiza, la fila desplegada de un evento futuro que sigue en pie
 * le ofrece editarlo y cancelarlo (#316).
 *
 * A quien pasa lista, la de un entrenamiento que ya empezó y sigue en pie le
 * ofrece "Pasar lista" (#395), que abre Asistencia con esa sesión. Puede estar
 * en Próximos: el de hoy sigue ahí aunque ya haya empezado.
 *
 * La de un entrenamiento o una competición enseña además los equipos del
 * reparto publicado (#403). Los demás eventos no se arman: no se piden.
 */

function canTakeAttendanceOf(event: AgendaEvent): boolean {
  return (
    event.eventType === "training" &&
    event.status === "scheduled" &&
    !isStillAhead(
      { date: event.startsOn, time: event.startTime },
      clubMoment(new Date()),
    )
  );
}

function TakeAttendanceLink({
  translate,
  eventId,
}: {
  readonly translate: Translator;
  readonly eventId: string;
}): React.JSX.Element {
  const query = new URLSearchParams({
    [ATTENDANCE_SESSION_QUERY_PARAM]: eventId,
  });
  return (
    <Link
      href={`${ATTENDANCE_PATH}?${query.toString()}`}
      className="admin-secondary agenda-take-attendance"
    >
      {translate("calendar.takeAttendance")}
    </Link>
  );
}

/** El bloque de fecha de la fila; también lo usa el inicio (#426). */
export function DateBlock({
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

const ANSWER_LABELS = {
  yes: "calendar.answer.yes",
  maybe: "calendar.answer.maybe",
  no: "calendar.answer.no",
} as const satisfies Record<RsvpResponse, string>;

/** La hora de inicio y, debajo, la de fin. El lector de pantalla oye el
 * rango entero. Sin fin (lo anterior a E24), sólo el inicio. */
function EventTimes({
  translate,
  event,
}: {
  readonly translate: Translator;
  readonly event: AgendaEvent;
}): React.JSX.Element {
  const { locale } = translate;
  const start = formatClockTime(locale, event.startTime);
  if (event.endTime === null) {
    return (
      <p className="agenda-times">
        <span className="agenda-start">{start}</span>
      </p>
    );
  }
  return (
    <p className="agenda-times">
      <span className="agenda-start" aria-hidden="true">
        {start}
      </span>
      <span className="agenda-end" aria-hidden="true">
        {formatClockTime(locale, event.endTime)}
      </span>
      <span className="visually-hidden">
        {formatClockRange(locale, event.startTime, event.endTime)}
      </span>
    </p>
  );
}

function PlaceLink({
  translate,
  event,
}: {
  readonly translate: Translator;
  readonly event: AgendaEvent;
}): React.JSX.Element {
  return (
    <a
      className="agenda-place"
      href={buildMapsUrl(event)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(click) => click.stopPropagation()}
    >
      <MapPin aria-hidden="true" focusable="false" size={14} />
      <span className="agenda-place-name">{event.location}</span>{" "}
      <span className="visually-hidden">
        {translate("calendar.event.opensMap")}
      </span>
    </a>
  );
}

/** Mi respuesta en su píldora o, si todavía puedo responder, la llamada al
 * RSVP. */
function MyAnswer({
  translate,
  myResponse,
  canRespond,
}: {
  readonly translate: Translator;
  readonly myResponse: RsvpResponse | null;
  readonly canRespond: boolean;
}): React.JSX.Element | null {
  if (myResponse !== null) {
    return (
      <p className="agenda-answer">
        <span className="visually-hidden">
          {translate("calendar.answer.label")}
        </span>{" "}
        <span className={`agenda-answer-pill agenda-answer-${myResponse}`}>
          {translate(ANSWER_LABELS[myResponse])}
        </span>
      </p>
    );
  }
  if (!canRespond) {
    return null;
  }
  return (
    <p className="agenda-answer">
      <span className="agenda-answer-missing" aria-hidden="true">
        {translate("calendar.answer.missing")}
      </span>
      <span className="visually-hidden">
        {translate("calendar.answer.missingHint")}
      </span>
    </p>
  );
}

function rowClassName(event: AgendaEvent): string {
  const classes = ["agenda-row", `agenda-row-${event.eventType}`];
  return (
    event.status === "cancelled" ? [...classes, "is-cancelled"] : classes
  ).join(" ");
}

export function AgendaRow({
  translate,
  event,
  period,
  shouldTakeFocus,
  organizer,
  canTakeAttendance,
  rsvpDisabledReasonId,
}: {
  readonly translate: Translator;
  readonly event: AgendaEvent;
  readonly period: AgendaPeriod;
  /** La primera fila de una página recién cargada: recibe el foco para que
   * quien pulsó "Ver más" siga leyendo desde ahí. */
  readonly shouldTakeFocus: boolean;
  /** Nulo para quien no organiza eventos. */
  readonly organizer: EventOrganizer | null;
  /** Si quien mira registra asistencia. Sólo decide si se pinta el enlace:
   * la frontera ya reserva Asistencia a Admin y Coach. */
  readonly canTakeAttendance: boolean;
  /** El id de la frase que dice por qué quien mira no puede responder (#453),
   * o `null` si puede. */
  readonly rsvpDisabledReasonId: string | null;
}): React.JSX.Element {
  const { isExpanded, detail, toggle, retry, receive } = useEventDetail(
    event.id,
  );
  const { state, respond } = useEventRsvp(event, receive);
  const teams = useEventTeam(event.id);
  // Los equipos son de socio (#453): sin la membresía al día la frontera los
  // cierra, así que ni se piden.
  const isMembershipCurrent = rsvpDisabledReasonId === null;
  const canHaveTeams =
    isMembershipCurrent && BUILDABLE_EVENT_TYPES.includes(event.eventType);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const detailId = useId();
  const isCancelled = event.status === "cancelled";
  const canRespond = period === "upcoming" && event.inAudience && !isCancelled;
  const canManage = organizer !== null && period === "upcoming" && !isCancelled;

  function toggleRow(): void {
    if (!isExpanded && canHaveTeams) {
      teams.open();
    }
    toggle();
  }

  useEffect(() => {
    if (shouldTakeFocus) {
      titleRef.current?.focus();
    }
  }, [shouldTakeFocus]);

  return (
    <li className={rowClassName(event)}>
      <span className="agenda-bar" aria-hidden="true" />
      <EventTimes translate={translate} event={event} />
      <div className="agenda-thumbnail">
        <EventCover
          url={event.coverThumbUrl}
          eventType={event.eventType}
          iconSize={24}
        />
      </div>
      <div className="agenda-body">
        <h3 ref={titleRef} className="agenda-title" tabIndex={-1}>
          <button
            type="button"
            className="agenda-toggle"
            aria-expanded={isExpanded}
            aria-controls={detailId}
            onClick={toggleRow}
          >
            <span className="agenda-title-text">{event.title}</span>
            <span className="agenda-chevron" aria-hidden="true" />
          </button>
        </h3>
        <div className="agenda-meta">
          <EventTypeTag translate={translate} eventType={event.eventType} />
          {isCancelled ? (
            <span className="agenda-cancelled">
              {translate("calendar.event.cancelled")}
            </span>
          ) : null}
          {event.seriesId === null ? null : (
            <span className="agenda-repeat">
              <Repeat aria-hidden="true" focusable="false" size={14} />
              <span className="visually-hidden">
                {translate("calendar.event.repeats")}
              </span>
            </span>
          )}
          <PlaceLink translate={translate} event={event} />
        </div>
      </div>
      <div className="agenda-side">
        <MyAnswer
          translate={translate}
          myResponse={state.tally.myResponse}
          canRespond={canRespond}
        />
        <p className="agenda-going">
          {translate("calendar.event.going", {
            count: state.tally.goingCount,
          })}
        </p>
      </div>
      <div id={detailId} className="agenda-detail" hidden={!isExpanded}>
        <div className="agenda-footer">
          {canRespond ? (
            <EventRsvp
              translate={translate}
              title={event.title}
              savedResponse={state.tally.myResponse}
              pendingResponse={state.pendingResponse}
              onRespond={respond}
              disabledReasonId={rsvpDisabledReasonId}
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
        {isExpanded ? (
          <EventDetailPanel
            translate={translate}
            detail={detail}
            onRetry={retry}
          />
        ) : null}
        {isExpanded && canHaveTeams ? (
          <EventTeams
            translate={translate}
            state={teams.team}
            isCancelled={isCancelled}
            onRetry={teams.retry}
          />
        ) : null}
        {isExpanded && canTakeAttendance && canTakeAttendanceOf(event) ? (
          <TakeAttendanceLink translate={translate} eventId={event.id} />
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
    </li>
  );
}
