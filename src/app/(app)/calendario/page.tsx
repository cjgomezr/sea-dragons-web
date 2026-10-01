import { AgendaScreen } from "@/components/calendar/AgendaScreen";
import { readCallerRole } from "@/lib/auth/caller-role";
import { hasCapability } from "@/lib/auth/roles";
import { CALENDAR_NEW_EVENT_QUERY_PARAM } from "@/lib/auth/routes";
import { type EventType, isEventType } from "@/lib/events/event-creation";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * El Calendario (#311, RF-7 del PRD de E7). Lo alcanza cualquier cuenta
 * activa, así que la ruta no está en `RESTRICTED_ROUTES`: qué eventos ve cada
 * uno lo decide el endpoint de la agenda (#309), que es de donde lee la
 * pantalla. El rol sólo decide si se pinta "+ Evento" (#313) y "Pasar
 * lista" (#395).
 *
 * `?nuevo=<tipo>` abre ya el formulario de crear con ese tipo (#426), a
 * quien puede crear eventos.
 */

/** Un parámetro repetido o un tipo que no existe no abren nada. */
function readNewEventType(
  value: string | string[] | undefined,
): EventType | null {
  return typeof value === "string" && isEventType(value) ? value : null;
}

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const [locale, role, params] = await Promise.all([
    readRequestLocale(),
    readCallerRole(),
    searchParams,
  ]);
  const canManageEvents = hasCapability(role, "createEvents");
  return (
    <AgendaScreen
      locale={locale}
      canManageEvents={canManageEvents}
      canTakeAttendance={hasCapability(role, "buildTeamsAndTrackAttendance")}
      openCreateWith={
        canManageEvents
          ? readNewEventType(params[CALENDAR_NEW_EVENT_QUERY_PARAM])
          : null
      }
    />
  );
}
