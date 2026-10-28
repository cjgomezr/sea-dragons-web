"use client";

import { useId, useState } from "react";
import { formatNumber } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import { parseMarkInput } from "@/lib/training/routine-row-view";
import type { SaveMark } from "./use-member-marks";

/**
 * Lo que comparten los campos de marca, el de la fila abierta (#901) y los de
 * Mis marcas (#902): guardan al salir o con Enter, no a cada tecla. Lo que no
 * vale no se guarda: lo dice y el campo vuelve al último valor.
 */

export type MarkFieldError = Extract<
  MessageKey,
  "training.member.markInvalid" | "training.member.markSaveFailed"
>;

type MarkInputProps = {
  readonly type: "text";
  readonly inputMode: "decimal";
  readonly autoComplete: "off";
  readonly value: string;
  readonly "aria-invalid": boolean;
  readonly "aria-describedby": string | undefined;
  readonly onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  readonly onBlur: () => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
};

export type MarkDraft = {
  readonly inputProps: MarkInputProps;
  readonly error: MarkFieldError | null;
  /** El id del aviso, al que apunta `aria-describedby` cuando hay uno. */
  readonly errorId: string;
};

function textOf(translate: Translator, value: number | null): string {
  return value === null ? "" : formatNumber(translate.locale, value);
}

export function useMarkDraft({
  translate,
  markId,
  value,
  onSaveMark,
}: {
  readonly translate: Translator;
  readonly markId: string;
  /** El valor guardado; nulo si el socio no la tiene. */
  readonly value: number | null;
  readonly onSaveMark: SaveMark;
}): MarkDraft {
  const errorId = useId();
  const savedText = textOf(translate, value);
  const [draft, setDraft] = useState(savedText);
  const [error, setError] = useState<MarkFieldError | null>(null);
  // Enter guarda y luego el foco sale del campo: el segundo intento no repite
  // la petición.
  const [committedText, setCommittedText] = useState(savedText);
  // La marca guardada desde este campo o desde otro cambia el valor: el campo
  // lo sigue sin volver a montarse, para que el foco se quede en él.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setDraft(savedText);
    setCommittedText(savedText);
  }

  function showError(key: MarkFieldError): void {
    setError(key);
    setDraft(savedText);
    setCommittedText(savedText);
  }

  async function commit(): Promise<void> {
    if (draft === committedText) {
      return;
    }
    setCommittedText(draft);
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
    const outcome = await onSaveMark(markId, nextValue);
    if (outcome === "failed") {
      showError("training.member.markSaveFailed");
      return;
    }
    setError(null);
  }

  return {
    error,
    errorId,
    inputProps: {
      type: "text",
      inputMode: "decimal",
      autoComplete: "off",
      value: draft,
      "aria-invalid": error === "training.member.markInvalid",
      "aria-describedby": error === null ? undefined : errorId,
      onChange: (event) => setDraft(event.target.value),
      onBlur: () => void commit(),
      onKeyDown: (event) => {
        if (event.key === "Enter") {
          void commit();
        }
      },
    },
  };
}
