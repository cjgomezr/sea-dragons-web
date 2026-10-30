"use client";

import { useState } from "react";
import type { Translator } from "@/lib/i18n/translator";
import {
  type ExerciseEditorRow,
  type LoadOption,
  loadOptionValue,
  parseLoadOption,
  parseLoadPct,
} from "@/lib/training/routine-editor";
import {
  LOAD_TEXT_MAX_LENGTH,
  type RoutineLoadDraft,
} from "@/lib/training/routine-items";
import type { RoutineMark } from "./planner-routines-client";
import { SavedTextField } from "./SavedTextField";

/**
 * La carga de una fila (#908, D10 del PRD de E35): un selector con No load,
 * "% of" y "Week dose of" de cada marca del club, y Text…. Con "% of" sale
 * el campo del porcentaje; con Text…, el del texto.
 *
 * Una carga que necesita un número o un texto que la fila aún no tiene
 * espera a que se escriba: guardarla sin él sería una fila que la API no
 * acepta. Si se sale del campo vacío, el selector vuelve a lo guardado.
 */

/** La opción elegida que espera su número o su texto para guardarse. */
type PendingLoad = Extract<LoadOption, { kind: "pct" | "text" }>;

/** Lo que el campo de al lado enseña: el porcentaje, el texto o nada. */
type LoadValueField =
  | { readonly kind: "none" }
  | { readonly kind: "pct"; readonly markId: string; readonly value: string }
  | { readonly kind: "text"; readonly value: string };

function valueField(
  load: RoutineLoadDraft,
  pending: PendingLoad | null,
): LoadValueField {
  if (pending?.kind === "pct") {
    return { kind: "pct", markId: pending.markId, value: "" };
  }
  if (pending?.kind === "text") {
    return { kind: "text", value: "" };
  }
  switch (load.kind) {
    case "pct":
      return { kind: "pct", markId: load.markId, value: String(load.pct) };
    case "text":
      return { kind: "text", value: load.text };
    case "none":
    case "week":
      return { kind: "none" };
  }
}

/** La carga que se guarda al elegir una opción, o la que espera su campo. */
function chooseLoad(
  option: LoadOption,
  current: RoutineLoadDraft,
): { readonly save: RoutineLoadDraft } | { readonly wait: PendingLoad } {
  switch (option.kind) {
    case "none":
    case "week":
      return { save: option };
    case "pct":
      // Otra marca con el mismo porcentaje: ya tiene su número.
      return current.kind === "pct"
        ? { save: { ...option, pct: current.pct } }
        : { wait: option };
    case "text":
      return { wait: option };
  }
}

function LoadOptions({
  translate,
  marks,
}: {
  readonly translate: Translator;
  readonly marks: readonly RoutineMark[];
}): React.JSX.Element {
  return (
    <>
      <option value="none">{translate("training.manage.loadNone")}</option>
      {marks.map((mark) => (
        <option key={`pct-${mark.id}`} value={`pct:${mark.id}`}>
          {translate("training.manage.loadPct", { mark: mark.name })}
        </option>
      ))}
      {marks.map((mark) => (
        <option key={`week-${mark.id}`} value={`week:${mark.id}`}>
          {translate("training.manage.loadWeek", { mark: mark.name })}
        </option>
      ))}
      <option value="text">{translate("training.manage.loadText")}</option>
    </>
  );
}

export function PlannerRoutineLoad({
  translate,
  row,
  marks,
  onChange,
}: {
  readonly translate: Translator;
  readonly row: ExerciseEditorRow;
  readonly marks: readonly RoutineMark[];
  readonly onChange: (load: RoutineLoadDraft) => void;
}): React.JSX.Element {
  const [pending, setPending] = useState<PendingLoad | null>(null);
  const exercise = row.exercise.name;
  const field = valueField(row.load, pending);

  /** Lo escrito en el campo de al lado; si no vale, nada se guarda y el
   * selector vuelve a lo guardado. */
  function commitValue(text: string): boolean {
    setPending(null);
    if (field.kind === "pct") {
      const pct = parseLoadPct(text);
      if (pct !== null) {
        onChange({ kind: "pct", markId: field.markId, pct });
      }
      return pct !== null;
    }
    const loadText = text.trim();
    if (loadText !== "") {
      onChange({ kind: "text", text: loadText });
    }
    return loadText !== "";
  }

  return (
    <span className="training-routine-load">
      <select
        aria-label={translate("training.manage.loadFor", { exercise })}
        value={loadOptionValue(pending ?? row.load)}
        onChange={(event) => {
          const choice = chooseLoad(
            parseLoadOption(event.target.value),
            row.load,
          );
          if ("save" in choice) {
            setPending(null);
            onChange(choice.save);
          } else {
            setPending(choice.wait);
          }
        }}
      >
        <LoadOptions translate={translate} marks={marks} />
      </select>
      {field.kind === "pct" ? (
        <SavedTextField
          key="pct"
          className="training-routine-load-pct"
          inputMode="decimal"
          aria-label={translate("training.manage.pctFor", { exercise })}
          value={field.value}
          onCommit={commitValue}
          onUnchanged={() => setPending(null)}
        />
      ) : null}
      {field.kind === "text" ? (
        <SavedTextField
          key="text"
          className="training-routine-load-text"
          maxLength={LOAD_TEXT_MAX_LENGTH}
          aria-label={translate("training.manage.loadTextFor", { exercise })}
          value={field.value}
          onCommit={commitValue}
          onUnchanged={() => setPending(null)}
        />
      ) : null}
    </span>
  );
}
