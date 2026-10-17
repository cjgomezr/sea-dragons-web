"use client";

import type { Translator } from "@/lib/i18n/translator";

/**
 * La barra del formulario de evento en el móvil (#657, "#2c" del handoff de
 * E24): Cancelar, el nombre de la pantalla y el botón principal, que manda el
 * formulario que la contiene. Se pega arriba al hacer scroll, como la de
 * noticias (#602). Su título nombra también el diálogo.
 */

export type EventFormBarSubmit = {
  readonly label: string;
  readonly isDisabled: boolean;
};

export function EventFormBar({
  translate,
  heading,
  submit,
  isCancelDisabled,
  onCancel,
}: {
  readonly translate: Translator;
  readonly heading: { readonly id: string; readonly text: string };
  readonly submit: EventFormBarSubmit;
  /** Mientras guarda no se cancela, como en el pie del escritorio. */
  readonly isCancelDisabled: boolean;
  readonly onCancel: () => void;
}): React.JSX.Element {
  return (
    <div className="event-form-bar" role="group" aria-labelledby={heading.id}>
      <button
        type="button"
        className="event-form-bar-cancel"
        onClick={onCancel}
        disabled={isCancelDisabled}
      >
        {translate("calendar.form.cancel")}
      </button>
      <h2 className="event-form-bar-title" id={heading.id}>
        {heading.text}
      </h2>
      <button
        type="submit"
        className="auth-submit event-form-bar-submit"
        disabled={submit.isDisabled}
      >
        {submit.label}
      </button>
    </div>
  );
}
