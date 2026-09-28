/**
 * La cobertura de posiciones de FR-046 (C2 en `docs/preguntas-abiertas.md`):
 * restricción dura donde la escuadra la permita. Una función con dos o más
 * jugadores exige al menos uno por equipo; con uno o ninguno no se exige.
 */

import type { PositionCoverage, SquadPlayer, TeamSplit } from "./squad";

const COVERAGE_FUNCTIONS: readonly PositionCoverage[] = [
  "goalkeeper",
  "defender",
  "forward",
];

/** Con dos se puede dar uno a cada equipo; con menos, no. */
const MIN_PLAYERS_TO_REQUIRE_COVERAGE = 2;

function hasCoverage(
  team: readonly SquadPlayer[],
  coverage: PositionCoverage,
): boolean {
  return team.some((player) => player.coverage === coverage);
}

function countSquadCoverage(
  split: TeamSplit,
  coverage: PositionCoverage,
): number {
  return [...split.a, ...split.b].filter(
    (player) => player.coverage === coverage,
  ).length;
}

/**
 * Cuántos huecos de cobertura tiene el reparto: cada función exigida que
 * falta en un equipo cuenta uno. Cero es un reparto que cumple.
 */
export function countCoverageGaps(split: TeamSplit): number {
  return COVERAGE_FUNCTIONS.filter(
    (coverage) =>
      countSquadCoverage(split, coverage) >= MIN_PLAYERS_TO_REQUIRE_COVERAGE,
  ).reduce(
    (gaps, coverage) =>
      gaps +
      Number(!hasCoverage(split.a, coverage)) +
      Number(!hasCoverage(split.b, coverage)),
    0,
  );
}
