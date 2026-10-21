"use client";

import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import { ListNumbers } from "@phosphor-icons/react/dist/ssr/ListNumbers";
import { Users } from "@phosphor-icons/react/dist/ssr/Users";
import { useRef } from "react";
import { Icon } from "@/components/Icon";
import {
  EVALUATIONS_TABS,
  type EvaluationsTab,
} from "@/lib/evaluations/evaluations-address";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Las pestañas Jugadores y Categorías de Evaluaciones (#818, D1 del PRD de
 * E31), cada una con su número. Se mueven con las flechas como las de Pagos
 * (#627): con dos, cualquier flecha va a la otra.
 */

const TAB_GLYPHS: Readonly<Record<EvaluationsTab, PhosphorGlyph>> = {
  players: Users,
  categories: ListNumbers,
};

const OTHER_TAB: Readonly<Record<EvaluationsTab, EvaluationsTab>> = {
  players: "categories",
  categories: "players",
};

function tabForKey(
  key: string,
  current: EvaluationsTab,
): EvaluationsTab | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowLeft":
      return OTHER_TAB[current];
    case "Home":
      return "players";
    case "End":
      return "categories";
    default:
      return null;
  }
}

export function evaluationsTabId(tab: EvaluationsTab): string {
  return `evaluaciones-pestana-${tab}`;
}

export function evaluationsPanelId(tab: EvaluationsTab): string {
  return `evaluaciones-panel-${tab}`;
}

export function EvaluationsTabs({
  translate,
  activeTab,
  counts,
  onSelect,
}: {
  readonly translate: Translator;
  readonly activeTab: EvaluationsTab;
  /** `null` mientras no se sabe: la pestaña sale sin número. */
  readonly counts: Readonly<Record<EvaluationsTab, number | null>>;
  readonly onSelect: (tab: EvaluationsTab) => void;
}): React.JSX.Element {
  const tabRefs = useRef<Partial<Record<EvaluationsTab, HTMLButtonElement>>>(
    {},
  );

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
      className="evaluations-tabs"
      role="tablist"
      aria-label={translate("evaluations.tabs.label")}
      onKeyDown={handleKeyDown}
    >
      {EVALUATIONS_TABS.map((tab) => {
        const isActive = tab === activeTab;
        const count = counts[tab];
        return (
          <button
            key={tab}
            ref={(element) => {
              tabRefs.current[tab] = element ?? undefined;
            }}
            type="button"
            role="tab"
            id={evaluationsTabId(tab)}
            className="evaluations-tab"
            aria-selected={isActive}
            aria-controls={evaluationsPanelId(tab)}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab)}
          >
            <Icon glyph={TAB_GLYPHS[tab]} />
            {translate(`evaluations.tabs.${tab}`)}
            {count === null ? null : (
              <span className="evaluations-tab-count">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
