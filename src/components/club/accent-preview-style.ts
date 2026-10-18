import {
  type AccentPalette,
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
 * medio escribir o uno sin texto legible encima no se enseña. */
export function accentPreviewStyleOf(
  typedColor: string,
  savedColor: string,
): AccentPreviewStyle {
  const typed = evaluateAccentColor(normalizeAccentInput(typedColor));
  if (typed.kind === "accepted") {
    return styleOf(typed.palette);
  }
  const saved = evaluateAccentColor(savedColor);
  if (saved.kind === "accepted") {
    return styleOf(saved.palette);
  }
  throw new Error(`El acento guardado no vale como acento: ${savedColor}`);
}
