"use client";

import { useId, useRef, useState } from "react";
import type { Translator } from "@/lib/i18n/translator";
import { TEAM_IDS, type TeamId } from "@/lib/teams/team-ids";
import { shortTeamName } from "@/lib/teams/team-short-name";
import type { SplitTotals } from "@/lib/teams/team-totals";
import { type TeamDraft, benchPlayers, teamPlayers } from "./team-draft";
import type { ChangeTeams } from "./TeamEditor";
import { BenchLists, type MovePlayer, TeamCard } from "./TeamLists";

/**
 * El reparto en el móvil (#762, RF-8 del PRD de E28,
 * `docs/design/design_handoff_teams/screenshots/04-mobile-team-tab.png` y
 * `05-mobile-bench-tab.png`): tres pestañas, el equipo A, el B y el banco,
 * con el punto de su color y cuántos hay. Sólo se ve la elegida. Arrastrar
 * no funciona con el dedo: se mueve con los botones de cada fila.
 *
 * Las flechas dan la vuelta al llegar a un extremo, e Inicio y Fin van a la
 * primera y a la última: el patrón de pestañas de WAI-ARIA que siguen las de
 * la configuración del club, que activa la pestaña al enfocarla. Los tres
 * paneles están siempre en el DOM, escondidos con `hidden`, para que cada
 * pestaña apunte a uno que existe.
 */

type BoardTab = TeamId | "bench";

const BOARD_TABS: readonly BoardTab[] = [...TEAM_IDS, "bench"];

function tabAt(index: number): BoardTab {
  const count = BOARD_TABS.length;
  const tab = BOARD_TABS[(index + count) % count];
  if (tab === undefined) {
    throw new RangeError(`No hay pestaña en el puesto ${index}.`);
  }
  return tab;
}

/** La pestaña a la que lleva cada tecla, o `null` si la tecla no mueve. */
function tabForKey(key: string, current: BoardTab): BoardTab | null {
  const index = BOARD_TABS.indexOf(current);
  switch (key) {
    case "ArrowRight":
      return tabAt(index + 1);
    case "ArrowLeft":
      return tabAt(index - 1);
    case "Home":
      return tabAt(0);
    case "End":
      return tabAt(BOARD_TABS.length - 1);
    default:
      return null;
  }
}

type TabLabel = {
  readonly name: string;
  /** El del equipo, o null para el banco, que va en el tono apagado. */
  readonly color: string | null;
  readonly count: number;
};

function labelTab(
  translate: Translator,
  draft: TeamDraft,
  tab: BoardTab,
): TabLabel {
  if (tab === "bench") {
    return {
      name: translate("teams.tabs.bench"),
      color: null,
      count:
        benchPlayers(draft, "available").length +
        benchPlayers(draft, "maybe").length,
    };
  }
  const { name, color } = draft.teams[tab];
  return {
    name: shortTeamName(name),
    color,
    count: teamPlayers(draft, tab).length,
  };
}

/** A la vista va el número; el lector oye "2 jugadores". */
function TabContent({
  translate,
  label,
}: {
  readonly translate: Translator;
  readonly label: TabLabel;
}): React.JSX.Element {
  return (
    <>
      <span
        className={
          label.color === null
            ? "team-tab-dot team-tab-dot-bench"
            : "team-tab-dot"
        }
        aria-hidden="true"
        style={
          label.color === null ? undefined : { backgroundColor: label.color }
        }
      />
      {label.name}{" "}
      <span className="team-tab-count" aria-hidden="true">
        {label.count}
      </span>
      <span className="visually-hidden">
        {translate("teams.column.players", { count: label.count })}
      </span>
    </>
  );
}

type TabRefs = React.RefObject<Partial<Record<BoardTab, HTMLButtonElement>>>;

