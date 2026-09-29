"use client";

import { useId, useState } from "react";
import {
  isPositionCoverage,
  POSITION_COVERAGES,
  type PositionCoverage,
} from "@/lib/club/club-positions";
import type { Translator } from "@/lib/i18n/translator";

/**
 * La función de una posición en el auto-balance (#404, RF-2 del PRD de E10):
 * portero, defensa, ataque o ninguna. Como el rol en el directorio, lo que se
 * elige es un borrador hasta que se guarda con su botón.
 *
 * El borrador vive aquí: la sección monta el control otra vez cuando la
 * función guardada cambia, así que empieza siempre por lo que dijo el
 * servidor. Si el guardado falla, la función elegida se queda puesta para
 * reintentarlo.
 */

/** El valor de "Sin función": un `<select>` sólo habla en textos. */
const NO_COVERAGE = "";

export function coverageFocusKey(positionId: string): string {
  return `${positionId}:coverage`;
}

function readCoverage(value: string): PositionCoverage | null {
  return isPositionCoverage(value) ? value : null;
}

export function describeCoverage(
  translate: Translator,
  coverage: PositionCoverage | null,
): string {
  return translate(`clubSettings.positions.coverage.${coverage ?? "none"}`);
}

export function PositionCoverageControl({
  translate,
  positionId,
  name,
  coverage,
  isBusy,
  isSaving,
  onSave,
}: {
  translate: Translator;
  positionId: string;
  /** El nombre de la posición en el idioma de la pantalla. */
  name: string;
  /** La que tiene guardada. */
  coverage: PositionCoverage | null;
  isBusy: boolean;
  isSaving: boolean;
  onSave: (coverage: PositionCoverage | null) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(coverage);
  const selectId = useId();
  return (
    <div className="club-positions-coverage">
      <label htmlFor={selectId}>
        {translate("clubSettings.positions.coverage.label")}
      </label>
      <select
        id={selectId}
        className="admin-member-role"
        data-focus-key={coverageFocusKey(positionId)}
        aria-label={translate("clubSettings.positions.coverage.control.label", {
          name,
        })}
        value={draft ?? NO_COVERAGE}
        disabled={isBusy}
        onChange={(event) => setDraft(readCoverage(event.target.value))}
      >
        <option value={NO_COVERAGE}>{describeCoverage(translate, null)}</option>
        {POSITION_COVERAGES.map((option) => (
          <option key={option} value={option}>
            {describeCoverage(translate, option)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="admin-secondary"
        aria-label={translate("clubSettings.positions.coverage.save.label", {
          name,
        })}
        disabled={isBusy || draft === coverage}
        onClick={() => onSave(draft)}
      >
        {translate(
          isSaving
            ? "clubSettings.positions.coverage.saving"
            : "clubSettings.positions.coverage.save",
        )}
      </button>
    </div>
  );
}
