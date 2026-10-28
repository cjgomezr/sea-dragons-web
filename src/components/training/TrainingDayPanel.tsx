import { Info } from "@phosphor-icons/react/dist/ssr/Info";
import { ListChecks } from "@phosphor-icons/react/dist/ssr/ListChecks";
import { MoonStars } from "@phosphor-icons/react/dist/ssr/MoonStars";
import { Trophy } from "@phosphor-icons/react/dist/ssr/Trophy";
import { useId } from "react";
import { Icon } from "@/components/Icon";
import { formatDashboardDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { missingMarksOf } from "@/lib/training/routine-row-view";
import type {
  TrainingCycle,
  TrainingDay,
  TrainingRoutine,
} from "@/lib/training/training-plan";
import {
  exerciseCount,
  trainingDayContent,
} from "@/lib/training/training-week-view";
import { type RowContext, TrainingExerciseRow } from "./TrainingExerciseRow";
import { routineColorStyle } from "./training-format";

/**
 * El día elegido (#900 y #901, §4.1 del handoff): cada rutina con su fecha,
 * cuántos ejercicios tiene y sus filas, las dos una debajo de la otra (D7);
 * el descanso o el evento.
 */

function RoutineItems({
  translate,
  routine,
  context,
}: {
  readonly translate: Translator;
  readonly routine: TrainingRoutine;
  readonly context: RowContext;
}): React.JSX.Element {
  if (routine.items.length === 0) {
    return (
      <p className="training-routine-empty">
        {translate("training.member.nothingHereYet")}
      </p>
    );
  }
  return (
    <ul className="training-routine-items">
      {routine.items.map((item) =>
        item.kind === "section" ? (
          <li key={item.id} className="training-section">
            <h4>{item.title}</h4>
          </li>
        ) : (
          <TrainingExerciseRow
            key={item.id}
            translate={translate}
            row={item}
            context={context}
          />
        ),
      )}
    </ul>
  );
}

function MissingMarks({
  translate,
  routine,
  context,
}: {
  readonly translate: Translator;
  readonly routine: TrainingRoutine;
  readonly context: RowContext;
}): React.JSX.Element | null {
  const missing = missingMarksOf(routine.items, context);
  if (missing.length === 0) {
    return null;
  }
  return (
    <div className="training-missing-marks">
      {missing.map((mark) => (
        <p key={mark.id}>
          <Icon glyph={Info} />
          {translate("training.member.missingMark", {
            mark: mark.name.toLocaleLowerCase(translate.locale),
          })}
        </p>
      ))}
    </div>
  );
}

function RoutineCard({
  translate,
  day,
  routine,
  context,
}: {
  readonly translate: Translator;
  readonly day: TrainingDay;
  readonly routine: TrainingRoutine;
  readonly context: RowContext;
}): React.JSX.Element {
  const headingId = useId();
  return (
    <section
      className="training-panel-card training-panel-routine"
      aria-labelledby={headingId}
      style={routineColorStyle(routine.colorIndex)}
    >
      <div className="training-panel-header">
        <span className="training-panel-tile">
          <Icon glyph={ListChecks} />
        </span>
        <div className="training-panel-heading">
          <h3 id={headingId}>{routine.name}</h3>
          <p className="training-panel-meta">
            {translate("training.member.dayMeta", {
              day: formatDashboardDay(translate.locale, day.date),
              exercises: translate("training.member.exercises", {
                count: exerciseCount(routine),
              }),
            })}
          </p>
        </div>
      </div>
      <RoutineItems translate={translate} routine={routine} context={context} />
      <MissingMarks translate={translate} routine={routine} context={context} />
    </section>
  );
}

function QuietDayCard({
  modifier,
  glyph,
  title,
  text,
}: {
  readonly modifier: "rest" | "event";
  readonly glyph: typeof MoonStars;
  readonly title: string;
  readonly text: string;
}): React.JSX.Element {
  const headingId = useId();
  return (
    <section
      className={`training-panel-card training-panel-${modifier}`}
      aria-labelledby={headingId}
    >
      <div className="training-panel-header">
        <span className="training-panel-tile">
          <Icon glyph={glyph} />
        </span>
        <div className="training-panel-heading">
          <h3 id={headingId}>{title}</h3>
          <p className="training-panel-meta">{text}</p>
        </div>
      </div>
    </section>
  );
}

export function TrainingDayPanel({
  translate,
  cycle,
  day,
  ...context
}: {
  readonly translate: Translator;
  readonly cycle: TrainingCycle;
  readonly day: TrainingDay;
} & RowContext): React.JSX.Element {
  const content = trainingDayContent(day, cycle);
  switch (content.kind) {
    case "routines":
      return (
        <div className="training-panel">
          {content.routines.map((routine) => (
            <RoutineCard
              key={routine.id}
              translate={translate}
              day={day}
              routine={routine}
              context={context}
            />
          ))}
        </div>
      );
    case "rest":
      return (
        <div className="training-panel">
          <QuietDayCard
            modifier="rest"
            glyph={MoonStars}
            title={translate("training.member.restDay")}
            text={translate("training.member.restDayText")}
          />
        </div>
      );
    case "event":
      return (
        <div className="training-panel">
          <QuietDayCard
            modifier="event"
            glyph={Trophy}
            title={content.eventName}
            text={translate("training.member.goodLuck")}
          />
        </div>
      );
  }
}
