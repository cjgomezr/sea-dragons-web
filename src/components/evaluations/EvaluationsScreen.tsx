"use client";

import { useCallback, useEffect, useState } from "react";
import type { EvaluationCategories } from "@/lib/evaluations/evaluation-categories";
import {
  type EvaluationsTab,
  searchWithEvaluationsTab,
  searchWithRosterView,
} from "@/lib/evaluations/evaluations-address";
import type { MemberEvaluation } from "@/lib/evaluations/member-evaluation";
import {
  type RosterView,
  applyRosterView,
  clearRosterFilters,
  countNotEvaluated,
  rosterPositions,
} from "@/lib/evaluations/roster-view";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { EvaluationCategoriesManager } from "./EvaluationCategoriesScreen";
import { EvaluationRoster, rosterButtonId } from "./EvaluationRoster";
import { EvaluationRosterToolbar } from "./EvaluationRosterToolbar";
import { EvaluationSheet } from "./EvaluationSheet";
import {
  EvaluationsTabs,
  evaluationsPanelId,
  evaluationsTabId,
} from "./EvaluationsTabs";
import { loadCategories } from "./evaluation-categories-client";
import {
  type EvaluationFailure,
  type ScreenRoster as Roster,
  type ScreenRosterEntry,
  describeEvaluationFailure,
  loadEvaluationRoster,
} from "./evaluations-client";

/**
 * La pantalla de Evaluaciones (#322, RF-6 del PRD de E9). Desde #818 (RF-2
 * del PRD de E31) lleva las pestañas Jugadores y Categorías, y la lista es
 * una tabla con búsqueda, filtros y orden. Al lado va la ficha de quien se
 * elija, con la edición de sus valoraciones.
 *
 * Quién llega lo decide la frontera: `EVALUATIONS_PATH` está en
 * `RESTRICTED_ROUTES` para Admin y Coach, y los endpoints lo vuelven a
 * comprobar (FR-055). Es de cliente, como el directorio, porque su razón de
 * ser es cambiar sin recargar, y lee por la API v1 que usará la aplicación
 * nativa de Release 2 (CON-002).
 *
 * La pestaña, los filtros y el orden viven en la dirección (D8): la página
 * los lee al cargar y cada cambio la reemplaza, sin apilar una entrada por
 * letra escrita.
 *
 * Con `initialMemberId` abre ya la ficha de ese miembro: es a donde lleva la
 * marca de sin evaluar del directorio (#324). Si no está en la lista, se
 * queda en la lista.
 *
 * Hasta 1024 px la tabla y la ficha son dos pasos: `data-step` le dice al CSS
 * cuál enseñar, igual que la lista de avisos de #266.
 */

type RosterState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: EvaluationFailure }
  | { readonly kind: "ready"; readonly roster: Roster };

function replaceAddressSearch(search: string): void {
  window.history.replaceState(null, "", `${window.location.pathname}${search}`);
}

function currentAddressParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function countActive(categories: EvaluationCategories): number {
  return categories.filter((category) => category.isActive).length;
}

function LoadFailure({
  translate,
  failure,
  onRetry,
}: {
  translate: Translator;
  failure: EvaluationFailure;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="admin-load-failure">
      <p className="auth-error" role="alert">
        {describeEvaluationFailure(translate, failure)}
      </p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        {translate("evaluations.retry")}
      </button>
    </div>
  );
}

/** La fila de la lista con lo que el servidor acaba de confirmar. Quién
 * guardó no viene en la respuesta: queda en `null`, que es "no se sabe", en
 * vez de atribuírselo a quien lo hizo antes. */
function toRosterEntry(
  entry: ScreenRosterEntry,
  evaluation: MemberEvaluation,
): ScreenRosterEntry {
  const { userId, fullName, position, photoUrl } = entry;
  const player = { userId, fullName, position, photoUrl };
  return evaluation.status === "evaluated"
    ? {
        status: "evaluated",
        ...player,
        overall: evaluation.overallRating,
        updatedAt: evaluation.updatedAt,
        updatedBy: null,
      }
    : { status: "not_evaluated", ...player };
}

function withEvaluation(roster: Roster, evaluation: MemberEvaluation): Roster {
  return {
    members: roster.members.map((entry) =>
      entry.userId === evaluation.memberId
        ? toRosterEntry(entry, evaluation)
        : entry,
    ),
  };
}

/** La plantilla del club, con reintentar y con lo que confirme cada
 * guardado. */
