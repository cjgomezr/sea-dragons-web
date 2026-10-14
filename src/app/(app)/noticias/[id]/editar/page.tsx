import type { Metadata } from "next";
import { NewsEditScreen } from "@/components/news/NewsEditScreen";
import { readCallerRole } from "@/lib/auth/caller-role";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { canPinNewsPosts } from "@/lib/news/news-posts";

/**
 * Editar una publicación (#331, RF-6 del PRD de E11), abierta desde la
 * publicación. `[id]` es el de la publicación.
 *
 * `RESTRICTED_ROUTES` la reserva a Admin y Committee: a los demás la frontera
 * los manda al panel antes de llegar aquí. Que sea suya, salvo para el Admin,
 * lo vuelve a comprobar el endpoint. El rol decide además si se pinta la
 * caja de fijar (#599).
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
  const [{ id }, locale, role] = await Promise.all([
    params,
    readRequestLocale(),
    readCallerRole(),
  ]);
  return (
    <NewsEditScreen
      key={id}
      locale={locale}
      postId={id}
      canPin={canPinNewsPosts(role)}
    />
  );
}
