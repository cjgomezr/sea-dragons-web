"use client";

import { CalendarBlank } from "@phosphor-icons/react/dist/ssr/CalendarBlank";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { Icon } from "@/components/Icon";
import { useIsPhone } from "@/components/use-is-phone";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import { DesktopCycleTab, PhoneCycleTab } from "./PlannerCycleTab";
import { plannerErrorMessage } from "./planner-format";
import { type PlannerCycles, usePlannerCycles } from "./use-planner-cycles";

/**
 * Planificar (#906, RF-7 y D3 del PRD de E35; §5.1 y §5.2 del handoff): la
 * cabecera, las pestañas y la pestaña Ciclo. Solo salen las pestañas que ya
 * existen; las demás llegan con sus tickets.
 *
 * Es de cliente porque elige y cambia ciclos sin recargar. Lee y escribe
 * solo por la API v1 (#904), como la aplicación nativa (CON-002).
 */

const CYCLE_TAB_ID = "planificar-pestana-ciclo";
const CYCLE_PANEL_ID = "planificar-panel-ciclo";

function PlannerHeader({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <header className="training-plan-header">
      <div>
        <p className="training-eyebrow">
          {translate("training.manage.eyebrow")}
        </p>
        <h1>{translate("training.manage.title")}</h1>
      </div>
      <p className="training-plan-lead">{translate("training.manage.lead")}</p>
    </header>
  );
}

/** La pestaña Ciclo, con las semanas del ciclo elegido si lo hay. */
function PlannerTabs({
  translate,
  selected,
}: {
  readonly translate: Translator;
  readonly selected: ManagedCycle | null;
}): React.JSX.Element {
  return (
    <div
      className="training-plan-tabs"
      role="tablist"
      aria-label={translate("training.manage.tabs")}
    >
      <button
        type="button"
        role="tab"
        id={CYCLE_TAB_ID}
        className="training-plan-tab"
        aria-selected="true"
        aria-controls={CYCLE_PANEL_ID}
      >
        <Icon glyph={CalendarBlank} />
        {translate("training.manage.tabCycle")}
        {selected === null ? null : (
          <>
            {" "}
            <span className="training-plan-tab-count">
              {translate("training.manage.tabCycleCount", {
                weeks: selected.weeks,
              })}
            </span>
          </>
        )}
      </button>
    </div>
  );
}

function NoCycles({
  translate,
  planner,
}: {
  readonly translate: Translator;
  readonly planner: PlannerCycles;
}): React.JSX.Element {
  return (
    <div className="training-empty">
      <p className="training-empty-title">
        {translate("training.manage.noCycles")}
      </p>
      <p className="admin-empty">{translate("training.manage.noCyclesText")}</p>
      <button
        type="button"
        className="training-plan-action"
        disabled={planner.isBusy}
        onClick={planner.create}
      >
        <Icon glyph={Plus} />
        {translate("training.manage.newCycle")}
      </button>
    </div>
  );
}

function CyclePanelContent({
  translate,
  planner,
  cycles,
  selected,
}: {
  readonly translate: Translator;
  readonly planner: PlannerCycles;
  readonly cycles: readonly ManagedCycle[];
  readonly selected: ManagedCycle | null;
}): React.JSX.Element {
  const isPhone = useIsPhone();
  if (selected === null) {
    return <NoCycles translate={translate} planner={planner} />;
  }
  const props = { translate, planner, cycles, selected };
  return isPhone ? (
    <PhoneCycleTab {...props} />
  ) : (
    <DesktopCycleTab {...props} />
  );
}

/** El aviso verde vive siempre en la página, vacío si no hay nada que
 * decir: un `role="status"` que aparece con su texto ya puesto no lo
 * anuncian todos los lectores. */
function PlannerMessages({
  translate,
  planner,
}: {
  readonly translate: Translator;
  readonly planner: PlannerCycles;
}): React.JSX.Element {
  return (
    <>
      <p className="training-plan-notice" role="status">
        {planner.notice}
      </p>
      {planner.error === null ? null : (
        <p className="auth-error" role="alert">
          {plannerErrorMessage(translate, planner.error)}
        </p>
      )}
    </>
  );
}

function PlannerContent({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  const planner = usePlannerCycles(translate);
  const { state } = planner;
  if (state.kind === "loading") {
    return (
      <p className="admin-empty">{translate("training.manage.loading")}</p>
    );
  }
  if (state.kind === "failed") {
    return (
      <div className="admin-load-failure">
        <p className="auth-error" role="alert">
          {translate("training.manage.failed")}
        </p>
        <button type="button" className="auth-submit" onClick={planner.retry}>
          {translate("training.manage.retry")}
        </button>
      </div>
    );
  }
  const selected =
    state.cycles.find((cycle) => cycle.id === state.selectedId) ?? null;
  return (
    <>
      <PlannerTabs translate={translate} selected={selected} />
      <div
        className="training-plan-panel"
        role="tabpanel"
        id={CYCLE_PANEL_ID}
        aria-labelledby={CYCLE_TAB_ID}
      >
        <PlannerMessages translate={translate} planner={planner} />
        <CyclePanelContent
          translate={translate}
          planner={planner}
          cycles={state.cycles}
          selected={selected}
        />
      </div>
    </>
  );
}

export function TrainingPlannerScreen({
  locale,
}: {
  readonly locale: Locale;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  return (
    <div className="training training-plan">
      <PlannerHeader translate={translate} />
      <PlannerContent translate={translate} />
    </div>
  );
}
