import { DEFAULT_CLUB_SLUG } from "@/lib/auth/supabase-auth-gateways";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import {
  type ClubBrand,
  type ClubBrandRow,
  createCachedClubBrandReader,
} from "./club-brand";
import { type SignInTextRow, toSignInTexts } from "./sign-in-texts";
import { type SocialLinkRow, toSocialLinks } from "./social-links";
import { readClubLogoUrl } from "./supabase-club-logo-gateways";

type Environment = Readonly<Record<string, string | undefined>>;

const CLUBS_TABLE = "clubs";
// Los alias dejan la fila casi con la forma de `ClubBrandRow`: falta pasar la
// ruta del logo a su dirección pública, repartir los textos del inicio de
// sesión (#301) por idioma y las redes (#964) por red. Las redes van en la
// misma consulta: si no se pueden leer, falla la marca entera y se pinta el
// respaldo, que no lleva ninguna.
const BRAND_COLUMNS =
  "name, initials, accentColor:accent_color, logoPath:logo_path, signInTextRows:club_sign_in_texts(locale, tagline, welcome), socialLinkRows:club_social_links(network, url)";

type BrandColumns = Omit<
  ClubBrandRow,
  "logoUrl" | "signInTexts" | "socialLinks"
> & {
  readonly logoPath: string | null;
  readonly signInTextRows: readonly SignInTextRow[];
  readonly socialLinkRows: readonly SocialLinkRow[];
};

/** Cuánto vive la marca en la memoria del servidor. Guardar un cambio la
 * invalida en el proceso que lo guarda; este plazo acota lo que tarda en verlo
 * cualquier otra instancia del servidor, que no se entera de la invalidación. */
const CLUB_BRAND_TIME_TO_LIVE_MS = 5 * 60 * 1000;

/** Por debajo del corte de 10 s de una función de Vercel en plan Hobby, como
 * `DATABASE_PROBE_TIMEOUT_MS`: si vence antes la plataforma, la pantalla se cae
 * en vez de pintarse con el respaldo. */
const CLUB_BRAND_READ_TIMEOUT_MS = 3_000;

/**
 * Lee la marca del club de esta instalación. Va con la llave de servicio, como
 * `findClubIdBySlug`, porque el club se encuentra por su `slug` y
 * `0022_club_brand.sql` no deja a `anon` leer esa columna. Sólo pide la marca,
 * y corre en el servidor. Lanza si Supabase no
 * contesta o no está configurado; decidir qué se pinta entonces es cosa de la
 * caché.
 */
export async function fetchClubBrandRow(
  env: Environment,
): Promise<ClubBrandRow> {
  const client = createServiceRoleClient(env);
  const { data, error } = await client
    .from(CLUBS_TABLE)
    .select(BRAND_COLUMNS)
    .eq("slug", DEFAULT_CLUB_SLUG)
    .single<BrandColumns>();
  if (error) {
    throw new Error(`No se pudo leer la marca del club: ${error.message}`);
  }
  const { logoPath, signInTextRows, socialLinkRows, ...brand } = data;
  return {
    ...brand,
    logoUrl: readClubLogoUrl(client, logoPath),
    signInTexts: toSignInTexts(signInTextRows),
    socialLinks: toSocialLinks(socialLinkRows),
  };
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
  readTimeoutMs: CLUB_BRAND_READ_TIMEOUT_MS,
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
