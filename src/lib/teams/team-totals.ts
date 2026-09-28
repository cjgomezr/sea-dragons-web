/**
 * Los totales del reparto (FR-045, RF-4 del PRD de E10): lo que la barra del
 * builder enseña de cada equipo y la diferencia entre los dos.
 */

import {
  type SquadPlayer,
  type TeamSplit,
  sumRatingTenths,
  tenthsToRating,
} from "./squad";

export type TeamTotals = {
  readonly playerCount: number;
  readonly combinedRating: number;
  /** La fuerza media a un decimal; `null` en un equipo sin jugadores. */
  readonly averageRating: number | null;
};

export type SplitTotals = {
  readonly a: TeamTotals;
  readonly b: TeamTotals;
  readonly ratingDifference: number;
};

export function calculateSplitTotals(split: TeamSplit): SplitTotals {
  const differenceTenths = Math.abs(
    sumRatingTenths(split.a) - sumRatingTenths(split.b),
  );
  return {
    a: calculateTeamTotals(split.a),
    b: calculateTeamTotals(split.b),
    ratingDifference: tenthsToRating(differenceTenths),
  };
}

/**
 * La media se redondea como el OVR: la que cae justo en la mitad sube. Se
 * divide la suma en décimas, no la media ya calculada, por la misma razón
 * que en `calculateOverallRating`.
 */
function calculateTeamTotals(players: readonly SquadPlayer[]): TeamTotals {
  const combinedTenths = sumRatingTenths(players);
  const averageRating =
    players.length === 0
      ? null
      : tenthsToRating(Math.round(combinedTenths / players.length));
  return {
    playerCount: players.length,
    combinedRating: tenthsToRating(combinedTenths),
    averageRating,
  };
}
