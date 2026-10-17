import type { RsvpResponse } from "@/lib/events/event-rsvp";
import type { Translator } from "@/lib/i18n/translator";

const ANSWER_LABELS = {
  yes: "calendar.answer.yes",
  maybe: "calendar.answer.maybe",
  no: "calendar.answer.no",
} as const satisfies Record<RsvpResponse, string>;

/** Mi respuesta en su píldora o, si todavía puedo responder, la llamada al
 * RSVP. */
export function MyAnswer({
  translate,
  myResponse,
  canRespond,
}: {
  readonly translate: Translator;
  readonly myResponse: RsvpResponse | null;
  readonly canRespond: boolean;
}): React.JSX.Element | null {
  if (myResponse !== null) {
    return (
      <p className="agenda-answer">
        <span className="visually-hidden">
          {translate("calendar.answer.label")}
        </span>{" "}
        <span className={`agenda-answer-pill agenda-answer-${myResponse}`}>
          {translate(ANSWER_LABELS[myResponse])}
        </span>
      </p>
    );
  }
  if (!canRespond) {
    return null;
  }
  return (
    <p className="agenda-answer">
      <span className="agenda-answer-missing" aria-hidden="true">
        {translate("calendar.answer.missing")}
      </span>
      <span className="visually-hidden">
        {translate("calendar.answer.missingHint")}
      </span>
    </p>
  );
}
