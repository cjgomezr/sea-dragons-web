"use client";

import { useEffect, useId } from "react";
import {
  formatCalendarDayParts,
  formatClockTime,
  formatOverallRating,
} from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import {
  ActionNotices,
  PublishConfirmation,
  SaveAndPublish,
} from "./TeamActions";
import {
  type BuildableEvent,
  describeTeamsFailure,
} from "./team-builder-client";
import {
  type TeamDraft,
  draftSuggestion,
  draftTotals,
  findPlayer,
  hasUnsavedChanges,
} from "./team-draft";
import { BenchLists, TeamColumns } from "./TeamLists";
import { SwapSuggestion, TotalsBar } from "./TeamSummary";
import {
  type BuilderState,
  type LastMove,
  type TeamBuilderControls,
  useTeamBuilder,
} from "./use-team-builder";

/**
 * El reparto de un evento (#402), siguiendo docs/mockups/team-light.png: el
 * título, guardar y publicar, el selector de evento, el control de modo y
 * "Balancear equipos", la barra de totales, las dos columnas, la sugerencia
 * y las listas de disponibles y "Quizás".
 *
 * Se monta de nuevo con cada evento (la pantalla le pone su id como clave),
 * así lo movido en uno no se cuela en otro. Por eso el selector vive aquí:
 * es el que sabe si hay cambios que descartar antes de irse.
 */

type ReadyState = Extract<BuilderState, { kind: "ready" }>;

/** "Sat 19 Jun": el día del evento, sin el cero delante. */
export function eventDay(translate: Translator, startsOn: string): string {
  const { weekday, day, month } = formatCalendarDayParts(
    translate.locale,
    startsOn,
  );
  return `${weekday} ${Number(day)} ${month}`;
}

function EventPicker({
  translate,
  events,
  openedId,
  onChoose,
}: {
  readonly translate: Translator;
  readonly events: readonly BuildableEvent[];
  readonly openedId: string;
  readonly onChoose: (eventId: string) => void;
}): React.JSX.Element {
  const selectId = useId();
  return (
    <div className="team-event-picker">
      <label htmlFor={selectId}>{translate("teams.event.label")}</label>
      <select
        id={selectId}
        value={openedId}
        onChange={(event) => onChoose(event.target.value)}
      >
        {events.map((event) => (
          <option key={event.id} value={event.id}>
            {translate("teams.event.choice", {
              day: eventDay(translate, event.startsOn),
              time: formatClockTime(translate.locale, event.startTime),
              title: event.title,
            })}
          </option>
        ))}
      </select>
    </div>
  );
}

/** "Auto-balance" en el control hace lo mismo que "Balancear equipos": el
 * modo automático es el resultado de balancear, no un ajuste aparte. */
function ModeControl({
  translate,
  controls,
  state,
}: {
  readonly translate: Translator;
  readonly controls: TeamBuilderControls;
  readonly state: ReadyState;
}): React.JSX.Element {
  const isBalancing = state.action.kind === "balancing";
  return (
    <div className="team-mode-row">
      <div
        className="team-mode"
        role="group"
        aria-label={translate("teams.mode.label")}
      >
        <button
          type="button"
          aria-pressed={state.draft.mode === "manual"}
          onClick={controls.chooseManual}
        >
          {translate("teams.mode.manual")}
        </button>
        <button
          type="button"
          aria-pressed={state.draft.mode === "auto"}
          onClick={() => void controls.balance()}
        >
          {translate("teams.mode.auto")}
        </button>
      </div>
      <button
        type="button"
        className="auth-submit team-balance"
        aria-busy={isBalancing}
        onClick={() => void controls.balance()}
      >
        {translate(isBalancing ? "teams.balancing" : "teams.balance")}
      </button>
    </div>
  );
}

/** A dónde fue un jugador, o null si salió de los equipos sin volver a
 * ninguna lista (un asignado que ya no estaba en la escuadra). */
function destinationName(
  translate: Translator,
  draft: TeamDraft,
  move: Extract<LastMove, { kind: "move" }>,
): string | null {
  if (move.destination !== "bench") {
    return draft.teams[move.destination].name;
  }
  const { origin } = findPlayer(draft, move.userId);
  return origin === "outside" ? null : translate(`teams.${origin}.title`);
}

/** Quién fue a dónde, sin los totales. */
function describeWhere(
  translate: Translator,
  draft: TeamDraft,
  move: LastMove,
): string {
  const nameOf = (userId: string) => findPlayer(draft, userId).fullName;
  if (move.kind === "swap") {
    return translate("teams.announce.swapped", {
      first: nameOf(move.fromA),
      second: nameOf(move.fromB),
    });
  }
  const player = nameOf(move.userId);
  const list = destinationName(translate, draft, move);
  return list === null
    ? translate("teams.announce.removed", { player })
    : translate("teams.announce.moved", { player, list });
}

/** Lo que se lee al mover: a dónde fue y cómo quedan los totales. */
function describeMove(
  translate: Translator,
  draft: TeamDraft,
  move: LastMove,
): string {
  const totals = draftTotals(draft);
  const points = (value: number) =>
    formatOverallRating(translate.locale, value);
  const where = describeWhere(translate, draft, move);
  return `${where} ${translate("teams.announce.totals", {
    teamA: draft.teams.a.name,
    pointsA: points(totals.a.combinedRating),
    teamB: draft.teams.b.name,
    pointsB: points(totals.b.combinedRating),
    difference: points(totals.ratingDifference),
  })}`;
}

