import type { Metadata } from "next";
import { EvaluationsScreen } from "@/components/evaluations/EvaluationsScreen";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * Evaluaciones (#322, RF-6 del PRD de E9): la lista de miembros con su OVR,
 * la ficha de quien se elija y la edición de sus valoraciones.
 *
 * `EVALUATIONS_PATH` está en `RESTRICTED_ROUTES` para Admin y Coach: a un
 * Player o un Committee la frontera los devuelve al panel antes de llegar
 * aquí, escriban la dirección o no (FR-055). Lo que la pantalla enseña lo
 * lee de los endpoints de `/api/v1/evaluations`, que lo vuelven a comprobar.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("evaluations.metaTitle", { club }),
  };
}

export default async function EvaluacionesPage(): Promise<React.JSX.Element> {
  return <EvaluationsScreen locale={await readRequestLocale()} />;
}
