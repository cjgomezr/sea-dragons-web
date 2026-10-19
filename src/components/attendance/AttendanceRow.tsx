import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr/ArrowUpRight";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { Clock } from "@phosphor-icons/react/dist/ssr/Clock";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { MemberAvatar } from "@/components/MemberAvatar";
import type { SheetViewer } from "@/lib/attendance/attendance-sheet";
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
} from "@/lib/attendance/attendance-status";
import { memberRecordHref } from "@/lib/auth/routes";
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
 *
 * En escritorio la fila es una sola línea (#764, E29), y un punto avisa de
 * que lo marcado en ella difiere de lo guardado.
 */

/** En píxeles, como `.attendance-avatar`. */
const AVATAR_SIZE = 30;

const STATUS_GLYPHS: Readonly<Record<AttendanceStatus, PhosphorGlyph>> = {
  present: Check,
  late: Clock,
  absent: X,
};

/** Quién mira la hoja y si puede salir de ella sin perder lo marcado. */
export type RowViewer = {
  readonly kind: SheetViewer;
  /** Con cambios sin guardar, pregunta si se descartan. */
  readonly canLeaveSheet: () => boolean;
};

/** Abrir en otra pestaña o ventana no saca de la hoja: no hay nada que
 * descartar, y preguntar cancelaría esa apertura si se contesta que no. */
export function opensElsewhere(event: React.MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey;
}

/** La foto grande se pide con la regla del directorio (#353), que esconde
 * al socio de baja a quien no es Admin. La hoja sí lo lista si tiene fila
 * guardada: a un Coach su foto no se le ofrece, porque siempre fallaría. */
function canOpenPhoto(member: SheetMember, viewer: RowViewer): boolean {
  return viewer.kind === "admin" || !member.isInactive;
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
      className="attendance-record-link"
      aria-label={translate("memberRecord.openLabel", {
        name: member.fullName,
      })}
      onClick={(event) => {
        if (!opensElsewhere(event) && !viewer.canLeaveSheet()) {
          event.preventDefault();
        }
      }}
    >
      <span className="attendance-name">{member.fullName}</span>
      <span className="attendance-record-icon">
        <Icon glyph={ArrowUpRight} />
      </span>
    </Link>
  );
}

/** El `title` no lo lee todo lector de pantalla (D3 de E29): el aviso va
 * también como texto oculto. */
function UnsavedDot({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  const label = translate("attendance.rowUnsaved");
  return (
    <span className="attendance-unsaved-dot" title={label}>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

function MemberHints({
  translate,
  member,
  isUnsaved,
}: {
  readonly translate: Translator;
  readonly member: SheetMember;
  readonly isUnsaved: boolean;
}): React.JSX.Element {
  return (
    <>
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
      {isUnsaved ? <UnsavedDot translate={translate} /> : null}
    </>
  );
}

function StatusSegment({
  translate,
  fullName,
  status,
  onMark,
}: {
  readonly translate: Translator;
  readonly fullName: string;
  readonly status: AttendanceStatus;
  readonly onMark: (status: AttendanceStatus) => void;
}): React.JSX.Element {
  return (
    <div className="attendance-segment" role="group" aria-label={fullName}>
      {ATTENDANCE_STATUSES.map((choice) => (
        <button
          key={choice}
          type="button"
          className={`attendance-choice attendance-choice-${choice}`}
          aria-pressed={choice === status}
          onClick={() => onMark(choice)}
        >
          <span className="attendance-choice-icon">
            <Icon glyph={STATUS_GLYPHS[choice]} weight="bold" />
          </span>
          {translate(`attendance.status.${choice}`)}
        </button>
      ))}
    </div>
  );
}

export function AttendanceRow({
  translate,
  member,
  viewer,
  status,
  isUnsaved,
  onMark,
}: {
  readonly translate: Translator;
  readonly member: SheetMember;
  readonly viewer: RowViewer;
  readonly status: AttendanceStatus;
  /** Lo marcado difiere de lo guardado (D2 de E29). */
  readonly isUnsaved: boolean;
  readonly onMark: (status: AttendanceStatus) => void;
}): React.JSX.Element {
  return (
    <li className="attendance-row">
      <div className="attendance-avatar-cell">
        <MemberAvatar
          fullName={member.fullName}
          photoUrl={member.photoUrl}
          size={AVATAR_SIZE}
          className="attendance-avatar"
          viewer={
            canOpenPhoto(member, viewer)
              ? { userId: member.userId, translate }
              : undefined
          }
        />
      </div>
      <div className="attendance-member-text">
        <MemberName translate={translate} member={member} viewer={viewer} />
        <MemberHints
          translate={translate}
          member={member}
          isUnsaved={isUnsaved}
        />
      </div>
      <StatusSegment
        translate={translate}
        fullName={member.fullName}
        status={status}
        onMark={onMark}
      />
    </li>
  );
}
