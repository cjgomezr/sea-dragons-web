import { MapPin } from "@phosphor-icons/react/dist/ssr/MapPin";
import { Repeat } from "@phosphor-icons/react/dist/ssr/Repeat";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
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
import { EventDetailPanel, type PanelSlots } from "./EventDetailPanel";
import {
  type EventOrganizer,
  EventOrganizerActions,
} from "./EventOrganizerActions";
import { EventRsvp } from "./EventRsvp";
import { EventTeams } from "./EventTeams";
import { EventTypeTag } from "./EventTypeTag";
import { type EventDetailState, useEventDetail } from "./use-event-detail";
import { type EventRsvpState, useEventRsvp } from "./use-event-rsvp";
import { useEventTeam } from "./use-event-team";

/**
 * Una fila de la agenda (#311, RF-7, AC-046), con la forma de E24 (#647,
 * RF-6): la barra del color del tipo, la hora de inicio y la de fin debajo,
 * la miniatura o el fondo del tipo, el título, la línea con la etiqueta, la
 * repetición y el lugar, y a la derecha mi respuesta y cuántos van. El color
 * acompaña: el tipo lo nombra su etiqueta y el cancelado, su palabra.
 *
 * El lugar es un enlace aparte al mapa, en otra pestaña. No llega a la fila:
 * pulsarlo no la elige.
 *
 * El título es el botón que elige la fila (#648, RF-7 del PRD de E24), así
 * Enter y Espacio la eligen; con el ratón se pulsa en cualquier punto de la
 * tarjeta. La elegida pinta su evento en el panel de al lado, que sustituye
 * al acordeón de #312. El panel sale de la fila, por un portal, porque la
 * fila es dueña de su respuesta, su detalle y sus equipos: así cambiar de
 * fila no pierde nada y la píldora cambia cuando se responde en el panel.
 *
 * Responde quien es de la audiencia de un evento que sigue en pie. A un
 * cancelado no se le responde, y quien organiza ve también los eventos que no
 * son para él (B7): esos no llevan botones. A un pasado tampoco (#312).
 *
 * A quien organiza, el panel de un evento futuro que sigue en pie le ofrece
 * editarlo y cancelarlo (#316).
 *
 * A quien pasa lista, el de un entrenamiento que ya empezó y sigue en pie le
 * ofrece "Pasar lista" (#395), que abre Asistencia con esa sesión. Puede estar
 * en Próximos: el de hoy sigue ahí aunque ya haya empezado.
 *
 * El de un entrenamiento o una competición enseña además los equipos del
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
      className="auth-submit agenda-take-attendance"
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

/** "¿Vas?" en el panel, con lo que se está guardando y el fallo. */
function RsvpSection({
  translate,
  title,
  rsvp,
  disabledReasonId,
}: {
  readonly translate: Translator;
  readonly title: string;
  readonly rsvp: {
    readonly state: EventRsvpState;
    readonly respond: (response: RsvpResponse) => void;
  };
  readonly disabledReasonId: string | null;
}): React.JSX.Element {
  const { state, respond } = rsvp;
  return (
    <div className="agenda-panel-section">
      <EventRsvp
        translate={translate}
        title={title}
        savedResponse={state.tally.myResponse}
        pendingResponse={state.pendingResponse}
        onRespond={respond}
        disabledReasonId={disabledReasonId}
        variant="panel"
      />
      <p className="agenda-rsvp-status" role="status">
        {state.pendingResponse === null
          ? null
          : translate("calendar.rsvp.saving")}
      </p>
      {state.failure === null ? null : (
        <p className="auth-error agenda-rsvp-error" role="alert">
          {describeRsvpFailure(translate, state.failure)}
        </p>
      )}
    </div>
  );
}

/** La fila de acciones del panel: Pasar lista, Editar y Cancelar, cada una
 * para quien puede. Editar y Cancelar esperan a la audiencia del detalle,
 * que el diálogo necesita. */
function PanelActions({
  translate,
  event,
  detail,
  goingCount,
  organizer,
  canTakeAttendance,
}: {
  readonly translate: Translator;
  readonly event: AgendaEvent;
  readonly detail: EventDetailState;
  readonly goingCount: number;
  /** Nulo si quien mira no puede editar ni cancelar este evento. */
  readonly organizer: EventOrganizer | null;
  readonly canTakeAttendance: boolean;
}): React.JSX.Element | null {
  const opened = detail.kind === "loaded" ? detail.opened : null;
  const audience = opened === null ? null : opened.audience;
  const canManage = organizer !== null && opened !== null && audience !== null;
  if (!canTakeAttendance && !canManage) {
    return null;
  }
  return (
    <div className="agenda-panel-actions">
      {canTakeAttendance ? (
        <TakeAttendanceLink translate={translate} eventId={event.id} />
      ) : null}
      {canManage ? (
        <EventOrganizerActions
          translate={translate}
          event={event}
          details={{
            notes: opened.notes,
            audience,
            coverUrl: opened.coverUrl,
            series: opened.series,
          }}
          goingCount={goingCount}
          organizer={organizer}
        />
      ) : null}
    </div>
  );
}

