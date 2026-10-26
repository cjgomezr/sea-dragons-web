import { describe, expect, it } from "vitest";
import { countTeamCoverage } from "@/lib/teams/position-coverage";
import type { PositionCoverage } from "@/lib/teams/squad";

/** Sólo lo que lee la tarjeta: la función de su posición. */
function teamPlayer(
  fullName: string,
  coverage: PositionCoverage | null = null,
): { readonly fullName: string; readonly coverage: PositionCoverage | null } {
  return { fullName, coverage };
}

/**
 * La cobertura de un equipo en su tarjeta (#759, D9 del PRD de E28): cuántos
 * porteros, defensas y atacantes tiene, según la función de su posición.
 */

describe("la cobertura de un equipo", () => {
  it("cuenta a cada jugador en la función de su posición", () => {
    const team = [
      teamPlayer("Ana", "goalkeeper"),
      teamPlayer("Bea", "defender"),
      teamPlayer("Carla", "defender"),
      teamPlayer("Dani", "forward"),
    ];

    expect(countTeamCoverage(team)).toEqual({
      goalkeeper: 1,
      defender: 2,
      forward: 1,
    });
  });

  it("no cuenta a quien no tiene función", () => {
    const team = [teamPlayer("Ana"), teamPlayer("Bea", "forward")];

    expect(countTeamCoverage(team)).toEqual({
      goalkeeper: 0,
      defender: 0,
      forward: 1,
    });
  });

  it("da cero en las tres a un equipo vacío", () => {
    expect(countTeamCoverage([])).toEqual({
      goalkeeper: 0,
      defender: 0,
      forward: 0,
    });
  });
});
