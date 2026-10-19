import type { Metadata } from "next";
import { TeamBuilderScreen } from "@/components/teams/TeamBuilderScreen";
import { TEAMS_EVENT_QUERY_PARAM } from "@/lib/auth/routes";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * Equipos (#402, RF-9 del PRD de E10): el team builder de Admin y Coach.
 *
 * `TEAMS_PATH` está en `RESTRICTED_ROUTES` para Admin y Coach: a un
 * Committee o un Player la frontera los devuelve al panel antes de llegar
 * aquí. Lo que la pantalla enseña lo lee de `/api/v1/teams`, que lo vuelve a
 * comprobar.
 *
 * `?evento=<id>` abre ese evento si es armable: es a donde lleva "Abrir
 * equipos" desde el inicio (#747).
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("teams.metaTitle", { club }),
  };
}

/** Un parámetro repetido no dice qué evento abrir: se abre el más cercano. */
function readInitialEventId(
  value: string | string[] | undefined,
): string | null {
  return typeof value === "string" ? value : null;
}

export default async function EquiposPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const [locale, params] = await Promise.all([
    readRequestLocale(),
    searchParams,
  ]);
  return (
    <TeamBuilderScreen
      locale={locale}
      initialEventId={readInitialEventId(params[TEAMS_EVENT_QUERY_PARAM])}
    />
  );
}
