import { LOCALE_COOKIE_NAME, type Locale } from "./locale";

// Lo bastante largo para que "vuelve más tarde" sea cualquier día de la
// temporada, sin volverse eterna: el idioma se guarda por equipo (PRD E17).
const LOCALE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** La cookie que recuerda el idioma elegido, lista para `document.cookie`.
 * `Path=/` porque la elección vale para toda la aplicación y no solo para la
 * pantalla desde la que se hizo. */
export function localeCookie(locale: Locale): string {
  return [
    `${LOCALE_COOKIE_NAME}=${locale}`,
    "Path=/",
    `Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ].join("; ");
}
