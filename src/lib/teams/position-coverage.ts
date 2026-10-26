/**
 * Los mínimos por posición de FR-046 (RF-2 del PRD de E34): restricción dura
 * donde la escuadra la permita. Una posición con mínimo N exige a cada
 * equipo `min(N, ⌊C / 2⌋)` de ella, siendo C los que hay en la escuadra: con
 * N = 1 es la regla de los tres roles que fijó C2.
 */

import type { PositionRequirement, SquadPlayer, TeamSplit } from "./squad";

/** Lo que se puede dar a cada equipo es la mitad de los que hay. */
const TEAMS_IN_SPLIT = 2;

type PositionedPlayer = Pick<SquadPlayer, "positionId">;

function countPosition(
  team: readonly PositionedPlayer[],
  positionId: string,
): number {
  return team.filter((player) => player.positionId === positionId).length;
}

/** Lo que se exige a cada equipo (D5): el mínimo, o la mitad de los que hay
 * en la escuadra si no llegan. */
function requiredPerTeam(inSquad: number, minPerTeam: number): number {
  return Math.min(minPerTeam, Math.floor(inSquad / TEAMS_IN_SPLIT));
}

function countRequirementGaps(
  split: TeamSplit,
  { positionId, minPerTeam }: PositionRequirement,
): number {
  const inSquad =
    countPosition(split.a, positionId) + countPosition(split.b, positionId);
  const required = requiredPerTeam(inSquad, minPerTeam);
  return [split.a, split.b].reduce(
    (gaps, team) =>
      gaps + Math.max(0, required - countPosition(team, positionId)),
    0,
  );
}

/**
 * Cuántos huecos tiene el reparto: cada jugador que le falta a un equipo
 * para su mínimo cuenta uno. Cero es un reparto que cumple.
 */
export function countCoverageGaps(
  split: TeamSplit,
  requirements: readonly PositionRequirement[],
): number {
  return requirements.reduce(
    (gaps, requirement) => gaps + countRequirementGaps(split, requirement),
    0,
  );
}

/** Los mínimos que sirve la API (`{ id, minPerTeam }`) en la forma que
 * cuenta el reparto, igual en el servidor y en la pantalla. */
export function toPositionRequirements(
  positions: readonly { readonly id: string; readonly minPerTeam: number }[],
): readonly PositionRequirement[] {
  return positions.map(({ id, minPerTeam }) => ({
    positionId: id,
    minPerTeam,
  }));
}

/** Una ficha de la tarjeta de un equipo (RF-5 del PRD de E34): cuántos
 * tiene de la posición y cuántos le faltan para su mínimo. */
export type PositionTally = {
  readonly count: number;
  readonly missingCount: number;
};

/**
 * La ficha de una posición en la tarjeta de un equipo. Sólo le falta algo a
 * un equipo con jugadores, y sólo lo que la escuadra permitía cumplir (D8):
 * con un portero en toda la escuadra no se le pide a nadie.
 */
export function tallyPosition(
  team: readonly PositionedPlayer[],
  squad: readonly PositionedPlayer[],
  { positionId, minPerTeam }: PositionRequirement,
): PositionTally {
  const count = countPosition(team, positionId);
  const required = requiredPerTeam(
    countPosition(squad, positionId),
    minPerTeam,
  );
  const missingCount = team.length === 0 ? 0 : Math.max(0, required - count);
  return { count, missingCount };
}
