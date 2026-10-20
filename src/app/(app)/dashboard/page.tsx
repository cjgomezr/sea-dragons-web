import { DashboardScreen } from "@/components/dashboard/DashboardScreen";
import type { OpenableSections } from "@/components/dashboard/ManagementColumn";
import { readCallerIdentity } from "@/lib/auth/caller-identity";
import { readCallerAccess, readCallerId } from "@/lib/auth/caller-role";
import { type Role, hasCapability } from "@/lib/auth/roles";
import { ATTENDANCE_PATH, DIRECTORY_PATH, NEWS_PATH } from "@/lib/auth/routes";
import {
  type ActiveAccess,
  isAllowedForAccess,
} from "@/lib/auth/session-boundary";
import { firstNameOf } from "@/lib/dashboard/dashboard-view";
import { readRequestLocale } from "@/lib/i18n/request-locale";

// El dashboard (#426, RF-1 a RF-4 del PRD de E14). Es también la pantalla de
// `/`, y la de `/dashboard` porque es a donde llevan la entrada y la
// navegación. Lo alcanza cualquier cuenta activa: qué ve cada rol lo decide
// `GET /api/v1/dashboard` (#424), de donde lee la pantalla. El nombre del
// saludo se lee aquí, el mismo que ya leyó la cáscara, para que el saludo no
// espere a esa respuesta (#752).

/** "+ Evento" sale a quien puede crear eventos (D12 del PRD de E27, #747):
 * Admin y Committee. Crear lo vuelve a comprobar el endpoint (#307). */
function canCreateEventsFromHome(role: Role): boolean {
  return hasCapability(role, "createEvents");
}

/** Los números del club enlazan a la sección sólo si quien mira la abre
 * (#750, D11): la misma regla que la frontera de la sesión. */
function openableSectionsFor(access: ActiveAccess): OpenableSections {
  return {
    attendance: isAllowedForAccess(ATTENDANCE_PATH, access),
    directory: isAllowedForAccess(DIRECTORY_PATH, access),
    news: isAllowedForAccess(NEWS_PATH, access),
  };
}

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const [locale, access, userId, identity] = await Promise.all([
    readRequestLocale(),
    readCallerAccess(),
    readCallerId(),
    readCallerIdentity(),
  ]);
  return (
    <DashboardScreen
      locale={locale}
      firstName={firstNameOf(identity.fullName)}
      userId={userId}
      canCreateEvents={canCreateEventsFromHome(access.role)}
      openableSections={openableSectionsFor(access)}
    />
  );
}
