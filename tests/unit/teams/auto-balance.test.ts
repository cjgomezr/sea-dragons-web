import { describe, expect, it } from "vitest";
import {
  AUTO_BALANCE_TIME_BUDGET_MS,
  autoBalanceTeams,
} from "@/lib/teams/auto-balance";
import type {
  PositionRequirement,
  SquadPlayer,
  TeamSplit,
} from "@/lib/teams/squad";
import { calculateSplitTotals } from "@/lib/teams/team-totals";
import {
  ROLE_REQUIREMENTS,
  namesOf,
  squadPlayer,
} from "../helpers/squad-players";

/**
 * El auto-balance de FR-046 (RF-5 del PRD de E10), tal como lo fijó C2 en
 * `docs/preguntas-abiertas.md`: orden descendente por OVR, reparto en
 * serpiente, y luego el intercambio de a un par que más mejore, hasta que
 * ninguno mejore o se agote el presupuesto de NFR-002. La cobertura de
 * posiciones es restricción dura donde la escuadra la permita.
 */

const NFR_002_LIMIT_MS = 2_000;
const PERFORMANCE_RUNS = 10;
const P95 = 0.95;

function countCoverage(
  team: readonly SquadPlayer[],
  positionId: string,
): number {
  return team.filter((player) => player.positionId === positionId).length;
}

function hasCoverage(split: TeamSplit, coverage: string): boolean {
  return (
    countCoverage(split.a, coverage) > 0 && countCoverage(split.b, coverage) > 0
  );
}

/**
 * Prueba por fuerza bruta, sin pasar por el código que se prueba, que ningún
 * intercambio de a un par que conserve la cobertura acerca más el puntaje.
 */
function findBetterCoveredSwap(
  split: TeamSplit,
  requiredCoverage: readonly string[],
): string | null {
  const currentDifference = calculateSplitTotals(split).ratingDifference;
  for (const fromA of split.a) {
    for (const fromB of split.b) {
      const swapped = {
        a: split.a.map((player) => (player === fromA ? fromB : player)),
        b: split.b.map((player) => (player === fromB ? fromA : player)),
      };
      const keepsCoverage = requiredCoverage.every((coverage) =>
        hasCoverage(swapped, coverage),
      );
      const difference = calculateSplitTotals(swapped).ratingDifference;
      if (keepsCoverage && difference < currentDifference) {
        return `${fromA.fullName} <-> ${fromB.fullName}`;
      }
    }
  }
  return null;
}

/** Como `findBetterCoveredSwap`, con cualquier regla de mínimos. */
function findBetterSwapKeeping(
  split: TeamSplit,
  meetsMinimums: (split: TeamSplit) => boolean,
): string | null {
  const currentDifference = calculateSplitTotals(split).ratingDifference;
  for (const fromA of split.a) {
    for (const fromB of split.b) {
      const swapped = {
        a: split.a.map((player) => (player === fromA ? fromB : player)),
        b: split.b.map((player) => (player === fromB ? fromA : player)),
      };
      const difference = calculateSplitTotals(swapped).ratingDifference;
      if (meetsMinimums(swapped) && difference < currentDifference) {
        return `${fromA.fullName} <-> ${fromB.fullName}`;
      }
    }
  }
  return null;
}

/** Doce con dos porteros que la serpiente pondría juntos en el equipo a. */
const TWELVE_WITH_TWO_GOALKEEPERS = [
  squadPlayer("Ana", 9, "goalkeeper"),
  squadPlayer("Bea", 8.5, "defender"),
  squadPlayer("Carla", 8),
  squadPlayer("Dani", 7.5, "goalkeeper"),
  squadPlayer("Eva", 7.2),
  squadPlayer("Fer", 6.8, "forward"),
  squadPlayer("Gabi", 6.5),
  squadPlayer("Hugo", 6.1),
  squadPlayer("Iris", 5.9),
  squadPlayer("Juan", 5.4),
  squadPlayer("Kai", null),
  squadPlayer("Luz", 4.6),
];

