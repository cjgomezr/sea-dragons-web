import type { Metadata } from "next";
import { DirectoryScreen } from "@/components/directory/DirectoryScreen";
import { readMetadataContext } from "@/lib/club/metadata-context";
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
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("directory.metaTitle", { club }),
    description: translate("directory.metaDescription"),
  };
}

export default async function DirectorioPage(): Promise<React.JSX.Element> {
  return <DirectoryScreen locale={await readRequestLocale()} />;
}
