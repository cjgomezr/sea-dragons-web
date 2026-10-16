"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { PAYMENTS_PATH } from "@/lib/auth/routes";
import type { AgendaEvent, AgendaPeriod } from "@/lib/events/event-agenda";
import type { EventType } from "@/lib/events/event-creation";
import {
  formatAgendaDayLabel,
  formatCalendarDayWithWeekday,
} from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { calendarYearOf, clubCalendarDate } from "@/lib/time/club-calendar";
import {
  type AgendaFailure,
  type AgendaLoad,
  describeAgendaFailure,
  loadAgenda,
} from "./agenda-client";
import { classifyAgendaDay, groupAgendaByDay } from "./agenda-days";
import { AgendaRow } from "./AgendaRow";
import {
  AGENDA_TYPES_QUERY_PARAM,
  AGENDA_TYPE_CHIPS,
  agendaRequestTypes,
  readAgendaTypeFilter,
  searchWithAgendaTypes,
  toggleAgendaType,
} from "./agenda-type-filter";
import {
  type CreatedSummary,
  createEvent,
  describeCreated,
} from "./event-create-client";
import {
  EMPTY_EVENT_FORM,
  type EventForm as EventFormValues,
  toEventDraft,
} from "./event-form";
import { type ManageNotice, describeManageNotice } from "./event-manage-client";
import { EventDialog } from "./EventDialog";
import type { FormSubmission } from "./EventForm";
import type { EventOrganizer } from "./EventOrganizerActions";

/**
 * La agenda del Calendario (#311, RF-5 a RF-7 del PRD de E7): los eventos de
 * quien mira de hoy en adelante, de 50 en 50, agrupados por día. Desde E24
 * (#647, RF-6) sigue docs/mockups/calendar-redesign-agenda-dark.png: un
 * control cambia a los pasados (#312), del más reciente al más antiguo, que
 * es como los sirve la API, y unos chips filtran por tipo.
 *
 * Los chips se guardan en la dirección (`?types=`) y la agenda se vuelve a
 * pedir con ellos: filtrar lo ya cargado dejaría páginas vacías (D8). Con
 * todos apagados no se pide nada.
 *
 * Es de cliente porque cambia sin recargar: "Ver más" añade la página
 * siguiente al final sin volver a pedir ni reordenar lo que ya hay, y cada
 * fila guarda su respuesta. Lee por la API v1, la misma que usará la
 * aplicación nativa de Release 2 (CON-002).
 *
 * Una vista abierta no se desmonta al cambiar de periodo, sólo se esconde:
 * al volver a Próximos sigue todo como estaba, con las filas desplegadas y
 * las respuestas guardadas, sin pedir la agenda otra vez.
 *
 * A quien puede crear eventos le pinta "+ Evento" (#313), que abre el
 * diálogo. Al crear, las vistas se vuelven a montar y piden la agenda otra
 * vez, para que el evento salga en su sitio, ordenado por el servidor.
 *
 * Lo mismo al editar o cancelar desde una fila (#316), y también cuando el
 * servidor dice que el evento ya no admitía cambios: la agenda que había ya
 * no es la verdad. Tras volver a pedirla, el foco vuelve al título de ese
 * evento.
 */

/** Lo que la agenda anuncia tras crear, editar o cancelar. */
type AgendaNotice =
  { readonly kind: "created"; readonly summary: CreatedSummary } | ManageNotice;

/** Cada vez que la agenda se vuelve a pedir, y el evento cuyo título recibe
 * el foco al llegar. */
type AgendaVersion = {
  readonly number: number;
  readonly focusEventId: string | null;
};

type MoreState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: AgendaFailure };

type AgendaState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: AgendaFailure }
  | {
      readonly kind: "ready";
      readonly events: readonly AgendaEvent[];
      readonly nextCursor: string | null;
      readonly more: MoreState;
      /** La primera fila de la última página añadida, que recibe el foco.
       * Nula en la primera página: al abrir la sección el foco no se mueve. */
      readonly focusEventId: string | null;
    };

