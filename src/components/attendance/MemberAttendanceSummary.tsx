import type { MemberAttendance } from "@/lib/attendance/attendance-stats";
import { formatPercent } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";

/**
 * El porcentaje de asistencia de un miembro (#396, RF-6 del PRD de E8): la
 * celda del directorio (FR-015) y la ficha rápida. El perfil y la ficha del
 * Admin enseñan desde #774 la de la temporada (`SeasonAttendanceCard`). Sin
 * sesiones elegibles se escribe "Sin datos", nunca un 0 (AC-017b): lo decide
 * la variante que llega de la API, no un `null`.
 */

export function describeAttendance(
  translate: Translator,
  locale: Locale,
  attendance: MemberAttendance,
): string {
  switch (attendance.kind) {
    case "rate":
      return formatPercent(locale, attendance.percent);
    case "no_data":
      return translate("memberAttendance.noData");
  }
}
