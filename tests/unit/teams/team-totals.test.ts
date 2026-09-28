import { describe, expect, it } from "vitest";
import { calculateSplitTotals } from "@/lib/teams/team-totals";
import { squadPlayer } from "../helpers/squad-players";

/**
 * Los totales del reparto (FR-045, RF-5 del PRD de E10): por equipo, cuántos
 * jugadores, el puntaje combinado y la fuerza media a un decimal; y la
 * diferencia de puntaje entre los dos.
 */

describe("los totales del reparto", () => {
  it("cuenta jugadores y suma el puntaje combinado de cada equipo", () => {
    const split = {
      a: [squadPlayer("Ana", 8.3), squadPlayer("Bea", 7.1)],
      b: [
        squadPlayer("Carla", 6),
        squadPlayer("Dani", 6.5),
        squadPlayer("Eva", 4),
      ],
    };

    const totals = calculateSplitTotals(split);

    expect(totals.a).toEqual({
      playerCount: 2,
      combinedRating: 15.4,
      averageRating: 7.7,
    });
    expect(totals.b).toEqual({
      playerCount: 3,
      combinedRating: 16.5,
      averageRating: 5.5,
    });
  });

  it("da la diferencia de puntaje combinado sin signo", () => {
    const split = {
      a: [squadPlayer("Ana", 6)],
      b: [squadPlayer("Bea", 8.5)],
    };

    expect(calculateSplitTotals(split).ratingDifference).toBe(2.5);
  });

  it("suma en décimas: 8.1 y 8.2 dan 16.3, no 16.299999", () => {
    const split = {
      a: [squadPlayer("Ana", 8.1), squadPlayer("Bea", 8.2)],
      b: [],
    };

    expect(calculateSplitTotals(split).a.combinedRating).toBe(16.3);
  });

  it("redondea hacia arriba la media que cae justo en la mitad, como el OVR", () => {
    const split = {
      a: [squadPlayer("Ana", 8.2), squadPlayer("Bea", 8.3)],
      b: [],
    };

    expect(calculateSplitTotals(split).a.averageRating).toBe(8.3);
  });

  it("cuenta con 5,0 al jugador sin evaluar (FR-086)", () => {
    const split = { a: [squadPlayer("Ana", null)], b: [squadPlayer("Bea", 7)] };

    const totals = calculateSplitTotals(split);

    expect(totals.a.combinedRating).toBe(5);
    expect(totals.ratingDifference).toBe(2);
  });

  it("deja sin media al equipo vacío, en vez de inventar un cero", () => {
    const split = { a: [], b: [squadPlayer("Bea", 7)] };

    const totals = calculateSplitTotals(split);

    expect(totals.a).toEqual({
      playerCount: 0,
      combinedRating: 0,
      averageRating: null,
    });
    expect(totals.ratingDifference).toBe(7);
  });
});
