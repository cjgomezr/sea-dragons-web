"use client";

import { useId, useRef, useState } from "react";
import { formatNumber } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import { parseMarkInput } from "@/lib/training/routine-row-view";
import type { TrainingMarkRef } from "@/lib/training/training-load";
import type { SaveMark } from "./use-member-marks";

/**
 * El campo de la marca dentro de una fila abierta (#901, §4.1 del handoff):
 * "Your {mark} best lift [___] kg". Guarda al salir o con Enter, no a cada
 * tecla, como Mis marcas (#902). Lo que no vale no se guarda: lo dice y el
 * campo vuelve al último valor.
 */

function textOf(translate: Translator, value: number | null): string {
  return value === null ? "" : formatNumber(translate.locale, value);
}

type FieldError = Extract<
  MessageKey,
  "training.member.markInvalid" | "training.member.markSaveFailed"
>;

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
  const errorId = useId();
  const savedText = textOf(translate, value);
  const [draft, setDraft] = useState(savedText);
  const [error, setError] = useState<FieldError | null>(null);
  // Enter guarda y luego el foco sale del campo: el segundo intento no repite
  // la petición.
  const committedText = useRef(savedText);

  async function commit(): Promise<void> {
    if (draft === committedText.current) {
      return;
    }
    committedText.current = draft;
    const input = parseMarkInput(draft);
    if (input.kind === "invalid") {
      showError("training.member.markInvalid");
      return;
    }
    const nextValue = input.kind === "value" ? input.value : null;
    if (nextValue === value) {
      setError(null);
      return;
    }
    const outcome = await onSaveMark(mark.id, nextValue);
    if (outcome === "failed") {
      showError("training.member.markSaveFailed");
      return;
    }
    setError(null);
  }

  function showError(key: FieldError): void {
    setError(key);
    setDraft(savedText);
    committedText.current = savedText;
  }

  return (
    <div className="training-mark-field">
      <label htmlFor={inputId}>
        {translate("training.member.markField", {
          mark: mark.name.toLocaleLowerCase(translate.locale),
        })}
      </label>
      <span className="training-mark-input">
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={draft}
          aria-invalid={error === "training.member.markInvalid"}
          aria-describedby={error === null ? undefined : errorId}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void commit();
            }
          }}
        />
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
