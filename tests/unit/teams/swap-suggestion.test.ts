import { describe, expect, it } from "vitest";
import { suggestSwap, swapPlayers } from "@/lib/teams/swap-suggestion";
import {
  ROLE_REQUIREMENTS,
  namesOf,
  squadPlayer,
} from "../helpers/squad-players";

/**
 * La sugerencia de intercambio (FR-047, RF-6 del PRD de E10): de todos los
 * intercambios de a un par, el que más mejora el reparto. Arreglar la
 * cobertura pesa más que acercar el puntaje, y un intercambio que rompa la
 * cobertura no se sugiere nunca.
 */

describe("la sugerencia de intercambio", () => {
  it("sugiere el par que más reduce la diferencia de puntaje", () => {
    const split = {
      a: [squadPlayer("Ana", 9), squadPlayer("Bea", 8), squadPlayer("Cris", 7)],
      b: [squadPlayer("Dani", 6), squadPlayer("Eva", 5), squadPlayer("Fer", 1)],
    };

    const suggestion = suggestSwap(split, ROLE_REQUIREMENTS);

    expect(suggestion).toEqual({
      playerFromA: squadPlayer("Cris", 7),
      playerFromB: squadPlayer("Fer", 1),
      improvement: "rating-difference",
      ratingDifferenceAfter: 0,
    });
  });

  it("antepone el par que arregla la cobertura al que acerca más el puntaje", () => {
    const split = {
      a: [
        squadPlayer("Ana", 9, "goalkeeper"),
        squadPlayer("Bea", 8, "goalkeeper"),
        squadPlayer("Cris", 7),
      ],
      b: [squadPlayer("Dani", 6), squadPlayer("Eva", 5), squadPlayer("Fer", 1)],
    };

    const suggestion = suggestSwap(split, ROLE_REQUIREMENTS);

    expect(suggestion).toEqual({
      playerFromA: squadPlayer("Bea", 8, "goalkeeper"),
      playerFromB: squadPlayer("Fer", 1),
      improvement: "coverage",
      ratingDifferenceAfter: 2,
    });
  });

  it("no sugiere un par que deje a un equipo sin portero, aunque acerque el puntaje", () => {
    const split = {
      a: [squadPlayer("Ana", 9, "goalkeeper"), squadPlayer("Bea", 6)],
      b: [squadPlayer("Carla", 5, "goalkeeper"), squadPlayer("Dani", 8)],
    };

    expect(suggestSwap(split, ROLE_REQUIREMENTS)).toBeNull();
  });

  it("no sugiere nada cuando ningún par mejora el reparto", () => {
    const split = {
      a: [squadPlayer("Ana", 9), squadPlayer("Dani", 6)],
      b: [squadPlayer("Bea", 8), squadPlayer("Carla", 7)],
    };

    expect(suggestSwap(split, ROLE_REQUIREMENTS)).toBeNull();
  });

  it("no sugiere nada con un equipo vacío", () => {
    const split = { a: [squadPlayer("Ana", 9)], b: [] };

    expect(suggestSwap(split, ROLE_REQUIREMENTS)).toBeNull();
  });

  it("elige el mismo par sin importar el orden en que llegan los jugadores", () => {
    const players = {
      a: [squadPlayer("Ana", 9), squadPlayer("Bea", 7)],
      b: [squadPlayer("Carla", 6), squadPlayer("Dani", 6)],
    };
    const reversed = {
      a: [...players.a].reverse(),
      b: [...players.b].reverse(),
    };

    expect(suggestSwap(reversed, ROLE_REQUIREMENTS)).toEqual(
      suggestSwap(players, ROLE_REQUIREMENTS),
    );
    expect(suggestSwap(players, ROLE_REQUIREMENTS)?.playerFromB.fullName).toBe(
      "Carla",
    );
  });
});

describe("aplicar un intercambio", () => {
  it("cambia a los dos jugadores de equipo y deja al resto donde estaba", () => {
    const ana = squadPlayer("Ana", 9);
    const dani = squadPlayer("Dani", 4);
    const split = {
      a: [ana, squadPlayer("Bea", 8)],
      b: [squadPlayer("Carla", 5), dani],
    };

    const swapped = swapPlayers(split, ana, dani);

    expect(namesOf(swapped.a)).toEqual(["Dani", "Bea"]);
    expect(namesOf(swapped.b)).toEqual(["Carla", "Ana"]);
  });
});

describe("la sugerencia con mínimos de más de uno (E34)", () => {
  const twoDefenders = [{ positionId: "defender", minPerTeam: 2 }];

  it("propone el par que cierra un mínimo que la escuadra permite cumplir", () => {
    const split = {
      a: [
        squadPlayer("Ana", 9, "defender"),
        squadPlayer("Bea", 8, "defender"),
        squadPlayer("Cris", 7, "defender"),
      ],
      b: [
        squadPlayer("Dani", 6, "defender"),
        squadPlayer("Eva", 5),
        squadPlayer("Fer", 1),
      ],
    };

    const suggestion = suggestSwap(split, twoDefenders);

    expect(suggestion?.improvement).toBe("coverage");
    expect(suggestion?.playerFromB.positionId).toBeNull();
    expect(suggestion?.playerFromA.positionId).toBe("defender");
  });

  it("con los mínimos cumplidos propone el que más acerca el nivel sin romper ninguno", () => {
    const split = {
      a: [
        squadPlayer("Ana", 9, "defender"),
        squadPlayer("Bea", 8, "defender"),
        squadPlayer("Cris", 7),
      ],
      b: [
        squadPlayer("Dani", 6, "defender"),
        squadPlayer("Eva", 5, "defender"),
        squadPlayer("Fer", 1),
      ],
    };

    const suggestion = suggestSwap(split, twoDefenders);

    expect(suggestion).toEqual({
      playerFromA: squadPlayer("Cris", 7),
      playerFromB: squadPlayer("Fer", 1),
      improvement: "rating-difference",
      ratingDifferenceAfter: 0,
    });
  });
});
