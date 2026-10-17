/**
 * Las secciones de la configuración del club (#718, D9 del PRD de E26) y
 * cómo van en la dirección: `/club?tab=general|sign-in|positions|packs`.
 *
 * Un `tab` que no existe es como si no estuviera, y qué pinta entonces lo
 * decide la pantalla: en escritorio General, en el móvil la lista. El
 * Committee sólo configura los packs (D8), así que para él la sección es
 * siempre Packs, diga lo que diga la dirección.
 */

export const CLUB_SETTINGS_SECTIONS = [
  "general",
  "sign-in",
  "positions",
  "packs",
] as const;

export type ClubSettingsSection = (typeof CLUB_SETTINGS_SECTIONS)[number];

export const CLUB_SETTINGS_SECTION_QUERY_PARAM = "tab";

/** La única sección de quien no es Admin. */
const COMMITTEE_SECTION: ClubSettingsSection = "packs";

function isClubSettingsSection(value: string): value is ClubSettingsSection {
  return (CLUB_SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/** La sección que pide `tab`, o `null` si no pide ninguna que exista. */
export function readClubSettingsSection(
  queryValue: string | null,
  canManageClub: boolean,
): ClubSettingsSection | null {
  if (!canManageClub) {
    return COMMITTEE_SECTION;
  }
  return queryValue !== null && isClubSettingsSection(queryValue)
    ? queryValue
    : null;
}

/** La búsqueda de la dirección con `tab`, sin tocar los demás parámetros.
 * Sin sección se quita; vacía si no queda ninguno. */
export function searchWithClubSettingsSection(
  current: URLSearchParams,
  section: ClubSettingsSection | null,
): string {
  const next = new URLSearchParams(current);
  if (section === null) {
    next.delete(CLUB_SETTINGS_SECTION_QUERY_PARAM);
  } else {
    next.set(CLUB_SETTINGS_SECTION_QUERY_PARAM, section);
  }
  const search = next.toString();
  return search === "" ? "" : `?${search}`;
}
