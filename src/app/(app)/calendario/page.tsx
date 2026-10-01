import { AgendaScreen } from "@/components/calendar/AgendaScreen";
import { readCallerRole } from "@/lib/auth/caller-role";
import { hasCapability } from "@/lib/auth/roles";
import {
  CALENDAR_EVENT_QUERY_PARAM,
  CALENDAR_NEW_EVENT_QUERY_PARAM,
  CALENDAR_PERIOD_QUERY_PARAM,
} from "@/lib/auth/routes";
import type { AgendaPeriod } from "@/lib/events/event-agenda";
import { type EventType, isEventType } from "@/lib/events/event-creation";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * El Calendario (#311, RF-7 del PRD de E7). Lo alcanza cualquier cuenta
 * activa, así que la ruta no está en `RESTRICTED_ROUTES`: qué eventos ve cada
 * uno lo decide el endpoint de la agenda (#309), que es de donde lee la
 * pantalla. El rol sólo decide si se pinta "+ Evento" (#313) y "Pasar
 * lista" (#395).
 *
 * `?evento=<id>` lleva el foco a la fila de ese evento, y `?periodo=past`
 * la busca entre los pasados: es a donde lleva un evento encontrado en la
 * búsqueda global (#427). `?nuevo=<tipo>` abre ya el formulario de crear con
 * ese tipo (#426), a quien puede crear eventos.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/** Un parámetro repetido no dice cuál de los dos: se ignora. */
function readSingle(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/** Sólo `past` cambia algo; cualquier otro valor abre los próximos. */
function readInitialPeriod(params: SearchParams): AgendaPeriod {
  return readSingle(params[CALENDAR_PERIOD_QUERY_PARAM]) === "past"
    ? "past"
    : "upcoming";
}

/** Un parámetro repetido o un tipo que no existe no abren nada. */
function readNewEventType(params: SearchParams): EventType | null {
  const value = readSingle(params[CALENDAR_NEW_EVENT_QUERY_PARAM]);
  return value !== null && isEventType(value) ? value : null;
}

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const [locale, role, params] = await Promise.all([
    readRequestLocale(),
    readCallerRole(),
    searchParams,
  ]);
  const focusEventId = readSingle(params[CALENDAR_EVENT_QUERY_PARAM]);
  const initialPeriod = readInitialPeriod(params);
  const canManageEvents = hasCapability(role, "createEvents");
  return (
    <AgendaScreen
      // Llegar a otro evento sin salir del calendario vuelve a montar la
      // agenda, que es lo que la abre en su periodo y le da el foco.
      key={`${focusEventId ?? ""}-${initialPeriod}`}
      initialPeriod={initialPeriod}
      focusEventId={focusEventId}
      locale={locale}
      canManageEvents={canManageEvents}
      canTakeAttendance={hasCapability(role, "buildTeamsAndTrackAttendance")}
      openCreateWith={canManageEvents ? readNewEventType(params) : null}
    />
  );
}
