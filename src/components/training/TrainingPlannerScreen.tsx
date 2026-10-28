"use client";

import { CalendarBlank } from "@phosphor-icons/react/dist/ssr/CalendarBlank";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { Trophy } from "@phosphor-icons/react/dist/ssr/Trophy";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { useIsPhone } from "@/components/use-is-phone";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import { DesktopCycleTab, PhoneCycleTab } from "./PlannerCycleTab";
import { PlannerMarksTab } from "./PlannerMarksTab";
import { plannerErrorMessage } from "./planner-format";
import { type PlannerCycles, usePlannerCycles } from "./use-planner-cycles";
import { type PlannerMarks, usePlannerMarks } from "./use-planner-marks";

/**
 * Planificar (#906, RF-7 y D3 del PRD de E35; §5.1 y §5.2 del handoff): la
 * cabecera, las pestañas y la pestaña Ciclo; Marcas llegó con #911. Solo
 * salen las pestañas que ya existen; las demás llegan con sus tickets.
 *
 * Es de cliente porque elige y cambia ciclos sin recargar. Lee y escribe
 * solo por la API v1 (#904), como la aplicación nativa (CON-002).
 */

type PlannerTab = "cycle" | "marks";

/** En el orden en que salen, que es el que recorren las flechas. */
const PLANNER_TABS: readonly PlannerTab[] = ["cycle", "marks"];

const TAB_IDS = {
  cycle: "planificar-pestana-ciclo",
  marks: "planificar-pestana-marcas",
} as const satisfies Record<PlannerTab, string>;

const PANEL_IDS = {
  cycle: "planificar-panel-ciclo",
  marks: "planificar-panel-marcas",
} as const satisfies Record<PlannerTab, string>;

/** ← y → pasan a la pestaña de al lado, dando la vuelta, como pide el patrón
 * de pestañas de WAI-ARIA. */
const TAB_STEP_OF_KEY: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
};

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

function TabButton({
  tab,
  isSelected,
  onSelect,
  children,
}: {
  readonly tab: PlannerTab;
  readonly isSelected: boolean;
  readonly onSelect: (tab: PlannerTab) => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      id={TAB_IDS[tab]}
      className="training-plan-tab"
      aria-selected={isSelected}
      aria-controls={PANEL_IDS[tab]}
      tabIndex={isSelected ? 0 : -1}
      onClick={() => onSelect(tab)}
    >
      {children}
    </button>
  );
}

function TabCount({ text }: { readonly text: string }): React.JSX.Element {
  return (
    <>
      {" "}
      <span className="training-plan-tab-count">{text}</span>
    </>
  );
}

/** Ciclo con las semanas del elegido si lo hay, y Marcas con cuántas hay
 * cuando ya llegaron. */
function PlannerTabs({
  translate,
  selectedTab,
  selectedCycle,
  marks,
  onSelect,
}: {
  readonly translate: Translator;
  readonly selectedTab: PlannerTab;
  readonly selectedCycle: ManagedCycle | null;
  readonly marks: PlannerMarks;
  readonly onSelect: (tab: PlannerTab) => void;
}): React.JSX.Element {
  function handleKey(event: React.KeyboardEvent): void {
    const step = TAB_STEP_OF_KEY[event.key];
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    const at = PLANNER_TABS.indexOf(selectedTab);
    const next =
      PLANNER_TABS[(at + step + PLANNER_TABS.length) % PLANNER_TABS.length];
    if (next !== undefined) {
      onSelect(next);
      document.getElementById(TAB_IDS[next])?.focus();
    }
  }

  return (
    <div
      className="training-plan-tabs"
      role="tablist"
      aria-label={translate("training.manage.tabs")}
      onKeyDown={handleKey}
    >
      <TabButton
        tab="cycle"
        isSelected={selectedTab === "cycle"}
        onSelect={onSelect}
      >
        <Icon glyph={CalendarBlank} />
        {translate("training.manage.tabCycle")}
        {selectedCycle === null ? null : (
          <TabCount
            text={translate("training.manage.tabCycleCount", {
              weeks: selectedCycle.weeks,
            })}
          />
        )}
      </TabButton>
      <TabButton
        tab="marks"
        isSelected={selectedTab === "marks"}
        onSelect={onSelect}
      >
        <Icon glyph={Trophy} />
        {translate("training.manage.tabMarks")}
        {marks.state.kind === "ready" ? (
          <TabCount text={String(marks.state.marks.length)} />
        ) : null}
      </TabButton>
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
  const marks = usePlannerMarks(translate);
  const [selectedTab, setSelectedTab] = useState<PlannerTab>("cycle");
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
      <PlannerTabs
        translate={translate}
        selectedTab={selectedTab}
        selectedCycle={selected}
        marks={marks}
        onSelect={setSelectedTab}
      />
      <div
        className="training-plan-panel"
        role="tabpanel"
        id={PANEL_IDS[selectedTab]}
        aria-labelledby={TAB_IDS[selectedTab]}
      >
        {selectedTab === "cycle" ? (
          <>
            <PlannerMessages translate={translate} planner={planner} />
            <CyclePanelContent
              translate={translate}
              planner={planner}
              cycles={state.cycles}
              selected={selected}
            />
          </>
        ) : (
          <PlannerMarksTab translate={translate} planner={marks} />
        )}
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
