/**
 * La sugerencia de intercambio (FR-047, RF-6 del PRD de E10), que es también
 * el paso de mejora del auto-balance: de todos los intercambios de a un par,
 * el que más mejora el reparto, o ninguno.
 *
 * "Mejorar" tiene prioridad fija (C2): primero cerrar huecos de cobertura,
 * después acercar el puntaje. Un intercambio que abra un hueco nunca sale
 * mejor, por mucho que acerque el puntaje.
 */

import { countCoverageGaps } from "./position-coverage";
import {
  type SquadPlayer,
  type TeamSplit,
  sortByRanking,
  sumRatingTenths,
  tenthsToRating,
} from "./squad";

export type SwapImprovement = "coverage" | "rating-difference";

export type SwapSuggestion = {
  readonly playerFromA: SquadPlayer;
  readonly playerFromB: SquadPlayer;
  readonly improvement: SwapImprovement;
  readonly ratingDifferenceAfter: number;
};

type SplitScore = {
  readonly coverageGaps: number;
  readonly differenceTenths: number;
};

type ScoredSwap = {
  readonly playerFromA: SquadPlayer;
  readonly playerFromB: SquadPlayer;
  readonly score: SplitScore;
};

function scoreSplit(split: TeamSplit): SplitScore {
  return {
    coverageGaps: countCoverageGaps(split),
    differenceTenths: Math.abs(
      sumRatingTenths(split.a) - sumRatingTenths(split.b),
    ),
  };
}

function isBetterScore(candidate: SplitScore, current: SplitScore): boolean {
  if (candidate.coverageGaps !== current.coverageGaps) {
    return candidate.coverageGaps < current.coverageGaps;
  }
  return candidate.differenceTenths < current.differenceTenths;
}

export function swapPlayers(
  split: TeamSplit,
  playerFromA: SquadPlayer,
  playerFromB: SquadPlayer,
): TeamSplit {
  return {
    a: split.a.map((player) =>
      player.userId === playerFromA.userId ? playerFromB : player,
    ),
    b: split.b.map((player) =>
      player.userId === playerFromB.userId ? playerFromA : player,
    ),
  };
}

/**
 * Recorre los pares en orden de ranking y sólo reemplaza al mejor con uno
 * estrictamente mejor: así el empate lo gana siempre el mismo par, llegue
 * como llegue la lista.
 */
function findBestSwap(split: TeamSplit): ScoredSwap | null {
  let best: ScoredSwap | null = null;
  let bestScore = scoreSplit(split);
  const rankedB = sortByRanking(split.b);
  for (const playerFromA of sortByRanking(split.a)) {
    for (const playerFromB of rankedB) {
      const score = scoreSplit(swapPlayers(split, playerFromA, playerFromB));
      if (isBetterScore(score, bestScore)) {
        best = { playerFromA, playerFromB, score };
        bestScore = score;
      }
    }
  }
  return best;
}

export function suggestSwap(split: TeamSplit): SwapSuggestion | null {
  const best = findBestSwap(split);
  if (best === null) {
    return null;
  }
  const closesCoverageGap = best.score.coverageGaps < countCoverageGaps(split);
  return {
    playerFromA: best.playerFromA,
    playerFromB: best.playerFromB,
    improvement: closesCoverageGap ? "coverage" : "rating-difference",
    ratingDifferenceAfter: tenthsToRating(best.score.differenceTenths),
  };
}
