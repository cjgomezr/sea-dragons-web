"use client";

import { useId } from "react";
import {
  isHexColor,
  normalizeAccentInput,
  SUGGESTED_ACCENT_COLORS,
} from "@/lib/club/accent-color";
import type { Translator } from "@/lib/i18n/translator";

/**
 * El color de acento en la configuración del club (#346, rehecho en #720
 * con el handoff de E26). Se elige de un toque entre cinco sugeridos, con el
 * selector del navegador o escribiendo el código, que es lo que hará quien lo
 * copie de una guía de marca. La vista previa de al lado sigue a lo elegido
 * antes de guardar. A diferencia del logo, el color viaja con el borrador.
 */

export const ACCENT_FIELD_ID = "club-acento";
const ACCENT_ISSUE_ID = "club-acento-aviso";

/** El selector del navegador sólo admite `#rrggbb` en minúsculas: lo
 * escrito si ya es un color, y si no, el guardado. */
function pickerColorOf(typed: string, savedColor: string): string {
  const code = normalizeAccentInput(typed);
  return isHexColor(code) ? code : savedColor.toLowerCase();
}

/** Radios nativos: las flechas del teclado pasan de uno a otro y lo eligen.
 * El color no es la única pista: cada uno se nombra con su código. */
function SuggestedColours({
  translate,
  typedCode,
  isDisabled,
  onChoose,
}: {
  translate: Translator;
  typedCode: string;
  isDisabled: boolean;
  onChoose: (color: string) => void;
}): React.JSX.Element {
  const groupName = useId();
  return (
    <div
      role="radiogroup"
      aria-label={translate("clubSettings.accent.suggested")}
      className="club-accent-suggested"
    >
      {SUGGESTED_ACCENT_COLORS.map((color) => (
        <label key={color} className="club-accent-swatch">
          <input
            type="radio"
            name={groupName}
            value={color}
            checked={typedCode === color.toLowerCase()}
            disabled={isDisabled}
            onChange={() => onChoose(color)}
          />
          <span
            className="club-accent-swatch-color"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <span className="visually-hidden">{color}</span>
        </label>
      ))}
    </div>
  );
}

export function ClubAccentField({
  translate,
  typedColor,
  savedColor,
  issueText,
  isDisabled,
  onChange,
}: {
  translate: Translator;
  /** Lo que hay en el campo, tal cual se escribió. */
  typedColor: string;
  savedColor: string;
  issueText: string | null;
  isDisabled: boolean;
  onChange: (typedColor: string) => void;
}): React.JSX.Element {
  const pickerColor = pickerColorOf(typedColor, savedColor);
  return (
    <div className="auth-field club-accent-field">
      <label htmlFor={ACCENT_FIELD_ID}>
        {translate("clubSettings.accent.label")}
      </label>
      <div className="club-accent-controls">
        <SuggestedColours
          translate={translate}
          typedCode={normalizeAccentInput(typedColor)}
          isDisabled={isDisabled}
          onChoose={onChange}
        />
        <span className="club-accent-divider" aria-hidden="true" />
        <input
          id={ACCENT_FIELD_ID}
          type="text"
          className="club-accent-code"
          value={typedColor}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={issueText !== null}
          aria-describedby={issueText === null ? undefined : ACCENT_ISSUE_ID}
          disabled={isDisabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          type="color"
          className="club-accent-picker"
          value={pickerColor}
          aria-label={translate("clubSettings.accent.picker", {
            color: pickerColor.toUpperCase(),
          })}
          disabled={isDisabled}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
      </div>
      {issueText === null ? null : (
        <p className="auth-field-error" id={ACCENT_ISSUE_ID} role="alert">
          {issueText}
        </p>
      )}
    </div>
  );
}
