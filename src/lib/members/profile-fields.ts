/**
 * Los catálogos de la ficha del socio que `0016_member_profile_fields.sql`
 * (#237) dejó cerrados con un `check` en la base: la posición y el nivel de
 * experiencia. Esto es la misma lista del lado de TypeScript, para estrechar
 * lo que llega de una consulta, igual que `ACCOUNT_STATUSES` hace con el
 * estado de la cuenta.
 *
 * El género vive sólo en la base por ahora: el directorio no lo muestra
 * (NFR-010) y el perfil propio llega en su propio ticket.
 */

/** En el orden del SRD, que no es el alfabético: es el que usa el directorio
 * para ordenar por posición (FR-019). Se guardan en inglés, como el rol; las
 * pantallas los traducen con claves del catálogo. */
export const POSITIONS = ["Goalkeeper", "Defender", "Forward"] as const;

export type Position = (typeof POSITIONS)[number];

/** De menos a más, que es como los ordenaría quien arma un entrenamiento. */
export const EXPERIENCE_LEVELS = [
  "Beginner",
  "Intermediate",
  "Advanced",
] as const;

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

/** Estrecha un valor que llega de la base. Compara exacto, sin normalizar
 * mayúsculas: lo que no esté en el catálogo no es una posición. */
export function parsePosition(value: unknown): Position | null {
  return POSITIONS.find((position) => position === value) ?? null;
}

export function parseExperienceLevel(value: unknown): ExperienceLevel | null {
  return EXPERIENCE_LEVELS.find((level) => level === value) ?? null;
}
