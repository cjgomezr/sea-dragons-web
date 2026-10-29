"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Translator } from "@/lib/i18n/translator";
import type { ManagedMark } from "@/lib/training/club-marks";
import { MARK_NAME_MAX_LENGTH } from "@/lib/training/club-marks";
import { isMarkNameTaken } from "@/lib/training/mark-planner-view";
import {
  type MarkActionResult,
  MARK_NAME_TAKEN_REASON,
} from "./use-planner-marks";

/**
 * El nombre de una marca en Planificar → Marcas (#911): el mismo formulario
 * para la fila de añadir y para renombrar en la fila, como el de las
 * categorías de Evaluaciones (E31). Enter manda; Esc cancela, si se puede.
 *
 * El nombre repetido se dice mientras se escribe, sin mirar mayúsculas ni
 * tildes, y no se manda. El servidor lo vuelve a comprobar (otra persona
 * pudo crearla hace un instante), y su respuesta se dice igual.
 */

export function PlannerMarkNameForm({
  translate,
  className,
  fieldLabel,
  placeholder,
  initialName,
  marks,
  renaming,
  hintId,
  fieldRef: outerFieldRef,
  isBusy,
  onSubmit,
  onCancel,
  children,
}: {
  readonly translate: Translator;
  readonly className: string;
  readonly fieldLabel: string;
  readonly placeholder?: string;
  readonly initialName: string;
  readonly marks: readonly ManagedMark[];
  /** La que se renombra: no choca consigo misma, y el campo abre con el
   * foco. */
  readonly renaming?: ManagedMark;
  /** La pista que va debajo, si la hay. */
  readonly hintId?: string;
  /** Para quien quiera devolverle el foco desde fuera. */
  readonly fieldRef?: React.RefObject<HTMLInputElement | null>;
  readonly isBusy: boolean;
  /** `done` vacía el campo de añadir; renombrar lo cierra quien lo abrió. */
  readonly onSubmit: (name: string) => Promise<MarkActionResult>;
  readonly onCancel?: () => void;
  /** Los botones que van detrás del campo; saben si se puede mandar. */
  readonly children: (canSubmit: boolean) => React.ReactNode;
}): React.JSX.Element {
  const fieldId = useId();
  const issueId = `${fieldId}-aviso`;
  const ownFieldRef = useRef<HTMLInputElement>(null);
  const fieldRef = outerFieldRef ?? ownFieldRef;
  const [name, setName] = useState(initialName);
  const [takenByServer, setTakenByServer] = useState<string | null>(null);
  const isRenaming = renaming !== undefined;

  useEffect(() => {
    if (isRenaming) {
      fieldRef.current?.focus();
    }
  }, [isRenaming, fieldRef]);

  const trimmed = name.trim();
  const takenName = isMarkNameTaken(marks, trimmed, renaming?.id)
    ? trimmed
    : takenByServer;
  const canSubmit = trimmed !== "" && takenName === null;

  function update(nextName: string): void {
    setName(nextName);
    setTakenByServer(null);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit || isBusy) {
      return;
    }
    const result = await onSubmit(trimmed);
    if (result.kind === "done") {
      setName(isRenaming ? trimmed : "");
      return;
    }
    if (result.reason === MARK_NAME_TAKEN_REASON) {
      setTakenByServer(trimmed);
    }
  }

  function handleKey(event: React.KeyboardEvent): void {
    if (event.key === "Escape" && onCancel !== undefined) {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <form
      className={className}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <div className="training-marks-field">
        <label className="visually-hidden" htmlFor={fieldId}>
          {fieldLabel}
        </label>
        <input
          ref={fieldRef}
          id={fieldId}
          type="text"
          value={name}
          placeholder={placeholder}
          maxLength={MARK_NAME_MAX_LENGTH}
          autoComplete="off"
          aria-invalid={takenName !== null}
          aria-describedby={takenName === null ? hintId : issueId}
          onChange={(event) => update(event.target.value)}
          onKeyDown={handleKey}
        />
        {takenName === null ? null : (
          <p className="auth-field-error" id={issueId}>
            {translate("training.marks.errorNameTaken", { name: takenName })}
          </p>
        )}
      </div>
      {children(canSubmit)}
    </form>
  );
}
