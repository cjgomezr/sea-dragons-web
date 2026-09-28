/**
 * La escuadra que reparte el team builder (E10): quién juega, con qué OVR y
 * qué función cubre su posición. Sin Supabase delante: leer la escuadra de la
 * base es cosa del handler.
 */

export type PositionCoverage = "goalkeeper" | "defender" | "forward";

export type SquadPlayer = {
  readonly userId: string;
  readonly fullName: string;
  /** El OVR de E9, ya redondeado a un decimal; `null` es "sin evaluar". */
  readonly rating: number | null;
  /** `null` si no tiene posición o su posición no lleva función. */
  readonly coverage: PositionCoverage | null;
};

export type TeamSplit = {
  readonly a: readonly SquadPlayer[];
  readonly b: readonly SquadPlayer[];
};

/** FR-086: el no evaluado cuenta con 5,0 al repartir, sin persistir nada. */
export const UNRATED_PLAYER_RATING = 5;

const TENTHS_PER_UNIT = 10;

/**
 * El OVR en décimas enteras. Se suma en enteros porque en coma flotante
 * 8.1 + 8.2 da 16.299999…, y esa cola cambiaría qué equipo "suma más".
 */
export function ratingInTenths(player: SquadPlayer): number {
  return Math.round((player.rating ?? UNRATED_PLAYER_RATING) * TENTHS_PER_UNIT);
}

export function sumRatingTenths(players: readonly SquadPlayer[]): number {
  return players.reduce((total, player) => total + ratingInTenths(player), 0);
}

export function tenthsToRating(tenths: number): number {
  return tenths / TENTHS_PER_UNIT;
}

/**
 * OVR descendente, y los empates por nombre y luego por id. Compara por
 * código de carácter y no con `localeCompare`: el orden no debe depender de
 * la configuración regional del servidor, o el mismo reparto saldría distinto.
 */
function compareByRanking(left: SquadPlayer, right: SquadPlayer): number {
  const byRating = ratingInTenths(right) - ratingInTenths(left);
  if (byRating !== 0) {
    return byRating;
  }
  if (left.fullName !== right.fullName) {
    return left.fullName < right.fullName ? -1 : 1;
  }
  if (left.userId === right.userId) {
    return 0;
  }
  return left.userId < right.userId ? -1 : 1;
}

export function sortByRanking(players: readonly SquadPlayer[]): SquadPlayer[] {
  return [...players].sort(compareByRanking);
}
