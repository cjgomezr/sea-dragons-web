import type { Metadata } from "next";
import { TeamBuilderScreen } from "@/components/teams/TeamBuilderScreen";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * Equipos (#402, RF-9 del PRD de E10): el team builder de Admin y Coach.
 *
 * `TEAMS_PATH` está en `RESTRICTED_ROUTES` para Admin y Coach: a un
 * Committee o un Player la frontera los devuelve al panel antes de llegar
 * aquí. Lo que la pantalla enseña lo lee de `/api/v1/teams`, que lo vuelve a
 * comprobar.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("teams.metaTitle", { club }),
  };
}

export default async function EquiposPage(): Promise<React.JSX.Element> {
  return <TeamBuilderScreen locale={await readRequestLocale()} />;
}
