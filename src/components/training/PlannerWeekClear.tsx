"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Clear week (#943): deja la semana en descanso y sin nota ni dosis, sin
 * mover las demás. Abre debajo una confirmación en color de peligro, como la
 * de borrar una marca; Cancel o Escape la cierran y devuelven el foco.
 */

export type WeekClearProps = {
  readonly translate: Translator;
  readonly weekNo: number;
  /** Los días de la semana con alguna rutina. */
  readonly routineDays: number;
  /** Verdadero si se vació. */
  readonly onClear: () => Promise<boolean>;
};

function confirmText(
  translate: Translator,
  weekNo: number,
  routineDays: number,
): string {
  return routineDays === 0
    ? translate("training.manage.confirmClearEmptyWeek", { week: weekNo })
    : translate("training.manage.confirmClearWeek", {
        week: weekNo,
        count: routineDays,
      });
}

function ClearConfirm({
  translate,
  text,
  isBusy,
  onCancel,
  onConfirm,
}: {
  readonly translate: Translator;
  readonly text: string;
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
      className="training-plan-confirm training-grid-week-clear-confirm"
      role="group"
      aria-labelledby={textId}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !isBusy) {
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
          disabled={isBusy}
          onClick={onCancel}
        >
          {translate("training.manage.cancel")}
        </button>
        <button
          type="button"
          className="training-plan-danger"
          disabled={isBusy}
          onClick={onConfirm}
        >
          {translate("training.manage.clearWeek")}
        </button>
      </div>
    </div>
  );
}

export function PlannerWeekClear({
  translate,
  weekNo,
  routineDays,
  onClear,
}: WeekClearProps): React.JSX.Element {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const clearRef = useRef<HTMLButtonElement>(null);

  function closeConfirm(): void {
    setIsConfirming(false);
    clearRef.current?.focus();
  }

  async function confirmClear(): Promise<void> {
    setIsBusy(true);
    const isCleared = await onClear();
    setIsBusy(false);
    // Si se vació, este botón ya no se pinta y no hay a dónde volver.
    if (!isCleared) {
      closeConfirm();
    }
  }

  return (
    <div className="training-grid-week-clear">
      <button
        ref={clearRef}
        type="button"
        className="training-plan-action"
        aria-expanded={isConfirming}
        onClick={() => setIsConfirming(true)}
      >
        {translate("training.manage.clearWeek")}
      </button>
      {isConfirming ? (
        <ClearConfirm
          translate={translate}
          text={confirmText(translate, weekNo, routineDays)}
          isBusy={isBusy}
          onCancel={closeConfirm}
          onConfirm={() => void confirmClear()}
        />
      ) : null}
    </div>
  );
}
