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
  DEFAULT_ROSTER_VIEW,
  type RosterView,
  applyRosterView,
  clearRosterFilters,
  countNotEvaluated,
  rosterPositions,
  withHeldPosition,
} from "@/lib/evaluations/roster-view";
import { locateInList } from "@/lib/evaluations/sheet-navigation";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { EvaluationCategoriesManager } from "./EvaluationCategoriesScreen";
import { EvaluationOverview } from "./EvaluationOverview";
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
 * una tabla con búsqueda, filtros y orden. Al lado va un panel (#819): sin
 * nadie elegido, el resumen de la plantilla; con alguien, su ficha, con la
 * edición de sus valoraciones.
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
 * marca de sin evaluar del directorio (#324). Si no está en la lista (no
 * existe o está de baja), el panel enseña el resumen (D8).
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

/** Quién guardó no viene en la respuesta de la ficha. Si es la misma versión
 * que trajo la lista, se conserva el de la lista; si es otra, queda en
 * `null`, que es "no se sabe", en vez de atribuírselo a quien lo hizo antes. */
function updatedByFor(
  entry: ScreenRosterEntry,
  updatedAt: string,
): string | null {
  return entry.status === "evaluated" &&
    Date.parse(entry.updatedAt) === Date.parse(updatedAt)
    ? entry.updatedBy
    : null;
}

/** La fila de la lista con lo que el servidor acaba de confirmar o leer. */
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
        updatedBy: updatedByFor(entry, evaluation.updatedAt),
      }
    : { status: "not_evaluated", ...player };
}

function withEvaluation(roster: Roster, evaluation: MemberEvaluation): Roster {
  return {
    ...roster,
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

/** Las categorías del club: su número va en la pestaña y su orden en las
 * notas de la ficha (#819). Si no se pueden leer, la pestaña sale sin número
 * y la ficha enseña las notas tal como vienen: el fallo lo dice la propia
 * pestaña Categorías al abrirla, con su reintento. */
function useClubCategories(): {
  readonly categories: EvaluationCategories | null;
  readonly updateFrom: (categories: EvaluationCategories) => void;
} {
  const [categories, setCategories] = useState<EvaluationCategories | null>(
    null,
  );

  useEffect(() => {
    let isCurrent = true;
    void loadCategories().then((outcome) => {
      if (isCurrent && outcome.kind === "loaded") {
        setCategories(outcome.categories);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  const updateFrom = useCallback((next: EvaluationCategories) => {
    setCategories(next);
  }, []);

  return { categories, updateFrom };
}

/** Lo que enseña la tabla: las posiciones del club, la vista sin una
 * posición que nadie tiene, y quién pasa la vista y en qué orden. */
type RosterDisplay = {
  readonly positions: ReturnType<typeof rosterPositions>;
  readonly shownView: RosterView;
  readonly listed: readonly ScreenRosterEntry[];
};

function displayRoster(
  members: readonly ScreenRosterEntry[],
  view: RosterView,
  locale: Locale,
): RosterDisplay {
  const positions = rosterPositions(members, locale);
  const shownView = withHeldPosition(view, positions);
  return {
    positions,
    shownView,
    listed: applyRosterView(members, shownView),
  };
}

/** Lo que pide "Evaluar a los pendientes": sólo los sin evaluar, sin
 * búsqueda ni posición, por nombre. */
const PENDING_VIEW: RosterView = {
  ...DEFAULT_ROSTER_VIEW,
  filter: "not_evaluated",
};

/** La barra, la tabla y, al lado, `side`: la ficha o el resumen. */
function PlayersPanel({
  translate,
  members,
  display,
  selectedId,
  onViewChange,
  onSelect,
  side,
}: {
  translate: Translator;
  members: readonly ScreenRosterEntry[];
  display: RosterDisplay;
  selectedId: string | null;
  onViewChange: (view: RosterView) => void;
  onSelect: (userId: string) => void;
  side: React.ReactNode;
}): React.JSX.Element {
  if (members.length === 0) {
    return <p className="admin-empty">{translate("evaluations.list.empty")}</p>;
  }
  const { positions, shownView, listed } = display;
  return (
    <>
      <EvaluationRosterToolbar
        translate={translate}
        view={shownView}
        counts={{
          all: members.length,
          notEvaluated: countNotEvaluated(members),
        }}
        positions={positions}
        onViewChange={onViewChange}
      />
      <div className="evaluations-panes">
        <EvaluationRoster
          translate={translate}
          members={listed}
          totalCount={members.length}
          selectedId={selectedId}
          onSelect={onSelect}
          onClearFilters={() => onViewChange(clearRosterFilters(shownView))}
        />
        {side}
      </div>
    </>
  );
}
export function EvaluationsScreen({
  locale,
  initialMemberId,
  initialTab,
  initialView,
  canOpenMemberRecords,
}: {
  locale: Locale;
  initialMemberId: string | null;
  initialTab: EvaluationsTab;
  initialView: RosterView;
  /** Si quien mira puede abrir la ficha del socio: la ficha enlaza su
   * perfil sólo entonces. */
  canOpenMemberRecords: boolean;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const { state, retry, applyEvaluation } = useEvaluationRoster();
  const clubCategories = useClubCategories();
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

  function openMember(userId: string): void {
    setReturnFocusTo(null);
    setSelectedId(userId);
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

  /** Hasta #820 el primero se abre en lectura. */
  function evaluatePending(): void {
    changeView(PENDING_VIEW);
    const [first] = applyRosterView(members ?? [], PENDING_VIEW);
    if (first !== undefined) {
      openMember(first.userId);
    }
  }

  function renderPlayers(roster: Roster): React.JSX.Element {
    const display = displayRoster(roster.members, view, locale);
    const side = selected ? (
      <EvaluationSheet
        key={selected.userId}
        translate={translate}
        member={selected}
        categories={clubCategories.categories}
        canOpenMemberRecords={canOpenMemberRecords}
        position={locateInList(
          display.listed.map((member) => member.userId),
          selected.userId,
        )}
        onClose={goBack}
        onNavigate={openMember}
        onEvaluationChange={applyEvaluation}
      />
    ) : (
      <EvaluationOverview
        translate={translate}
        count={{
          evaluated: roster.members.length - countNotEvaluated(roster.members),
          total: roster.members.length,
        }}
        summary={roster.summary}
        onEvaluatePending={evaluatePending}
        onOpen={openMember}
      />
    );
    return (
      <PlayersPanel
        translate={translate}
        members={roster.members}
        display={display}
        selectedId={selectedId}
        onViewChange={changeView}
        onSelect={toggleSelection}
        side={side}
      />
    );
  }

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
            categories:
              clubCategories.categories === null
                ? null
                : countActive(clubCategories.categories),
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
            onCategoriesChange={clubCategories.updateFrom}
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
        {tab === "players" && state.kind === "ready"
          ? renderPlayers(state.roster)
          : null}
      </div>
    </div>
  );
}
