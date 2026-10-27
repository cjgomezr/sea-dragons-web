import { Trophy } from "@phosphor-icons/react/dist/ssr/Trophy";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { TRAINING_PLANNING_PATH } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import type { ActiveTrainingPlan } from "@/lib/training/training-plan";
import { weeksToGo } from "@/lib/training/training-week-view";
import { formatDayWithYear } from "./training-format";

/**
 * La cabecera del ciclo (#900, §4.1 y §4.2 del handoff): el antetítulo, el
 * nombre, el evento o el final, y a la derecha dónde cae hoy. En el móvil,
 * todo en una línea bajo el nombre.
 */

export function PlanTrainingLink({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <Link href={TRAINING_PLANNING_PATH} className="admin-secondary">
      {translate("training.member.planTraining")}
    </Link>
  );
}

function CycleTarget({
  translate,
  plan,
}: {
  readonly translate: Translator;
  readonly plan: ActiveTrainingPlan;
}): React.JSX.Element {
  const { event, endDate } = plan.cycle;
  if (event === null || event.date === null) {
    return (
      <p className="training-target">
        {translate("training.member.endsOn", {
          date: formatDayWithYear(translate.locale, endDate),
        })}
      </p>
    );
  }
  return (
    <p className="training-target">
      <span className="training-target-icon">
        <Icon glyph={Trophy} />
      </span>
      {translate("training.member.eventOn", {
        event: event.name,
        date: formatDayWithYear(translate.locale, event.date),
      })}
    </p>
  );
}

/** "starts {fecha}" o "cycle finished": lo que se dice cuando hoy no cae
 * dentro del ciclo; nulo cuando sí. */
function phaseOutsideCycle(
  translate: Translator,
  plan: ActiveTrainingPlan,
): string | null {
  switch (plan.current.phase) {
    case "not_started":
      return translate("training.member.startsOn", {
        date: formatDayWithYear(translate.locale, plan.cycle.startDate),
      });
    case "finished":
      return translate("training.member.finished");
    case "running":
      return null;
  }
}

function Countdown({
  translate,
  plan,
}: {
  readonly translate: Translator;
  readonly plan: ActiveTrainingPlan;
}): React.JSX.Element {
  const outside = phaseOutsideCycle(translate, plan);
  if (outside !== null) {
    return (
      <div className="training-countdown">
        <p className="training-countdown-week">{outside}</p>
      </div>
    );
  }
  const remaining = weeksToGo(plan);
  return (
    <div className="training-countdown">
      <p className="training-countdown-remaining">
        <span className="training-countdown-number">{remaining}</span>{" "}
        <span className="training-countdown-label">
          {translate("training.member.weeksToGo", { count: remaining })}
        </span>
      </p>
      <p className="training-countdown-week">
        {translate("training.member.weekOfTotal", {
          week: plan.current.week,
          weeks: plan.cycle.weeks,
        })}
      </p>
    </div>
  );
}

function compactPosition(
  translate: Translator,
  plan: ActiveTrainingPlan,
): string {
  return (
    phaseOutsideCycle(translate, plan) ??
    translate("training.member.compactRunning", {
      count: weeksToGo(plan),
      week: plan.current.week,
      weeks: plan.cycle.weeks,
    })
  );
}

export function TrainingHeader({
  translate,
  plan,
  canPlan,
  isPhone,
}: {
  readonly translate: Translator;
  readonly plan: ActiveTrainingPlan;
  readonly canPlan: boolean;
  readonly isPhone: boolean;
}): React.JSX.Element {
  return (
    <header className="training-header">
      <div className="training-heading">
        <p className="training-eyebrow">
          {translate("training.member.eyebrow")}
        </p>
        <h1>{plan.cycle.name}</h1>
        {isPhone ? (
          <p className="training-compact-position">
            {compactPosition(translate, plan)}
          </p>
        ) : (
          <CycleTarget translate={translate} plan={plan} />
        )}
      </div>
      <div className="training-header-side">
        {canPlan ? <PlanTrainingLink translate={translate} /> : null}
        {isPhone ? null : <Countdown translate={translate} plan={plan} />}
      </div>
    </header>
  );
}
