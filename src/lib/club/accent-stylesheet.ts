import {
  type AccentPair,
  DEFAULT_ACCENT_COLOR,
  evaluateAccentColor,
} from "./accent-color";

/**
 * La hoja que pinta el acento del club (#294, RF-3 del PRD de E18a). Va en
 * el `<head>` del HTML que sirve el servidor, como `ThemeScript`: la página
 * sale ya con el color del club, sin JavaScript y sin parpadeo del de antes.
 *
 * Repite los tres selectores de la paleta de `globals.css` con `html`
 * delante. Así pesa más que los de la hoja global sea cual sea el orden en
 * que el navegador reciba las dos, y el resto de la paleta sigue saliendo de
 * `globals.css`.
 */

const LIGHT_SELECTOR = "html:root";
const SYSTEM_DARK_SELECTOR = 'html:root:not([data-theme="light"])';
const CHOSEN_DARK_SELECTOR = 'html:root[data-theme="dark"]';

function accentRule(selector: string, pair: AccentPair): string {
  return `${selector}{--color-accent:${pair.accent};--color-on-accent:${pair.onAccent}}`;
}

/**
 * `null` cuando no hace falta hoja: con el acento de hoy, cuyo par oscuro lo
 * eligió el diseño a mano, y con uno guardado que no llegue a AA, que no
 * debería existir pero que no puede dejar la aplicación ilegible.
 */
export function buildAccentStylesheet(accentColor: string): string | null {
  if (accentColor.toLowerCase() === DEFAULT_ACCENT_COLOR) {
    return null;
  }
  const evaluation = evaluateAccentColor(accentColor);
  if (evaluation.kind === "rejected") {
    return null;
  }
  const { light, dark } = evaluation.palette;
  return [
    accentRule(LIGHT_SELECTOR, light),
    `@media (prefers-color-scheme: dark){${accentRule(SYSTEM_DARK_SELECTOR, dark)}}`,
    accentRule(CHOSEN_DARK_SELECTOR, dark),
  ].join("\n");
}
