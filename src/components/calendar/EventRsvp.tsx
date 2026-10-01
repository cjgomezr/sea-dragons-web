import type { RsvpResponse } from "@/lib/events/event-rsvp";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Los botones Sí, Quizás y No de una fila (#311, RF-5, AC-015). Marcado queda
 * sólo lo que el servidor guardó: `aria-pressed` es lo que anuncia el lector
 * de pantalla, así que un botón no se marca mientras guarda ni tras un fallo.
 * Mientras guarda, los botones siguen enfocables y un toque más no hace nada:
 * `disabled` le quitaría el foco a quien acaba de pulsar con el teclado.
 *
 * Quien no tiene la membresía al día (#453) ve los botones deshabilitados, y
 * el grupo anuncia por qué con la frase que lleva a Pagos.
 */

const RSVP_CHOICES: readonly {
  readonly response: RsvpResponse;
  readonly label:
    "calendar.rsvp.yes" | "calendar.rsvp.maybe" | "calendar.rsvp.no";
}[] = [
  { response: "yes", label: "calendar.rsvp.yes" },
  { response: "maybe", label: "calendar.rsvp.maybe" },
  { response: "no", label: "calendar.rsvp.no" },
];

export function EventRsvp({
  translate,
  title,
  savedResponse,
  pendingResponse,
  onRespond,
  disabledReasonId = null,
}: {
  readonly translate: Translator;
  readonly title: string;
  readonly savedResponse: RsvpResponse | null;
  /** La que se está guardando: se ve distinta, pero no se anuncia elegida. */
  readonly pendingResponse: RsvpResponse | null;
  readonly onRespond: (response: RsvpResponse) => void;
  /** El id de la frase que dice por qué no se puede responder, o `null` si
   * se puede. */
  readonly disabledReasonId?: string | null;
}): React.JSX.Element {
  const isDisabled = disabledReasonId !== null;
  return (
    <div
      className="agenda-rsvp"
      role="group"
      aria-label={translate("calendar.rsvp.groupLabel", { title })}
      aria-busy={pendingResponse !== null}
      aria-describedby={disabledReasonId ?? undefined}
    >
      <span className="agenda-rsvp-label" aria-hidden="true">
        {translate("calendar.rsvp.label")}
      </span>
      {RSVP_CHOICES.map(({ response, label }) => (
        <button
          key={response}
          type="button"
          className={
            pendingResponse === response
              ? "agenda-rsvp-choice is-pending"
              : "agenda-rsvp-choice"
          }
          aria-pressed={savedResponse === response}
          disabled={isDisabled}
          onClick={() => onRespond(response)}
        >
          {translate(label)}
        </button>
      ))}
    </div>
  );
}
