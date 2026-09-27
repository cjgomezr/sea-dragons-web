"use client";

import { useEffect, useId, useRef, useState } from "react";
import { TextField } from "@/components/directory/record-fields";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import {
  CATEGORY_NAME_MAX_LENGTH,
  type CategoryIssueCode,
  findCategoryNameIssues,
} from "@/lib/evaluations/evaluation-categories";
import type { Translator } from "@/lib/i18n/translator";
import {
  describeCategoriesFailure,
  describeCategoryIssue,
  readCategoryIssueCode,
} from "./evaluation-categories-client";

/**
 * El nombre de una categoría de evaluación (#323): el mismo formulario para
 * añadirla y para renombrarla, como el de las posiciones (#300). Lo que se
 * sabe sin el servidor (vacío, demasiado largo) se avisa sin mandar nada; el
 * nombre repetido lo dice el servidor, y va junto al campo igual.
 *
 * Un fallo que no es del campo, como uno de red, se queda aquí con lo
 * escrito: reintentar es volver a pulsar el botón.
 */

/** Qué pasó con lo que se mandó. `done` vacía el formulario (al añadir) o lo
 * cierra (al renombrar). `null` es que había otra acción en vuelo. */
export type CategoryFormOutcome =
  { readonly kind: "done" } | ApiRequestFailure | null;

export function CategoryNameForm({
  translate,
  formLabel,
  submitText,
  savingText,
  initialName,
  isDisabled,
  isSaving,
  shouldFocusOnOpen = false,
  onSubmit,
  onCancel,
}: {
  translate: Translator;
  /** El nombre accesible del formulario. */
  formLabel: string;
  submitText: string;
  savingText: string;
  initialName: string;
  /** Hay una acción en vuelo, sea esta o cualquier otra de la pantalla. */
  isDisabled: boolean;
  /** La que está en vuelo es justo la de este formulario. */
  isSaving: boolean;
  /** Al abrir el de renombrar, el foco va al campo. */
  shouldFocusOnOpen?: boolean;
  onSubmit: (name: string) => Promise<CategoryFormOutcome>;
  onCancel?: () => void;
}): React.JSX.Element {
  const idPrefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(initialName);
  const [issueCode, setIssueCode] = useState<CategoryIssueCode | null>(null);
  const [failure, setFailure] = useState<ApiRequestFailure | null>(null);

  useEffect(() => {
    if (shouldFocusOnOpen) {
      formRef.current?.querySelector("input")?.focus();
    }
  }, [shouldFocusOnOpen]);

  function update(nextName: string): void {
    setName(nextName);
    setIssueCode(null);
    setFailure(null);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const [localIssue] = findCategoryNameIssues(name);
    if (localIssue !== undefined) {
      setIssueCode(localIssue.code);
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
    setIssueCode(code);
    setFailure(code === null ? outcome : null);
  }

  const hintId = `${idPrefix}-ayuda`;
  return (
    <form
      ref={formRef}
      className="club-positions-form"
      aria-label={formLabel}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <fieldset className="club-positions-fields" disabled={isDisabled}>
        <TextField
          id={`${idPrefix}-nombre`}
          label={translate("evaluations.categories.name.label")}
          type="text"
          value={name}
          issueText={
            issueCode === null
              ? null
              : describeCategoryIssue(translate, issueCode)
          }
          hintIds={[hintId]}
          onChange={update}
        />
      </fieldset>
      <p className="auth-hint" id={hintId}>
        {translate("evaluations.categories.name.hint", {
          max: CATEGORY_NAME_MAX_LENGTH,
        })}
      </p>
      {failure === null ? null : (
        <p className="auth-error" role="alert">
          {describeCategoriesFailure(translate, failure)}
        </p>
      )}
      <div className="groups-actions">
        <button type="submit" className="auth-submit" disabled={isDisabled}>
          {isSaving ? savingText : submitText}
        </button>
        {onCancel === undefined ? null : (
          <button
            type="button"
            className="admin-secondary"
            disabled={isDisabled}
            onClick={onCancel}
          >
            {translate("evaluations.categories.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
