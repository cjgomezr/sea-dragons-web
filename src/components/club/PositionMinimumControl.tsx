"use client";

import { useRef, useState } from "react";
import { POSITION_MIN_PER_TEAM_MAX } from "@/lib/club/manage-club-positions";
import type { Translator } from "@/lib/i18n/translator";

/**
 * El mínimo por equipo de una posición en la tabla (#887, RF-4 del PRD de
 * E34): cuántos de ella intenta poner el auto-balance en cada equipo, de 0
 * a 20. Sustituye al selector del rol (#404).
 *
 * Se guarda sin botón aparte, como lo demás de la tabla. Lo escrito a mano
 * se guarda con Enter o al salir del campo: guardar a cada tecla mandaría el
 * 1 de un 12. Las flechas suben o bajan uno y guardan al momento. Lo que no
 * es un número de 0 a 20 no se manda y el campo vuelve al último guardado.
 *
 * Mientras se guarda, el campo enseña lo que se mandó. Al terminar enseña
 * lo que dijo el servidor: lo nuevo si salió bien y lo de antes si falló.
 */

const MINIMUM_PATTERN = /^\d{1,2}$/;

const STEP_OF_KEY: Readonly<Record<string, number>> = {
  ArrowUp: 1,
  ArrowDown: -1,
};

export function minimumFocusKey(positionId: string): string {
  return `${positionId}:minimum`;
}

function isValidMinimum(value: number): boolean {
  return value >= 0 && value <= POSITION_MIN_PER_TEAM_MAX;
}

/** Lo escrito, si es un mínimo que vale. */
function readMinimum(text: string): number | null {
  const trimmed = text.trim();
  if (!MINIMUM_PATTERN.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return isValidMinimum(value) ? value : null;
}

export function PositionMinimumControl({
  translate,
  positionId,
  name,
  minPerTeam,
  isBusy,
  onSave,
}: {
  translate: Translator;
  positionId: string;
  /** El nombre de la posición en el idioma de la pantalla. */
  name: string;
  /** El que tiene guardado. */
  minPerTeam: number;
  isBusy: boolean;
  /** `shouldKeepFocus` es que se guardó sin salir del campo. */
  onSave: (minPerTeam: number, shouldKeepFocus: boolean) => Promise<void>;
}): React.JSX.Element {
  /** Lo escrito y aún no guardado; `null` enseña el guardado. */
  const [draft, setDraft] = useState<string | null>(null);
  /** Al desactivarse durante el guardado, el campo puede perder el foco: ese
   * `blur` no es salir del campo y no vuelve a mandar nada. */
  const isSaving = useRef(false);

  async function commit(
    minimum: number | null,
    shouldKeepFocus: boolean,
  ): Promise<void> {
    if (isSaving.current) {
      return;
    }
    if (minimum === null || minimum === minPerTeam) {
      setDraft(null);
      return;
    }
    isSaving.current = true;
    setDraft(String(minimum));
    try {
      await onSave(minimum, shouldKeepFocus);
    } finally {
      isSaving.current = false;
      setDraft(null);
    }
  }

  function handleKey(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      // Sin esto, Enter enviaría también el formulario de renombrar.
      event.preventDefault();
      void commit(readMinimum(event.currentTarget.value), true);
      return;
    }
    const step = STEP_OF_KEY[event.key];
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    const next = (readMinimum(event.currentTarget.value) ?? minPerTeam) + step;
    if (isValidMinimum(next)) {
      void commit(next, true);
    }
  }

  return (
    <div className="club-positions-cell club-positions-minimum">
      <input
        className="club-positions-input club-positions-minimum-input"
        type="number"
        inputMode="numeric"
        min={0}
        max={POSITION_MIN_PER_TEAM_MAX}
        step={1}
        data-focus-key={minimumFocusKey(positionId)}
        aria-label={translate("clubSettings.positions.minimum.control.label", {
          name,
        })}
        value={draft ?? String(minPerTeam)}
        disabled={isBusy}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKey}
        onBlur={(event) => void commit(readMinimum(event.target.value), false)}
      />
    </div>
  );
}
