import { AgendaScreen } from "@/components/calendar/AgendaScreen";
import { readRequestLocale } from "@/lib/i18n/request-locale";

/**
 * El Calendario (#311, RF-7 del PRD de E7). Lo alcanza cualquier cuenta
 * activa, así que la ruta no está en `RESTRICTED_ROUTES`: qué eventos ve cada
 * uno lo decide el endpoint de la agenda (#309), que es de donde lee la
 * pantalla.
 */
export default async function CalendarioPage(): Promise<React.JSX.Element> {
  return <AgendaScreen locale={await readRequestLocale()} />;
}
