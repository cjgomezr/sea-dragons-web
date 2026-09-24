import { type Locale, otherLocale } from "@/lib/i18n/locale";

/**
 * Las posiciones de juego del club (#299, RF-7 del PRD de E18a), contadas sin
 * Supabase delante. Hasta aquí eran la constante `POSITIONS`; desde
 * `0025_club_positions.sql` las define cada club, con su orden y un nombre por
 * idioma.
 *
 * Archivar no borra (D3 del PRD): quien tenía la posición la conserva y la
 * sigue viendo, pero nadie más puede elegirla, y él tampoco una vez que la
 * cambie.
 */

/** Un nombre por idioma. Falta uno como mucho: la lectura rechaza una
 * posición sin ninguno. */
export type PositionNames = { readonly [L in Locale]: string | null };

export type ClubPosition = {
  readonly id: string;
  readonly names: PositionNames;
  readonly isArchived: boolean;
};

/** Todas las del club, archivadas incluidas, en el orden que decidió. */
export type ClubPositions = readonly ClubPosition[];

export type ClubPositionsGateway = {
  findClubPositions(clubId: string): Promise<ClubPositions>;
};

/** En el idioma de la pantalla, o en el otro si falta (D2 del PRD). */
export function positionName(names: PositionNames, locale: Locale): string {
  const name = names[locale] ?? names[otherLocale(locale)];
  if (name === null) {
    throw new Error("La posición no tiene nombre en ningún idioma.");
  }
  return name;
}

/** Lo que ofrece el desplegable: las activas, más la archivada de quien ya la
 * tiene, todas en el orden del club. */
export function offeredPositions(
  positions: ClubPositions,
  currentId: string | null,
): ClubPositions {
  return positions.filter(
    (position) => !position.isArchived || position.id === currentId,
  );
}

/** Ninguna, o una de las que se le ofrecen. Una posición de otro club no está
 * en el catálogo, así que tampoco pasa. */
export function isAcceptablePosition(
  positions: ClubPositions,
  choice: {
    readonly chosenId: string | null;
    readonly currentId: string | null;
  },
): boolean {
  return (
    choice.chosenId === null ||
    offeredPositions(positions, choice.currentId).some(
      (position) => position.id === choice.chosenId,
    )
  );
}

/** El lugar en el orden del club, que es el del directorio (FR-019). Una
 * posición que el club no tiene es una fila que la clave foránea compuesta de
 * `members` no dejaría existir: se falla en vez de colocarla en cualquier
 * sitio. */
export function positionRank(positions: ClubPositions, id: string): number {
  const rank = positions.findIndex((position) => position.id === id);
  if (rank === -1) {
    throw new Error(`El club no tiene la posición ${id}.`);
  }
  return rank;
}

/** La posición por su id, con la misma garantía que `positionRank`. */
export function findClubPosition(
  positions: ClubPositions,
  id: string,
): ClubPosition {
  const position = positions.find((candidate) => candidate.id === id);
  if (position === undefined) {
    throw new Error(`El club no tiene la posición ${id}.`);
  }
  return position;
}

export type CachedClubPositionsReaderOptions = {
  readonly fetchPositions: (clubId: string) => Promise<ClubPositions>;
  readonly timeToLiveMs: number;
  readonly now: () => number;
};

type CacheEntry = {
  readonly positions: Promise<ClubPositions>;
  readonly expiresAtMs: number;
};

/**
 * La misma caché que la marca (`club-brand.ts`): una consulta por caducidad y
 * no por visita, guardando la promesa para que las visitas simultáneas la
 * compartan. A diferencia de la marca no hay respaldo: sin catálogo no se
 * puede validar una posición, así que el fallo sube, y no se guarda para que
 * la siguiente lectura reintente.
 */
export function createCachedClubPositionsReader({
  fetchPositions,
  timeToLiveMs,
  now,
}: CachedClubPositionsReaderOptions): ClubPositionsGateway {
  const cache = new Map<string, CacheEntry>();

  function startFetch(clubId: string): CacheEntry {
    const entry: CacheEntry = {
      positions: fetchPositions(clubId).catch((error: unknown) => {
        if (cache.get(clubId) === entry) {
          cache.delete(clubId);
        }
        throw error;
      }),
      expiresAtMs: now() + timeToLiveMs,
    };
    return entry;
  }

  return {
    findClubPositions(clubId) {
      const cached = cache.get(clubId);
      if (cached !== undefined && now() < cached.expiresAtMs) {
        return cached.positions;
      }
      const entry = startFetch(clubId);
      cache.set(clubId, entry);
      return entry.positions;
    },
  };
}
