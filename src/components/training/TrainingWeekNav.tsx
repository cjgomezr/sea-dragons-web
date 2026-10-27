import { CaretLeft } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import type { ActiveTrainingPlan } from "@/lib/training/training-plan";
import { formatWeekRange } from "./training-format";

/**
 * ‹ › entre semanas, con la que se mira y sus fechas (#900, §4.1 y §4.2 del
 * handoff). Desde otra semana aparece "Back to this week".
 */

const FIRST_WEEK = 1;

export function TrainingWeekNav({
  translate,
  plan,
  isPhone,
  onChooseWeek,
}: {
  readonly translate: Translator;
  readonly plan: ActiveTrainingPlan;
  readonly isPhone: boolean;
  readonly onChooseWeek: (week: number) => void;
}): React.JSX.Element {
  const week = plan.week.number;
  const isAwayFromThisWeek = week !== plan.current.week;
  return (
    <div className="training-week-nav">
      <button
        type="button"
        className="training-week-step"
        aria-label={translate("training.member.previousWeek")}
        disabled={week <= FIRST_WEEK}
        onClick={() => onChooseWeek(week - 1)}
      >
        <Icon glyph={CaretLeft} />
      </button>
      <div className="training-week-title">
        <h2>
          {isPhone
            ? translate("training.member.weekShort", { week })
            : translate("training.member.weekHeading", {
                week,
                weeks: plan.cycle.weeks,
              })}
        </h2>
        <p className="training-week-range">
          {formatWeekRange(translate, plan.week)}
        </p>
      </div>
      <button
        type="button"
        className="training-week-step"
        aria-label={translate("training.member.nextWeek")}
        disabled={week >= plan.cycle.weeks}
        onClick={() => onChooseWeek(week + 1)}
      >
        <Icon glyph={CaretRight} />
      </button>
      {isAwayFromThisWeek ? (
        <button
          type="button"
          className="training-back-to-week"
          onClick={() => onChooseWeek(plan.current.week)}
        >
          {translate("training.member.backToThisWeek")}
        </button>
      ) : null}
    </div>
  );
}
