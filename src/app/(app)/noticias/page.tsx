import type { Metadata } from "next";
import { NewsFeedScreen } from "@/components/news/NewsFeedScreen";
import { readCallerRole } from "@/lib/auth/caller-role";
import { hasCapability } from "@/lib/auth/roles";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * El feed de noticias (#329, RF-4 del PRD de E11). Lo alcanza cualquier cuenta
 * activa, así que la ruta no está en `RESTRICTED_ROUTES`: qué publicaciones
 * ve cada uno lo decide el endpoint del feed (#327), que es de donde lee la
 * pantalla. El rol sólo decide si se pinta el botón de publicar (#330).
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("news.metaTitle", { club }),
    description: translate("news.metaDescription"),
  };
}

export default async function NoticiasPage(): Promise<React.JSX.Element> {
  const [locale, role] = await Promise.all([
    readRequestLocale(),
    readCallerRole(),
  ]);
  return (
    <NewsFeedScreen
      locale={locale}
      canPublish={hasCapability(role, "publishNewsAndDocuments")}
    />
  );
}
