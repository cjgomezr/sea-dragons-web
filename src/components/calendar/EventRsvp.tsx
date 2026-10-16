import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { Question } from "@phosphor-icons/react/dist/ssr/Question";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
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
 *
 * En el panel del evento (#648) son Voy, Quizás y No puedo, y el elegido
 * toma el color de su respuesta.
 */

type RsvpChoice = {
  readonly response: RsvpResponse;
  readonly label:
    `calendar.rsvp.${RsvpResponse}` | `calendar.answer.${RsvpResponse}`;
  readonly Glyph: PhosphorGlyph | null;
};

/** La fila del inicio dice Sí, Quizás y No; el panel del evento (#648), Voy,
 * Quizás y No puedo con su icono, como la píldora de la agenda. */
const RSVP_CHOICES: Readonly<Record<EventRsvpVariant, readonly RsvpChoice[]>> =
  {
    row: [
      { response: "yes", label: "calendar.rsvp.yes", Glyph: null },
      { response: "maybe", label: "calendar.rsvp.maybe", Glyph: null },
      { response: "no", label: "calendar.rsvp.no", Glyph: null },
    ],
    panel: [
      { response: "yes", label: "calendar.answer.yes", Glyph: Check },
      { response: "maybe", label: "calendar.answer.maybe", Glyph: Question },
      { response: "no", label: "calendar.answer.no", Glyph: X },
    ],
  };

const RSVP_HEADINGS = {
  row: "calendar.rsvp.label",
  panel: "calendar.panel.rsvpHeading",
} as const satisfies Record<EventRsvpVariant, string>;

export type EventRsvpVariant = "row" | "panel";

function choiceClassName(
  variant: EventRsvpVariant,
  response: RsvpResponse,
  isPending: boolean,
): string {
  const classes =
    variant === "panel"
      ? ["agenda-rsvp-choice", `agenda-rsvp-choice-${response}`]
      : ["agenda-rsvp-choice"];
  return (isPending ? [...classes, "is-pending"] : classes).join(" ");
}

export function EventRsvp({
  translate,
  title,
  savedResponse,
  pendingResponse,
  onRespond,
  disabledReasonId = null,
  variant = "row",
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
  readonly variant?: EventRsvpVariant;
}): React.JSX.Element {
  const isDisabled = disabledReasonId !== null;
  return (
    <div
      className={`agenda-rsvp agenda-rsvp-${variant}`}
      role="group"
      aria-label={translate("calendar.rsvp.groupLabel", { title })}
      aria-busy={pendingResponse !== null}
      aria-describedby={disabledReasonId ?? undefined}
    >
      <span className="agenda-rsvp-label" aria-hidden="true">
        {translate(RSVP_HEADINGS[variant])}
      </span>
      {RSVP_CHOICES[variant].map(({ response, label, Glyph }) => (
        <button
          key={response}
          type="button"
          className={choiceClassName(
            variant,
            response,
            pendingResponse === response,
          )}
          aria-pressed={savedResponse === response}
          disabled={isDisabled}
          onClick={() => onRespond(response)}
        >
          {Glyph === null ? null : (
            <Glyph aria-hidden="true" focusable="false" size={16} />
          )}
          {translate(label)}
        </button>
      ))}
    </div>
  );
}
