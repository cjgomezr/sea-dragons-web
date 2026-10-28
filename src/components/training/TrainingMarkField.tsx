"use client";

import { useId } from "react";
import type { Translator } from "@/lib/i18n/translator";
import type { TrainingMarkRef } from "@/lib/training/training-load";
import { useMarkDraft } from "./use-mark-draft";
import type { SaveMark } from "./use-member-marks";

/**
 * El campo de la marca dentro de una fila abierta (#901, §4.1 del handoff):
 * "Your {mark} best lift [___] kg". Guarda como los de Mis marcas (#902).
 */

export function TrainingMarkField({
  translate,
  mark,
  value,
  onSaveMark,
}: {
  readonly translate: Translator;
  readonly mark: TrainingMarkRef;
  /** El valor guardado; nulo si el socio no la tiene. */
  readonly value: number | null;
  readonly onSaveMark: SaveMark;
}): React.JSX.Element {
  const inputId = useId();
  const { inputProps, error, errorId } = useMarkDraft({
    translate,
    markId: mark.id,
    value,
    onSaveMark,
  });

  return (
    <div className="training-mark-field">
      <label htmlFor={inputId}>
        {translate("training.member.markField", {
          mark: mark.name.toLocaleLowerCase(translate.locale),
        })}
      </label>
      <span className="training-mark-input">
        <input id={inputId} {...inputProps} />
        <span>{translate("training.member.markUnit")}</span>
      </span>
      {error === null ? null : (
        <p id={errorId} className="training-mark-error" role="alert">
          {translate(error)}
        </p>
      )}
    </div>
  );
}
