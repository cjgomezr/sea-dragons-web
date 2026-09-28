import { AgendaScreen } from "@/components/calendar/AgendaScreen";
import { readCallerRole } from "@/lib/auth/caller-role";
import { hasCapability } from "@/lib/auth/roles";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * El Calendario (#311, RF-7 del PRD de E7). Lo alcanza cualquier cuenta
 * activa, así que la ruta no está en `RESTRICTED_ROUTES`: qué eventos ve cada
 * uno lo decide el endpoint de la agenda (#309), que es de donde lee la
 * pantalla. El rol sólo decide si se pinta "+ Evento" (#313) y "Pasar
 * lista" (#395).
 */
export default async function CalendarioPage(): Promise<React.JSX.Element> {
  const [locale, role] = await Promise.all([
    readRequestLocale(),
    readCallerRole(),
  ]);
  return (
    <AgendaScreen
      locale={locale}
      canManageEvents={hasCapability(role, "createEvents")}
      canTakeAttendance={hasCapability(role, "buildTeamsAndTrackAttendance")}
    />
  );
}
