"use client";

import type { Translator } from "@/lib/i18n/translator";

/**
 * La barra propia del formulario de publicar y editar en el móvil (#602,
 * "#2e" del handoff de E22): Cancelar, el nombre de la pantalla y el botón
 * principal, que manda el formulario que la contiene. Va debajo de la
 * cabecera de la app, que se queda (D10), y se pega arriba al hacer scroll.
 */

const BAR_HEADING_ID = "publicar-barra-titulo";

export type NewsPublishBarSubmit = {
  readonly label: string;
  readonly isDisabled: boolean;
  readonly describedBy: string | undefined;
};

export function NewsPublishBar({
  translate,
  heading,
  submit,
  onCancel,
}: {
  readonly translate: Translator;
  readonly heading: string;
  readonly submit: NewsPublishBarSubmit;
  readonly onCancel: () => void;
}): React.JSX.Element {
  return (
    <div
      className="news-publish-bar"
      role="group"
      aria-labelledby={BAR_HEADING_ID}
    >
      <button
        type="button"
        className="news-publish-bar-cancel"
        onClick={onCancel}
      >
        {translate("news.publish.bar.cancel")}
      </button>
      <h1 className="news-publish-bar-title" id={BAR_HEADING_ID}>
        {heading}
      </h1>
      <button
        type="submit"
        className="news-publish-bar-submit"
        disabled={submit.isDisabled}
        aria-describedby={submit.describedBy}
      >
        {submit.label}
      </button>
    </div>
  );
}
