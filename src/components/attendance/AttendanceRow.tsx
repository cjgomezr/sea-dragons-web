import { MemberAvatar } from "@/components/MemberAvatar";
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
} from "@/lib/attendance/attendance-status";
import { positionName } from "@/lib/club/club-positions";
import type { Translator } from "@/lib/i18n/translator";
import type { SheetMember } from "./attendance-client";

/**
 * Una fila de la hoja (#395): el avatar, el nombre, la posición y el
 * segmento Presente · Tarde · Ausente. El segmento sigue la forma
 * del RSVP del calendario (`EventRsvp.tsx`): un grupo con el nombre del
 * miembro y un botón por estado, con `aria-pressed` en el elegido.
 *
 * Marcar no guarda: cambia la hoja que se está pasando, y se manda entera con
 * "Guardar asistencia". Por eso el botón se marca al momento.
 */

/** En píxeles, como `.attendance-avatar`. */
const AVATAR_SIZE = 36;

export function AttendanceRow({
  translate,
  member,
  status,
  onMark,
}: {
  readonly translate: Translator;
  readonly member: SheetMember;
  readonly status: AttendanceStatus;
  readonly onMark: (status: AttendanceStatus) => void;
}): React.JSX.Element {
  return (
    <li className="attendance-row">
      <div className="attendance-member">
        <MemberAvatar
          fullName={member.fullName}
          photoUrl={member.photoUrl}
          size={AVATAR_SIZE}
          className="attendance-avatar"
        />
        <div className="attendance-member-text">
          <span className="attendance-name">{member.fullName}</span>
          <span className="attendance-hints">
            {member.position === null ? null : (
              <span className="attendance-position">
                {positionName(member.position.names, translate.locale)}
              </span>
            )}
            {member.isInactive ? (
              <span className="attendance-inactive">
                {translate("attendance.inactive")}
              </span>
            ) : null}
          </span>
        </div>
      </div>
      <div
        className="attendance-segment"
        role="group"
        aria-label={member.fullName}
      >
        {ATTENDANCE_STATUSES.map((choice) => (
          <button
            key={choice}
            type="button"
            className={`attendance-choice attendance-choice-${choice}`}
            aria-pressed={choice === status}
            onClick={() => onMark(choice)}
          >
            {translate(`attendance.status.${choice}`)}
          </button>
        ))}
      </div>
    </li>
  );
}
