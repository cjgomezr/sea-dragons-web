"use client";

import { useEffect, useRef, useState } from "react";
import { useIsBelowDesktop } from "@/components/use-is-phone";
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
import type { EvaluationsLayout } from "./evaluations-layout";

/**
 * La pantalla de Evaluaciones (#322, RF-6 del PRD de E9). Desde #818 (RF-2
 * del PRD de E31) lleva las pestañas Jugadores y Categorías, y la lista es
 * una tabla con búsqueda, filtros y orden. Al lado va un panel (#819): sin
 * nadie elegido, el resumen de la plantilla; con alguien, su ficha, con la
 * edición de sus valoraciones (#820). Cada guardado lo dice unos segundos
 * bajo las pestañas y vuelve a pedir el resumen.
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
 * cuál enseñar, igual que la lista de avisos de #266. Ahí (#822, D12) la
 * tabla es una lista y la ficha ocupa la pantalla, con sus botones en una
 * barra fija abajo.
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
  readonly refreshSummary: () => void;
} {
  const [state, setState] = useState<RosterState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);
  // Con Guardar y siguiente se encadenan guardados: sólo vale la respuesta
  // del último, no la de uno anterior que llegue tarde.
  const latestSummaryRequest = useRef(0);

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

  /** El resumen lo calcula el servidor (D5): tras guardar se vuelve a pedir
   * la plantilla y se toma su resumen. Las filas no se tocan, porque ya las
   * puso al día lo que confirmó el guardado. Si falla, se queda el resumen
   * que había: lo dice la próxima lectura. */
  function refreshSummary(): void {
    latestSummaryRequest.current += 1;
    const request = latestSummaryRequest.current;
    void loadEvaluationRoster().then((outcome) => {
      if (
        outcome.kind !== "loaded" ||
        request !== latestSummaryRequest.current
      ) {
        return;
      }
      setState((current) =>
        current.kind === "ready"
          ? {
              kind: "ready",
              roster: { ...current.roster, summary: outcome.roster.summary },
            }
          : current,
      );
    });
  }

  return { state, retry, applyEvaluation, refreshSummary };
}

/** Lo que dura a la vista "{nombre} guardado" (handoff: unos 3 segundos). */
const SAVED_NOTICE_MS = 3000;

type SavedNotice = {
  readonly name: string;
  /** Otro guardado del mismo jugador vuelve a contar los 3 segundos. */
  readonly sequence: number;
};

/** "{nombre} guardado" tras cada guardado, que se va solo. */
function useSavedNotice(): {
  readonly notice: SavedNotice | null;
  readonly show: (name: string) => void;
} {
  const [notice, setNotice] = useState<SavedNotice | null>(null);

  useEffect(() => {
    if (notice === null) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), SAVED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return {
    notice,
    show: (name) =>
      setNotice((current) => ({
        name,
        sequence: (current?.sequence ?? 0) + 1,
      })),
  };
}

/** Siempre en la página, para que el lector de pantalla tenga ya la región
 * cuando llegue el texto; vacía no ocupa sitio. */
function SavedNoticeRegion({
  translate,
  notice,
}: {
  translate: Translator;
  notice: SavedNotice | null;
}): React.JSX.Element {
  return (
    <p
      className={
        notice === null ? "evaluations-saved" : "admin-notice evaluations-saved"
      }
      role="status"
    >
      {notice === null
        ? null
        : translate("evaluations.saved", { name: notice.name })}
    </p>
  );
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

  return { categories, updateFrom: setCategories };
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
  layout,
  onViewChange,
  onSelect,
  side,
}: {
  translate: Translator;
  members: readonly ScreenRosterEntry[];
  display: RosterDisplay;
  selectedId: string | null;
  layout: EvaluationsLayout;
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
        layout={layout}
        onViewChange={onViewChange}
      />
      <div className="evaluations-panes">
        <EvaluationRoster
          translate={translate}
          members={listed}
          totalCount={members.length}
          selectedId={selectedId}
          layout={layout}
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
  const layout: EvaluationsLayout = useIsBelowDesktop() ? "compact" : "desktop";
  const { state, retry, applyEvaluation, refreshSummary } =
    useEvaluationRoster();
  const savedNotice = useSavedNotice();
  const clubCategories = useClubCategories();
  const [tab, setTab] = useState<EvaluationsTab>(initialTab);
  const [view, setView] = useState<RosterView>(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(initialMemberId);
  // Si la ficha que se abre empieza ya en edición (#820).
  const [isEditingOnOpen, setIsEditingOnOpen] = useState(false);
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

  function openMember(userId: string, isEditing = false): void {
    setReturnFocusTo(null);
    setSelectedId(userId);
    setIsEditingOnOpen(isEditing);
  }

  /** Pulsar la fila abierta la suelta. */
  function toggleSelection(userId: string): void {
    setReturnFocusTo(null);
    setSelectedId((current) => (current === userId ? null : userId));
    setIsEditingOnOpen(false);
  }

  function goBack(): void {
    setReturnFocusTo(selectedId);
    setSelectedId(null);
  }

  const members = state.kind === "ready" ? state.roster.members : null;
  const selected = members?.find((member) => member.userId === selectedId);

  /** El primero se abre ya en edición (#820). */
  function evaluatePending(players: readonly ScreenRosterEntry[]): void {
    changeView(PENDING_VIEW);
    const [first] = applyRosterView(players, PENDING_VIEW);
    if (first !== undefined) {
      openMember(first.userId, true);
    }
  }

  /** La fila ya la puso al día la ficha; aquí, el aviso, el resumen y, con
   * Guardar y siguiente, el siguiente en edición. */
  function confirmSaved(name: string, nextId: string | null): void {
    savedNotice.show(name);
    refreshSummary();
    if (nextId !== null) {
      openMember(nextId, true);
    }
  }

  /** El panel lateral: la ficha de quien esté elegido, o el resumen. */
  function renderSide(
    roster: Roster,
    display: RosterDisplay,
  ): React.JSX.Element {
    return selected ? (
      <EvaluationSheet
        key={selected.userId}
        context={{
          translate,
          member: selected,
          canOpenMemberRecords,
          position: locateInList(
            display.listed.map((member) => member.userId),
            selected.userId,
          ),
          layout,
          onClose: goBack,
          onNavigate: (userId) => openMember(userId),
        }}
        categories={clubCategories.categories}
        isEditingOnOpen={isEditingOnOpen}
        onEvaluationChange={applyEvaluation}
        onSaved={(nextId) => confirmSaved(selected.fullName, nextId)}
      />
    ) : (
      <EvaluationOverview
        translate={translate}
        count={{
          evaluated: roster.members.length - countNotEvaluated(roster.members),
          total: roster.members.length,
        }}
        summary={roster.summary}
        onEvaluatePending={() => evaluatePending(roster.members)}
        onOpen={(userId) => openMember(userId)}
      />
    );
  }

  function renderPlayers(roster: Roster): React.JSX.Element {
    const display = displayRoster(roster.members, view, locale);
    return (
      <PlayersPanel
        translate={translate}
        members={roster.members}
        display={display}
        selectedId={selectedId}
        layout={layout}
        onViewChange={changeView}
        onSelect={toggleSelection}
        side={renderSide(roster, display)}
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
        <SavedNoticeRegion translate={translate} notice={savedNotice.notice} />
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
