import Link from "next/link";
import { MemberAvatar } from "@/components/MemberAvatar";
import { memberRecordHref } from "@/lib/auth/routes";
import { positionName } from "@/lib/club/club-positions";
import type { ListPosition } from "@/lib/evaluations/sheet-navigation";
import type { Translator } from "@/lib/i18n/translator";
import { OverallScore } from "./OverallScore";
import type { ScreenRosterEntry } from "./evaluations-client";

/**
 * La caja del panel de un jugador (#819, RF-3 del PRD de E31): arriba dice
 * dónde está en la lista filtrada, con cerrar, anterior y siguiente; debajo,
 * la identidad con el OVR. En el móvil es el segundo paso, así que lleva
 * además su propio botón de volver a la lista. En edición (#820) el borde
 * pasa a acento y el OVR es el de lo ajustado.
 */

const AVATAR_SIZE = 56;

/** Lo que la caja necesita del jugador y de la lista, sea cual sea el estado
 * de su evaluación. */
export type SheetContext = {
  readonly translate: Translator;
  readonly member: ScreenRosterEntry;
  readonly canOpenMemberRecords: boolean;
  readonly position: ListPosition;
  readonly onClose: () => void;
  readonly onNavigate: (userId: string) => void;
};

function NavButton({
  label,
  glyph,
  targetId,
  onNavigate,
}: {
  label: string;
  glyph: string;
  targetId: string | null;
  onNavigate: (userId: string) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="evaluation-sheet-nav-button"
      aria-label={label}
      disabled={targetId === null}
      onClick={() => {
        if (targetId !== null) {
          onNavigate(targetId);
        }
      }}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

/** "{i} de {n} en esta lista" o que no está en el filtro, con cerrar,
 * anterior y siguiente. */
function SheetNav({
  translate,
  position,
  onClose,
  onNavigate,
}: Pick<
  SheetContext,
  "translate" | "position" | "onClose" | "onNavigate"
>): React.JSX.Element {
  return (
    <div className="evaluation-sheet-nav">
      <p>
        {position.kind === "listed"
          ? translate("evaluations.sheet.listPosition", {
              position: position.index + 1,
              total: position.count,
            })
          : translate("evaluations.sheet.outOfFilter")}
      </p>
      <button
        type="button"
        className="evaluation-sheet-nav-button evaluation-sheet-close"
        aria-label={translate("evaluations.sheet.close")}
        onClick={onClose}
      >
        <span aria-hidden="true">×</span>
      </button>
      <NavButton
        label={translate("evaluations.sheet.previous")}
        glyph="‹"
        targetId={position.previousId}
        onNavigate={onNavigate}
      />
      <NavButton
        label={translate("evaluations.sheet.next")}
        glyph="›"
        targetId={position.nextId}
        onNavigate={onNavigate}
      />
    </div>
  );
}

/** "posición · Perfil": el enlace sólo si quien mira puede abrir la ficha
 * del socio (#770). */
function IdentityLine({
  translate,
  member,
  canOpenMemberRecords,
}: Pick<
  SheetContext,
  "translate" | "member" | "canOpenMemberRecords"
>): React.JSX.Element | null {
  const position =
    member.position === null
      ? null
      : positionName(member.position.names, translate.locale);
  if (position === null && !canOpenMemberRecords) {
    return null;
  }
  return (
    <p className="evaluation-sheet-identity">
      {position}
      {position !== null && canOpenMemberRecords ? " · " : null}
      {canOpenMemberRecords ? (
        <Link href={memberRecordHref(member.userId)}>
          {translate("evaluations.sheet.profile")}
        </Link>
      ) : null}
    </p>
  );
}

export function EvaluationSheetFrame({
  context,
  overallRating,
  isEditing,
  children,
}: {
  context: SheetContext;
  /** `null` sin evaluación o sin ninguna categoría. */
  overallRating: number | null;
  isEditing: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const { translate, member, onClose } = context;
  return (
    <section
      className="evaluation-sheet"
      aria-label={translate("evaluations.sheet.label", {
        name: member.fullName,
      })}
      data-editing={isEditing ? "true" : undefined}
    >
      <button type="button" className="evaluation-back" onClick={onClose}>
        <span aria-hidden="true">←</span>
        {translate("evaluations.sheet.back")}
      </button>
      <SheetNav
        translate={translate}
        position={context.position}
        onClose={onClose}
        onNavigate={context.onNavigate}
      />
      <header className="evaluation-sheet-header">
        <MemberAvatar
          fullName={member.fullName}
          photoUrl={member.photoUrl}
          size={AVATAR_SIZE}
          className="evaluation-avatar"
        />
        <div className="evaluation-sheet-who">
          <h2>{member.fullName}</h2>
          <IdentityLine
            translate={translate}
            member={member}
            canOpenMemberRecords={context.canOpenMemberRecords}
          />
        </div>
        <OverallScore translate={translate} overallRating={overallRating} />
      </header>
      {children}
    </section>
  );
}
