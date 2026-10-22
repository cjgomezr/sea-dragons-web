"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import {
  CATEGORY_NAME_MAX_LENGTH,
  type CategoryIssueCode,
  type EvaluationCategories,
  isCategoryNameTaken,
} from "@/lib/evaluations/evaluation-categories";
import type { Translator } from "@/lib/i18n/translator";
import {
  describeCategoriesFailure,
  describeCategoryIssue,
  readCategoryIssueCode,
} from "./evaluation-categories-client";

/**
 * El nombre de una categoría de evaluación en una fila de la tabla (#821,
 * RF-5 del PRD de E31): el mismo formulario para la fila de añadir y para
 * renombrar en la fila, como el de las posiciones (#723).
 *
 * El formulario no tiene caja propia (`display: contents`): su campo es una
 * celda de la fila, y los botones que van detrás los pone quien lo usa.
 *
 * El nombre repetido se avisa mientras se escribe, sin distinguir mayúsculas
 * ni tildes y contra las activas y las desactivadas; el servidor lo vuelve a
 * comprobar, y su respuesta va junto al campo igual. Un fallo que no es del
 * campo, como uno de red, se queda aquí con lo escrito: reintentar es volver
 * a mandarlo.
 */

/** Qué pasó con lo que se mandó. `done` vacía el formulario (al añadir) o lo
 * cierra (al renombrar). `null` es que había otra acción en vuelo. */
export type CategoryFormOutcome =
  { readonly kind: "done" } | ApiRequestFailure | null;

export function CategoryNameForm({
  translate,
  formLabel,
  fieldLabel,
  isLabelVisible = false,
  fieldClassName,
  placeholder,
  initialName,
  categories,
  renamingId,
  isDisabled,
  shouldFocusOnOpen = false,
  onSubmit,
  onCancel,
  children,
}: {
  translate: Translator;
  /** El nombre accesible del formulario. */
  formLabel: string;
  /** La etiqueta del campo. */
  fieldLabel: string;
  /** En la fila de la tabla no cabe y sólo se lee; en la hoja del móvil se
   * ve. */
  isLabelVisible?: boolean;
  /** La clase del campo, que cambia entre añadir y renombrar. */
  fieldClassName: string;
  placeholder?: string;
  initialName: string;
  /** Todas, desactivadas incluidas, para avisar del nombre repetido. */
  categories: EvaluationCategories;
  /** La que se renombra, que no cuenta como repetida consigo misma. */
  renamingId?: string;
  /** Hay una acción en vuelo, sea esta o cualquier otra de la pestaña. */
  isDisabled: boolean;
  /** Al abrir el de renombrar, el foco va al campo. */
  shouldFocusOnOpen?: boolean;
  onSubmit: (name: string) => Promise<CategoryFormOutcome>;
  /** Esc lo llama, si lo hay. */
  onCancel?: () => void;
  /** Las celdas que siguen al campo; saben si se puede mandar. */
  children: (canSubmit: boolean) => React.ReactNode;
}): React.JSX.Element {
  const idPrefix = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [serverIssue, setServerIssue] = useState<CategoryIssueCode | null>(
    null,
  );
  const [failure, setFailure] = useState<ApiRequestFailure | null>(null);

  useEffect(() => {
    if (shouldFocusOnOpen) {
      fieldRef.current?.focus();
    }
  }, [shouldFocusOnOpen]);

  const isTaken = isCategoryNameTaken(categories, name, renamingId);
  const issueCode: CategoryIssueCode | null = isTaken
    ? "name_taken"
    : serverIssue;
  const canSubmit = name.trim() !== "" && !isTaken;

  function update(nextName: string): void {
    setName(nextName);
    setServerIssue(null);
    setFailure(null);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    const outcome = await onSubmit(name.trim());
    if (outcome === null) {
      return;
    }
    if (outcome.kind === "done") {
      update(initialName);
      return;
    }
    const code = readCategoryIssueCode(outcome);
    setServerIssue(code);
    setFailure(code === null ? outcome : null);
  }

  function handleKey(event: React.KeyboardEvent): void {
    if (event.key === "Escape" && onCancel !== undefined) {
      event.preventDefault();
      onCancel();
    }
  }

  const fieldId = `${idPrefix}-nombre`;
  const issueId = `${fieldId}-aviso`;
  return (
    <form
      className="club-positions-form"
      aria-label={formLabel}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <div className="club-positions-cell club-positions-names-cell">
        <label
          className={
            isLabelVisible ? "club-positions-name-label" : "visually-hidden"
          }
          htmlFor={fieldId}
        >
          {fieldLabel}
        </label>
        <input
          ref={fieldRef}
          id={fieldId}
          className={`club-positions-input ${fieldClassName}`}
          type="text"
          value={name}
          placeholder={placeholder}
          maxLength={CATEGORY_NAME_MAX_LENGTH}
          autoComplete="off"
          disabled={isDisabled}
          aria-invalid={issueCode !== null}
          aria-describedby={issueCode === null ? undefined : issueId}
          onChange={(event) => update(event.target.value)}
          onKeyDown={handleKey}
        />
        {issueCode === null ? null : (
          <p className="auth-field-error" id={issueId}>
            {describeCategoryIssue(translate, issueCode)}
          </p>
        )}
        {failure === null ? null : (
          <p className="auth-error" role="alert">
            {describeCategoriesFailure(translate, failure)}
          </p>
        )}
      </div>
      {children(canSubmit)}
    </form>
  );
}