const TITLE_ID = "calendario-titulo";

// En el orden del control. No se importa `AGENDA_PERIODS`: vive junto a la
// lógica de servidor de la agenda, que no tiene por qué llegar al navegador.
const PERIODS: readonly AgendaPeriod[] = ["upcoming", "past"];

const PERIOD_TEXTS = {
  upcoming: {
    choice: "calendar.period.upcoming",
    title: "calendar.title",
    empty: "calendar.empty",
  },
  past: {
    choice: "calendar.period.past",
    title: "calendar.pastTitle",
    empty: "calendar.pastEmpty",
  },
} as const satisfies Record<AgendaPeriod, Record<string, string>>;

/** Hasta dónde se busca el evento al que se llega desde la búsqueda global
 * (#427): 200 eventos, meses de entrenamientos semanales. Más allá, la agenda
 * se queda en lo cargado y "Ver más" sigue a mano. */
const MAX_PAGES_TO_FIND_EVENT = 4;

/** La primera página y, si el evento buscado no está en ella, las siguientes
 * hasta encontrarlo o llegar al tope. Un fallo en una página de más no tumba
 * la agenda: se enseña lo que ya llegó. */
async function loadFirstPages(
  period: AgendaPeriod,
  eventTypes: readonly EventType[],
  soughtEventId: string | null,
): Promise<AgendaLoad> {
  const first = await loadAgenda(period, null, eventTypes);
  if (first.kind === "failed" || soughtEventId === null) {
    return first;
  }
  let { events, nextCursor } = first.page;
  for (
    let pages = 1;
    pages < MAX_PAGES_TO_FIND_EVENT &&
    nextCursor !== null &&
    !events.some((event) => event.id === soughtEventId);
    pages += 1
  ) {
    const next = await loadAgenda(period, nextCursor, eventTypes);
    if (next.kind === "failed") {
      break;
    }
    events = [...events, ...next.page.events];
    nextCursor = next.page.nextCursor;
  }
  return { kind: "loaded", page: { events, nextCursor } };
}

function LoadFailure({
  translate,
  failure,
  onRetry,
}: {
  readonly translate: Translator;
  readonly failure: AgendaFailure;
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="admin-load-failure">
      <p className="auth-error" role="alert">
        {describeAgendaFailure(translate, failure)}
      </p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        {translate("calendar.retry")}
      </button>
    </div>
  );
}

function LoadMore({
  translate,
  more,
  onLoadMore,
}: {
  readonly translate: Translator;
  readonly more: MoreState;
  readonly onLoadMore: () => void;
}): React.JSX.Element {
  const isLoading = more.kind === "loading";
  return (
    <div className="agenda-more">
      {more.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeAgendaFailure(translate, more.failure)}
        </p>
      ) : null}
      <button
        type="button"
        className="admin-secondary"
        onClick={onLoadMore}
        disabled={isLoading}
      >
        {translate(isLoading ? "calendar.loadingMore" : "calendar.loadMore")}
      </button>
    </div>
  );
}

/** La etiqueta de un día: "TODAY" en el acento, o "SAT · OCT 17" con "This
 * weekend" al lado. La abreviatura es para la vista; el lector de pantalla
 * oye el día entero. */
function AgendaDayHeading({
  translate,
  date,
  today,
}: {
  readonly translate: Translator;
  readonly date: string;
  readonly today: string;
}): React.JSX.Element {
  const { locale } = translate;
  const kind = classifyAgendaDay(date, today);
  const fullDate = formatCalendarDayWithWeekday(locale, date);
  if (kind === "today") {
    const todayWord = translate("calendar.day.today");
    return (
      <h2 className="agenda-day-heading">
        <span className="agenda-day-label is-today" aria-hidden="true">
          {todayWord.toLocaleUpperCase(locale)}
        </span>{" "}
        <span className="visually-hidden">{todayWord}</span>{" "}
        <span className="agenda-day-note">{fullDate}</span>
      </h2>
    );
  }
  const withYear = calendarYearOf(date) !== calendarYearOf(today);
  return (
    <h2 className="agenda-day-heading">
      <span className="agenda-day-label" aria-hidden="true">
        {formatAgendaDayLabel(locale, date, { withYear })}
      </span>{" "}
      <span className="visually-hidden">{fullDate}</span>
      {kind === "thisWeekend" ? (
        <>
          {" "}
          <span className="agenda-day-note">
            {translate("calendar.day.thisWeekend")}
          </span>
        </>
      ) : null}
    </h2>
  );
}

