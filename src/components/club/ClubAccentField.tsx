"use client";

import {
  evaluateAccentColor,
  isHexColor,
  normalizeAccentInput,
} from "@/lib/club/accent-color";
import type { Translator } from "@/lib/i18n/translator";

/**
 * El color de acento en la configuración del club (#346, RF-3 del PRD de
 * E18a). Se elige con el selector del navegador o escribiendo el código, que
 * es lo que hará quien lo copie de una guía de marca. La muestra sigue a lo
 * elegido antes de guardar, con el mismo cálculo que hace el servidor
 * (`evaluateAccentColor`), para que la vista previa no mienta. A diferencia
 * del logo, el color viaja con el botón del formulario.
 */

export const ACCENT_FIELD_ID = "club-acento";
const ACCENT_HINT_ID = "club-acento-ayuda";
const ACCENT_ISSUE_ID = "club-acento-aviso";

type LinkColorProperties = React.CSSProperties &
  Readonly<Record<`--club-accent-link-${"light" | "dark"}`, string>>;

/** Lo que enseña la muestra: lo escrito si ya es un color, y si no, el
 * guardado. El selector del navegador sólo admite `#rrggbb` en minúsculas. */
function previewColorOf(typed: string, savedColor: string): string {
  const code = normalizeAccentInput(typed);
  return isHexColor(code) ? code : savedColor.toLowerCase();
}

function AccentPreview({
  translate,
  color,
}: {
  translate: Translator;
  color: string;
}): React.JSX.Element {
  const evaluation = evaluateAccentColor(color);
  // Un color sobre el que nada se lee no lleva texto de ejemplo: el aviso de
  // al lado, al guardar, explica por qué.
  if (evaluation.kind === "rejected") {
    return (
      <div className="club-accent-preview" aria-hidden="true">
        <span
          className="club-accent-preview-swatch"
          style={{ backgroundColor: color }}
        />
      </div>
    );
  }
  const { light, dark } = evaluation.palette;
  // Un solo enlace no se lee sobre los dos temas: la hoja elige la variante.
  const linkColors: LinkColorProperties = {
    "--club-accent-link-light": light.accentText,
    "--club-accent-link-dark": dark.accentText,
  };
  // El valor ya está en el campo; la muestra es sólo para la vista.
  return (
    <div className="club-accent-preview" aria-hidden="true">
      <span
        className="club-accent-preview-swatch"
        style={{ backgroundColor: light.accent, color: light.onAccent }}
      >
        {translate("clubSettings.accent.previewText")}
      </span>
      <span className="club-accent-preview-link" style={linkColors}>
        {translate("clubSettings.accent.previewLink")}
      </span>
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
  const previewColor = previewColorOf(typedColor, savedColor);
  const describedBy = [
    ...(issueText === null ? [] : [ACCENT_ISSUE_ID]),
    ACCENT_HINT_ID,
  ].join(" ");
  return (
    <div className="auth-field club-accent-field">
      <div className="club-accent-controls">
        <input
          type="color"
          className="club-accent-picker"
          value={previewColor}
          aria-label={translate("clubSettings.accent.picker", {
            color: previewColor.toUpperCase(),
          })}
          disabled={isDisabled}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
        <input
          id={ACCENT_FIELD_ID}
          type="text"
          className="club-accent-code"
          value={typedColor}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={issueText !== null}
          aria-describedby={describedBy}
          disabled={isDisabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <AccentPreview translate={translate} color={previewColor} />
      </div>
      <p className="auth-hint" id={ACCENT_HINT_ID}>
        {translate("clubSettings.accent.hint")}
      </p>
      {issueText === null ? null : (
        <p className="auth-field-error" id={ACCENT_ISSUE_ID} role="alert">
          {issueText}
        </p>
      )}
    </div>
  );
}