function fivePointPlayers(count: number): SquadPlayer[] {
  return Array.from({ length: count }, (_, index) =>
    squadPlayer(`J${String(index + 1).padStart(2, "0")}`, 5),
  );
}

describe("reparto en serpiente", () => {
  it("reparte a-b-b-a por OVR descendente", () => {
    const squad = [
      squadPlayer("Ana", 9),
      squadPlayer("Bea", 8),
      squadPlayer("Carla", 7),
      squadPlayer("Dani", 6),
    ];

    const result = autoBalanceTeams(squad, ROLE_REQUIREMENTS);

    expect(namesOf(result.a)).toEqual(["Ana", "Dani"]);
    expect(namesOf(result.b)).toEqual(["Bea", "Carla"]);
  });

  it("devuelve el modo auto", () => {
    expect(
      autoBalanceTeams([squadPlayer("Ana", 9)], ROLE_REQUIREMENTS).mode,
    ).toBe("auto");
  });

  it("devuelve dos equipos vacíos con la escuadra vacía", () => {
    const result = autoBalanceTeams([], ROLE_REQUIREMENTS);

    expect(result.a).toEqual([]);
    expect(result.b).toEqual([]);
    expect(result.isTimeBudgetExhausted).toBe(false);
  });

  it("pone en el equipo a al único jugador de una escuadra de uno", () => {
    const result = autoBalanceTeams([squadPlayer("Ana", 9)], ROLE_REQUIREMENTS);

    expect(namesOf(result.a)).toEqual(["Ana"]);
    expect(result.b).toEqual([]);
  });

  it("cuenta con 5,0 a los no evaluados y los devuelve marcados, sin inventarles nota (AC-053)", () => {
    const squad = [
      squadPlayer("Ana", 9),
      squadPlayer("Bea", null),
      squadPlayer("Carla", null),
      squadPlayer("Dani", 1),
    ];

    const result = autoBalanceTeams(squad, ROLE_REQUIREMENTS);

    expect(namesOf(result.b)).toEqual(["Bea", "Carla"]);
    expect(calculateSplitTotals(result).ratingDifference).toBe(0);
    expect(result.unratedPlayerIds).toEqual(["id-Bea", "id-Carla"]);
    expect(result.b.map((player) => player.rating)).toEqual([null, null]);
  });
});

describe("cobertura de posiciones", () => {
  it("con doce y dos porteros da seis y seis con un portero por lado, en un óptimo local (AC-019)", () => {
    const result = autoBalanceTeams(
      TWELVE_WITH_TWO_GOALKEEPERS,
      ROLE_REQUIREMENTS,
    );

    expect(result.a).toHaveLength(6);
    expect(result.b).toHaveLength(6);
    expect(countCoverage(result.a, "goalkeeper")).toBe(1);
    expect(countCoverage(result.b, "goalkeeper")).toBe(1);
    expect(findBetterCoveredSwap(result, ["goalkeeper"])).toBeNull();
  });

  it("da al menos un defensa y un atacante a cada equipo cuando hay dos o más de cada uno", () => {
    const squad = [
      squadPlayer("Ana", 9, "defender"),
      squadPlayer("Bea", 8.5, "forward"),
      squadPlayer("Carla", 8, "forward"),
      squadPlayer("Dani", 7.5, "defender"),
      squadPlayer("Eva", 7),
      squadPlayer("Fer", 6.5),
      squadPlayer("Gabi", 6),
      squadPlayer("Hugo", 5.5),
    ];

    const result = autoBalanceTeams(squad, ROLE_REQUIREMENTS);

    expect(hasCoverage(result, "defender")).toBe(true);
    expect(hasCoverage(result, "forward")).toBe(true);
    expect(findBetterCoveredSwap(result, ["defender", "forward"])).toBeNull();
  });

  it("no exige portero por lado con un solo portero y reparte por puntaje", () => {
    const squad = [
      squadPlayer("Ana", 9, "goalkeeper"),
      squadPlayer("Bea", 8),
      squadPlayer("Carla", 7),
      squadPlayer("Dani", 6),
    ];

    const result = autoBalanceTeams(squad, ROLE_REQUIREMENTS);

    expect(namesOf(result.a)).toEqual(["Ana", "Dani"]);
    expect(calculateSplitTotals(result).ratingDifference).toBe(0);
  });

  it("no exige portero por lado sin ningún portero y reparte por puntaje", () => {
    const squad = [
      squadPlayer("Ana", 9, "defender"),
      squadPlayer("Bea", 8, "defender"),
      squadPlayer("Carla", 7, "forward"),
      squadPlayer("Dani", 6, "forward"),
    ];

    const result = autoBalanceTeams(squad, ROLE_REQUIREMENTS);

    expect(calculateSplitTotals(result).ratingDifference).toBe(0);
    expect(hasCoverage(result, "defender")).toBe(true);
  });

  it("separa a dos porteros aunque juntos equilibrarían mejor el puntaje", () => {
    const squad = [
      squadPlayer("Ana", 8, "goalkeeper"),
      squadPlayer("Bea", 8, "goalkeeper"),
      squadPlayer("Cris", 9),
      squadPlayer("Dani", 7),
    ];

    const result = autoBalanceTeams(squad, ROLE_REQUIREMENTS);

    expect(hasCoverage(result, "goalkeeper")).toBe(true);
    expect(calculateSplitTotals(result).ratingDifference).toBe(2);
  });

  it("no cuenta para ninguna cobertura a los jugadores sin función", () => {
    const squad = [
      squadPlayer("Ana", 8, null),
      squadPlayer("Bea", 8, null),
      squadPlayer("Cris", 9),
      squadPlayer("Dani", 7),
    ];

    const result = autoBalanceTeams(squad, ROLE_REQUIREMENTS);

    expect(namesOf(result.b)).toEqual(["Ana", "Bea"]);
    expect(calculateSplitTotals(result).ratingDifference).toBe(0);
  });
});

