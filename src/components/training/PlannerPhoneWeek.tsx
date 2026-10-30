"use client";

import { CaretLeft } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import {
  GRID_WEEKDAYS,
  countRoutineDays,
  dayRoutines,
  initialPhoneWeek,
  weekRecordOf,
} from "@/lib/training/cycle-grid-view";
import { PlannerDaySlots } from "./PlannerDaySlots";
import { PlannerWeekEditor } from "./PlannerWeekEditor";
import type { GridContext } from "./PlannerCycleGrid";
import { gridWeekRange, gridWeekdayName } from "./planner-format";

/**
 * La cuadrícula en el móvil y la tableta (#907, §5.2 del handoff): una
 * semana a la vez, con ‹ › de 44 px, "Week {k} of {N}" y sus fechas, su nota
 * y su dosis, y siete filas con el día y su `<select>`.
 */

const FIRST_WEEK = 1;

export function PlannerPhoneWeek({
  context,
}: {
  readonly context: GridContext;
}): React.JSX.Element {
  const { translate, cycle, plan, grid } = context;
  const [chosenWeek, setChosenWeek] = useState(() =>
    initialPhoneWeek(cycle, new Date()),
  );
  // Si se bajan las semanas, la elegida puede ya no estar.
  const week = Math.min(chosenWeek, cycle.weeks);
  return (
    <div className="training-grid-phone">
      <div className="training-week-nav training-grid-phone-nav">
        <button
          type="button"
          className="training-week-step"
          aria-label={translate("training.member.previousWeek")}
          disabled={week <= FIRST_WEEK}
          onClick={() => setChosenWeek(week - 1)}
        >
          <Icon glyph={CaretLeft} />
        </button>
        <div className="training-week-title">
          <h2>
            {translate("training.member.weekHeading", {
              week,
              weeks: cycle.weeks,
            })}
          </h2>
          <p className="training-week-range">
            {gridWeekRange(translate, cycle, week)}
          </p>
        </div>
        <button
          type="button"
          className="training-week-step"
          aria-label={translate("training.member.nextWeek")}
          disabled={week >= cycle.weeks}
          onClick={() => setChosenWeek(week + 1)}
        >
          <Icon glyph={CaretRight} />
        </button>
      </div>
      <PlannerWeekEditor
        key={week}
        translate={translate}
        week={weekRecordOf(plan.weeks, week)}
        isReadOnly={context.isReadOnly}
        reporter={context.planner}
        routineDays={countRoutineDays(plan.days, week)}
        onSave={grid.saveWeek}
        onClear={grid.clearWeek}
      />
      <ul className="training-grid-phone-days">
        {GRID_WEEKDAYS.map((weekday) => (
          <li key={weekday} className="training-grid-phone-day">
            <span className="training-grid-phone-day-name" aria-hidden="true">
              {gridWeekdayName(translate, weekday)}
            </span>
            <PlannerDaySlots
              key={`${week}-${weekday}`}
              translate={translate}
              options={context.options}
              day={{ weekNo: week, weekday }}
              routines={dayRoutines(plan.days, { weekNo: week, weekday })}
              isReadOnly={context.isReadOnly}
              onChange={grid.setDay}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
