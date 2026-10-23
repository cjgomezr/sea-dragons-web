import type { Metadata } from "next";
import { DirectoryScreen } from "@/components/directory/DirectoryScreen";
import { readMetadataContext } from "@/lib/club/metadata-context";
import {
  DEFAULT_DIRECTORY_QUERY,
  type DirectoryQuery,
} from "@/lib/directory/directory";
import { readClubBrand } from "@/lib/club/supabase-club-brand";
import {
  InvalidDirectoryQueryError,
  isInviteRequested,
  parseDirectoryQuery,
} from "@/lib/directory/directory-query";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * El directorio del club (#239, RF-2 del PRD de E5): quién está en el club,
 * con su país, su nivel, su rol y su posición.
 *
 * Lo alcanza cualquier cuenta activa, sea cual sea su rol, así que la ruta no
 * está en `RESTRICTED_ROUTES`: la frontera ya mandó a entrar a quien no tiene
 * sesión. Lo que dentro es de un Admin lo decide el endpoint de #238, que es
 * de donde la pantalla lee: son los mismos endpoints que usará la aplicación
 * nativa de Release 2 (CON-002).
 *
 * La consulta llega en la dirección: `?q=` es a donde llevan "Ver todos" y un
 * socio encontrado en la búsqueda global (#427), y los filtros viven ahí para
 * que recargar o compartir la página devuelva la misma lista (#497).
 * `?invite=1` abre el panel de invitar (#862): es a donde lleva la dirección
 * vieja del alta, `/directorio/nuevo`.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("directory.metaTitle", { club }),
    description: translate("directory.metaDescription"),
  };
}

function toSearchParams(
  params: Record<string, string | string[] | undefined>,
): URLSearchParams {
  return new URLSearchParams(
    Object.entries(params).flatMap(([name, value]) =>
      typeof value === "string" ? [[name, value]] : [],
    ),
  );
}

/** Los mismos parámetros que lee el endpoint. Una dirección que no sabe leer
 * (escrita a mano, o de una versión anterior) no rompe la página: abre el
 * directorio sin filtros, igual que si no trajera ninguno. */
function readInitialQuery(searchParams: URLSearchParams): DirectoryQuery {
  try {
    return parseDirectoryQuery(searchParams);
  } catch (error) {
    if (error instanceof InvalidDirectoryQueryError) {
      return DEFAULT_DIRECTORY_QUERY;
    }
    throw error;
  }
}

export default async function DirectorioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const [locale, brand, params] = await Promise.all([
    readRequestLocale(),
    readClubBrand(),
    searchParams,
  ]);
  const addressParams = toSearchParams(params);
  const initialQuery = readInitialQuery(addressParams);
  return (
    // Llegar con otra consulta sin salir del directorio, como desde la
    // búsqueda global, vuelve a montarlo con ella.
    <DirectoryScreen
      key={JSON.stringify(initialQuery)}
      locale={locale}
      clubName={brand.name}
      initialQuery={initialQuery}
      isInviteOpenAtStart={isInviteRequested(addressParams)}
    />
  );
}
