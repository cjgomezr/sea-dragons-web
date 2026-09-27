import type { Metadata } from "next";
import { NewsEditScreen } from "@/components/news/NewsEditScreen";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * Editar una publicación (#331, RF-6 del PRD de E11), abierta desde la
 * publicación. `[id]` es el de la publicación.
 *
 * `RESTRICTED_ROUTES` la reserva a Admin y Committee: a los demás la frontera
 * los manda al panel antes de llegar aquí. Que sea suya, salvo para el Admin,
 * lo vuelve a comprobar el endpoint.
 */

type EditNewsPageProps = {
  readonly params: Promise<{ readonly id: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("news.edit.metaTitle", { club }),
    description: translate("news.edit.metaDescription"),
  };
}

export default async function EditNewsPage({
  params,
}: EditNewsPageProps): Promise<React.JSX.Element> {
  const { id } = await params;
  return (
    <NewsEditScreen key={id} locale={await readRequestLocale()} postId={id} />
  );
}
