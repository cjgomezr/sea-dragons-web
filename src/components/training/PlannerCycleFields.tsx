"use client";

import { useId, useState } from "react";
import type { Translator } from "@/lib/i18n/translator";
import type { CycleChanges, ManagedCycle } from "@/lib/training/club-cycles";
import {
  scheduleDate,
  scheduleForDate,
  scheduleForEventName,
} from "@/lib/training/cycle-planner-view";
import { DATE_REQUIRED_REASON } from "./planner-format";
import type { PlannerCycles } from "./use-planner-cycles";

/**
 * Los campos de un ciclo en Planificar (#906, RF-7): nombre, evento, su
 * fecha (o la de inicio sin evento) y semanas. Cada uno se guarda al salir
 * de él. Si la API no lo acepta, el campo vuelve a lo que tenía. Bajar las
 * semanas cuando las que sobran tienen días pide confirmar antes.
 *
 * Quien lo pinta le pone de `key` el ciclo tal como llegó, así que cada
 * respuesta del servidor vuelve a llenar los campos.
 */

type FieldName = "name" | "event" | "date" | "weeks";

type Drafts = Readonly<Record<FieldName, string>>;

function draftsOf(cycle: ManagedCycle): Drafts {
  return {
    name: cycle.name,
    event: cycle.event?.name ?? "",
    date: scheduleDate(cycle),
    weeks: String(cycle.weeks),
  };
}

/** Lo que se manda al salir de un campo; nulo si nada cambió, o el motivo
 * si ni se puede mandar. */
function changesFor(
  cycle: ManagedCycle,
  field: FieldName,
  value: string,
): CycleChanges | { readonly invalid: string } | null {
  switch (field) {
    case "name":
      return value === cycle.name ? null : { name: value };
    case "event": {
      const schedule = scheduleForEventName(cycle, value);
      return schedule === null ? null : { schedule };
    }
    case "date": {
      if (value === "") {
        return { invalid: DATE_REQUIRED_REASON };
      }
      const schedule = scheduleForDate(cycle, value);
      return schedule === null ? null : { schedule };
    }
    case "weeks": {
      const weeks = Number(value);
      if (value.trim() === "" || !Number.isInteger(weeks)) {
        return { invalid: "weeks_out_of_range" };
      }
      return weeks === cycle.weeks ? null : { weeks };
    }
  }
}

type PendingRemoval = {
  readonly changes: CycleChanges;
  readonly weeks: number;
  readonly daysRemoved: number;
};

function RemovalConfirm({
  translate,
  pending,
  onConfirm,
  onCancel,
}: {
  readonly translate: Translator;
  readonly pending: PendingRemoval;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const textId = useId();
  return (
    <div
      className="training-plan-confirm"
      role="group"
      aria-labelledby={textId}
    >
      <p id={textId}>
        {translate("training.manage.confirmRemoval", {
          count: pending.daysRemoved,
          weeks: pending.weeks,
        })}
      </p>
      <div className="training-plan-confirm-actions">
        <button type="button" className="admin-secondary" onClick={onCancel}>
          {translate("training.manage.cancel")}
        </button>
        <button
          type="button"
          className="training-plan-danger"
          onClick={onConfirm}
        >
          {translate("training.manage.confirmRemove", {
            count: pending.daysRemoved,
          })}
        </button>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  isReadOnly,
  type = "text",
  className,
  onChange,
  onBlur,
}: {
  readonly label: string;
  readonly value: string;
  readonly isReadOnly: boolean;
  readonly type?: "text" | "date" | "number";
  readonly className: string;
  readonly onChange: (value: string) => void;
  readonly onBlur: () => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className={`training-plan-field ${className}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        readOnly={isReadOnly}
        inputMode={type === "number" ? "numeric" : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </div>
  );
}

export function PlannerCycleFields({
  translate,
  cycle,
  planner,
}: {
  readonly translate: Translator;
  readonly cycle: ManagedCycle;
  readonly planner: Pick<PlannerCycles, "save" | "showError">;
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<Drafts>(() => draftsOf(cycle));
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  const isReadOnly = cycle.status === "archived";

  function revert(field: FieldName): void {
    setDrafts((current) => ({ ...current, [field]: draftsOf(cycle)[field] }));
  }

  async function save(
    field: FieldName,
    changes: CycleChanges,
    confirmRemoval: boolean,
  ): Promise<void> {
    const result = await planner.save({
      cycleId: cycle.id,
      changes,
      confirmRemoval,
    });
    if (result.kind === "failed") {
      revert(field);
    }
    if (result.kind === "confirmRemoval" && changes.weeks !== undefined) {
      setPending({
        changes,
        weeks: changes.weeks,
        daysRemoved: result.daysRemoved,
      });
    }
  }

  function leave(field: FieldName): void {
    if (isReadOnly) {
      return;
    }
    const changes = changesFor(cycle, field, drafts[field]);
    if (changes === null) {
      return;
    }
    if ("invalid" in changes) {
      revert(field);
      planner.showError({ reason: changes.invalid });
      return;
    }
    void save(field, changes, false);
  }

  function fieldProps(field: FieldName): {
    readonly value: string;
    readonly isReadOnly: boolean;
    readonly className: string;
    readonly onChange: (value: string) => void;
    readonly onBlur: () => void;
  } {
    return {
      value: drafts[field],
      isReadOnly,
      className: `training-plan-field-${field}`,
      onChange: (value) =>
        setDrafts((current) => ({ ...current, [field]: value })),
      onBlur: () => leave(field),
    };
  }

  return (
    <>
      <div className="training-plan-fields">
        <TextField
          label={translate("training.manage.cycleName")}
          {...fieldProps("name")}
        />
        <TextField
          label={translate("training.manage.targetEvent")}
          {...fieldProps("event")}
        />
        <TextField
          label={translate(
            cycle.event === null
              ? "training.manage.startDate"
              : "training.manage.eventDate",
          )}
          type="date"
          {...fieldProps("date")}
        />
        <TextField
          label={translate("training.manage.weeks")}
          type="number"
          {...fieldProps("weeks")}
        />
      </div>
      {pending === null ? null : (
        <RemovalConfirm
          translate={translate}
          pending={pending}
          onCancel={() => {
            setPending(null);
            revert("weeks");
          }}
          onConfirm={() => {
            setPending(null);
            void save("weeks", pending.changes, true);
          }}
        />
      )}
    </>
  );
}
