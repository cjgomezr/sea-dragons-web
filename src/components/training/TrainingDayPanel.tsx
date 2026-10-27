import { ListChecks } from "@phosphor-icons/react/dist/ssr/ListChecks";
import { MoonStars } from "@phosphor-icons/react/dist/ssr/MoonStars";
import { Trophy } from "@phosphor-icons/react/dist/ssr/Trophy";
import { useId } from "react";
import { Icon } from "@/components/Icon";
import { formatDashboardDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type {
  TrainingCycle,
  TrainingDay,
  TrainingRoutine,
} from "@/lib/training/training-plan";
import {
  exerciseCount,
  trainingDayContent,
} from "@/lib/training/training-week-view";
import { routineColorStyle } from "./training-format";

/**
 * El día elegido (#900, §4.1 del handoff): la rutina con su fecha y cuántos
 * ejercicios tiene, las dos una debajo de la otra (D7), el descanso o el
 * evento. Las filas de ejercicios llegan con #901.
 */

function RoutineCard({
  translate,
  day,
  routine,
}: {
  readonly translate: Translator;
  readonly day: TrainingDay;
  readonly routine: TrainingRoutine;
}): React.JSX.Element {
  const headingId = useId();
  return (
    <section
      className="training-panel-card training-panel-routine"
      aria-labelledby={headingId}
      style={routineColorStyle(routine.colorIndex)}
    >
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
      <span className="training-panel-tile">
        <Icon glyph={glyph} />
      </span>
      <div className="training-panel-heading">
        <h3 id={headingId}>{title}</h3>
        <p className="training-panel-meta">{text}</p>
      </div>
    </section>
  );
}

export function TrainingDayPanel({
  translate,
  cycle,
  day,
}: {
  readonly translate: Translator;
  readonly cycle: TrainingCycle;
  readonly day: TrainingDay;
}): React.JSX.Element {
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
