"use client";

import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import { cycleMeta, statusLabel } from "./planner-format";

/**
 * Las tarjetas de los ciclos en el escritorio (#906, §5.1 del handoff): una
 * fila que se desplaza de lado, con el activo y los borradores, y después
 * + New cycle. Los archivados esperan detrás de "Show archived · {n}", salvo
 * el elegido, que siempre se ve.
 */

export function CycleStatusPill({
  translate,
  cycle,
}: {
  readonly translate: Translator;
  readonly cycle: ManagedCycle;
}): React.JSX.Element {
  return (
    <span
      className={`training-plan-status training-plan-status-${cycle.status}`}
    >
      {statusLabel(translate, cycle.status)}
    </span>
  );
}

function CycleCard({
  translate,
  cycle,
  isSelected,
  onSelect,
}: {
  readonly translate: Translator;
  readonly cycle: ManagedCycle;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        className="training-plan-card"
        aria-pressed={isSelected}
        onClick={onSelect}
      >
        <span className="training-plan-card-top">
          <span className="training-plan-card-name">{cycle.name}</span>
          <CycleStatusPill translate={translate} cycle={cycle} />
        </span>
        <span className="training-plan-card-meta">
          {cycleMeta(translate, cycle)}
        </span>
      </button>
    </li>
  );
}

export function PlannerCycleCards({
  translate,
  cycles,
  selectedId,
  isBusy,
  onSelect,
  onCreate,
}: {
  readonly translate: Translator;
  readonly cycles: readonly ManagedCycle[];
  readonly selectedId: string | null;
  readonly isBusy: boolean;
  readonly onSelect: (cycleId: string) => void;
  readonly onCreate: () => void;
}): React.JSX.Element {
  const [isShowingArchived, setIsShowingArchived] = useState(false);
  const archivedCount = cycles.filter(
    (cycle) => cycle.status === "archived",
  ).length;
  const visible = cycles.filter(
    (cycle) =>
      isShowingArchived ||
      cycle.status !== "archived" ||
      cycle.id === selectedId,
  );

  return (
    <div className="training-plan-cards-area">
      <ul
        className="training-plan-cards"
        aria-label={translate("training.manage.cycles")}
      >
        {visible.map((cycle) => (
          <CycleCard
            key={cycle.id}
            translate={translate}
            cycle={cycle}
            isSelected={cycle.id === selectedId}
            onSelect={() => onSelect(cycle.id)}
          />
        ))}
        <li>
          <button
            type="button"
            className="training-plan-new-card"
            disabled={isBusy}
            onClick={onCreate}
          >
            <Icon glyph={Plus} />
            {translate("training.manage.newCycle")}
          </button>
        </li>
      </ul>
      {archivedCount === 0 ? null : (
        <button
          type="button"
          className="training-plan-archived-toggle"
          aria-expanded={isShowingArchived}
          onClick={() => setIsShowingArchived((previous) => !previous)}
        >
          {isShowingArchived
            ? translate("training.manage.hideArchived")
            : translate("training.manage.showArchived", {
                count: archivedCount,
              })}
        </button>
      )}
    </div>
  );
}
