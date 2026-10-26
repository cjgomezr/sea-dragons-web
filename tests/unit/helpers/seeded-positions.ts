import type { ClubPosition } from "@/lib/club/club-positions";

/**
 * Las tres posiciones que `0025_club_positions.sql` siembra en cada club, con
 * ids fijos, para los tests que no hablan con la base (#299). Van en el orden
 * del club, con el mínimo y las abreviaturas que `0081` les da.
 */
export const GOALKEEPER: ClubPosition = {
  id: "90000000-0000-4000-8000-000000000001",
  names: { en: "Goalkeeper", es: "Portería" },
  isArchived: false,
  minPerTeam: 1,
  shortNames: { en: "GK", es: "POR" },
};

export const DEFENDER: ClubPosition = {
  id: "90000000-0000-4000-8000-000000000002",
  names: { en: "Defender", es: "Defensa" },
  isArchived: false,
  minPerTeam: 1,
  shortNames: { en: "DEF", es: "DEF" },
};

export const FORWARD: ClubPosition = {
  id: "90000000-0000-4000-8000-000000000003",
  names: { en: "Forward", es: "Ataque" },
  isArchived: false,
  minPerTeam: 1,
  shortNames: { en: "ATT", es: "ATA" },
};

export const SEEDED_POSITIONS = [GOALKEEPER, DEFENDER, FORWARD] as const;

/** Una posición tal como la sirve el directorio: sin la marca de archivo. */
export function asDirectoryPosition({ id, names }: ClubPosition): {
  readonly id: string;
  readonly names: ClubPosition["names"];
} {
  return { id, names };
}
