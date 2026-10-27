"use client";

import { useEffect, useState } from "react";
import { useIsPhone } from "@/components/use-is-phone";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type { MarkValues } from "@/lib/training/routine-row-view";
import type { ActiveTrainingPlan } from "@/lib/training/training-plan";
import { defaultSelectedWeekday } from "@/lib/training/training-week-view";
import { loadTrainingPlan } from "./training-client";
import { TrainingDayPanel } from "./TrainingDayPanel";
import { TrainingDayPills, TrainingDayRows } from "./TrainingDayList";
import { PlanTrainingLink, TrainingHeader } from "./TrainingHeader";
import { TrainingWeekNav } from "./TrainingWeekNav";
import { TrainingWeekStrip } from "./TrainingWeekStrip";
import {
  type MemberMarksState,
  type SaveMark,
  useMemberMarks,
} from "./use-member-marks";

/**
 * Entrenamiento (#900, RF-3 y RF-12 del PRD de E35): la cabecera del ciclo
 * activo, sus semanas y los días de la que se mira, con el día elegido al
 * lado (debajo en el móvil).
 *
 * Es de cliente porque se mueve entre semanas y días sin recargar. Lee sólo
 * de la API v1 (#898), la misma que usará la aplicación nativa (CON-002).
 */

type PlanState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "blocked" }
  | { readonly kind: "noCycle" }
  | { readonly kind: "ready"; readonly plan: ActiveTrainingPlan };

/** El plan de la semana pedida; nula es la de hoy. Al cambiar de semana se
 * sigue viendo la anterior hasta que llega la nueva. */
function useTrainingPlan(): {
  readonly state: PlanState;
  readonly showWeek: (week: number) => void;
  readonly retry: () => void;
} {
  const [state, setState] = useState<PlanState>({ kind: "loading" });
  const [request, setRequest] = useState<{
    readonly week: number | null;
    readonly attempt: number;
  }>({ week: null, attempt: 0 });

  useEffect(() => {
    let isCurrent = true;
    void loadTrainingPlan(request.week).then((outcome) => {
      if (!isCurrent) {
        return;
      }
      if (outcome.kind !== "loaded") {
        setState({ kind: outcome.kind });
        return;
      }
      const { plan } = outcome;
      setState(
        plan.cycle === null ? { kind: "noCycle" } : { kind: "ready", plan },
      );
    });
    return () => {
      isCurrent = false;
    };
  }, [request]);

  return {
    state,
    showWeek: (week) =>
      setRequest((previous) => ({ week, attempt: previous.attempt })),
    retry: () => {
      setState({ kind: "loading" });
      setRequest((previous) => ({
        ...previous,
        attempt: previous.attempt + 1,
      }));
    },
  };
}

function PlainHeader({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <header className="training-header">
      <h1>{translate("nav.label.training")}</h1>
    </header>
  );
}

function NoPlan({
  translate,
  canPlan,
}: {
  readonly translate: Translator;
  readonly canPlan: boolean;
}): React.JSX.Element {
  return (
    <>
      <PlainHeader translate={translate} />
      <div className="training-empty">
        <p className="training-empty-title">
          {translate("training.member.noPlan")}
        </p>
        <p className="admin-empty">{translate("training.member.noPlanText")}</p>
        {canPlan ? <PlanTrainingLink translate={translate} /> : null}
      </div>
    </>
  );
}

function PlanFailure({
  translate,
  onRetry,
}: {
  readonly translate: Translator;
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="admin-load-failure">
      <p className="auth-error" role="alert">
        {translate("training.member.failed")}
      </p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        {translate("training.member.retry")}
      </button>
    </div>
  );
}

/** Las marcas del socio con las que cada fila calcula sus kilos (#901). */
type MarksForRows = {
  readonly markValues: MarkValues;
  readonly onSaveMark: SaveMark;
};

