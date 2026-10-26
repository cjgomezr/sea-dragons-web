import { describe, expect, it } from "vitest";
import {
  countCoverageGaps,
  describeTeamCoverage,
} from "@/lib/teams/position-coverage";
import type { PositionRequirement, SquadPlayer } from "@/lib/teams/squad";
import { squadPlayer } from "../helpers/squad-players";

/**
 * Los mínimos por posición de E34 (RF-2 del PRD, FR-046): cada equipo debe
 * tener al menos `min(N, ⌊C / 2⌋)` de cada posición con mínimo N, siendo C
 * los de esa posición en la escuadra. Cada uno que falta es un hueco.
 */

function playersOf(
  positionId: string | null,
  count: number,
  prefix: string,
): SquadPlayer[] {
  return Array.from({ length: count }, (_, index) =>
    squadPlayer(`${prefix}${index}`, 5, positionId),
  );
}

function requiring(
  positionId: string,
  minPerTeam: number,
): readonly PositionRequirement[] {
  return [{ positionId, minPerTeam }];
}

describe("los huecos de los mínimos por posición", () => {
  it("con mínimo 1 y dos porteros juntos cuenta un hueco", () => {
    const split = { a: playersOf("gk", 2, "A"), b: playersOf(null, 2, "B") };

    expect(countCoverageGaps(split, requiring("gk", 1))).toBe(1);
  });

  it("con mínimo 1 y un portero por lado no cuenta huecos", () => {
    const split = { a: playersOf("gk", 1, "A"), b: playersOf("gk", 1, "B") };

    expect(countCoverageGaps(split, requiring("gk", 1))).toBe(0);
  });

  it("con mínimo 2 y cuatro defensas cuenta lo que le falta a cada equipo", () => {
    const split = {
      a: [...playersOf("def", 3, "A"), ...playersOf(null, 1, "X")],
      b: [...playersOf("def", 1, "B"), ...playersOf(null, 3, "Y")],
    };

    expect(countCoverageGaps(split, requiring("def", 2))).toBe(1);
  });

  it("con mínimo 2 y tres defensas sólo exige uno por equipo", () => {
    const split = {
      a: [...playersOf("def", 2, "A"), ...playersOf(null, 1, "X")],
      b: [...playersOf("def", 1, "B"), ...playersOf(null, 2, "Y")],
    };

    expect(countCoverageGaps(split, requiring("def", 2))).toBe(0);
  });

  it("con un mínimo mayor que la mitad exige sólo la mitad redondeada abajo", () => {
    const split = { a: playersOf("def", 2, "A"), b: playersOf("def", 2, "B") };

    expect(countCoverageGaps(split, requiring("def", 5))).toBe(0);
  });

  it("no exige nada con un solo jugador de la posición", () => {
    const split = { a: playersOf("gk", 1, "A"), b: playersOf(null, 1, "B") };

    expect(countCoverageGaps(split, requiring("gk", 1))).toBe(0);
  });

  it("no exige nada a una posición sin requisito, como la de mínimo 0 o la archivada", () => {
    const split = { a: playersOf("gk", 2, "A"), b: playersOf(null, 2, "B") };

    expect(countCoverageGaps(split, [])).toBe(0);
  });

  it("no cuenta para ningún mínimo a quien no tiene posición", () => {
    const split = { a: playersOf("gk", 1, "A"), b: playersOf(null, 3, "B") };

    expect(countCoverageGaps(split, requiring("gk", 1))).toBe(0);
  });

  it("suma los huecos de todas las posiciones", () => {
    const split = {
      a: [...playersOf("gk", 2, "G"), ...playersOf("def", 4, "D")],
      b: playersOf(null, 6, "B"),
    };
    const requirements = [
      { positionId: "gk", minPerTeam: 1 },
      { positionId: "def", minPerTeam: 2 },
    ];

    expect(countCoverageGaps(split, requirements)).toBe(3);
  });
});

describe("la cobertura de una tarjeta de equipo (#888)", () => {
  it("cuenta los de cada posición y no avisa con el mínimo cumplido", () => {
    const team = [...playersOf("gk", 1, "A"), ...playersOf(null, 2, "X")];
    const squad = [...team, ...playersOf("gk", 1, "B")];

    expect(describeTeamCoverage(team, squad, requiring("gk", 1))).toEqual([
      { positionId: "gk", count: 1, missingCount: 0 },
    ]);
  });

  it("avisa de uno que falta cuando la escuadra permitía cumplirlo", () => {
    const team = playersOf(null, 3, "A");
    const squad = [...team, ...playersOf("gk", 2, "B")];

    expect(describeTeamCoverage(team, squad, requiring("gk", 1))).toEqual([
      { positionId: "gk", count: 0, missingCount: 1 },
    ]);
  });

  it("avisa de dos que faltan con mínimo 2 y cuatro en la escuadra", () => {
    const team = playersOf(null, 3, "A");
    const squad = [...team, ...playersOf("def", 4, "B")];

    expect(describeTeamCoverage(team, squad, requiring("def", 2))).toEqual([
      { positionId: "def", count: 0, missingCount: 2 },
    ]);
  });

  it("no avisa de un mínimo que la escuadra no permitía cumplir", () => {
    const team = playersOf(null, 3, "A");
    const squad = [...team, ...playersOf("gk", 1, "B")];

    expect(describeTeamCoverage(team, squad, requiring("gk", 1))).toEqual([
      { positionId: "gk", count: 0, missingCount: 0 },
    ]);
  });

  it("no avisa de nada a un equipo vacío", () => {
    const squad = playersOf("gk", 2, "B");

    expect(describeTeamCoverage([], squad, requiring("gk", 1))).toEqual([
      { positionId: "gk", count: 0, missingCount: 0 },
    ]);
  });

  it("sigue el orden de los requisitos, que es el del club", () => {
    const team = playersOf("def", 1, "A");
    const requirements = [
      { positionId: "gk", minPerTeam: 1 },
      { positionId: "def", minPerTeam: 1 },
    ];

    expect(
      describeTeamCoverage(team, team, requirements).map(
        ({ positionId }) => positionId,
      ),
    ).toEqual(["gk", "def"]);
  });
});
