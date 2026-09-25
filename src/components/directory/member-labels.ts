import { positionName } from "@/lib/club/club-positions";
import type { DirectoryMember } from "@/lib/directory/directory";
import { countryName } from "@/lib/geo/countries";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Cómo se escribe en pantalla lo que la base guarda en inglés o en código: el
 * país (ISO 3166-1) y el nivel de experiencia. La posición trae sus nombres
 * del club (#299), y se elige el del idioma de la pantalla.
 *
 * Quien no tiene el dato no deja un hueco: el PRD de E5 pide un guion en su
 * lugar, para que la fila se lea igual con datos que sin ellos.
 */

/** El guion del dato que falta. Es una semiraya y no una raya larga, que el
 * estilo de la casa no usa. */
export const MISSING_FIELD = "–";

/** El país en el idioma de la pantalla, como en el selector del registro. Un
 * código que el catálogo no conoce se enseña tal cual: es lo que la base
 * guarda, y esconderlo dejaría la fila mintiendo. */
export function describeCountry(
  translate: Translator,
  country: DirectoryMember["country"],
): string {
  if (country === null) {
    return MISSING_FIELD;
  }
  return countryName(translate.locale, country) ?? country;
}

export function describeExperienceLevel(
  translate: Translator,
  level: DirectoryMember["experienceLevel"],
): string {
  return level === null ? MISSING_FIELD : translate(`level.${level}`);
}

export function describePosition(
  translate: Translator,
  position: DirectoryMember["position"],
): string {
  return position === null
    ? MISSING_FIELD
    : positionName(position.names, translate.locale);
}
