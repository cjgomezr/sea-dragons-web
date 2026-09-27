import type { Metadata } from "next";
import { EvaluationsScreen } from "@/components/evaluations/EvaluationsScreen";
import { EVALUATION_MEMBER_QUERY_PARAM } from "@/lib/auth/routes";
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
 *
 * `?miembro=<user_id>` abre ya la ficha de esa persona (#324).
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("evaluations.metaTitle", { club }),
  };
}

/** Un parámetro repetido no dice a quién abrir: se queda en la lista. */
function readInitialMemberId(
  value: string | string[] | undefined,
): string | null {
  return typeof value === "string" ? value : null;
}

export default async function EvaluacionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const [locale, params] = await Promise.all([
    readRequestLocale(),
    searchParams,
  ]);
  return (
    <EvaluationsScreen
      locale={locale}
      initialMemberId={readInitialMemberId(
        params[EVALUATION_MEMBER_QUERY_PARAM],
      )}
    />
  );
}
