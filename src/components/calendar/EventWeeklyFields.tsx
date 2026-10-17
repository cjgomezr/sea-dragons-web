import { Repeat } from "@phosphor-icons/react/dist/ssr/Repeat";
import { useId } from "react";
import type { Translator } from "@/lib/i18n/translator";
import { type FieldProps, InputField, WeekdaysField } from "./EventFormFields";
import type { WeeklyPreview } from "./weekly-preview";

/**
 * El panel de Semanal al crear una serie (#651, punto 5 del "#1c" del
 * handoff de E24): los días, hasta cuándo y, si salen sesiones, cuántas son
 * y cuáles las primeras, antes de guardar.
 */

const SUMMARY_ICON_SIZE = 16;

/** Por qué no sale ninguna sesión, si se sabe ya en el navegador. */
function describePreviewIssue(
  translate: Translator,
  preview: WeeklyPreview,
): string | null {
  switch (preview.kind) {
    case "noDays":
      return translate("calendar.form.weekly.noDays");
    case "noSessions":
      return translate("calendar.form.weekly.noSessions");
    default:
      return null;
  }
}

function WeeklySummary({
  translate,
  preview,
}: {
  readonly translate: Translator;
  readonly preview: Extract<WeeklyPreview, { kind: "sessions" }>;
}): React.JSX.Element {
  const nextId = useId();
  return (
    <div className="event-form-weekly-summary">
      <p className="event-form-weekly-total">
        <Repeat aria-hidden="true" size={SUMMARY_ICON_SIZE} />
        <span>{preview.summary}</span>
      </p>
      <div className="event-form-weekly-next">
        <span id={nextId}>{translate("calendar.form.weekly.next")}</span>
        <ul aria-labelledby={nextId}>
          {preview.nextDates.map((date) => (
            <li key={date}>{date}</li>
          ))}
        </ul>
        {preview.moreCount > 0 ? (
          <span>
            {translate("calendar.form.weekly.more", {
              count: preview.moreCount,
            })}
          </span>
        ) : null}
      </div>
      <p className="event-form-weekly-hint">
        {translate("calendar.form.weekly.hint")}
      </p>
    </div>
  );
}

/** El aviso del servidor manda; si no hay, el que ya se ve en el
 * navegador. */
export function WeeklyFields(
  props: FieldProps & { readonly preview: WeeklyPreview },
): React.JSX.Element {
  const { translate, preview, issueTextFor } = props;
  return (
    <div className="event-form-weekly">
      <WeekdaysField
        {...props}
        issueText={
          issueTextFor("weekdays") ?? describePreviewIssue(translate, preview)
        }
      />
      <InputField
        {...props}
        field="endsOn"
        type="date"
        label={translate("calendar.form.endsOn")}
      />
      <div className="event-form-weekly-region" aria-live="polite">
        {preview.kind === "sessions" ? (
          <WeeklySummary translate={translate} preview={preview} />
        ) : null}
      </div>
    </div>
  );
}
