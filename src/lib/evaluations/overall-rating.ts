/**
 * El OVR de una evaluación (FR-052, RF-2 del PRD de E9): la media de todas sus
 * categorías, a un decimal. Se calcula al leer y no se guarda, así que un
 * ajuste nunca deja un valor obsoleto en la base.
 */

const TENTHS_PER_UNIT = 10;

/**
 * La media que cae justo en la mitad sube: 8.25 da 8.3 y 8.35 da 8.4. Se
 * divide la suma entera, no la media ya calculada: `8.35 * 10` en coma
 * flotante es 83.4999…, y redondear eso bajaría a 8.3.
 *
 * Sin ninguna categoría no hay media, y se dice con `null`: un cero sería una
 * nota que nadie puso.
 */
export function calculateOverallRating(
  ratings: readonly number[],
): number | null {
  if (ratings.length === 0) {
    return null;
  }
  const sum = ratings.reduce((total, rating) => total + rating, 0);
  const tenths = Math.round((sum * TENTHS_PER_UNIT) / ratings.length);
  return tenths / TENTHS_PER_UNIT;
}