function AgendaList({
  translate,
  period,
  events,
  focusEventId,
  organizer,
  canTakeAttendance,
  rsvpDisabledReasonId,
}: {
  readonly translate: Translator;
  readonly period: AgendaPeriod;
  readonly events: readonly AgendaEvent[];
  readonly focusEventId: string | null;
  readonly organizer: EventOrganizer | null;
  readonly canTakeAttendance: boolean;
  readonly rsvpDisabledReasonId: string | null;
}): React.JSX.Element {
  if (events.length === 0) {
    return (
      <p className="admin-empty">{translate(PERIOD_TEXTS[period].empty)}</p>
    );
  }
  const today = clubCalendarDate(new Date());
  return (
    <ul className="agenda-list" aria-labelledby={TITLE_ID}>
      {groupAgendaByDay(events).map((day) => (
        <li key={day.date} className="agenda-day">
          <AgendaDayHeading
            translate={translate}
            date={day.date}
            today={today}
          />
          <ul className="agenda-day-events">
            {day.events.map((event) => (
              <AgendaRow
                key={event.id}
                translate={translate}
                event={event}
                period={period}
                shouldTakeFocus={event.id === focusEventId}
                organizer={organizer}
                canTakeAttendance={canTakeAttendance}
                rsvpDisabledReasonId={rsvpDisabledReasonId}
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** "+ Evento" y el diálogo que abre. Al cerrarse, el foco vuelve al botón.
 * Con `openWith` el diálogo ya llega abierto con ese tipo elegido. */
function CreateEventButton({
  translate,
  openWith,
  onOpen,
  onCreated,
}: {
  readonly translate: Translator;
  readonly openWith: EventType | null;
  readonly onOpen: () => void;
  readonly onCreated: (summary: CreatedSummary) => void;
}): React.JSX.Element {
  const [isDialogOpen, setIsDialogOpen] = useState(openWith !== null);
  const openButtonRef = useRef<HTMLButtonElement>(null);

  function handleClosed(): void {
    setIsDialogOpen(false);
    openButtonRef.current?.focus();
  }

  async function submit(form: EventFormValues): Promise<FormSubmission> {
    const creation = await createEvent(toEventDraft(form));
    if (creation.kind === "failed") {
      return creation;
    }
    onCreated(creation.summary);
    return { kind: "finished" };
  }

  return (
    <>
      <button
        ref={openButtonRef}
        type="button"
        className="auth-submit agenda-create"
        onClick={() => {
          onOpen();
          setIsDialogOpen(true);
        }}
      >
        <span aria-hidden="true">+ </span>
        {translate("calendar.create.open")}
      </button>
      {isDialogOpen ? (
        <EventDialog
          translate={translate}
          layout="create"
          initialForm={
            openWith === null
              ? EMPTY_EVENT_FORM
              : { ...EMPTY_EVENT_FORM, eventType: openWith }
          }
          submit={submit}
          onClosed={handleClosed}
        />
      ) : null}
    </>
  );
}

function PeriodChoice({
  translate,
  period,
  onChoose,
}: {
  readonly translate: Translator;
  readonly period: AgendaPeriod;
  readonly onChoose: (period: AgendaPeriod) => void;
}): React.JSX.Element {
  return (
    <div
      className="agenda-period"
      role="group"
      aria-label={translate("calendar.period.label")}
    >
      {PERIODS.map((choice) => (
        <button
          key={choice}
          type="button"
          className="agenda-period-choice"
          aria-pressed={choice === period}
          onClick={() => onChoose(choice)}
        >
          {translate(PERIOD_TEXTS[choice].choice)}
        </button>
      ))}
    </div>
  );
}

/** Un chip por tipo, con su punto de color. Encendido lleva el tinte del
 * tipo; el color acompaña, `aria-pressed` es lo que se anuncia. */
function TypeChips({
  translate,
  chosenTypes,
  onToggle,
}: {
  readonly translate: Translator;
  readonly chosenTypes: readonly EventType[];
  readonly onToggle: (eventType: EventType) => void;
}): React.JSX.Element {
  return (
    <div
      className="agenda-chips"
      role="group"
      aria-label={translate("calendar.types.label")}
    >
      {AGENDA_TYPE_CHIPS.map((eventType) => (
        <button
          key={eventType}
          type="button"
          className={`agenda-chip agenda-chip-${eventType}`}
          aria-pressed={chosenTypes.includes(eventType)}
          onClick={() => onToggle(eventType)}
        >
          <span className="agenda-chip-dot" aria-hidden="true" />
          {translate(`event.type.${eventType}`)}
        </button>
      ))}
    </div>
  );
}

function NoTypesChosen({
  translate,
  onShowAll,
}: {
  readonly translate: Translator;
  readonly onShowAll: () => void;
}): React.JSX.Element {
  return (
    <div className="agenda-no-types">
      <p className="admin-empty">{translate("calendar.types.empty")}</p>
      <button type="button" className="admin-secondary" onClick={onShowAll}>
        {translate("calendar.types.showAll")}
      </button>
    </div>
  );
}

/** Los tipos de la dirección. Un parámetro repetido no dice cuál de los dos
 * y enciende todos, como lo lee la página en el servidor. */
function readAddressTypes(searchParams: URLSearchParams): readonly EventType[] {
  const values = searchParams.getAll(AGENDA_TYPES_QUERY_PARAM);
  return values.length > 1
    ? AGENDA_TYPE_CHIPS
    : readAgendaTypeFilter(values.at(0) ?? null);
}

/** Escribe el filtro en la dirección sin pedir la página otra vez. Se
 * reemplaza la entrada del historial: volver atrás sale del calendario, y al
 * volver a él la dirección trae el mismo filtro. Next la sincroniza con su
 * router. */
function writeTypesToAddress(eventTypes: readonly EventType[]): void {
  const { pathname, search } = window.location;
  window.history.replaceState(
    null,
    "",
    `${pathname}${searchWithAgendaTypes(search, eventTypes)}`,
  );
}

function AgendaView({
  translate,
  period,
  eventTypes,
  isActive,
  focusOnLoad,
  organizer,
  canTakeAttendance,
  rsvpDisabledReasonId,
}: {
  readonly translate: Translator;
  readonly period: AgendaPeriod;
  /** Los tipos que se piden; ninguno, todos. */
  readonly eventTypes: readonly EventType[];
  readonly isActive: boolean;
  /** El evento cuyo título recibe el foco con la primera página. */
  readonly focusOnLoad: string | null;
  readonly organizer: EventOrganizer | null;
  readonly canTakeAttendance: boolean;
  readonly rsvpDisabledReasonId: string | null;
}): React.JSX.Element {
  const [state, setState] = useState<AgendaState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    const soughtEventId = reloads === 0 ? focusOnLoad : null;
    void loadFirstPages(period, eventTypes, soughtEventId).then((outcome) => {
      if (!isCurrent) {
        return;
      }
      setState(
        outcome.kind === "loaded"
          ? {
              kind: "ready",
              events: outcome.page.events,
              nextCursor: outcome.page.nextCursor,
              more: { kind: "idle" },
              focusEventId: soughtEventId,
            }
          : { kind: "failed", failure: outcome },
      );
    });
    return () => {
      isCurrent = false;
    };
  }, [period, eventTypes, reloads, focusOnLoad]);

  function reloadAgenda(): void {
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  async function loadMore(cursor: string): Promise<void> {
    setState((current) =>
      current.kind === "ready"
        ? { ...current, more: { kind: "loading" } }
        : current,
    );
    const outcome = await loadAgenda(period, cursor, eventTypes);
    setState((current) => {
      if (current.kind !== "ready") {
        return current;
      }
      if (outcome.kind === "failed") {
        return { ...current, more: { kind: "failed", failure: outcome } };
      }
      return {
        kind: "ready",
        events: [...current.events, ...outcome.page.events],
        nextCursor: outcome.page.nextCursor,
        more: { kind: "idle" },
        focusEventId: outcome.page.events.at(0)?.id ?? null,
      };
    });
  }

  const nextCursor = state.kind === "ready" ? state.nextCursor : null;

  return (
    <div className="agenda-view" hidden={!isActive}>
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("calendar.loading")}</p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure
          translate={translate}
          failure={state.failure}
          onRetry={reloadAgenda}
        />
      ) : null}
      {state.kind === "ready" ? (
        <AgendaList
          translate={translate}
          period={period}
          events={state.events}
          focusEventId={state.focusEventId}
          organizer={organizer}
          canTakeAttendance={canTakeAttendance}
          rsvpDisabledReasonId={rsvpDisabledReasonId}
        />
      ) : null}
      {state.kind === "ready" && nextCursor !== null ? (
        <LoadMore
          translate={translate}
          more={state.more}
          onLoadMore={() => void loadMore(nextCursor)}
        />
      ) : null}
    </div>
  );
}

function describeNotice(translate: Translator, notice: AgendaNotice): string {
  return notice.kind === "created"
    ? describeCreated(translate, notice.summary)
    : describeManageNotice(translate, notice);
}

/** La frase de quien no puede responder porque su membresía no está al día
 * (#453), con el enlace a donde se arregla. */
function MembershipRsvpNotice({
  translate,
  id,
}: {
  readonly translate: Translator;
  readonly id: string;
}): React.JSX.Element {
  return (
    <p className="membership-notice">
      <span id={id}>{translate("calendar.membership.notice")}</span>{" "}
      <Link href={PAYMENTS_PATH}>
        {translate("calendar.membership.toPayments")}
      </Link>
    </p>
  );
}

export function AgendaScreen({
  locale,
  canManageEvents,
  canTakeAttendance,
  canRespond,
  initialPeriod = "upcoming",
  initialTypes = AGENDA_TYPE_CHIPS,
  focusEventId = null,
  openCreateWith = null,
}: {
  readonly locale: Locale;
  /** Si quien mira puede crear, editar y cancelar eventos. Sólo decide si se
   * pintan los botones: los endpoints ya rechazan a quien no tiene
   * `createEvents` (#307, #314, #315). */
  readonly canManageEvents: boolean;
  /** Si quien mira registra asistencia: decide si un entrenamiento empezado
   * ofrece "Pasar lista" (#395). */
  readonly canTakeAttendance: boolean;
  /** Si quien mira puede responder al RSVP. Sin la membresía al día ve los
   * eventos con los botones deshabilitados (#453); el endpoint ya responde
   * 403. */
  readonly canRespond: boolean;
  /** Dónde abre: un evento pasado de la búsqueda global vive en los pasados
   * (#427). */
  readonly initialPeriod?: AgendaPeriod;
  /** Los tipos encendidos al abrir, los de `?types=` (#647). */
  readonly initialTypes?: readonly EventType[];
  /** El evento cuyo título recibe el foco al llegar, como el que se abrió
   * desde la búsqueda global (#427). */
  readonly focusEventId?: string | null;
  /** El tipo con el que el formulario de crear llega ya abierto, como lo
   * pide "Nuevo entrenamiento" desde el inicio (#426). */
  readonly openCreateWith?: EventType | null;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const membershipNoticeId = useId();
  const rsvpDisabledReasonId = canRespond ? null : membershipNoticeId;
  const [period, setPeriod] = useState<AgendaPeriod>(initialPeriod);
  const [notice, setNotice] = useState<AgendaNotice | null>(null);
  // En el navegador manda la dirección: al volver atrás, el router pinta la
  // página con los props de antes de filtrar, sin `?types=`. Fuera de un
  // router no hay dirección y valen los props.
  const searchParams = useSearchParams();
  const [chosenTypes, setChosenTypes] = useState<readonly EventType[]>(() =>
    searchParams === null ? initialTypes : readAddressTypes(searchParams),
  );
  // Cambia con cada evento creado, editado o cancelado: la clave nueva vuelve
  // a montar las vistas.
  const [agendaVersion, setAgendaVersion] = useState<AgendaVersion>({
    number: 0,
    focusEventId,
  });
  // Los periodos ya abiertos: uno se monta la primera vez que se elige.
  const [openedPeriods, setOpenedPeriods] = useState<ReadonlySet<AgendaPeriod>>(
    () => new Set([initialPeriod]),
  );

  function reloadAgenda(eventToFocus: string | null): void {
    setAgendaVersion((version) => ({
      number: version.number + 1,
      focusEventId: eventToFocus,
    }));
  }

  const organizer: EventOrganizer | null = canManageEvents
    ? {
        onSettled: (eventId, managed) => {
          setNotice(managed);
          reloadAgenda(eventId);
        },
      }
    : null;

  function chooseTypes(eventTypes: readonly EventType[]): void {
    setChosenTypes(eventTypes);
    writeTypesToAddress(eventTypes);
    // Vuelve a montar las vistas: la agenda llega de cero con los tipos nuevos
    // y el foco no salta al evento con el que se abrió.
    reloadAgenda(null);
  }

  function choosePeriod(choice: AgendaPeriod): void {
    setPeriod(choice);
    setOpenedPeriods((current) =>
      current.has(choice) ? current : new Set([...current, choice]),
    );
  }

  return (
    <div className="agenda">
      <header className="agenda-header">
        <div>
          <p className="agenda-eyebrow">{translate("calendar.eyebrow")}</p>
          <h1 id={TITLE_ID}>{translate(PERIOD_TEXTS[period].title)}</h1>
        </div>
        <div className="agenda-actions">
          <PeriodChoice
            translate={translate}
            period={period}
            onChoose={choosePeriod}
          />
          {canManageEvents ? (
            <CreateEventButton
              translate={translate}
              openWith={openCreateWith}
              onOpen={() => setNotice(null)}
              onCreated={(summary) => {
                setNotice({ kind: "created", summary });
                reloadAgenda(null);
              }}
            />
          ) : null}
        </div>
        <TypeChips
          translate={translate}
          chosenTypes={chosenTypes}
          onToggle={(eventType) =>
            chooseTypes(toggleAgendaType(chosenTypes, eventType))
          }
        />
      </header>
      {rsvpDisabledReasonId === null ? null : (
        <MembershipRsvpNotice translate={translate} id={rsvpDisabledReasonId} />
      )}
      {/* Siempre en el DOM: un lector de pantalla sólo anuncia los cambios
          de una región que ya estaba. */}
      {canManageEvents ? (
        <p className="agenda-notice" role="status">
          {notice === null || notice.kind === "closed"
            ? null
            : describeNotice(translate, notice)}
        </p>
      ) : null}
      {notice?.kind === "closed" ? (
        <p className="auth-error agenda-closed" role="alert">
          {describeManageNotice(translate, notice)}
        </p>
      ) : null}
      {chosenTypes.length === 0 ? (
        <NoTypesChosen
          translate={translate}
          onShowAll={() => chooseTypes(AGENDA_TYPE_CHIPS)}
        />
      ) : null}
      {chosenTypes.length === 0
        ? null
        : PERIODS.filter((choice) => openedPeriods.has(choice)).map(
            (choice) => (
              <AgendaView
                key={`${choice}-${agendaVersion.number}`}
                translate={translate}
                period={choice}
                eventTypes={agendaRequestTypes(chosenTypes)}
                isActive={choice === period}
                focusOnLoad={agendaVersion.focusEventId}
                organizer={organizer}
                canTakeAttendance={canTakeAttendance}
                rsvpDisabledReasonId={rsvpDisabledReasonId}
              />
            ),
          )}
    </div>
  );
}
