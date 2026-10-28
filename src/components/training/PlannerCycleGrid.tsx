"use client";

import { Copy } from "@phosphor-icons/react/dist/ssr/Copy";
import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import type { ManagedRoutine } from "@/lib/training/club-routines";
import {
  GRID_WEEKDAYS,
  canCopyWeekOne,
  currentGridWeek,
  dayRoutines,
  lastCopyTarget,
  weekRecordOf,
} from "@/lib/training/cycle-grid-view";
import { type GridOptions, PlannerDaySlots } from "./PlannerDaySlots";
import { PlannerPhoneWeek } from "./PlannerPhoneWeek";
import { PlannerWeekEditor } from "./PlannerWeekEditor";
import type { CyclePlan } from "./planner-client";
import {
  gridWeekRange,
  gridWeekdayName,
  routineOptionLabel,
  weekSummary,
} from "./planner-format";
import { type CycleGrid, useCycleGrid } from "./use-cycle-grid";
import type { PlannerCycles } from "./use-planner-cycles";

/**
 * La cuadrícula de Planificar → Ciclo (#907, RF-8, D6 y D7; §5.1 y §5.2 del
 * handoff): en el escritorio, una fila por semana con la cabecera fija; en
 * el móvil, una semana a la vez. Debajo, copiar la semana 1. Un ciclo
 * archivado se ve, pero no se cambia, como sus campos.
 */

const NO_ROUTINES: readonly ManagedRoutine[] = [];

type GridProps = {
  readonly translate: Translator;
  readonly planner: PlannerCycles;
  readonly cycle: ManagedCycle;
  readonly isPhone: boolean;
};

/** Lo que comparten la tabla del escritorio y la semana del móvil. */
export type GridContext = {
  readonly translate: Translator;
  readonly planner: PlannerCycles;
  readonly cycle: ManagedCycle;
  readonly grid: CycleGrid;
  readonly plan: CyclePlan;
  readonly options: GridOptions;
  readonly isReadOnly: boolean;
};

function useGridOptions(
  translate: Translator,
  routines: readonly ManagedRoutine[],
): GridOptions {
  return useMemo(
    () => ({
      elements: (
        <>
          <option value="">{translate("training.manage.rest")}</option>
          {routines.map((routine) => (
            <option key={routine.id} value={routine.id}>
              {routineOptionLabel(translate, routine)}
            </option>
          ))}
        </>
      ),
      colorOf: new Map(
        routines.map((routine) => [routine.id, routine.colorIndex]),
      ),
    }),
    [translate, routines],
  );
}

