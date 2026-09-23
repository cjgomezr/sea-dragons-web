import { DEFAULT_CLUB_SLUG } from "@/lib/auth/supabase-auth-gateways";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import {
  type ClubBrand,
  type ClubBrandRow,
  createCachedClubBrandReader,
} from "./club-brand";

type Environment = Readonly<Record<string, string | undefined>>;

const CLUBS_TABLE = "clubs";
const BRAND_COLUMNS = "name, initials";

/** Cuánto vive la marca en la memoria del servidor. Guardar un cambio la
 * invalida en el proceso que lo guarda; este plazo acota lo que tarda en verlo
 * cualquier otra instancia del servidor, que no se entera de la invalidación. */
const CLUB_BRAND_TIME_TO_LIVE_MS = 5 * 60 * 1000;

/**
 * Lee la marca del club de esta instalación. Va con la llave de servicio, como
 * `findClubIdBySlug`, porque el club se encuentra por su `slug` y
 * `0022_club_brand.sql` no deja a `anon` leer esa columna. Sólo pide el nombre
 * y las iniciales, y corre en el servidor. Lanza si Supabase no contesta o no
 * está configurado; decidir qué se pinta entonces es cosa de la caché.
 */
export async function fetchClubBrandRow(
  env: Environment,
): Promise<ClubBrandRow> {
  const client = createServiceRoleClient(env);
  const { data, error } = await client
    .from(CLUBS_TABLE)
    .select(BRAND_COLUMNS)
    .eq("slug", DEFAULT_CLUB_SLUG)
    .single<ClubBrandRow>();
  if (error) {
    throw new Error(`No se pudo leer la marca del club: ${error.message}`);
  }
  return data;
}

const clubBrandReader = createCachedClubBrandReader({
  fetchRow: () => fetchClubBrandRow(process.env),
  reportFailure: (error) => {
    console.error(
      "[marca] no se pudo leer la marca del club; se pinta la de respaldo:",
      error,
    );
  },
  timeToLiveMs: CLUB_BRAND_TIME_TO_LIVE_MS,
  now: Date.now,
});

/** La marca con la que se pinta cada pantalla. Nunca lanza: si la base no
 * contesta, devuelve el respaldo y deja el fallo en el registro. */
export function readClubBrand(): Promise<ClubBrand> {
  return clubBrandReader.read();
}

/** Para quien guarda un cambio de la marca: la siguiente visita lo ve sin
 * esperar a que caduque la caché (RF-2). */
export function invalidateClubBrand(): void {
  clubBrandReader.invalidate();
}
