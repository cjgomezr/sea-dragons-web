"use client";

import { useId, useState } from "react";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import type { CycleWeekRecord } from "@/lib/training/club-cycles";
import {
  DOSE_REPS_MAX_LENGTH,
  DOSE_TEXT_MAX_LENGTH,
  WEEK_NOTE_MAX_LENGTH,
} from "@/lib/training/club-cycle-input";
import {
  type IntensityKind,
  type WeekDraft,
  draftOfWeek,
  readWeekDraft,
} from "@/lib/training/cycle-grid-view";
import type { DoseIntensity, WeekDose } from "@/lib/training/training-load";
import type { GridReporter } from "./use-cycle-grid";

/**
 * La nota y la dosis de una semana (#907, D6): la nota de hasta 140, y las
 * series, las repeticiones y la intensidad (ninguna, % de la marca o un
 * texto). Cada campo se guarda al salir; si no se guarda, vuelve a lo que
 * tenía y Planificar dice por qué.
 */

const INTENSITY_KEYS = {
  none: "training.manage.intensityNone",
  pct: "training.manage.intensityPct",
  text: "training.manage.intensityText",
} as const satisfies Record<IntensityKind, MessageKey>;

const INTENSITY_KINDS = Object.keys(INTENSITY_KEYS) as IntensityKind[];

export type WeekEditorProps = {
  readonly translate: Translator;
  readonly week: CycleWeekRecord;
  readonly isReadOnly: boolean;
  readonly reporter: GridReporter;
  /** Verdadero si se guardó. */
  readonly onSave: (week: CycleWeekRecord) => Promise<boolean>;
  readonly id?: string;
};

function isSameIntensity(first: DoseIntensity, second: DoseIntensity): boolean {
  switch (first.kind) {
    case "none":
      return second.kind === "none";
    case "pct":
      return second.kind === "pct" && second.pct === first.pct;
    case "text":
      return second.kind === "text" && second.text === first.text;
  }
}

function isSameDose(first: WeekDose | null, second: WeekDose | null): boolean {
  if (first === null || second === null) {
    return first === second;
  }
  return (
    first.sets === second.sets &&
    first.reps === second.reps &&
    isSameIntensity(first.intensity, second.intensity)
  );
}

/** Salir de un campo sin cambiar nada no manda nada. */
function isSameWeek(first: CycleWeekRecord, second: CycleWeekRecord): boolean {
  return first.note === second.note && isSameDose(first.dose, second.dose);
}

function TextField({
  label,
  value,
  maxLength,
  inputMode,
  isReadOnly,
  onChange,
  onCommit,
}: {
  readonly label: string;
  readonly value: string;
  readonly maxLength?: number;
  readonly inputMode?: "numeric" | "decimal";
  readonly isReadOnly: boolean;
  readonly onChange: (value: string) => void;
  readonly onCommit: () => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="training-plan-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        value={value}
        maxLength={maxLength}
        readOnly={isReadOnly}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
      />
    </div>
  );
}

function IntensityField({
  translate,
  draft,
  isReadOnly,
  onChange,
}: {
  readonly translate: Translator;
  readonly draft: WeekDraft;
  readonly isReadOnly: boolean;
  readonly onChange: (kind: IntensityKind) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="training-plan-field">
      <label htmlFor={id}>{translate("training.manage.doseIntensity")}</label>
      <select
        id={id}
        value={draft.intensityKind}
        disabled={isReadOnly}
        onChange={(event) => onChange(event.target.value as IntensityKind)}
      >
        {INTENSITY_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {translate(INTENSITY_KEYS[kind])}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PlannerWeekEditor({
  translate,
  week,
  isReadOnly,
  reporter,
  onSave,
  id,
}: WeekEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState(() => draftOfWeek(week));

  function change(patch: Partial<WeekDraft>): WeekDraft {
    const next = { ...draft, ...patch };
    setDraft(next);
    return next;
  }

  async function commit(next: WeekDraft): Promise<void> {
    const reading = readWeekDraft(week.weekNo, next);
    switch (reading.kind) {
      case "incomplete":
        return;
      case "invalid":
        reporter.showError({ reason: reading.reason });
        setDraft(draftOfWeek(week));
        return;
      case "ready":
        if (isSameWeek(reading.week, week)) {
          return;
        }
        if (!(await onSave(reading.week))) {
          setDraft(draftOfWeek(week));
        }
    }
  }

  const fieldProps = {
    isReadOnly,
    onCommit: () => void commit(draft),
  };
  return (
    <fieldset id={id} className="training-grid-week-editor">
      <legend>
        {translate("training.manage.weekEditor", { week: week.weekNo })}
      </legend>
      <div className="training-grid-week-note">
        <TextField
          {...fieldProps}
          label={translate("training.manage.weekNote")}
          value={draft.note}
          maxLength={WEEK_NOTE_MAX_LENGTH}
          onChange={(note) => change({ note })}
        />
        <p className="training-grid-hint">
          {translate("training.manage.weekNoteHint")}
        </p>
      </div>
      <div
        className="training-grid-week-dose"
        role="group"
        aria-label={translate("training.manage.weekDose")}
      >
        <TextField
          {...fieldProps}
          label={translate("training.manage.doseSets")}
          value={draft.sets}
          inputMode="numeric"
          onChange={(sets) => change({ sets })}
        />
        <TextField
          {...fieldProps}
          label={translate("training.manage.doseReps")}
          value={draft.reps}
          maxLength={DOSE_REPS_MAX_LENGTH}
          onChange={(reps) => change({ reps })}
        />
        <IntensityField
          translate={translate}
          draft={draft}
          isReadOnly={isReadOnly}
          onChange={(intensityKind) =>
            void commit(change({ intensityKind, intensityValue: "" }))
          }
        />
        {draft.intensityKind === "none" ? null : (
          <TextField
            {...fieldProps}
            label={translate(
              draft.intensityKind === "pct"
                ? "training.manage.intensityPctValue"
                : "training.manage.intensityTextValue",
            )}
            value={draft.intensityValue}
            inputMode={draft.intensityKind === "pct" ? "decimal" : undefined}
            maxLength={
              draft.intensityKind === "text" ? DOSE_TEXT_MAX_LENGTH : undefined
            }
            onChange={(intensityValue) => change({ intensityValue })}
          />
        )}
      </div>
    </fieldset>
  );
}
