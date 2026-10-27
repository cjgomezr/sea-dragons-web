import type { Metadata } from "next";
import { TrainingScreen } from "@/components/training/TrainingScreen";
import { readCallerRole } from "@/lib/auth/caller-role";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { canPlanTraining } from "@/lib/training/training-plan";

/**
 * Entrenamiento (#900, RF-3 y RF-12 del PRD de E35): la semana del ciclo
 * activo. La alcanza cualquier cuenta activa; quién ve el plan lo decide
 * `/api/v1/training/plan`, que la pantalla lee como la aplicación nativa
 * (CON-002).
 *
 * El rol se lee aquí, en el servidor, para ofrecer Planificar al Admin y al
 * Coach (D3).
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("training.member.metaTitle", { club }),
  };
}

export default async function EntrenamientoPage(): Promise<React.JSX.Element> {
  const [locale, role] = await Promise.all([
    readRequestLocale(),
    readCallerRole(),
  ]);
  return <TrainingScreen locale={locale} canPlan={canPlanTraining(role)} />;
}
