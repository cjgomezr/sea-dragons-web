/**
 * El nombre corto de un equipo (#761, D10 del PRD de E28): el que llevan los
 * botones Añadir del banco y las pestañas del móvil. Es el nombre sin "Team "
 * ni "Equipo " al principio, que es lo que todos los equipos repiten, y
 * cortado con puntos suspensivos si aun así no cabe en un botón.
 */

const TEAM_NAME_PREFIXES = ["Team ", "Equipo "] as const;

/** Lo que cabe en un botón Añadir junto a los otros: "Barracudas" entra. */
const SHORT_NAME_MAX_LENGTH = 10;

const ELLIPSIS = "…";

function withoutPrefix(name: string): string {
  const prefix = TEAM_NAME_PREFIXES.find((candidate) =>
    name.startsWith(candidate),
  );
  if (prefix === undefined) {
    return name;
  }
  const rest = name.slice(prefix.length).trim();
  return rest === "" ? name : rest;
}

export function shortTeamName(name: string): string {
  const short = withoutPrefix(name);
  if (short.length <= SHORT_NAME_MAX_LENGTH) {
    return short;
  }
  return `${short.slice(0, SHORT_NAME_MAX_LENGTH - 1).trimEnd()}${ELLIPSIS}`;
}
