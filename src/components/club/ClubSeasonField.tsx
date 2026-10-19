"use client";

import type { Translator } from "@/lib/i18n/translator";

/**
 * TEMPORADA en la pestaña General (#744, RF-1 y D1 del PRD de E27): el día
 * en que empieza la temporada, que viaja con el borrador como el nombre.
 * Vacío, la asistencia del inicio cuenta desde el 1 de enero.
 */

const SEASON_HEADING_ID = "club-temporada";
const SEASON_START_ID = "club-inicio-temporada";
const SEASON_START_HINT_ID = "club-inicio-temporada-ayuda";
const SEASON_START_ISSUE_ID = "club-inicio-temporada-aviso";

export function ClubSeasonField({
  translate,
  value,
  issueText,
  onChange,
}: {
  translate: Translator;
  /** YYYY-MM-DD, o la cadena vacía sin fecha. */
  value: string;
  issueText: string | null;
  onChange: (seasonStartsOn: string) => void;
}): React.JSX.Element {
  return (
    <section className="auth-fields" aria-labelledby={SEASON_HEADING_ID}>
      <h2 id={SEASON_HEADING_ID} className="club-general-heading">
        {translate("clubSettings.season.title")}
      </h2>
      <div className="auth-field">
        <label htmlFor={SEASON_START_ID}>
          {translate("clubSettings.season.label")}
        </label>
        <input
          id={SEASON_START_ID}
          type="date"
          value={value}
          aria-invalid={issueText !== null}
          aria-describedby={
            issueText === null
              ? SEASON_START_HINT_ID
              : `${SEASON_START_ISSUE_ID} ${SEASON_START_HINT_ID}`
          }
          onChange={(event) => onChange(event.target.value)}
        />
        {issueText === null ? null : (
          <p className="auth-field-error" id={SEASON_START_ISSUE_ID}>
            {issueText}
          </p>
        )}
        <p className="auth-hint" id={SEASON_START_HINT_ID}>
          {translate("clubSettings.season.hint")}
        </p>
      </div>
    </section>
  );
}
