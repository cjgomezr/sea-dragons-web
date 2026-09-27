import type { Metadata } from "next";
import { NewsPublishScreen } from "@/components/news/NewsPublishScreen";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * Publicar en Noticias (#330, RF-2 y RF-3 del PRD de E11), abierto desde la
 * cabecera del feed.
 *
 * `RESTRICTED_ROUTES` la reserva a Admin y Committee: a los demás la frontera
 * los manda al panel antes de llegar aquí, aunque escriban la dirección a
 * mano. Los endpoints de publicar y de subir lo vuelven a comprobar.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("news.publish.metaTitle", { club }),
    description: translate("news.publish.metaDescription"),
  };
}

export default async function PublishNewsPage(): Promise<React.JSX.Element> {
  return <NewsPublishScreen locale={await readRequestLocale()} />;
}
