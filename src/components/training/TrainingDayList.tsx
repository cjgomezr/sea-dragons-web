import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { ListChecks } from "@phosphor-icons/react/dist/ssr/ListChecks";
import { MoonStars } from "@phosphor-icons/react/dist/ssr/MoonStars";
import { Trophy } from "@phosphor-icons/react/dist/ssr/Trophy";
import type { CSSProperties } from "react";
import { Icon } from "@/components/Icon";
import {
  formatCalendarDayParts,
  formatDashboardDay,
  formatNarrowWeekday,
} from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type {
  ActiveTrainingPlan,
  TrainingDay,
} from "@/lib/training/training-plan";
import {
  type TrainingDayContent,
  trainingDayContent,
} from "@/lib/training/training-week-view";
import {
  dayExerciseCount,
  describeDayContent,
  formatShortDate,
  routineColorStyle,
} from "./training-format";

/**
 * Los siete días de la semana que se mira (#900): filas en el escritorio
 * (§4.1 del handoff) y píldoras en el móvil (§4.2). Elegir uno lo abre en
 * el panel.
 */

type DayListProps = {
  readonly translate: Translator;
  readonly plan: ActiveTrainingPlan;
  readonly selectedWeekday: number;
  readonly onSelectDay: (weekday: number) => void;
};

function DayTileIcon({
  content,
}: {
  readonly content: TrainingDayContent;
}): React.JSX.Element {
  switch (content.kind) {
    case "routines":
      return <Icon glyph={ListChecks} />;
    case "event":
      return <Icon glyph={Trophy} />;
    case "rest":
      return <Icon glyph={MoonStars} />;
  }
}

function daySubtitle(
  translate: Translator,
  day: TrainingDay,
  content: TrainingDayContent,
): string {
  switch (content.kind) {
    case "routines":
      return translate("training.member.exercises", {
        count: dayExerciseCount(day),
      });
    case "event":
      return translate("training.member.eventDay");
    case "rest":
      return translate("training.member.nothingPlanned");
  }
}

/** La barra de color del borde: un tramo por rutina, el aviso en el día del
 * evento, y nada en el descanso. */
function DayBar({
  content,
}: {
  readonly content: TrainingDayContent;
}): React.JSX.Element {
  return (
    <span className="training-day-bar" aria-hidden="true">
      {content.kind === "routines"
        ? content.routines.map((routine) => (
            <span
              key={routine.id}
              className="training-day-bar-segment"
              style={routineColorStyle(routine.colorIndex)}
            />
          ))
        : null}
    </span>
  );
}

/** La baldosa del icono va teñida con el color de la primera rutina. */
function tileStyleOf(content: TrainingDayContent): CSSProperties | undefined {
  if (content.kind !== "routines") {
    return undefined;
  }
  const [first] = content.routines;
  return first === undefined ? undefined : routineColorStyle(first.colorIndex);
}

function DayRow({
  translate,
  day,
  content,
  isToday,
  isSelected,
  onSelect,
}: {
  readonly translate: Translator;
  readonly day: TrainingDay;
  readonly content: TrainingDayContent;
  readonly isToday: boolean;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`training-day training-day-${content.kind}`}
      aria-pressed={isSelected}
      onClick={onSelect}
    >
      <DayBar content={content} />
      <span className="training-day-date">
        <span
          className={
            isToday
              ? "training-day-weekday training-day-weekday-today"
              : "training-day-weekday"
          }
        >
          {formatCalendarDayParts(translate.locale, day.date).weekday}
        </span>
        <span>{formatShortDate(translate.locale, day.date)}</span>
      </span>
      <span className="training-day-tile" style={tileStyleOf(content)}>
        <DayTileIcon content={content} />
      </span>
      <span className="training-day-text">
        <span className="training-day-title">
          {describeDayContent(translate, content)}
        </span>
        <span className="training-day-subtitle">
          {daySubtitle(translate, day, content)}
        </span>
      </span>
      {isToday ? (
        <span className="training-today">
          {translate("training.member.today")}
        </span>
      ) : null}
      <span className="training-day-caret">
        <Icon glyph={CaretRight} />
      </span>
    </button>
  );
}

export function TrainingDayRows({
  translate,
  plan,
  selectedWeekday,
  onSelectDay,
}: DayListProps): React.JSX.Element {
  return (
    <ul
      className="training-days"
      aria-label={translate("training.member.days", {
        week: plan.week.number,
      })}
    >
      {plan.week.days.map((day) => (
        <li key={day.date}>
          <DayRow
            translate={translate}
            day={day}
            content={trainingDayContent(day, plan.cycle)}
            isToday={day.date === plan.current.today}
            isSelected={day.weekday === selectedWeekday}
            onSelect={() => onSelectDay(day.weekday)}
          />
        </li>
      ))}
    </ul>
  );
}

function PillDots({
  content,
}: {
  readonly content: TrainingDayContent;
}): React.JSX.Element {
  return (
    <span className="training-pill-dots" aria-hidden="true">
      {content.kind === "routines"
        ? content.routines.map((routine) => (
            <span
              key={routine.id}
              className="training-pill-dot"
              style={routineColorStyle(routine.colorIndex)}
            />
          ))
        : null}
      {content.kind === "event" ? (
        <span className="training-pill-dot training-pill-dot-event" />
      ) : null}
    </span>
  );
}

export function TrainingDayPills({
  translate,
  plan,
  selectedWeekday,
  onSelectDay,
}: DayListProps): React.JSX.Element {
  return (
    <ul
      className="training-pills"
      aria-label={translate("training.member.days", {
        week: plan.week.number,
      })}
    >
      {plan.week.days.map((day) => {
        const content = trainingDayContent(day, plan.cycle);
        const isToday = day.date === plan.current.today;
        return (
          <li key={day.date}>
            <button
              type="button"
              className={`training-pill training-pill-${content.kind}`}
              aria-pressed={day.weekday === selectedWeekday}
              aria-label={translate("training.member.dayPill", {
                day: formatDashboardDay(translate.locale, day.date),
                summary: describeDayContent(translate, content),
              })}
              onClick={() => onSelectDay(day.weekday)}
            >
              <span
                className={
                  isToday
                    ? "training-pill-initial training-pill-initial-today"
                    : "training-pill-initial"
                }
              >
                {formatNarrowWeekday(translate.locale, day.date)}
              </span>
              <span className="training-pill-number">
                {Number(formatCalendarDayParts(translate.locale, day.date).day)}
              </span>
              <PillDots content={content} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
