"use client";

import { useEffect, useId, useRef } from "react";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Una confirmación debajo de lo que la pidió, en Planificar: su frase,
 * Cancel con el foco al abrirse, y el botón que confirma. Escape cancela.
 * La usan las acciones de un ciclo (#906, #935, #952) y su campo For (#980).
 */

export function PlannerInlineConfirm({
  translate,
  text,
  classNames,
  confirmLabel,
  isBusy,
  onCancel,
  onConfirm,
}: {
  readonly translate: Translator;
  readonly text: string;
  /** La de la caja y la del botón que confirma. */
  readonly classNames: { readonly box: string; readonly confirm: string };
  readonly confirmLabel: string;
  readonly isBusy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): React.JSX.Element {
  const textId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className={`training-plan-confirm ${classNames.box}`}
      role="group"
      aria-labelledby={textId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onCancel();
        }
      }}
    >
      <p id={textId}>{text}</p>
      <div className="training-plan-confirm-actions">
        <button
          ref={cancelRef}
          type="button"
          className="training-plan-action"
          onClick={onCancel}
        >
          {translate("training.manage.cancel")}
        </button>
        <button
          type="button"
          className={classNames.confirm}
          disabled={isBusy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
