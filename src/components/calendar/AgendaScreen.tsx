"use client";

import { useEffect, useState } from "react";
import type { AgendaEvent } from "@/lib/events/event-agenda";
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
 *
 * Es de cliente porque cambia sin recargar: "Ver más" añade la página
 * siguiente al final sin volver a pedir ni reordenar lo que ya hay, y cada
 * fila guarda su respuesta. Lee por la API v1, la misma que usará la
 * aplicación nativa de Release 2 (CON-002).
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
  events,
  focusEventId,
}: {
  readonly translate: Translator;
  readonly events: readonly AgendaEvent[];
  readonly focusEventId: string | null;
}): React.JSX.Element {
  if (events.length === 0) {
    return <p className="admin-empty">{translate("calendar.empty")}</p>;
  }
  return (
    <ul className="agenda-list" aria-labelledby={TITLE_ID}>
      {events.map((event) => (
        <AgendaRow
          key={event.id}
          translate={translate}
          event={event}
          shouldTakeFocus={event.id === focusEventId}
        />
      ))}
    </ul>
  );
}

export function AgendaScreen({
  locale,
}: {
  readonly locale: Locale;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [state, setState] = useState<AgendaState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadAgenda(null).then((outcome) => {
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
  }, [reloads]);

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
    const outcome = await loadAgenda(cursor);
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
    <div className="agenda">
      <header className="agenda-header">
        <p className="agenda-eyebrow">{translate("calendar.eyebrow")}</p>
        <h1 id={TITLE_ID}>{translate("calendar.title")}</h1>
      </header>
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
