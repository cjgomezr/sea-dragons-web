import type { EvaluationCategories } from "./evaluation-categories";
import { type EvaluationRating, INITIAL_RATING } from "./member-evaluation";

/**
 * Las filas de notas de la ficha en lectura (#819, RF-3 y D3 del PRD de
 * E31). Van las categorías activas del club en el orden de Categorías; la
 * que la evaluación no tiene (se añadió después) sale "nueva · sin nota" y no
 * cuenta en el OVR, que ya calculó el servidor. Detrás, las desactivadas que
 * la evaluación conserva hasta que se edite (D4).
 *
 * Sin las categorías del club (no se pudieron leer) quedan las notas tal
 * como vienen, que ya llegan en el orden del catálogo.
 */

export type SheetRating =
  | { readonly kind: "rated"; readonly entry: EvaluationRating }
  | {
      readonly kind: "unrated";
      readonly categoryId: string;
      readonly name: string;
    };

function rated(entry: EvaluationRating): SheetRating {
  return { kind: "rated", entry };
}

export function sheetRatings(
  ratings: readonly EvaluationRating[],
  categories: EvaluationCategories | null,
): readonly SheetRating[] {
  if (categories === null) {
    return ratings.map(rated);
  }
  const byCategory = new Map(ratings.map((entry) => [entry.categoryId, entry]));
  const active = categories.filter((category) => category.isActive);
  const activeIds = new Set(active.map((category) => category.id));
  const activeRows = active.map((category): SheetRating => {
    const entry = byCategory.get(category.id);
    return entry === undefined
      ? { kind: "unrated", categoryId: category.id, name: category.name }
      : rated(entry);
  });
  const keptRows = ratings
    .filter((entry) => !activeIds.has(entry.categoryId))
    .map(rated);
  return [...activeRows, ...keptRows];
}

/** Una fila de la edición, con la nota de la que parte. */
export type EditingRating = {
  readonly categoryId: string;
  readonly name: string;
  readonly rating: number;
};

/**
 * Las filas de notas de la ficha en edición (#820, D4 del PRD de E31): las
 * categorías activas del club en su orden, con su nota las que la evaluación
 * ya tiene y en 5 las nuevas. Las desactivadas no salen: guardar las quita.
 *
 * Sin las categorías del club no se sabe cuáles son nuevas: quedan las notas
 * que no están desactivadas.
 */
export function editingRatings(
  ratings: readonly EvaluationRating[],
  categories: EvaluationCategories | null,
): readonly EditingRating[] {
  if (categories === null) {
    return ratings
      .filter((entry) => !entry.isRetired)
      .map(({ categoryId, name, rating }) => ({ categoryId, name, rating }));
  }
  const ratingOf = new Map(
    ratings.map((entry) => [entry.categoryId, entry.rating]),
  );
  return categories
    .filter((category) => category.isActive)
    .map((category) => ({
      categoryId: category.id,
      name: category.name,
      rating: ratingOf.get(category.id) ?? INITIAL_RATING,
    }));
}
