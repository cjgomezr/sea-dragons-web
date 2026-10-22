import { describe, expect, it } from "vitest";
import type { EvaluationCategories } from "@/lib/evaluations/evaluation-categories";
import type { EvaluationRating } from "@/lib/evaluations/member-evaluation";
import { editingRatings, sheetRatings } from "@/lib/evaluations/sheet-ratings";

/**
 * Las filas de notas de la ficha en lectura (#819, D3 del PRD de E31): las
 * categorías activas en el orden de Categorías, con las que la evaluación no
 * tiene como "nueva · sin nota", y detrás las desactivadas que conserva.
 * Y las de la edición (#820, D4): sólo las activas, con las nuevas en 5.
 */

const FITNESS: EvaluationRating = {
  categoryId: "fitness",
  name: "Fitness",
  rating: 8,
  isRetired: false,
};
const SPEED: EvaluationRating = {
  categoryId: "speed",
  name: "Speed",
  rating: 7,
  isRetired: false,
};
const OLD: EvaluationRating = {
  categoryId: "old",
  name: "Old",
  rating: 4,
  isRetired: true,
};

const CATEGORIES: EvaluationCategories = [
  { id: "speed", name: "Speed", isActive: true },
  { id: "breath", name: "Breath hold", isActive: true },
  { id: "fitness", name: "Fitness", isActive: true },
  { id: "old", name: "Old", isActive: false },
];

describe("sheetRatings", () => {
  it("sigue el orden de Categorías y marca la activa que falta como sin nota", () => {
    const rows = sheetRatings([FITNESS, SPEED], CATEGORIES);

    expect(rows).toEqual([
      { kind: "rated", entry: SPEED },
      { kind: "unrated", categoryId: "breath", name: "Breath hold" },
      { kind: "rated", entry: FITNESS },
    ]);
  });

  it("deja al final las desactivadas que la evaluación conserva", () => {
    const rows = sheetRatings([OLD, FITNESS], CATEGORIES);

    expect(rows.map((row) => row.kind)).toEqual([
      "unrated",
      "unrated",
      "rated",
      "rated",
    ]);
    expect(rows.at(-1)).toEqual({ kind: "rated", entry: OLD });
  });

  it("sin las categorías del club enseña las notas tal como vienen", () => {
    const rows = sheetRatings([FITNESS, SPEED], null);

    expect(rows).toEqual([
      { kind: "rated", entry: FITNESS },
      { kind: "rated", entry: SPEED },
    ]);
  });
});

describe("editingRatings", () => {
  it("lleva las activas en el orden de Categorías, con su nota o en 5 las nuevas", () => {
    const rows = editingRatings([FITNESS, SPEED], CATEGORIES);

    expect(rows).toEqual([
      { categoryId: "speed", name: "Speed", rating: 7 },
      { categoryId: "breath", name: "Breath hold", rating: 5 },
      { categoryId: "fitness", name: "Fitness", rating: 8 },
    ]);
  });

  it("no lleva las desactivadas que la evaluación conserva", () => {
    const rows = editingRatings([OLD, FITNESS], CATEGORIES);

    expect(rows.map((row) => row.categoryId)).toEqual([
      "speed",
      "breath",
      "fitness",
    ]);
  });

  it("sin las categorías del club lleva las notas que no están desactivadas", () => {
    const rows = editingRatings([FITNESS, OLD, SPEED], null);

    expect(rows).toEqual([
      { categoryId: "fitness", name: "Fitness", rating: 8 },
      { categoryId: "speed", name: "Speed", rating: 7 },
    ]);
  });
});