function BoardTabs({
  translate,
  draft,
  idPrefix,
  activeTab,
  tabRefs,
  onSelect,
}: {
  readonly translate: Translator;
  readonly draft: TeamDraft;
  readonly idPrefix: string;
  readonly activeTab: BoardTab;
  readonly tabRefs: TabRefs;
  readonly onSelect: (tab: BoardTab) => void;
}): React.JSX.Element {
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const next = tabForKey(event.key, activeTab);
    if (next === null) {
      return;
    }
    event.preventDefault();
    onSelect(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div
      className="team-tabs"
      role="tablist"
      aria-label={translate("teams.tabs.label")}
      onKeyDown={handleKeyDown}
    >
      {BOARD_TABS.map((tab) => {
        const isActive = tab === activeTab;
        return (
          <button
            key={tab}
            ref={(element) => {
              tabRefs.current[tab] = element ?? undefined;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab}`}
            className="team-tab"
            aria-selected={isActive}
            aria-controls={`${idPrefix}-panel-${tab}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab)}
          >
            <TabContent
              translate={translate}
              label={labelTab(translate, draft, tab)}
            />
          </button>
        );
      })}
    </div>
  );
}

function BoardPanel({
  idPrefix,
  tab,
  isActive,
  children,
}: {
  readonly idPrefix: string;
  readonly tab: BoardTab;
  readonly isActive: boolean;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="team-tab-panel"
      role="tabpanel"
      id={`${idPrefix}-panel-${tab}`}
      aria-labelledby={`${idPrefix}-tab-${tab}`}
      hidden={!isActive}
    >
      {children}
    </div>
  );
}

/** El equipo vacío en el móvil: allí no se arrastra, así que en vez del
 * texto del escritorio dice que se añade desde el banco, con un botón que
 * abre esa pestaña. */
function EmptyPhoneTeam({
  translate,
  onShowBench,
}: {
  readonly translate: Translator;
  readonly onShowBench: () => void;
}): React.JSX.Element {
  return (
    <div className="team-list-empty team-list-empty-phone">
      <p>{translate("teams.column.emptyPhone")}</p>
      <button
        type="button"
        className="team-list-empty-action"
        onClick={onShowBench}
      >
        {translate("teams.column.emptyPhoneAction")}
      </button>
    </div>
  );
}

export function PhoneBoard({
  translate,
  draft,
  totals,
  suggestion,
  onMove,
  onChangeTeams,
}: {
  readonly translate: Translator;
  readonly draft: TeamDraft;
  readonly totals: SplitTotals;
  /** La sugerencia de intercambio, que va bajo la tarjeta de cada equipo. */
  readonly suggestion: React.ReactNode;
  readonly onMove: MovePlayer;
  readonly onChangeTeams: ChangeTeams;
}): React.JSX.Element {
  const idPrefix = useId();
  const [activeTab, setActiveTab] = useState<BoardTab>("a");
  const tabRefs = useRef<Partial<Record<BoardTab, HTMLButtonElement>>>({});

  // El botón que lo pide queda en un panel escondido: el foco pasa a la
  // pestaña del banco para no perderse.
  function showBench(): void {
    setActiveTab("bench");
    tabRefs.current.bench?.focus();
  }

  return (
    <>
      <BoardTabs
        translate={translate}
        draft={draft}
        idPrefix={idPrefix}
        activeTab={activeTab}
        tabRefs={tabRefs}
        onSelect={setActiveTab}
      />
      {TEAM_IDS.map((team) => (
        <BoardPanel
          key={team}
          idPrefix={idPrefix}
          tab={team}
          isActive={activeTab === team}
        >
          <TeamCard
            translate={translate}
            draft={draft}
            team={team}
            totals={totals[team]}
            onMove={onMove}
            onChangeTeams={onChangeTeams}
            emptyState={
              <EmptyPhoneTeam translate={translate} onShowBench={showBench} />
            }
          />
          {suggestion}
        </BoardPanel>
      ))}
      <BoardPanel
        idPrefix={idPrefix}
        tab="bench"
        isActive={activeTab === "bench"}
      >
        <BenchLists translate={translate} draft={draft} onMove={onMove} />
      </BoardPanel>
    </>
  );
}

/** Guardar y Publicar fijos abajo, sobre las pestañas de la aplicación. El
 * borde de arriba va en aviso mientras hay cambios sin guardar. */
export function PhoneSaveBar({
  hasChanges,
  children,
}: {
  readonly hasChanges: boolean;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={
        hasChanges ? "team-phone-bar team-phone-bar-unsaved" : "team-phone-bar"
      }
    >
      {children}
    </div>
  );
}
