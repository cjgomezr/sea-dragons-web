"use client";

import { useState } from "react";
import {
  isPositionCoverage,
  POSITION_COVERAGES,
  type PositionCoverage,
} from "@/lib/club/club-positions";
import type { Translator } from "@/lib/i18n/translator";

/**
 * La función de una posición en el auto-balance (#404, RF-2 del PRD de E10):
 * portero, defensa, ataque o ninguna. Desde #723 se guarda al cambiarla, sin
 * botón aparte.
 *
 * Lo elegido vive aquí: la sección monta el control otra vez cuando la
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
  onSave,
}: {
  translate: Translator;
  positionId: string;
  /** El nombre de la posición en el idioma de la pantalla. */
  name: string;
  /** La que tiene guardada. */
  coverage: PositionCoverage | null;
  isBusy: boolean;
  onSave: (coverage: PositionCoverage | null) => void;
}): React.JSX.Element {
  const [chosen, setChosen] = useState(coverage);

  function choose(value: string): void {
    const next = readCoverage(value);
    setChosen(next);
    onSave(next);
  }

  return (
    <div className="club-positions-cell club-positions-coverage">
      <select
        className="club-positions-select"
        data-focus-key={coverageFocusKey(positionId)}
        aria-label={translate("clubSettings.positions.coverage.control.label", {
          name,
        })}
        value={chosen ?? NO_COVERAGE}
        disabled={isBusy}
        onChange={(event) => choose(event.target.value)}
      >
        <option value={NO_COVERAGE}>{describeCoverage(translate, null)}</option>
        {POSITION_COVERAGES.map((option) => (
          <option key={option} value={option}>
            {describeCoverage(translate, option)}
          </option>
        ))}
      </select>
    </div>
  );
}