function useEvaluationRoster(): {
  readonly state: RosterState;
  readonly retry: () => void;
  readonly applyEvaluation: (evaluation: MemberEvaluation) => void;
} {
  const [state, setState] = useState<RosterState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadEvaluationRoster().then((outcome) => {
      if (isCurrent) {
        setState(
          outcome.kind === "loaded"
            ? { kind: "ready", roster: outcome.roster }
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

  function applyEvaluation(evaluation: MemberEvaluation): void {
    setState((current) =>
      current.kind === "ready"
        ? { kind: "ready", roster: withEvaluation(current.roster, evaluation) }
        : current,
    );
  }

  return { state, retry, applyEvaluation };
}

/** Cuántas categorías activas tiene el club, para el número de la pestaña.
 * Si no se pueden leer, la pestaña sale sin número: el fallo lo dice la
 * propia pestaña Categorías al abrirla, con su reintento. */
function useActiveCategoryCount(): {
  readonly count: number | null;
  readonly updateFrom: (categories: EvaluationCategories) => void;
} {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let isCurrent = true;
    void loadCategories().then((outcome) => {
      if (isCurrent && outcome.kind === "loaded") {
        setCount(countActive(outcome.categories));
      }
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  const updateFrom = useCallback((categories: EvaluationCategories) => {
    setCount(countActive(categories));
  }, []);

  return { count, updateFrom };
}

/** La barra, la tabla y, al lado, `sheet`: la ficha o el aviso de elegir. */
function PlayersPanel({
  translate,
  members,
  view,
  selectedId,
  onViewChange,
  onSelect,
  sheet,
}: {
  translate: Translator;
  members: readonly ScreenRosterEntry[];
  view: RosterView;
  selectedId: string | null;
  onViewChange: (view: RosterView) => void;
  onSelect: (userId: string) => void;
  sheet: React.ReactNode;
}): React.JSX.Element {
  if (members.length === 0) {
    return <p className="admin-empty">{translate("evaluations.list.empty")}</p>;
  }
  return (
    <>
      <EvaluationRosterToolbar
        translate={translate}
        view={view}
        counts={{
          all: members.length,
          notEvaluated: countNotEvaluated(members),
        }}
        positions={rosterPositions(members, translate.locale)}
        onViewChange={onViewChange}
      />
      <div className="evaluations-panes">
        <EvaluationRoster
          translate={translate}
          members={applyRosterView(members, view)}
          totalCount={members.length}
          selectedId={selectedId}
          onSelect={onSelect}
          onClearFilters={() => onViewChange(clearRosterFilters(view))}
        />
        {sheet}
      </div>
    </>
  );
}

export function EvaluationsScreen({
  locale,
  initialMemberId,
  initialTab,
  initialView,
}: {
  locale: Locale;
  initialMemberId: string | null;
  initialTab: EvaluationsTab;
  initialView: RosterView;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const { state, retry, applyEvaluation } = useEvaluationRoster();
  const categoryCount = useActiveCategoryCount();
  const [tab, setTab] = useState<EvaluationsTab>(initialTab);
  const [view, setView] = useState<RosterView>(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(initialMemberId);
  // A quién devolver el foco al volver de la ficha a la lista.
  const [returnFocusTo, setReturnFocusTo] = useState<string | null>(null);

  useEffect(() => {
    if (returnFocusTo !== null) {
      document.getElementById(rosterButtonId(returnFocusTo))?.focus();
    }
  }, [returnFocusTo]);

  function selectTab(next: EvaluationsTab): void {
    setTab(next);
    replaceAddressSearch(
      searchWithEvaluationsTab(currentAddressParams(), next),
    );
  }

  function changeView(next: RosterView): void {
    setView(next);
    replaceAddressSearch(searchWithRosterView(currentAddressParams(), next));
  }

  /** Pulsar la fila abierta la suelta. */
  function toggleSelection(userId: string): void {
    setReturnFocusTo(null);
    setSelectedId((current) => (current === userId ? null : userId));
  }

  function goBack(): void {
    setReturnFocusTo(selectedId);
    setSelectedId(null);
  }

  const members = state.kind === "ready" ? state.roster.members : null;
  const selected = members?.find((member) => member.userId === selectedId);

  return (
    <div className="evaluations" data-step={selected ? "sheet" : "list"}>
      <header className="evaluations-header">
        <h1>{translate("evaluations.title")}</h1>
        <p className="app-lead">{translate("evaluations.lead")}</p>
        <EvaluationsTabs
          translate={translate}
          activeTab={tab}
          counts={{
            players: members === null ? null : members.length,
            categories: categoryCount.count,
          }}
          onSelect={selectTab}
        />
      </header>
      <div
        role="tabpanel"
        id={evaluationsPanelId(tab)}
        aria-labelledby={evaluationsTabId(tab)}
        className="evaluations-panel"
      >
        {tab === "categories" ? (
          <EvaluationCategoriesManager
            translate={translate}
            onCategoriesChange={categoryCount.updateFrom}
          />
        ) : null}
        {tab === "players" && state.kind === "loading" ? (
          <p className="admin-empty">{translate("evaluations.loading")}</p>
        ) : null}
        {tab === "players" && state.kind === "failed" ? (
          <LoadFailure
            translate={translate}
            failure={state.failure}
            onRetry={retry}
          />
        ) : null}
        {tab === "players" && members !== null ? (
          <PlayersPanel
            translate={translate}
            members={members}
            view={view}
            selectedId={selectedId}
            onViewChange={changeView}
            onSelect={toggleSelection}
            sheet={
              selected ? (
                <EvaluationSheet
                  key={selected.userId}
                  translate={translate}
                  memberId={selected.userId}
                  fullName={selected.fullName}
                  onBack={goBack}
                  onEvaluationChange={applyEvaluation}
                />
              ) : (
                <p className="evaluation-sheet-placeholder">
                  {translate("evaluations.sheet.placeholder")}
                </p>
              )
            }
          />
        ) : null}
      </div>
    </div>
  );
}
