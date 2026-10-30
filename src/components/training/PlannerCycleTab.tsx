"use client";

import { CalendarCheck } from "@phosphor-icons/react/dist/ssr/CalendarCheck";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { useId, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import { summarizeCycle } from "@/lib/training/cycle-planner-view";
import { CycleStatusPill, PlannerCycleCards } from "./PlannerCycleCards";
import { PlannerCycleActions } from "./PlannerCycleActions";
import { PlannerCycleGrid } from "./PlannerCycleGrid";
import { PlannerCycleFields } from "./PlannerCycleFields";
import { cycleMeta, summaryLine } from "./planner-format";
import type { PlannerCycles } from "./use-planner-cycles";

/**
 * La pestaña Ciclo de Planificar (#906, §5.1 y §5.2 del handoff): en el
 * escritorio, las tarjetas, la franja de acciones y los campos; en el móvil,
 * un selector de ciclo y una tarjeta con su estado, sus campos y sus
 * acciones. Debajo, la cuadrícula del ciclo (#907).
 */

type CycleTabProps = {
  readonly translate: Translator;
  readonly planner: PlannerCycles;
  readonly cycles: readonly ManagedCycle[];
  readonly selected: ManagedCycle;
};

function activeCycleName(cycles: readonly ManagedCycle[]): string | null {
  const active = cycles.find((cycle) => cycle.status === "active");
  return active === undefined ? null : active.name;
}

function SummaryLine({
  translate,
  cycle,
}: {
  readonly translate: Translator;
  readonly cycle: ManagedCycle;
}): React.JSX.Element {
  return (
    <p className="training-plan-summary">
      <span className="training-plan-summary-icon">
        <Icon glyph={CalendarCheck} />
      </span>
      {summaryLine(translate, summarizeCycle(cycle, new Date()))}
    </p>
  );
}

function NewCycleButton({
  translate,
  planner,
}: {
  readonly translate: Translator;
  readonly planner: PlannerCycles;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="training-plan-action training-plan-action-new"
      aria-label={translate("training.manage.newCycle")}
      disabled={planner.isBusy}
      onClick={planner.create}
    >
      <Icon glyph={Plus} />
    </button>
  );
}

export function DesktopCycleTab({
  translate,
  planner,
  cycles,
  selected,
}: CycleTabProps): React.JSX.Element {
  return (
    <>
      <PlannerCycleCards
        translate={translate}
        cycles={cycles}
        selectedId={selected.id}
        isBusy={planner.isBusy}
        onSelect={planner.select}
        onCreate={planner.create}
      />
      <div className="training-plan-strip">
        <p className="training-plan-editing">
          {translate("training.manage.editing")}{" "}
          <strong>{selected.name}</strong>
        </p>
        <PlannerCycleActions
          key={`actions-${selected.id}`}
          translate={translate}
          cycle={selected}
          planner={planner}
          activeName={activeCycleName(cycles)}
          isCompact={false}
          className="training-plan-actions"
        />
      </div>
      <PlannerCycleFields
        key={selected.id}
        translate={translate}
        cycle={selected}
        planner={planner}
      />
      <SummaryLine translate={translate} cycle={selected} />
      <PlannerCycleGrid
        key={`grid-${selected.id}`}
        translate={translate}
        planner={planner}
        cycle={selected}
      />
    </>
  );
}

function CycleSelect({
  translate,
  cycles,
  selectedId,
  onSelect,
}: {
  readonly translate: Translator;
  readonly cycles: readonly ManagedCycle[];
  readonly selectedId: string;
  readonly onSelect: (cycleId: string) => void;
}): React.JSX.Element {
  const id = useId();
  const current = cycles.filter((cycle) => cycle.status !== "archived");
  const archived = cycles.filter((cycle) => cycle.status === "archived");
  return (
    <div className="training-plan-field training-plan-cycle-select">
      <label htmlFor={id}>{translate("training.manage.cycleSelect")}</label>
      <select
        id={id}
        value={selectedId}
        onChange={(event) => onSelect(event.target.value)}
      >
        {current.map((cycle) => (
          <option key={cycle.id} value={cycle.id}>
            {translate(
              cycle.status === "active"
                ? "training.manage.optionActive"
                : "training.manage.optionDraft",
              { name: cycle.name },
            )}
          </option>
        ))}
        {archived.length === 0 ? null : (
          <optgroup label={translate("training.manage.archivedGroup")}>
            {archived.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}

/** Los campos del activo esperan detrás de "Edit name and dates"; los del
 * borrador se ven siempre y los del archivado, de lectura. */
function PhoneFields({
  translate,
  planner,
  selected,
}: Omit<CycleTabProps, "cycles">): React.JSX.Element {
  const [isEditingActive, setIsEditingActive] = useState(false);
  const fields = (
    <PlannerCycleFields
      key={selected.id}
      translate={translate}
      cycle={selected}
      planner={planner}
    />
  );
  if (selected.status !== "active") {
    return fields;
  }
  return (
    <>
      <button
        type="button"
        className="training-plan-edit-toggle"
        aria-expanded={isEditingActive}
        onClick={() => setIsEditingActive((previous) => !previous)}
      >
        <Icon glyph={PencilSimple} />
        {translate("training.manage.editNameAndDates")}
      </button>
      {isEditingActive ? fields : null}
    </>
  );
}

export function PhoneCycleTab({
  translate,
  planner,
  cycles,
  selected,
}: CycleTabProps): React.JSX.Element {
  return (
    <>
      <div className="training-plan-phone-card">
        <CycleSelect
          translate={translate}
          cycles={cycles}
          selectedId={selected.id}
          onSelect={planner.select}
        />
        <p className="training-plan-phone-meta">
          <CycleStatusPill translate={translate} cycle={selected} />
          <span>{cycleMeta(translate, selected)}</span>
        </p>
        <PhoneFields
          key={selected.id}
          translate={translate}
          planner={planner}
          selected={selected}
        />
        <PlannerCycleActions
          key={`actions-${selected.id}`}
          translate={translate}
          cycle={selected}
          planner={planner}
          activeName={activeCycleName(cycles)}
          isCompact
          className="training-plan-actions training-plan-phone-actions"
        >
          <NewCycleButton translate={translate} planner={planner} />
        </PlannerCycleActions>
      </div>
      <SummaryLine translate={translate} cycle={selected} />
      <PlannerCycleGrid
        key={`grid-${selected.id}`}
        translate={translate}
        planner={planner}
        cycle={selected}
      />
    </>
  );
}
