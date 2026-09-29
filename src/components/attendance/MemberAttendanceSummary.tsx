import type { MemberAttendance } from "@/lib/attendance/attendance-stats";
import { formatPercent } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";

/**
 * El porcentaje de asistencia de un miembro (#396, RF-6 del PRD de E8): la
 * celda del directorio (FR-015) y el bloque del perfil propio (FR-022) y de
 * la ficha del Admin. Sin sesiones elegibles se escribe "Sin datos", nunca un
 * 0 (AC-017b): lo decide la variante que llega de la API, no un `null`.
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

/** El bloque del perfil y de la ficha: el porcentaje grande y las sesiones
 * debajo. El prefijo oculto hace que un lector de pantalla oiga
 * "Asistencia: 90 %" y no un número suelto al llegar a la cifra. */
export function MemberAttendanceSummary({
  translate,
  locale,
  attendance,
  headingId,
  className,
}: {
  translate: Translator;
  locale: Locale;
  attendance: MemberAttendance;
  /** Único en la página: el perfil y la ficha dan el suyo. */
  headingId: string;
  /** La tarjeta de la pantalla que lo acoge. */
  className: string;
}): React.JSX.Element {
  return (
    <section
      className={`${className} member-attendance`}
      aria-labelledby={headingId}
    >
      <h2 id={headingId}>{translate("memberAttendance.title")}</h2>
      <p
        className={
          attendance.kind === "rate"
            ? "member-attendance-figure"
            : "member-attendance-figure member-attendance-empty"
        }
      >
        <span className="visually-hidden">
          {translate("memberAttendance.spokenPrefix")}
        </span>
        <span>{describeAttendance(translate, locale, attendance)}</span>
      </p>
      {attendance.kind === "rate" ? (
        <p className="member-attendance-sessions">
          {translate("memberAttendance.sessions", {
            count: attendance.sessions,
          })}
        </p>
      ) : null}
    </section>
  );
}