function useWarnBeforeLeaving(hasChanges: boolean): void {
  useEffect(() => {
    if (!hasChanges) {
      return;
    }
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasChanges]);
}

function assignedCount(draft: TeamDraft): number {
  return draft.assignments.length;
}

function Publishing({
  translate,
  controls,
  state,
}: {
  readonly translate: Translator;
  readonly controls: TeamBuilderControls;
  readonly state: ReadyState;
}): React.JSX.Element | null {
  const { kind } = state.action;
  if (kind !== "confirmingPublish" && kind !== "publishing") {
    return null;
  }
  return (
    <PublishConfirmation
      translate={translate}
      assignedCount={assignedCount(state.draft)}
      wasPublished={state.draft.publishedAt !== null}
      isPublishing={kind === "publishing"}
      onConfirm={() => void controls.publish()}
      onCancel={controls.cancelPublish}
    />
  );
}

/** Siempre en el DOM, como el `status`: anuncia cada movimiento. */
function MoveAnnouncer({
  translate,
  state,
}: {
  readonly translate: Translator;
  readonly state: ReadyState;
}): React.JSX.Element {
  return (
    <p className="visually-hidden" aria-live="polite">
      {state.lastMove === null
        ? null
        : describeMove(translate, state.draft, state.lastMove)}
    </p>
  );
}

function SplitBoard({
  translate,
  controls,
  state,
}: {
  readonly translate: Translator;
  readonly controls: TeamBuilderControls;
  readonly state: ReadyState;
}): React.JSX.Element {
  const { draft } = state;
  const totals = draftTotals(draft);
  const suggestion = draftSuggestion(draft);
  return (
    <>
      <TotalsBar translate={translate} teams={draft.teams} totals={totals} />
      <TeamColumns
        translate={translate}
        draft={draft}
        totals={totals}
        onMove={controls.move}
      />
      {suggestion === null ? null : (
        <SwapSuggestion
          translate={translate}
          suggestion={suggestion}
          onApply={() =>
            controls.swap(suggestion.fromA.userId, suggestion.fromB.userId)
          }
        />
      )}
      <BenchLists translate={translate} draft={draft} onMove={controls.move} />
    </>
  );
}

function LoadFailure({
  translate,
  controls,
  state,
}: {
  readonly translate: Translator;
  readonly controls: TeamBuilderControls;
  readonly state: Extract<BuilderState, { kind: "failed" }>;
}): React.JSX.Element {
  return (
    <div className="admin-load-failure">
      <p className="auth-error" role="alert">
        {describeTeamsFailure(translate, state.failure)}
      </p>
      <button type="button" className="auth-submit" onClick={controls.retry}>
        {translate("teams.retry")}
      </button>
    </div>
  );
}

function Heading({
  translate,
  event,
  children,
}: {
  readonly translate: Translator;
  readonly event: BuildableEvent;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="team-header">
      <div className="team-heading">
        <p className="team-eyebrow">{translate("teams.eyebrow")}</p>
        <h1>
          {translate("teams.title", {
            day: eventDay(translate, event.startsOn),
            title: event.title,
          })}
        </h1>
        <p className="team-lead">{translate("teams.lead")}</p>
      </div>
      {children}
    </header>
  );
}

function ReadyBuilder({
  translate,
  controls,
  state,
  picker,
}: {
  readonly translate: Translator;
  readonly controls: TeamBuilderControls;
  readonly state: ReadyState;
  readonly picker: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <div className="team-toolbar">
        {picker}
        <ModeControl translate={translate} controls={controls} state={state} />
      </div>
      <Publishing translate={translate} controls={controls} state={state} />
      <ActionNotices translate={translate} action={state.action} />
      <MoveAnnouncer translate={translate} state={state} />
      <SplitBoard translate={translate} controls={controls} state={state} />
    </>
  );
}

export function TeamBuilderPanel({
  translate,
  event,
  events,
  onChooseEvent,
}: {
  readonly translate: Translator;
  readonly event: BuildableEvent;
  readonly events: readonly BuildableEvent[];
  readonly onChooseEvent: (eventId: string) => void;
}): React.JSX.Element {
  const controls = useTeamBuilder(event.id);
  const { state } = controls;
  const hasChanges = state.kind === "ready" && hasUnsavedChanges(state.draft);
  useWarnBeforeLeaving(hasChanges);

  function chooseEvent(choice: string): void {
    // El diálogo nativo basta: es una pregunta de sí o no y el navegador la
    // hace accesible.
    if (
      choice === event.id ||
      (hasChanges && !window.confirm(translate("teams.discardQuestion")))
    ) {
      return;
    }
    onChooseEvent(choice);
  }

  const picker = (
    <EventPicker
      translate={translate}
      events={events}
      openedId={event.id}
      onChoose={chooseEvent}
    />
  );
  return (
    <>
      <Heading translate={translate} event={event}>
        {state.kind === "ready" ? (
          <SaveAndPublish
            translate={translate}
            action={state.action}
            hasChanges={hasChanges}
            assignedCount={assignedCount(state.draft)}
            onSave={() => void controls.save()}
            onAskToPublish={controls.askToPublish}
          />
        ) : null}
      </Heading>
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("teams.loadingSquad")}</p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure translate={translate} controls={controls} state={state} />
      ) : null}
      {state.kind === "ready" ? (
        <ReadyBuilder
          translate={translate}
          controls={controls}
          state={state}
          picker={picker}
        />
      ) : null}
    </>
  );
}
