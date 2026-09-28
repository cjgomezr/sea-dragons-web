import type { Metadata } from "next";
import { AttendanceScreen } from "@/components/attendance/AttendanceScreen";
import { ATTENDANCE_SESSION_QUERY_PARAM } from "@/lib/auth/routes";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * Asistencia (#395, RF-8 del PRD de E8): la hoja de la sesión más reciente,
 * las fichas para cambiar de sesión y el guardado.
 *
 * `ATTENDANCE_PATH` está en `RESTRICTED_ROUTES` para Admin y Coach: a un
 * Committee o un Player la frontera los devuelve al panel antes de llegar
 * aquí. Lo que la pantalla enseña lo lee de `/api/v1/attendance`, que lo
 * vuelve a comprobar.
 *
 * `?sesion=<id>` abre ya la hoja de esa sesión: es a donde lleva "Pasar
 * lista" desde el calendario.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("attendance.metaTitle", { club }),
  };
}

/** Un parámetro repetido no dice qué sesión abrir: se abre la más reciente. */
function readInitialSessionId(
  value: string | string[] | undefined,
): string | null {
  return typeof value === "string" ? value : null;
}

export default async function AsistenciaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const [locale, params] = await Promise.all([
    readRequestLocale(),
    searchParams,
  ]);
  return (
    <AttendanceScreen
      locale={locale}
      initialSessionId={readInitialSessionId(
        params[ATTENDANCE_SESSION_QUERY_PARAM],
      )}
    />
  );
}
