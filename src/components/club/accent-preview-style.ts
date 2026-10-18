import {
  type AccentPalette,
  DEFAULT_ACCENT_COLOR,
  evaluateAccentColor,
  normalizeAccentInput,
} from "@/lib/club/accent-color";

/**
 * Los colores con los que la pestaña General pinta el acento del borrador
 * (#720): la vista previa y las iniciales del logo. Van en línea como
 * variables, una por tema, porque el relleno y el enlace que se leen en el
 * tema claro no son los del oscuro; la hoja elige cuál usar. El cálculo es el
 * del servidor (`evaluateAccentColor`), para que la vista previa no mienta.
 */

export type AccentPreviewStyle = React.CSSProperties &
  Readonly<
    Record<
      | `--club-preview-${"accent" | "on-accent"}-${"light" | "dark"}`
      | `--club-accent-link-${"light" | "dark"}`,
      string
    >
  >;

function styleOf({ light, dark }: AccentPalette): AccentPreviewStyle {
  return {
    "--club-preview-accent-light": light.accent,
    "--club-preview-on-accent-light": light.onAccent,
    "--club-preview-accent-dark": dark.accent,
    "--club-preview-on-accent-dark": dark.onAccent,
    "--club-accent-link-light": light.accentText,
    "--club-accent-link-dark": dark.accentText,
  };
}

/** Lo escrito si vale como acento, y si no, el color guardado: un código a
 * medio escribir o uno sin texto legible encima no se enseña. Un guardado
 * que tampoco se lee (puesto por SQL, o de antes de la regla del #346) no
 * tumba la pantalla donde se arregla: cae al de por defecto, como el correo. */
export function accentPreviewStyleOf(
  typedColor: string,
  savedColor: string,
): AccentPreviewStyle {
  const candidates = [
    normalizeAccentInput(typedColor),
    savedColor,
    DEFAULT_ACCENT_COLOR,
  ];
  for (const candidate of candidates) {
    const evaluation = evaluateAccentColor(candidate);
    if (evaluation.kind === "accepted") {
      return styleOf(evaluation.palette);
    }
  }
  throw new Error(`El acento por defecto no se lee: ${DEFAULT_ACCENT_COLOR}`);
}
