/**
 * Los catálogos de la ficha del socio que `0016_member_profile_fields.sql`
 * (#237) dejó cerrados con un `check` en la base: el nivel de experiencia y
 * el género. Esto es la misma lista del lado de TypeScript, para estrechar
 * lo que llega de una consulta o de una petición, igual que
 * `ACCOUNT_STATUSES` hace con el estado de la cuenta.
 *
 * La posición salió de aquí con #299: la define cada club
 * (`src/lib/club/club-positions.ts`).
 *
 * El directorio no muestra el género (NFR-010): sólo lo lee y lo escribe el
 * perfil propio (#241).
 */

/** De menos a más, que es como los ordenaría quien arma un entrenamiento. */
export const EXPERIENCE_LEVELS = [
  "Beginner",
  "Intermediate",
  "Advanced",
] as const;

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

/** Estrecha un valor que llega de la base. Compara exacto, sin normalizar
 * mayúsculas: lo que no esté en el catálogo no vale. */
export function parseExperienceLevel(value: unknown): ExperienceLevel | null {
  return EXPERIENCE_LEVELS.find((level) => level === value) ?? null;
}

/** Códigos y no texto libre: "prefiero no decirlo" (`undisclosed`) es un
 * valor de verdad, distinto de no haber contestado (null). */
export const GENDERS = ["female", "male", "non_binary", "undisclosed"] as const;

export type Gender = (typeof GENDERS)[number];

export function parseGender(value: unknown): Gender | null {
  return GENDERS.find((gender) => gender === value) ?? null;
}