describe("intercambios", () => {
  it("mejora el reparto de la serpiente hasta que ningún intercambio acerca más el puntaje", () => {
    const squad = [10, 9, 8, 7, 6, 1].map((rating) =>
      squadPlayer(`P${rating}`, rating),
    );

    const result = autoBalanceTeams(squad, ROLE_REQUIREMENTS);

    expect(calculateSplitTotals(result).ratingDifference).toBe(1);
    expect(findBetterCoveredSwap(result, [])).toBeNull();
  });

  it("no rompe la cobertura al intercambiar", () => {
    const result = autoBalanceTeams(
      TWELVE_WITH_TWO_GOALKEEPERS,
      ROLE_REQUIREMENTS,
    );

    expect(hasCoverage(result, "goalkeeper")).toBe(true);
  });
});

describe("escuadra impar", () => {
  it("con trece da siete y seis, y el sobrante va al equipo b si a suma más (AC-019b)", () => {
    const squad = [squadPlayer("Top", 9), ...fivePointPlayers(12)];

    const result = autoBalanceTeams(squad, ROLE_REQUIREMENTS);

    expect(result.a).toHaveLength(6);
    expect(result.b).toHaveLength(7);
  });

  it("con trece da siete y seis, y el sobrante va al equipo a si b suma más (AC-019b)", () => {
    const squad = [
      squadPlayer("Uno", 9),
      squadPlayer("Dos", 9),
      squadPlayer("Tres", 9),
      ...fivePointPlayers(10),
    ];

    const result = autoBalanceTeams(squad, ROLE_REQUIREMENTS);

    expect(result.a).toHaveLength(7);
    expect(result.b).toHaveLength(6);
  });
});

