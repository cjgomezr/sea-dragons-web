"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CALENDAR_PATH } from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import {
  type BuildableEvent,
  type TeamsFailure,
  describeTeamsFailure,
  loadBuildableEvents,
} from "./team-builder-client";
import { TeamBuilderPanel } from "./TeamBuilderPanel";

/**
 * La pantalla de Equipos (#402, RF-9 del PRD de E10): donde Admin y Coach
 * arman los dos equipos de un entrenamiento o una competición. Abre el
 * evento armable más cercano y deja elegir otro.
 *
 * Es de cliente porque se mueve sin recargar y los totales cambian al
 * momento (AC-018). Lee y guarda sólo por la API v1 (#401), la misma que
 * usará la aplicación nativa de Release 2 (CON-002).
 */

type EventsState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: TeamsFailure }
  | { readonly kind: "ready"; readonly events: readonly BuildableEvent[] };

function useBuildableEvents(): {
  readonly state: EventsState;
  readonly retry: () => void;
} {
  const [state, setState] = useState<EventsState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadBuildableEvents().then((outcome) => {
      if (isCurrent) {
        setState(
          outcome.kind === "loaded"
            ? { kind: "ready", events: outcome.events }
            : { kind: "failed", failure: outcome },
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [reloads]);

  function retry(): void {
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  return { state, retry };
}

function EventsFallback({
  translate,
  state,
  onRetry,
}: {
  readonly translate: Translator;
  readonly state: EventsState;
  readonly onRetry: () => void;
}): React.JSX.Element {
  switch (state.kind) {
    case "loading":
      return <p className="admin-empty">{translate("teams.loading")}</p>;
    case "failed":
      return (
        <div className="admin-load-failure">
          <p className="auth-error" role="alert">
            {describeTeamsFailure(translate, state.failure)}
          </p>
          <button type="button" className="auth-submit" onClick={onRetry}>
            {translate("teams.retry")}
          </button>
        </div>
      );
    case "ready":
      return (
        <div className="team-no-events">
          <p className="admin-empty">{translate("teams.noEvents")}</p>
          <Link href={CALENDAR_PATH} className="admin-secondary">
            {translate("teams.toCalendar")}
          </Link>
        </div>
      );
  }
}

export function TeamBuilderScreen({
  locale,
}: {
  readonly locale: Locale;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const events = useBuildableEvents();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const list = events.state.kind === "ready" ? events.state.events : [];
  const opened =
    list.find((event) => event.id === chosenId) ?? list.at(0) ?? null;

  if (opened !== null) {
    return (
      <div className="teams">
        <TeamBuilderPanel
          key={opened.id}
          translate={translate}
          event={opened}
          events={list}
          onChooseEvent={setChosenId}
        />
      </div>
    );
  }
  return (
    <div className="teams">
      <header className="team-header">
        <h1>{translate("nav.label.teams")}</h1>
      </header>
      <EventsFallback
        translate={translate}
        state={events.state}
        onRetry={events.retry}
      />
    </div>
  );
}