function TrainingWeekView({
  translate,
  plan,
  canPlan,
  marks,
  onChooseWeek,
}: {
  readonly translate: Translator;
  readonly plan: ActiveTrainingPlan;
  readonly canPlan: boolean;
  readonly marks: MarksForRows;
  readonly onChooseWeek: (week: number) => void;
}): React.JSX.Element {
  const isPhone = useIsPhone();
  const [selection, setSelection] = useState<{
    readonly week: number;
    readonly weekday: number;
  } | null>(null);
  const selectedWeekday =
    selection !== null && selection.week === plan.week.number
      ? selection.weekday
      : defaultSelectedWeekday(plan.week, plan.current.today);
  const selectedDay = plan.week.days.find(
    (day) => day.weekday === selectedWeekday,
  );
  const dayListProps = {
    translate,
    plan,
    selectedWeekday,
    onSelectDay: (weekday: number) =>
      setSelection({ week: plan.week.number, weekday }),
  };

  return (
    <>
      <TrainingHeader
        translate={translate}
        plan={plan}
        canPlan={canPlan}
        isPhone={isPhone}
      />
      {isPhone ? null : (
        <TrainingWeekStrip
          translate={translate}
          plan={plan}
          onChooseWeek={onChooseWeek}
        />
      )}
      <div className="training-layout">
        <div className="training-week">
          <TrainingWeekNav
            translate={translate}
            plan={plan}
            isPhone={isPhone}
            onChooseWeek={onChooseWeek}
          />
          {plan.week.note === null ? null : (
            <p className="training-week-note">{plan.week.note}</p>
          )}
          {isPhone ? (
            <TrainingDayPills {...dayListProps} />
          ) : (
            <TrainingDayRows {...dayListProps} />
          )}
        </div>
        {selectedDay === undefined ? null : (
          <TrainingDayPanel
            translate={translate}
            cycle={plan.cycle}
            day={selectedDay}
            weekDose={plan.week.dose}
            {...marks}
          />
        )}
      </div>
    </>
  );
}

/** La pantalla espera al plan y a las marcas del socio: sin ellas, cada fila
 * con % pediría una marca que a lo mejor ya tiene. Lo que falla o se cierra
 * en cualquiera de los dos manda. */
function combinedState(plan: PlanState, marks: MemberMarksState): PlanState {
  if (plan.kind === "blocked" || marks.kind === "blocked") {
    return { kind: "blocked" };
  }
  if (plan.kind === "failed" || marks.kind === "failed") {
    return { kind: "failed" };
  }
  return marks.kind === "loading" ? { kind: "loading" } : plan;
}

function TrainingContent({
  translate,
  canPlan,
}: {
  readonly translate: Translator;
  readonly canPlan: boolean;
}): React.JSX.Element {
  const plan = useTrainingPlan();
  const marks = useMemberMarks();
  const state = combinedState(plan.state, marks.state);
  const retry = (): void => {
    plan.retry();
    marks.retry();
  };
  switch (state.kind) {
    case "loading":
      return (
        <p className="admin-empty">{translate("training.member.loading")}</p>
      );
    case "failed":
      return <PlanFailure translate={translate} onRetry={retry} />;
    case "blocked":
      // La pantalla bloqueada llega con #902; mientras, sin días.
      return <PlainHeader translate={translate} />;
    case "noCycle":
      return <NoPlan translate={translate} canPlan={canPlan} />;
    case "ready":
      return (
        <TrainingWeekView
          translate={translate}
          plan={state.plan}
          canPlan={canPlan}
          marks={{
            markValues: marks.markValues,
            onSaveMark: marks.saveMark,
          }}
          onChooseWeek={plan.showWeek}
        />
      );
  }
}

export function TrainingScreen({
  locale,
  canPlan,
}: {
  readonly locale: Locale;
  /** Admin y Coach (D3): ven el enlace a Planificar. */
  readonly canPlan: boolean;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  return (
    <div className="training">
      <TrainingContent translate={translate} canPlan={canPlan} />
    </div>
  );
}
