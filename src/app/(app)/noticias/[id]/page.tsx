import type { Metadata } from "next";
import { NewsPostScreen } from "@/components/news/NewsPostScreen";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * Una publicación abierta (#329, RF-5 del PRD de E11). `[id]` es el de la
 * publicación. La que no le corresponde a quien mira la responde el endpoint
 * con un 404, igual que la que no existe, y la pantalla pinta lo mismo.
 */

type NewsPostPageProps = {
  readonly params: Promise<{ readonly id: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("news.metaTitle", { club }),
    description: translate("news.metaDescription"),
  };
}

export default async function NewsPostPage({
  params,
}: NewsPostPageProps): Promise<React.JSX.Element> {
  const { id } = await params;
  return (
    // Otra publicación empieza de cero: sin esto, pasar de una a otra dejaría
    // a la vista la anterior mientras llega la nueva.
    <NewsPostScreen key={id} locale={await readRequestLocale()} postId={id} />
  );
}
