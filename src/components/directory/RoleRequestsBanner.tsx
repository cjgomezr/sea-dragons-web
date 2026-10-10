"use client";

import type { Translator } from "@/lib/i18n/translator";

/**
 * El aviso del móvil (#553, RF-7 del PRD de E21): "{n} solicitudes de rol
 * esperando · Revisar", encima de la lista, que abre la pantalla de
 * solicitudes. Sólo lo monta la pantalla para un Admin con alguna
 * pendiente; desde 768px lo esconde la hoja de estilos, porque allí la
 * cabecera lleva su píldora y la bandeja va debajo de la lista.
 */
export function RoleRequestsBanner({
  translate,
  count,
  ref,
  onReview,
}: {
  translate: Translator;
  count: number;
  /** Al volver de la pantalla de solicitudes, el foco vuelve aquí. */
  ref: React.Ref<HTMLButtonElement>;
  onReview: () => void;
}): React.JSX.Element {
  const waiting = translate("directory.requests.waiting", { count });
  const review = translate("directory.requests.review");
  // El nombre se escribe entero: lo que se ve son dos textos separados por
  // el espacio de la fila, y un lector de pantalla los juntaría sin pausa.
  return (
    <button
      ref={ref}
      type="button"
      className="directory-requests-banner"
      aria-label={`${waiting} · ${review}`}
      onClick={onReview}
    >
      <span className="directory-requests-banner-dot" aria-hidden="true" />
      <span className="directory-requests-banner-text">{waiting}</span>
      <span className="directory-requests-banner-review">{review}</span>
    </button>
  );
}
