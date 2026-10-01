import type { Metadata } from "next";
import { DirectoryScreen } from "@/components/directory/DirectoryScreen";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { SEARCH_QUERY_PARAM } from "@/lib/directory/directory-query";
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
 * `?q=` llega ya puesto en la búsqueda: es a donde llevan "Ver todos" y un
 * socio encontrado en la búsqueda global (#427).
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("directory.metaTitle", { club }),
    description: translate("directory.metaDescription"),
  };
}

export default async function DirectorioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const [locale, params] = await Promise.all([
    readRequestLocale(),
    searchParams,
  ]);
  const search = params[SEARCH_QUERY_PARAM];
  const initialSearch = typeof search === "string" ? search : "";
  return (
    // Llegar con otro texto sin salir del directorio vuelve a montarlo con él.
    <DirectoryScreen
      key={initialSearch}
      locale={locale}
      initialSearch={initialSearch}
    />
  );
}