function rowClassName(event: AgendaEvent, isSelected: boolean): string {
  const classes = [
    "agenda-row",
    `agenda-row-${event.eventType}`,
    ...(event.status === "cancelled" ? ["is-cancelled"] : []),
    ...(isSelected ? ["is-selected"] : []),
  ];
  return classes.join(" ");
}

/** Dónde pinta su panel la fila elegida (#648). */
export type PanelTarget = {
  /** El hueco junto a la lista; nulo hasta que se monta. */
  readonly slot: HTMLElement | null;
  /** El id del panel, al que apunta el botón de cada fila. */
  readonly id: string;
  /** Si el panel se llevó el foco al elegirse: lo eligió un gesto, no la
   * carga de la agenda. */
  readonly shouldTakeFocus: boolean;
};

export function AgendaRow({
  translate,
  event,
  period,
  shouldTakeFocus,
  isSelected,
  onSelect,
  panel,
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
  /** Si es la fila cuyo evento enseña el panel. */
  readonly isSelected: boolean;
  readonly onSelect: () => void;
  readonly panel: PanelTarget;
  /** Nulo para quien no organiza eventos. */
  readonly organizer: EventOrganizer | null;
  /** Si quien mira registra asistencia. Sólo decide si se pinta el enlace:
   * la frontera ya reserva Asistencia a Admin y Coach. */
  readonly canTakeAttendance: boolean;
  /** El id de la frase que dice por qué quien mira no puede responder (#453),
   * o `null` si puede. */
  readonly rsvpDisabledReasonId: string | null;
}): React.JSX.Element {
  const { detail, open, retry, receive } = useEventDetail(event.id);
  const rsvp = useEventRsvp(event, receive);
  const { tally } = rsvp.state;
  const teams = useEventTeam(event.id);
  // Los equipos son de socio (#453): sin la membresía al día la frontera los
  // cierra, así que ni se piden.
  const isMembershipCurrent = rsvpDisabledReasonId === null;
  const canHaveTeams =
    isMembershipCurrent && BUILDABLE_EVENT_TYPES.includes(event.eventType);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const { open: openTeam } = teams;
  const isCancelled = event.status === "cancelled";
  const canRespond = period === "upcoming" && event.inAudience && !isCancelled;
  const canManage = organizer !== null && period === "upcoming" && !isCancelled;

  // Elegida, la fila pide su detalle y sus equipos. Los dos se guardan y sólo
  // se piden la primera vez: volver a elegirla no pide otra vez.
  useEffect(() => {
    if (!isSelected) {
      return;
    }
    open();
    if (canHaveTeams) {
      openTeam();
    }
  }, [isSelected, canHaveTeams, open, openTeam]);

  useEffect(() => {
    if (shouldTakeFocus) {
      titleRef.current?.focus();
    }
  }, [shouldTakeFocus]);

  const slots: PanelSlots = {
    rsvp: canRespond ? (
      <RsvpSection
        translate={translate}
        title={event.title}
        rsvp={rsvp}
        disabledReasonId={rsvpDisabledReasonId}
      />
    ) : null,
    teams: canHaveTeams ? (
      <EventTeams
        translate={translate}
        state={teams.team}
        isCancelled={isCancelled}
        onRetry={teams.retry}
      />
    ) : null,
    actions: (
      <PanelActions
        translate={translate}
        event={event}
        detail={detail}
        goingCount={tally.goingCount}
        organizer={canManage ? organizer : null}
        canTakeAttendance={canTakeAttendance && canTakeAttendanceOf(event)}
      />
    ),
  };

  return (
    <li className={rowClassName(event, isSelected)}>
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
            ref={toggleRef}
            type="button"
            className="agenda-toggle"
            aria-controls={panel.id}
            aria-current={isSelected ? "true" : undefined}
            onClick={onSelect}
          >
            <span className="agenda-title-text">{event.title}</span>
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
          myResponse={tally.myResponse}
          canRespond={canRespond}
        />
        <p className="agenda-going">
          {translate("calendar.event.going", { count: tally.goingCount })}
        </p>
      </div>
      {isSelected && panel.slot !== null
        ? createPortal(
            <EventDetailPanel
              id={panel.id}
              translate={translate}
              event={event}
              detail={detail}
              tally={tally}
              onRetry={retry}
              slots={slots}
              focus={{
                shouldTakeFocus: panel.shouldTakeFocus,
                onReturn: () => toggleRef.current?.focus(),
              }}
            />,
            panel.slot,
          )
        : null}
    </li>
  );
}
