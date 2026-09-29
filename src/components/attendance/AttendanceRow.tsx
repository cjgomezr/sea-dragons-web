import Link from "next/link";
import { MemberAvatar } from "@/components/MemberAvatar";
import type { SheetViewer } from "@/lib/attendance/attendance-sheet";
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
} from "@/lib/attendance/attendance-status";
import { MEMBER_RECORD_PATH } from "@/lib/auth/routes";
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
 *
 * La foto y el nombre se comportan como en el directorio (#414): la foto se
 * abre en grande para quien pasa lista, y al Admin el nombre le abre la ficha.
 */

/** En píxeles, como `.attendance-avatar`. */
const AVATAR_SIZE = 36;

/** Quién mira la hoja y si puede salir de ella sin perder lo marcado. */
export type RowViewer = {
  readonly kind: SheetViewer;
  /** Con cambios sin guardar, pregunta si se descartan. */
  readonly canLeaveSheet: () => boolean;
};

function memberRecordHref(userId: string): string {
  return MEMBER_RECORD_PATH.replace("[id]", userId);
}

/** Como en el directorio, el nombre accesible del enlace dice a dónde lleva y
 * contiene el nombre visible (WCAG 2.5.3). Si no se acepta descartar lo
 * marcado, el clic no navega. */
function MemberName({
  translate,
  member,
  viewer,
}: {
  readonly translate: Translator;
  readonly member: SheetMember;
  readonly viewer: RowViewer;
}): React.JSX.Element {
  if (viewer.kind === "coach") {
    return <span className="attendance-name">{member.fullName}</span>;
  }
  return (
    <Link
      href={memberRecordHref(member.userId)}
      className="attendance-name attendance-record-link"
      aria-label={translate("memberRecord.openLabel", {
        name: member.fullName,
      })}
      onClick={(event) => {
        if (!viewer.canLeaveSheet()) {
          event.preventDefault();
        }
      }}
    >
      {member.fullName}
    </Link>
  );
}

export function AttendanceRow({
  translate,
  member,
  viewer,
  status,
  onMark,
}: {
  readonly translate: Translator;
  readonly member: SheetMember;
  readonly viewer: RowViewer;
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
          viewer={{ userId: member.userId, translate }}
        />
        <div className="attendance-member-text">
          <MemberName translate={translate} member={member} viewer={viewer} />
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
