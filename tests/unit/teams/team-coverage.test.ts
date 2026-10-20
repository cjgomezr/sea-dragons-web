import { describe, expect, it } from "vitest";
import { countTeamCoverage } from "@/lib/teams/position-coverage";
import { squadPlayer } from "../helpers/squad-players";

/**
 * La cobertura de un equipo en su tarjeta (#759, D9 del PRD de E28): cuántos
 * porteros, defensas y atacantes tiene, según la función de su posición.
 */

describe("la cobertura de un equipo", () => {
  it("cuenta a cada jugador en la función de su posición", () => {
    const team = [
      squadPlayer("Ana", 8, "goalkeeper"),
      squadPlayer("Bea", 7, "defender"),
      squadPlayer("Carla", 6, "defender"),
      squadPlayer("Dani", 6, "forward"),
    ];

    expect(countTeamCoverage(team)).toEqual({
      goalkeeper: 1,
      defender: 2,
      forward: 1,
    });
  });

  it("no cuenta a quien no tiene función", () => {
    const team = [squadPlayer("Ana", 8), squadPlayer("Bea", 7, "forward")];

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
