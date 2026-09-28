import type { PositionCoverage, SquadPlayer } from "@/lib/teams/squad";

/**
 * Un jugador de escuadra para los tests del team builder (E10). El id sale
 * del nombre para que los fallos se lean sin traducir uuids.
 */
export function squadPlayer(
  fullName: string,
  rating: number | null,
  coverage: PositionCoverage | null = null,
): SquadPlayer {
  return { userId: `id-${fullName}`, fullName, rating, coverage };
}

export function namesOf(players: readonly SquadPlayer[]): string[] {
  return players.map((player) => player.fullName);
}