describe("determinismo", () => {
  it("da el mismo reparto dos veces y sin importar el orden de entrada", () => {
    const shuffled = [...TWELVE_WITH_TWO_GOALKEEPERS].reverse();

    const first = autoBalanceTeams(
      TWELVE_WITH_TWO_GOALKEEPERS,
      ROLE_REQUIREMENTS,
    );
    const second = autoBalanceTeams(
      TWELVE_WITH_TWO_GOALKEEPERS,
      ROLE_REQUIREMENTS,
    );
    const fromShuffled = autoBalanceTeams(shuffled, ROLE_REQUIREMENTS);

    expect(second).toEqual(first);
    expect(fromShuffled).toEqual(first);
  });

  it("rompe los empates de OVR por nombre", () => {
    const squad = ["Dani", "Bea", "Ana", "Carla"].map((name) =>
      squadPlayer(name, 5),
    );

    const result = autoBalanceTeams(squad, ROLE_REQUIREMENTS);

    expect(namesOf(result.a)).toEqual(["Ana", "Dani"]);
    expect(namesOf(result.b)).toEqual(["Bea", "Carla"]);
  });

  it("rompe los empates de OVR y nombre por id", () => {
    const squad: SquadPlayer[] = [
      { userId: "id-2", fullName: "Sam", rating: 5, positionId: null },
      { userId: "id-1", fullName: "Sam", rating: 5, positionId: null },
    ];

    const result = autoBalanceTeams(squad, ROLE_REQUIREMENTS);

    expect(result.a.map((player) => player.userId)).toEqual(["id-1"]);
  });
});

describe("presupuesto de tiempo", () => {
  it("se queda por debajo de los 2 s de NFR-002 para dejar margen a la red", () => {
    expect(AUTO_BALANCE_TIME_BUDGET_MS).toBeLessThan(NFR_002_LIMIT_MS);
  });

  it("devuelve el mejor reparto alcanzado y avisa cuando se agota, sin lanzar", () => {
    let calls = 0;
    const clockThatJumpsPastBudget = (): number =>
      calls++ === 0 ? 0 : AUTO_BALANCE_TIME_BUDGET_MS;

    const result = autoBalanceTeams(
      TWELVE_WITH_TWO_GOALKEEPERS,
      ROLE_REQUIREMENTS,
      {
        now: clockThatJumpsPastBudget,
      },
    );

    expect(result.isTimeBudgetExhausted).toBe(true);
    expect(result.a).toHaveLength(6);
    expect(result.b).toHaveLength(6);
    expect(countCoverage(result.a, "goalkeeper")).toBe(2);
  });

  it("no avisa de nada cuando termina dentro del presupuesto", () => {
    const frozenClock = (): number => 0;

    const result = autoBalanceTeams(
      TWELVE_WITH_TWO_GOALKEEPERS,
      ROLE_REQUIREMENTS,
      {
        now: frozenClock,
      },
    );

    expect(result.isTimeBudgetExhausted).toBe(false);
    expect(result).toEqual(
      autoBalanceTeams(TWELVE_WITH_TWO_GOALKEEPERS, ROLE_REQUIREMENTS),
    );
  });

  it("reparte treinta jugadores en menos de 2 s en el percentil 95 (AC-019c)", () => {
    const coverages: (string | null)[] = [
      "goalkeeper",
      "defender",
      "forward",
      null,
      "defender",
      "forward",
    ];
    const squad = Array.from({ length: 30 }, (_, index) =>
      squadPlayer(
        `P${String(index).padStart(2, "0")}`,
        index % 7 === 0 ? null : ((index * 37) % 50) / 10 + 5,
        coverages[index % coverages.length],
      ),
    );

    const durations = Array.from({ length: PERFORMANCE_RUNS }, () => {
      const startedAt = performance.now();
      autoBalanceTeams(squad, ROLE_REQUIREMENTS);
      return performance.now() - startedAt;
    }).sort((left, right) => left - right);
    const p95 = durations[Math.ceil(PERFORMANCE_RUNS * P95) - 1];

    expect(p95).toBeLessThan(NFR_002_LIMIT_MS);
  });
});

