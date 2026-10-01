"use client";

import { useEffect, useRef, useState } from "react";
import type { AgendaEvent, AgendaPeriod } from "@/lib/events/event-agenda";
import type { EventType } from "@/lib/events/event-creation";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import {
  type AgendaFailure,
  type AgendaLoad,
  describeAgendaFailure,
  loadAgenda,
} from "./agenda-client";
import { AgendaRow } from "./AgendaRow";
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
 * quien mira de hoy en adelante, de 50 en 50, con el RSVP en cada fila. Sigue
 * docs/mockups/calendar-light.png sin el control Mes/Semana/Agenda (ASS-010).
 * En su sitio, un control cambia a los pasados (#312), del más reciente al
 * más antiguo, que es como los sirve la API.
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
  soughtEventId: string | null,
): Promise<AgendaLoad> {
  const first = await loadAgenda(period, null);
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
    const next = await loadAgenda(period, nextCursor);
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

function AgendaList({
  translate,
  period,
  events,
  focusEventId,
  organizer,
  canTakeAttendance,
}: {
  readonly translate: Translator;
  readonly period: AgendaPeriod;
  readonly events: readonly AgendaEvent[];
  readonly focusEventId: string | null;
  readonly organizer: EventOrganizer | null;
  readonly canTakeAttendance: boolean;
}): React.JSX.Element {
  if (events.length === 0) {
    return (
      <p className="admin-empty">{translate(PERIOD_TEXTS[period].empty)}</p>
    );
  }
  return (
    <ul className="agenda-list" aria-labelledby={TITLE_ID}>
      {events.map((event) => (
        <AgendaRow
          key={event.id}
          translate={translate}
          event={event}
          period={period}
          shouldTakeFocus={event.id === focusEventId}
          organizer={organizer}
          canTakeAttendance={canTakeAttendance}
        />
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

function AgendaView({
  translate,
  period,
  isActive,
  focusOnLoad,
  organizer,
  canTakeAttendance,
}: {
  readonly translate: Translator;
  readonly period: AgendaPeriod;
  readonly isActive: boolean;
  /** El evento cuyo título recibe el foco con la primera página. */
  readonly focusOnLoad: string | null;
  readonly organizer: EventOrganizer | null;
  readonly canTakeAttendance: boolean;
}): React.JSX.Element {
  const [state, setState] = useState<AgendaState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    const soughtEventId = reloads === 0 ? focusOnLoad : null;
    void loadFirstPages(period, soughtEventId).then((outcome) => {
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
  }, [period, reloads, focusOnLoad]);

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
    const outcome = await loadAgenda(period, cursor);
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

export function AgendaScreen({
  locale,
  canManageEvents,
  canTakeAttendance,
  initialPeriod = "upcoming",
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
  /** Dónde abre: un evento pasado de la búsqueda global vive en los pasados
   * (#427). */
  readonly initialPeriod?: AgendaPeriod;
  /** El evento cuyo título recibe el foco al llegar, como el que se abrió
   * desde la búsqueda global (#427). */
  readonly focusEventId?: string | null;
  /** El tipo con el que el formulario de crear llega ya abierto, como lo
   * pide "Nuevo entrenamiento" desde el inicio (#426). */
  readonly openCreateWith?: EventType | null;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [period, setPeriod] = useState<AgendaPeriod>(initialPeriod);
  const [notice, setNotice] = useState<AgendaNotice | null>(null);
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
      </header>
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
      {PERIODS.filter((choice) => openedPeriods.has(choice)).map((choice) => (
        <AgendaView
          key={`${choice}-${agendaVersion.number}`}
          translate={translate}
          period={choice}
          isActive={choice === period}
          focusOnLoad={agendaVersion.focusEventId}
          organizer={organizer}
          canTakeAttendance={canTakeAttendance}
        />
      ))}
    </div>
  );
}
