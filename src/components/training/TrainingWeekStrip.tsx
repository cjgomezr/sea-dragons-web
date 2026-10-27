import type { Translator } from "@/lib/i18n/translator";
import type { ActiveTrainingPlan } from "@/lib/training/training-plan";
import {
  type WeekStripMark,
  weekStripMark,
} from "@/lib/training/training-week-view";

/**
 * Un botón por semana del ciclo (#900, §4.1 del handoff), sólo en el
 * escritorio: la actual con NOW, la que se mira resaltada, las pasadas
 * apagadas y la del evento en el color de aviso.
 */

const LABEL_SEPARATOR = ", ";

function weekLabel(
  translate: Translator,
  week: number,
  mark: WeekStripMark,
): string {
  return [
    translate("training.member.weekButton", { week }),
    ...(mark.isCurrent ? [translate("training.member.thisWeek")] : []),
    ...(mark.isEventWeek ? [translate("training.member.eventWeek")] : []),
  ].join(LABEL_SEPARATOR);
}

function weekClassName(mark: WeekStripMark): string {
  return [
    "training-strip-week",
    ...(mark.isPast ? ["training-strip-week-past"] : []),
    ...(mark.isEventWeek ? ["training-strip-week-event"] : []),
  ].join(" ");
}

export function TrainingWeekStrip({
  translate,
  plan,
  onChooseWeek,
}: {
  readonly translate: Translator;
  readonly plan: ActiveTrainingPlan;
  readonly onChooseWeek: (week: number) => void;
}): React.JSX.Element {
  const weeks = Array.from(
    { length: plan.cycle.weeks },
    (_, index) => index + 1,
  );
  return (
    <nav
      className="training-strip"
      aria-label={translate("training.member.weeks")}
    >
      {weeks.map((week) => {
        const mark = weekStripMark(plan, week);
        return (
          <button
            key={week}
            type="button"
            className={weekClassName(mark)}
            aria-label={weekLabel(translate, week, mark)}
            aria-pressed={week === plan.week.number}
            onClick={() => onChooseWeek(week)}
          >
            {mark.isCurrent ? (
              <span className="training-strip-now">
                {translate("training.member.now")}
              </span>
            ) : null}
            {week}
          </button>
        );
      })}
    </nav>
  );
}
