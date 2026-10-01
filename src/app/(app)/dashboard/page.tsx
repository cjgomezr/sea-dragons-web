import { DashboardScreen } from "@/components/dashboard/DashboardScreen";
import { readCallerRole } from "@/lib/auth/caller-role";
import { type Role, hasCapability } from "@/lib/auth/roles";
import { readRequestLocale } from "@/lib/i18n/request-locale";

// El dashboard (#426, RF-1 a RF-4 del PRD de E14). Es también la pantalla de
// `/`, y la de `/dashboard` porque es a donde llevan la entrada y la
// navegación. Lo alcanza cualquier cuenta activa: qué ve cada rol lo decide
// `GET /api/v1/dashboard` (#424), de donde lee la pantalla.

/** RF-4 reserva "Nuevo entrenamiento" a Admin y Coach, pero un Coach no
 * crea eventos (ASS-006 del SRD, la matriz de la sección 4): el botón lo
 * llevaría a un calendario sin formulario. Queda quien está en los dos
 * conjuntos, el Admin. */
function canCreateTrainingsFromHome(role: Role): boolean {
  return (
    hasCapability(role, "createEvents") &&
    hasCapability(role, "buildTeamsAndTrackAttendance")
  );
}

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const [locale, role] = await Promise.all([
    readRequestLocale(),
    readCallerRole(),
  ]);
  return (
    <DashboardScreen
      locale={locale}
      canCreateTrainings={canCreateTrainingsFromHome(role)}
    />
  );
}
