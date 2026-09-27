import { describe, expect, it } from "vitest";
import { calculateOverallRating } from "@/lib/evaluations/overall-rating";

/**
 * El OVR (FR-052, RF-2 del PRD de E9): la media de todas las categorías de la
 * evaluación, a un decimal. Se calcula al leer, nunca se guarda.
 */

describe("el OVR", () => {
  it("es 8.3 con diez categorías que suman 83 (AC-021)", () => {
    const ratings = [9, 8, 8, 9, 8, 8, 9, 8, 8, 8];

    expect(calculateOverallRating(ratings)).toBe(8.3);
  });

  it("cuenta las once categorías de una evaluación con once (AC-035)", () => {
    const ratings = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 1];

    expect(calculateOverallRating(ratings)).toBe(9.2);
  });

  it("redondea hacia arriba la media que cae justo en la mitad: 8.25 da 8.3", () => {
    expect(calculateOverallRating([8, 8, 8, 9])).toBe(8.3);
  });

  it("redondea 8.35 a 8.4, aunque 8.35 no exista exacto en coma flotante", () => {
    const ratings = [...Array<number>(13).fill(8), ...Array<number>(7).fill(9)];

    expect(calculateOverallRating(ratings)).toBe(8.4);
  });

  it("redondea hacia abajo lo que no llega a la mitad", () => {
    expect(calculateOverallRating([7, 7, 8])).toBe(7.3);
  });

  it("devuelve un entero sin decimales espurios", () => {
    expect(calculateOverallRating([5, 5, 5])).toBe(5);
  });

  it("devuelve null, y no cero, sin ninguna categoría", () => {
    expect(calculateOverallRating([])).toBeNull();
  });
});
