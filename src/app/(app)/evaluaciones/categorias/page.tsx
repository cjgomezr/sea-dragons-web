import type { Metadata } from "next";
import { EvaluationCategoriesScreen } from "@/components/evaluations/EvaluationCategoriesScreen";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * Las categorías de evaluación (#323, RF-3 del PRD de E9), dentro de
 * Evaluaciones y alcanzable desde su cabecera.
 *
 * Cuelga de `EVALUATIONS_PATH`, que está en `RESTRICTED_ROUTES` para Admin y
 * Coach: a un Player o un Committee la frontera los devuelve al panel antes
 * de llegar aquí. Los endpoints de `/api/v1/evaluations/categories` lo
 * vuelven a comprobar.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("evaluations.categories.metaTitle", { club }),
  };
}

export default async function CategoriasPage(): Promise<React.JSX.Element> {
  return <EvaluationCategoriesScreen locale={await readRequestLocale()} />;
}
