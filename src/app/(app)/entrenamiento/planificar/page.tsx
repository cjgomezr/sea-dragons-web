import type { Metadata } from "next";
import { TrainingPlannerScreen } from "@/components/training/TrainingPlannerScreen";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * Planificar el entrenamiento (#906, RF-7 y D3 del PRD de E35): la pestaña
 * Ciclo. `TRAINING_PLANNING_PATH` está en `RESTRICTED_ROUTES` para Admin y
 * Coach: a un Player o un Committee la frontera los devuelve al panel antes
 * de llegar aquí. Lo que enseña lo lee de `/api/v1/training/manage`, que lo
 * vuelve a comprobar.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("training.manage.metaTitle", { club }),
  };
}

export default async function PlanificarPage(): Promise<React.JSX.Element> {
  return <TrainingPlannerScreen locale={await readRequestLocale()} />;
}