describe("mínimos por posición del club (E34)", () => {
  const defenders = (count: number): SquadPlayer[] =>
    Array.from({ length: count }, (_, index) =>
      squadPlayer(`D${index}`, 9 - index, "defender"),
    );
  const twoDefenders: readonly PositionRequirement[] = [
    { positionId: "defender", minPerTeam: 2 },
  ];

  it("con mínimo 2 y cuatro defensas da al menos dos a cada equipo", () => {
    const squad = [...defenders(4), ...fivePointPlayers(4)];

    const result = autoBalanceTeams(squad, twoDefenders);

    expect(countCoverage(result.a, "defender")).toBeGreaterThanOrEqual(2);
    expect(countCoverage(result.b, "defender")).toBeGreaterThanOrEqual(2);
  });

  it("con mínimo 2 y tres defensas da al menos uno a cada equipo", () => {
    const squad = [...defenders(3), ...fivePointPlayers(5)];

    const result = autoBalanceTeams(squad, twoDefenders);

    expect(countCoverage(result.a, "defender")).toBeGreaterThanOrEqual(1);
    expect(countCoverage(result.b, "defender")).toBeGreaterThanOrEqual(1);
  });

  it("sin requisito para una posición, como la de mínimo 0, sus jugadores sólo cuentan para el nivel", () => {
    const squad = [
      squadPlayer("Ana", 8, "goalkeeper"),
      squadPlayer("Bea", 8, "goalkeeper"),
      squadPlayer("Cris", 9),
      squadPlayer("Dani", 7),
    ];

    const result = autoBalanceTeams(squad, []);

    expect(namesOf(result.b)).toEqual(["Ana", "Bea"]);
    expect(calculateSplitTotals(result).ratingDifference).toBe(0);
  });

  it("con escuadra impar da el de más al equipo de menor nivel sin romper un mínimo (AC-019b)", () => {
    const squad = [
      squadPlayer("Top", 9),
      squadPlayer("Gk1", 5, "goalkeeper"),
      squadPlayer("Gk2", 5, "goalkeeper"),
      ...fivePointPlayers(10),
    ];

    const result = autoBalanceTeams(squad, ROLE_REQUIREMENTS);

    expect(result.a).toHaveLength(6);
    expect(result.b).toHaveLength(7);
    expect(countCoverage(result.a, "goalkeeper")).toBe(1);
    expect(countCoverage(result.b, "goalkeeper")).toBe(1);
  });

  it("con mínimos de más de uno en varias posiciones a la vez reparte sin lanzar y sin un intercambio que deje menos huecos o menos diferencia", () => {
    const positions = ["gk", "def", "mid", "fwd", "wing"];
    const squad = Array.from({ length: 14 }, (_, index) =>
      squadPlayer(
        `P${String(index).padStart(2, "0")}`,
        ((index * 37) % 50) / 10 + 5,
        positions[index % 3],
      ),
    );
    const requirements = positions.map((positionId) => ({
      positionId,
      minPerTeam: 3,
    }));

    const result = autoBalanceTeams(squad, requirements);

    const meetsMinimums = (split: TeamSplit): boolean =>
      ["gk", "def", "mid"].every(
        (positionId) =>
          countCoverage(split.a, positionId) >= 2 &&
          countCoverage(split.b, positionId) >= 2,
      );
    expect(meetsMinimums(result)).toBe(true);
    expect(findBetterSwapKeeping(result, meetsMinimums)).toBeNull();
  });

  it("reparte treinta jugadores con cinco posiciones con mínimo dentro del presupuesto de 1,5 s (AC-019c)", () => {
    const positions = ["gk", "def", "mid", "fwd", "wing", null];
    const squad = Array.from({ length: 30 }, (_, index) =>
      squadPlayer(
        `P${String(index).padStart(2, "0")}`,
        index % 7 === 0 ? null : ((index * 37) % 50) / 10 + 5,
        positions[index % positions.length],
      ),
    );
    const requirements = positions.flatMap((positionId, index) =>
      positionId === null ? [] : [{ positionId, minPerTeam: 1 + (index % 2) }],
    );

    const durations = Array.from({ length: PERFORMANCE_RUNS }, () => {
      const startedAt = performance.now();
      const result = autoBalanceTeams(squad, requirements);
      expect(result.isTimeBudgetExhausted).toBe(false);
      return performance.now() - startedAt;
    }).sort((left, right) => left - right);
    const p95 = durations[Math.ceil(PERFORMANCE_RUNS * P95) - 1];

    expect(p95).toBeLessThan(AUTO_BALANCE_TIME_BUDGET_MS);
  });
});