function GridWeekRow({
  context,
  week,
  isCurrent,
  isOpen,
  onToggle,
}: {
  readonly context: GridContext;
  readonly week: number;
  readonly isCurrent: boolean;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element {
  const { translate, cycle, plan, grid, planner } = context;
  const record = weekRecordOf(plan.weeks, week);
  const summary = weekSummary(translate, record);
  const editorId = `training-grid-week-${week}`;
  return (
    <>
      <tr
        className={isCurrent ? "training-grid-current" : undefined}
        aria-current={isCurrent ? "date" : undefined}
      >
        <th scope="row">
          <button
            type="button"
            className={
              week === cycle.weeks
                ? "training-grid-week training-grid-week-last"
                : "training-grid-week"
            }
            aria-label={translate("training.manage.weekToggle", { week })}
            aria-expanded={isOpen}
            aria-controls={isOpen ? editorId : undefined}
            onClick={onToggle}
          >
            {week}
          </button>
        </th>
        <td className="training-grid-dates">
          <span>{gridWeekRange(translate, cycle, week)}</span>
          {summary === null ? null : (
            <span className="training-grid-summary" title={summary}>
              {summary}
            </span>
          )}
        </td>
        {GRID_WEEKDAYS.map((weekday) => (
          <td key={weekday}>
            <PlannerDaySlots
              translate={translate}
              options={context.options}
              day={{ weekNo: week, weekday }}
              routines={dayRoutines(plan.days, { weekNo: week, weekday })}
              isReadOnly={context.isReadOnly}
              onChange={grid.setDay}
            />
          </td>
        ))}
      </tr>
      {isOpen ? (
        <tr className="training-grid-editor-row">
          <td colSpan={GRID_WEEKDAYS.length + 2}>
            <PlannerWeekEditor
              id={editorId}
              translate={translate}
              week={record}
              isReadOnly={context.isReadOnly}
              reporter={planner}
              onSave={grid.saveWeek}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DesktopGrid({
  context,
}: {
  readonly context: GridContext;
}): React.JSX.Element {
  const { translate, cycle } = context;
  const [openWeek, setOpenWeek] = useState<number | null>(null);
  const weeks = Array.from({ length: cycle.weeks }, (_, index) => index + 1);
  const currentWeek = currentGridWeek(cycle, new Date());
  return (
    <div className="training-grid">
      <table
        aria-label={translate("training.manage.grid", { name: cycle.name })}
      >
        <thead>
          <tr>
            <th scope="col">{translate("training.manage.gridWeek")}</th>
            <th scope="col">{translate("training.manage.gridDates")}</th>
            {GRID_WEEKDAYS.map((weekday) => (
              <th key={weekday} scope="col">
                {gridWeekdayName(translate, weekday)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <GridWeekRow
              key={week}
              context={context}
              week={week}
              isCurrent={week === currentWeek}
              isOpen={openWeek === week}
              onToggle={() =>
                setOpenWeek((previous) => (previous === week ? null : week))
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CopyWeekOne({
  context,
}: {
  readonly context: GridContext;
}): React.JSX.Element | null {
  const { translate, cycle, grid, planner } = context;
  if (context.isReadOnly || !canCopyWeekOne(cycle.weeks)) {
    return null;
  }
  async function copy(): Promise<void> {
    if (await grid.copyWeekOne()) {
      planner.announce(
        translate("training.manage.weekOneCopied", {
          last: lastCopyTarget(cycle.weeks),
        }),
      );
    }
  }
  return (
    <button
      type="button"
      className="training-plan-action training-grid-copy"
      disabled={grid.isCopying}
      onClick={() => void copy()}
    >
      <Icon glyph={Copy} />
      {translate("training.manage.copyWeekOne")}
    </button>
  );
}

function GridLoadFailure({
  translate,
  onRetry,
}: {
  readonly translate: Translator;
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="admin-load-failure">
      <p className="auth-error">{translate("training.manage.gridFailed")}</p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        {translate("training.manage.retry")}
      </button>
    </div>
  );
}

function ReadyGrid({
  context,
  isPhone,
}: {
  readonly context: GridContext;
  readonly isPhone: boolean;
}): React.JSX.Element {
  return (
    <section className="training-grid-section">
      {isPhone ? (
        <PlannerPhoneWeek context={context} />
      ) : (
        <DesktopGrid context={context} />
      )}
      {context.isReadOnly ? null : (
        <p className="training-grid-hint">
          {context.translate("training.manage.gridHint")}
        </p>
      )}
      <CopyWeekOne context={context} />
    </section>
  );
}

export function PlannerCycleGrid({
  translate,
  planner,
  cycle,
  isPhone,
}: GridProps): React.JSX.Element {
  const grid = useCycleGrid(cycle, planner);
  const routines =
    grid.state.kind === "ready" ? grid.state.routines : NO_ROUTINES;
  const options = useGridOptions(translate, routines);
  switch (grid.state.kind) {
    case "loading":
      return (
        <p className="admin-empty">
          {translate("training.manage.gridLoading")}
        </p>
      );
    case "failed":
      return <GridLoadFailure translate={translate} onRetry={grid.retry} />;
    case "ready":
      return (
        <ReadyGrid
          isPhone={isPhone}
          context={{
            translate,
            planner,
            cycle,
            grid,
            plan: grid.state.plan,
            options,
            isReadOnly: cycle.status === "archived",
          }}
        />
      );
  }
}
