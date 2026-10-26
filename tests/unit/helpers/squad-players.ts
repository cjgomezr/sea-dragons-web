import type { PositionRequirement, SquadPlayer } from "@/lib/teams/squad";

/**
 * Un jugador de escuadra para los tests del team builder (E10). El id sale
 * del nombre para que los fallos se lean sin traducir uuids, y la posición
 * es un id cualquiera: los tests de siempre usan los de los tres roles.
 */
export function squadPlayer(
  fullName: string,
  rating: number | null,
  positionId: string | null = null,
): SquadPlayer {
  return { userId: `id-${fullName}`, fullName, rating, positionId };
}

export function namesOf(players: readonly SquadPlayer[]): string[] {
  return players.map((player) => player.fullName);
}

/** Lo que deja la migración de #885: mínimo 1 en las tres posiciones con
 * rol. Con estos requisitos el reparto tiene que salir como antes (E34). */
export const ROLE_REQUIREMENTS: readonly PositionRequirement[] = [
  { positionId: "goalkeeper", minPerTeam: 1 },
  { positionId: "defender", minPerTeam: 1 },
  { positionId: "forward", minPerTeam: 1 },
];
