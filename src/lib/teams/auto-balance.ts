/**
 * El auto-balance de FR-046 (RF-5 del PRD de E10) con el algoritmo que fijó
 * C2 en `docs/preguntas-abiertas.md`: orden descendente por OVR, reparto en
 * serpiente, y después el mejor intercambio de a un par, repetido hasta que
 * ninguno mejore o se agote el presupuesto de tiempo. Pura y determinista:
 * la misma escuadra da siempre el mismo reparto.
 */

import {
  type SquadPlayer,
  type TeamSplit,
  sortByRanking,
  sumRatingTenths,
} from "./squad";
import { suggestSwap, swapPlayers } from "./swap-suggestion";

/**
 * NFR-002 pide respuesta en menos de 2 s; el cálculo se queda con 1,5 y deja
 * el resto para la red y la base.
 */
export const AUTO_BALANCE_TIME_BUDGET_MS = 1_500;

/** En la serpiente a-b-b-a, las posiciones 0 y 3 de cada vuelta van al a. */
const SNAKE_ROUND_LENGTH = 4;
const SNAKE_TURNS_FOR_A: readonly number[] = [0, 3];

export type AutoBalanceOptions = {
  /** El reloj en milisegundos; se inyecta para probar el corte sin esperar. */
  readonly now?: () => number;
};

export type AutoBalanceResult = TeamSplit & {
  readonly mode: "auto";
  readonly isTimeBudgetExhausted: boolean;
  /** FR-086: los que entraron con el 5,0 virtual, para marcarlos al enseñar. */
  readonly unratedPlayerIds: readonly string[];
};

type ImprovedSplit = {
  readonly split: TeamSplit;
  readonly isTimeBudgetExhausted: boolean;
};

function readSystemClock(): number {
  return performance.now();
}

/**
 * Reparte las parejas en serpiente. Con escuadra impar el último sobra y va
 * al equipo de menor puntaje combinado (AC-019b); en el empate, al a, que es
 * también donde cae el único jugador de una escuadra de uno.
 */
function dealSnake(ranked: readonly SquadPlayer[]): TeamSplit {
  const paired = ranked.slice(0, ranked.length - (ranked.length % 2));
  const leftovers = ranked.slice(paired.length);
  const isTurnForA = (index: number): boolean =>
    SNAKE_TURNS_FOR_A.includes(index % SNAKE_ROUND_LENGTH);
  const a = paired.filter((_, index) => isTurnForA(index));
  const b = paired.filter((_, index) => !isTurnForA(index));
  return sumRatingTenths(a) <= sumRatingTenths(b)
    ? { a: [...a, ...leftovers], b }
    : { a, b: [...b, ...leftovers] };
}

/**
 * Aplica el mejor intercambio mientras exista. Si se agota el presupuesto,
 * devuelve el reparto alcanzado y lo dice: cortar nunca es un error.
 */
function improveBySwaps(initial: TeamSplit, now: () => number): ImprovedSplit {
  const startedAt = now();
  let split = initial;
  for (;;) {
    if (now() - startedAt >= AUTO_BALANCE_TIME_BUDGET_MS) {
      return { split, isTimeBudgetExhausted: true };
    }
    const swap = suggestSwap(split);
    if (swap === null) {
      return { split, isTimeBudgetExhausted: false };
    }
    split = swapPlayers(split, swap.playerFromA, swap.playerFromB);
  }
}

export function autoBalanceTeams(
  squad: readonly SquadPlayer[],
  options: AutoBalanceOptions = {},
): AutoBalanceResult {
  const ranked = sortByRanking(squad);
  const { split, isTimeBudgetExhausted } = improveBySwaps(
    dealSnake(ranked),
    options.now ?? readSystemClock,
  );
  return {
    a: sortByRanking(split.a),
    b: sortByRanking(split.b),
    mode: "auto",
    isTimeBudgetExhausted,
    unratedPlayerIds: ranked
      .filter((player) => player.rating === null)
      .map((player) => player.userId),
  };
}
