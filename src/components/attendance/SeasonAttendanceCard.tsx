import { SideCard } from "@/components/account/SideCard";
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
} from "@/lib/attendance/attendance-status";
import type { SeasonAttendance } from "@/lib/attendance/season-attendance";
import { formatCalendarDay, formatPercent } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";

/**
 * La asistencia de la temporada en el perfil y en la ficha (#774, D9 del PRD
 * de E30): el porcentaje, cuántas de cuántas sesiones y las últimas 10 como
 * bloques, con el cálculo del inicio (#746). Sin sesiones esta temporada lo
 * dice, nunca un 0 (AC-017b).
 */

const STATUS_KEYS = {
  present: "attendance.status.present",
  late: "attendance.status.late",
  absent: "attendance.status.absent",
} as const satisfies Record<AttendanceStatus, MessageKey>;

/** El color dice el estado; cada bloque lleva además su fecha y su estado en
 * texto, que es lo que oye un lector de pantalla. */
function LastSessions({
  translate,
  last10,
}: {
  translate: Translator;
  last10: SeasonAttendance["last10"];
}): React.JSX.Element {
  return (
    <>
      <ol
        className="season-attendance-blocks"
        aria-label={translate("seasonAttendance.last10")}
      >
        {last10.map((session) => (
          <li
            key={session.eventId}
            className={`season-attendance-block season-attendance-${session.status}`}
          >
            <span className="visually-hidden">
              {translate("seasonAttendance.session", {
                date: formatCalendarDay(translate.locale, session.startsOn),
                status: translate(STATUS_KEYS[session.status]),
              })}
            </span>
          </li>
        ))}
      </ol>
      <div className="season-attendance-legend">
        <span aria-hidden="true">{translate("seasonAttendance.last10")}</span>
        <ul aria-label={translate("seasonAttendance.legend")}>
          {ATTENDANCE_STATUSES.map((status) => (
            <li key={status} className={`season-attendance-${status}`}>
              {translate(STATUS_KEYS[status])}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function SeasonFigures({
  translate,
  attendance,
}: {
  translate: Translator;
  attendance: SeasonAttendance;
}): React.JSX.Element {
  return (
    <>
      <p className="season-attendance-figures">
        <span className="season-attendance-percent">
          {formatPercent(translate.locale, attendance.percent)}
        </span>
        <span>
          {translate("seasonAttendance.sessions", {
            attended: attendance.attended,
            count: attendance.sessions,
          })}
        </span>
      </p>
      <LastSessions translate={translate} last10={attendance.last10} />
    </>
  );
}

export function SeasonAttendanceCard({
  translate,
  attendance,
  headingId,
}: {
  translate: Translator;
  /** Null sin sesiones esta temporada. */
  attendance: SeasonAttendance | null;
  headingId: string;
}): React.JSX.Element {
  return (
    <SideCard
      headingId={headingId}
      title={translate("memberAttendance.title")}
      action={
        <span className="profile-side-card-note">
          {translate("seasonAttendance.season")}
        </span>
      }
    >
      {attendance === null ? (
        <p className="profile-side-card-empty">
          {translate("seasonAttendance.none")}
        </p>
      ) : (
        <SeasonFigures translate={translate} attendance={attendance} />
      )}
    </SideCard>
  );
}
