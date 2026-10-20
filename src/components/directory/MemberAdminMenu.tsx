"use client";

import { ArrowCounterClockwise } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise";
import { DotsThree } from "@phosphor-icons/react/dist/ssr/DotsThree";
import { HandCoins } from "@phosphor-icons/react/dist/ssr/HandCoins";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { UserMinus } from "@phosphor-icons/react/dist/ssr/UserMinus";
import { UserSwitch } from "@phosphor-icons/react/dist/ssr/UserSwitch";
import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import { useId } from "react";
import { Icon } from "@/components/Icon";
import { useDropdownMenu } from "@/components/use-dropdown-menu";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import type { Translator } from "@/lib/i18n/translator";
import type { MembershipStatus } from "@/lib/membership/membership";

/**
 * El ⋯ del Admin en la cabecera de la ficha (#775, RF-6 del PRD de E30, D7):
 * un desplegable de 260 px con Cambiar rol (con el rol de ahora), la
 * exención, Reenviar invitación sólo a quien no activó su cuenta y, tras una
 * línea, Desactivar en peligro, o Reactivar a quien ya está de baja.
 *
 * Sólo elige: lo que hace cada opción es de la ficha, con los controles de
 * siempre. Se cierra como el menú de la cuenta, y también al elegir, con el
 * foco de vuelta en el ⋯.
 */

export type AdminAction =
  "changeRole" | "waiver" | "resendInvitation" | "deactivate" | "reactivate";

/** Lo que el menú necesita saber del socio para decidir qué ofrece. */
export type AdminMenuMember = {
  readonly role: Role;
  readonly accountStatus: AccountStatus;
  readonly membershipStatus: MembershipStatus | null;
};

function MenuItem({
  glyph,
  label,
  detail,
  isDanger,
  onChoose,
}: {
  glyph: PhosphorGlyph;
  label: string;
  /** Lo que se lee junto a la opción (el rol de ahora), o null. */
  detail: string | null;
  isDanger: boolean;
  onChoose: () => void;
}): React.JSX.Element {
  const labelId = useId();
  const detailId = useId();
  return (
    <button
      type="button"
      className={
        isDanger
          ? "member-admin-menu-item member-admin-menu-item-danger"
          : "member-admin-menu-item"
      }
      // El rol de ahora se lee como descripción, no como parte del nombre.
      aria-labelledby={labelId}
      aria-describedby={detail === null ? undefined : detailId}
      onClick={onChoose}
    >
      <Icon glyph={glyph} />
      <span id={labelId} className="member-admin-menu-label">
        {label}
      </span>
      {detail === null ? null : (
        <span id={detailId} className="member-admin-menu-detail">
          {detail}
        </span>
      )}
    </button>
  );
}

function StatusItem({
  translate,
  accountStatus,
  onChoose,
}: {
  translate: Translator;
  accountStatus: AccountStatus;
  onChoose: (action: AdminAction) => void;
}): React.JSX.Element {
  if (accountStatus === "inactive") {
    return (
      <MenuItem
        glyph={ArrowCounterClockwise}
        label={translate("memberRecord.menu.reactivate")}
        detail={null}
        isDanger={false}
        onChoose={() => onChoose("reactivate")}
      />
    );
  }
  return (
    <MenuItem
      glyph={UserMinus}
      label={translate("memberRecord.menu.deactivate")}
      detail={null}
      isDanger
      onChoose={() => onChoose("deactivate")}
    />
  );
}

export function MemberAdminMenu({
  translate,
  member,
  openerRef,
  onChoose,
}: {
  translate: Translator;
  member: AdminMenuMember;
  /** El ⋯, que la ficha también enfoca al cancelar la franja de desactivar. */
  openerRef: React.RefObject<HTMLButtonElement | null>;
  onChoose: (action: AdminAction) => void;
}): React.JSX.Element {
  const menuId = useId();
  const { isOpen, containerRef, toggle, closeAndReturnFocus } =
    useDropdownMenu(openerRef);
  const label = translate("memberRecord.menu.open");

  function choose(action: AdminAction): void {
    closeAndReturnFocus();
    onChoose(action);
  }

  return (
    <div className="member-admin-menu-anchor" ref={containerRef}>
      <button
        ref={openerRef}
        type="button"
        className="member-record-action"
        aria-label={label}
        title={label}
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={toggle}
      >
        <Icon glyph={DotsThree} weight="bold" />
      </button>
      {isOpen ? (
        <div id={menuId} className="member-admin-menu">
          <MenuItem
            glyph={UserSwitch}
            label={translate("memberRecord.menu.changeRole")}
            detail={translate(`role.${member.role}`)}
            isDanger={false}
            onChoose={() => choose("changeRole")}
          />
          <MenuItem
            glyph={HandCoins}
            label={translate(
              member.membershipStatus === "waived"
                ? "memberRecord.menu.removeWaiver"
                : "memberRecord.menu.waive",
            )}
            detail={null}
            isDanger={false}
            onChoose={() => choose("waiver")}
          />
          {member.accountStatus === "incomplete" ? (
            <MenuItem
              glyph={PaperPlaneTilt}
              label={translate("memberRecord.menu.resendInvitation")}
              detail={null}
              isDanger={false}
              onChoose={() => choose("resendInvitation")}
            />
          ) : null}
          <hr className="member-admin-menu-rule" />
          <StatusItem
            translate={translate}
            accountStatus={member.accountStatus}
            onChoose={choose}
          />
        </div>
      ) : null}
    </div>
  );
}
