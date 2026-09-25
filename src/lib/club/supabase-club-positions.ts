import type { SupabaseClient } from "@supabase/supabase-js";
import { isLocale } from "@/lib/i18n/locale";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import {
  type ClubPosition,
  type ClubPositions,
  type ClubPositionsGateway,
  type PositionChoicesGateways,
  type PositionNames,
  createCachedClubPositionsReader,
} from "./club-positions";

/**
 * Adaptador entre las posiciones del club (#299) y Supabase: las lee de
 * `club_positions` con sus nombres de `club_position_names`
 * (`0025_club_positions.sql`).
 *
 * Sirve con cualquier cliente: la RLS deja a un miembro leer las de su club, y
 * la llave de servicio las de cualquiera, así que quien llama filtra por el
 * club que averiguó de la sesión.
 */

const POSITIONS_TABLE = "club_positions";
const POSITIONS_COLUMNS =
  "id, archivedAt:archived_at, names:club_position_names(locale, name)";

type PositionRow = {
  readonly id: string;
  readonly archivedAt: string | null;
  readonly names: readonly { readonly locale: string; readonly name: string }[];
};

/** El `check` de `0025` sólo deja los idiomas de la aplicación. Sin ningún
 * nombre la posición no se puede pintar: se falla en vez de servirla. */
function toPositionNames(row: PositionRow): PositionNames {
  const names: Record<keyof PositionNames, string | null> = {
    en: null,
    es: null,
  };
  for (const { locale, name } of row.names) {
    if (!isLocale(locale)) {
      throw new Error(
        `La posición ${row.id} trae un nombre en ${locale}, que la aplicación no habla.`,
      );
    }
    names[locale] = name;
  }
  if (names.en === null && names.es === null) {
    throw new Error(`La posición ${row.id} no tiene nombre en ningún idioma.`);
  }
  return names;
}

function toClubPosition(row: PositionRow): ClubPosition {
  return {
    id: row.id,
    names: toPositionNames(row),
    isArchived: row.archivedAt !== null,
  };
}

/** En el orden del club. Un empate de `sort_order` lo deshace el orden de
 * creación, como dice `0025`, y el id lo deja fijo entre lecturas. */
export async function fetchClubPositions(
  client: SupabaseClient,
  clubId: string,
): Promise<ClubPositions> {
  const { data, error } = await client
    .from(POSITIONS_TABLE)
    .select(POSITIONS_COLUMNS)
    .eq("club_id", clubId)
    .order("sort_order")
    .order("created_at")
    .order("id")
    .overrideTypes<PositionRow[], { merge: false }>();
  if (error) {
    throw new Error(
      `No se pudieron leer las posiciones del club ${clubId}: ${error.message}`,
    );
  }
  return data.map(toClubPosition);
}

/** Sin caché, para quien necesita ver un cambio en el acto: los tests de
 * integración que archivan una posición y la prueban enseguida. */
export function createClubPositionsGateway(
  client: SupabaseClient,
): ClubPositionsGateway {
  // Sin caché no hay nada viejo: se lee siempre, y las pedidas sobran.
  return { findClubPositions: (clubId) => fetchClubPositions(client, clubId) };
}

/** Lo mismo que la marca: un cambio guardado en otra instancia del servidor
 * tarda como mucho esto en verse. En la que lo guardó se ve en el acto, porque
 * la pantalla del Admin (#300) invalida la caché. */
const CLUB_POSITIONS_TIME_TO_LIVE_MS = 5 * 60 * 1000;

const cachedClubPositionsReader = createCachedClubPositionsReader({
  fetchPositions: (clubId) =>
    fetchClubPositions(createServiceRoleClient(process.env), clubId),
  timeToLiveMs: CLUB_POSITIONS_TIME_TO_LIVE_MS,
  now: Date.now,
});

/** El catálogo con el que trabajan las pantallas y la API, desde la caché. Va
 * con la llave de servicio porque la caché la comparten todas las visitas. */
export const cachedClubPositions: ClubPositionsGateway =
  cachedClubPositionsReader;

/** Para quien guarda un cambio del catálogo: el perfil y el directorio lo ven
 * en la siguiente visita, como la marca con `invalidateClubBrand`. */
export function invalidateClubPositions(): void {
  cachedClubPositionsReader.invalidate();
}

type Environment = Readonly<Record<string, string | undefined>>;

export type PositionChoicesGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: PositionChoicesGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición de `GET /api/v1/club/positions`. Con la llave de
 * servicio, como el directorio: la fila de quien llama dice su club. */
export function createSupabasePositionChoicesGateways(
  env: Environment,
): PositionChoicesGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: {
      members: createRoleRequestGateways(createServiceRoleClient(env)).members,
      positions: cachedClubPositions,
    },
  };
}
