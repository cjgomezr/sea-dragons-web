"use client";

import { useEffect, useState } from "react";
import type { AgendaEvent, AgendaPeriod } from "@/lib/events/event-agenda";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import {
  type AgendaFailure,
  describeAgendaFailure,
  loadAgenda,
} from "./agenda-client";
import { AgendaRow } from "./AgendaRow";

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
 */

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
}: {
  readonly translate: Translator;
  readonly period: AgendaPeriod;
  readonly events: readonly AgendaEvent[];
  readonly focusEventId: string | null;
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
        />
      ))}
    </ul>
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
}: {
  readonly translate: Translator;
  readonly period: AgendaPeriod;
  readonly isActive: boolean;
}): React.JSX.Element {
  const [state, setState] = useState<AgendaState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadAgenda(period, null).then((outcome) => {
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
              focusEventId: null,
            }
          : { kind: "failed", failure: outcome },
      );
    });
    return () => {
      isCurrent = false;
    };
  }, [period, reloads]);

  function retryLoad(): void {
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
          onRetry={retryLoad}
        />
      ) : null}
      {state.kind === "ready" ? (
        <AgendaList
          translate={translate}
          period={period}
          events={state.events}
          focusEventId={state.focusEventId}
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

export function AgendaScreen({
  locale,
}: {
  readonly locale: Locale;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [period, setPeriod] = useState<AgendaPeriod>("upcoming");
  // Los periodos ya abiertos: uno se monta la primera vez que se elige.
  const [openedPeriods, setOpenedPeriods] = useState<ReadonlySet<AgendaPeriod>>(
    () => new Set(["upcoming"]),
  );

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
        <PeriodChoice
          translate={translate}
          period={period}
          onChoose={choosePeriod}
        />
      </header>
      {PERIODS.filter((choice) => openedPeriods.has(choice)).map((choice) => (
        <AgendaView
          key={choice}
          translate={translate}
          period={choice}
          isActive={choice === period}
        />
      ))}
    </div>
  );
}
