import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
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

/** Una posición tal como la pinta quien no decide si está archivada: el
 * directorio y los desplegables que sólo ofrecen activas. */
export type NamedPosition = Pick<ClubPosition, "id" | "names">;

/** Todas las del club, archivadas incluidas, en el orden que decidió. */
export type ClubPositions = readonly ClubPosition[];

export type ClubPositionsGateway = {
  /** `referencedIds` son las posiciones que quien llama necesita resolver,
   * como las que tienen los socios que va a pintar. Una caché que no las
   * conoce está vieja y vuelve a leer. */
  findClubPositions(
    clubId: string,
    referencedIds: readonly string[],
  ): Promise<ClubPositions>;
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

function includesAll(
  positions: ClubPositions,
  referencedIds: readonly string[],
): boolean {
  return referencedIds.every((id) =>
    positions.some((position) => position.id === id),
  );
}

/**
 * La misma caché que la marca (`club-brand.ts`): una consulta por caducidad y
 * no por visita, guardando la promesa para que las visitas simultáneas la
 * compartan. A diferencia de la marca no hay respaldo: sin catálogo no se
 * puede validar una posición, así que el fallo sube, y no se guarda para que
 * la siguiente lectura reintente.
 *
 * Una posición creada en otra instancia del servidor no invalida ésta. Si la
 * piden y no está, se vuelve a leer en vez de esperar a que caduque: si no, el
 * directorio no sabría pintar a quien ya la tiene.
 */
export type CachedClubPositionsReader = ClubPositionsGateway & {
  /** Para quien guarda un cambio del catálogo (#300): la siguiente lectura
   * va a la base sin esperar a que caduque. */
  invalidate(): void;
};

export function createCachedClubPositionsReader({
  fetchPositions,
  timeToLiveMs,
  now,
}: CachedClubPositionsReaderOptions): CachedClubPositionsReader {
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

  function refresh(clubId: string): Promise<ClubPositions> {
    const entry = startFetch(clubId);
    cache.set(clubId, entry);
    return entry.positions;
  }

  return {
    async findClubPositions(clubId, referencedIds) {
      const cached = cache.get(clubId);
      if (cached === undefined || now() >= cached.expiresAtMs) {
        return refresh(clubId);
      }
      const positions = await cached.positions;
      return includesAll(positions, referencedIds)
        ? positions
        : refresh(clubId);
    },
    invalidate() {
      cache.clear();
    },
  };
}

export type PositionChoicesGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly positions: ClubPositionsGateway;
};

/** Las que se pueden dar a quien todavía no tiene ninguna, en el club de
 * quien pregunta: las activas, en su orden. Es el desplegable del alta de un
 * miembro. */
export async function listPositionChoices(
  gateways: PositionChoicesGateways,
  callerId: string,
): Promise<readonly NamedPosition[]> {
  const caller = await gateways.members.findRoleRequestMember(callerId);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  const positions = await gateways.positions.findClubPositions(
    caller.clubId,
    [],
  );
  return offeredPositions(positions, null).map(({ id, names }) => ({
    id,
    names,
  }));
}
