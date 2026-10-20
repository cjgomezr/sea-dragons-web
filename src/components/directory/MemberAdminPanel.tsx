"use client";

import type { Role } from "@/lib/auth/roles";
import type { Translator } from "@/lib/i18n/translator";
import type { MemberRecord } from "@/lib/members/member-record";
import type { MembershipWaiverChange } from "@/lib/membership/membership-waiver";
import { InvitationResend } from "./InvitationResend";
import type { AdminAction } from "./MemberAdminMenu";
import { MemberRecordRole } from "./MemberRecordRole";
import {
  DeactivationConfirmation,
  type MemberStatusChange,
  MemberStatusOutcome,
} from "./MemberStatusControl";
import { MembershipWaiverControl } from "./MembershipWaiverControl";

/**
 * Lo que abre cada opción del ⋯ de la ficha (#775, D7 del PRD de E30), bajo
 * la cabecera: el control de siempre, sin cambiarle la lógica. El rol con su
 * confirmación (#549), la exención con su diálogo (#457), el reenvío de la
 * invitación (#243) y la baja (#244), que ahora se confirma en una franja.
 */

/** Lo que hay bajo la cabecera: nada, o lo que abrió la última opción. */
export type AdminPanel = "none" | AdminAction;

export type AdminPanelHandlers = {
  readonly onRoleChanged: (role: Role) => void;
  readonly onWaiverChanged: (change: MembershipWaiverChange) => void;
  /** Al cancelar la baja: la ficha quita la franja y devuelve el foco al ⋯. */
  readonly onDeactivationCancelled: () => void;
};

function InvitationPanel({
  translate,
  record,
}: {
  translate: Translator;
  record: MemberRecord;
}): React.JSX.Element {
  return (
    <section className="admin-section" aria-labelledby="ficha-invitacion">
      <h2 id="ficha-invitacion">
        {translate("memberRecord.invitation.title")}
      </h2>
      <p className="app-lead">
        {translate("memberRecord.invitation.lead", { name: record.fullName })}
      </p>
      <InvitationResend
        translate={translate}
        userId={record.userId}
        isPrimary={false}
        sentText={translate("memberRecord.invitation.resent", {
          name: record.fullName,
        })}
      />
    </section>
  );
}

/** La baja enseña su franja hasta que el servidor responde; después, como la
 * reactivación, sólo cómo fue. */
function StatusPanel({
  translate,
  record,
  isDeactivation,
  statusChange,
  onDeactivationCancelled,
}: {
  translate: Translator;
  record: MemberRecord;
  isDeactivation: boolean;
  statusChange: MemberStatusChange;
  onDeactivationCancelled: () => void;
}): React.JSX.Element | null {
  const { state } = statusChange;
  if (isDeactivation && (state.kind === "idle" || state.kind === "saving")) {
    return (
      <DeactivationConfirmation
        translate={translate}
        name={record.fullName}
        isSaving={state.kind === "saving"}
        onCancel={onDeactivationCancelled}
        onConfirm={() => void statusChange.changeStatus()}
      />
    );
  }
  return (
    <MemberStatusOutcome
      translate={translate}
      state={state}
      name={record.fullName}
    />
  );
}

export function MemberAdminPanel({
  translate,
  record,
  panel,
  statusChange,
  handlers,
}: {
  translate: Translator;
  record: MemberRecord;
  panel: AdminPanel;
  /** La baja y la reactivación, que la ficha pide al elegir la opción. */
  statusChange: MemberStatusChange;
  handlers: AdminPanelHandlers;
}): React.JSX.Element | null {
  switch (panel) {
    case "none":
      return null;
    case "changeRole":
      return (
        <MemberRecordRole
          translate={translate}
          member={record}
          onRoleChanged={handlers.onRoleChanged}
        />
      );
    case "waiver":
      return (
        <MembershipWaiverControl
          translate={translate}
          member={record}
          onWaiverChanged={handlers.onWaiverChanged}
        />
      );
    case "resendInvitation":
      return <InvitationPanel translate={translate} record={record} />;
    case "deactivate":
    case "reactivate":
      return (
        <StatusPanel
          translate={translate}
          record={record}
          isDeactivation={panel === "deactivate"}
          statusChange={statusChange}
          onDeactivationCancelled={handlers.onDeactivationCancelled}
        />
      );
  }
}
