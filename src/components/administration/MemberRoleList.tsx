"use client";

import { useRef, useState } from "react";
import { memberInitials } from "@/lib/auth/member-initials";
import type { ClubMember } from "@/lib/auth/club-administration";
import { ROLES, type Role, parseRole } from "@/lib/auth/roles";
import type { Translator } from "@/lib/i18n/translator";
import {
  AdministrationNotice,
  type AdministrationNoticeState,
} from "./AdministrationNotice";

/**
 * La lista de socios del club con su rol (RF-8 del PRD de E3). La fila es la
 * de docs/mockups/directory-light.png reducida a lo que este ticket cubre:
 * iniciales, nombre, correo y el rol. Buscar, filtrar y dar de alta son de E5.
 *
 * El rol que se elige es un borrador hasta que el servidor lo confirma. Si lo
 * rechaza (el último Admin del club, por ejemplo), el borrador vuelve al rol
 * que el socio tiene de verdad: la lista no enseña un cambio que no ocurrió.
 */

type RoleDrafts = Readonly<Record<string, Role>>;

/**
 * Qué hacer con el rol que se eligió cuando la petición termina.
 *
 * - `settled`: el servidor dijo la última palabra, la haya aplicado o la haya
 *   rechazado por una regla. El borrador se tira y la fila vuelve a enseñar el
 *   rol que el socio tiene de verdad, que es lo que pide el caso del último
 *   Admin.
 * - `retryable`: no se sabe (la red, un 500). El borrador se queda puesto para
 *   que volver a intentarlo sea un clic y no elegir el rol otra vez.
 */
export type MemberRoleSaveResult = "settled" | "retryable";

function MemberRow({
  translate,
  member,
  draftRole,
  isBusy,
  onSelect,
  onSave,
}: {
  translate: Translator;
  member: ClubMember;
  draftRole: Role;
  isBusy: boolean;
  /** Recibe `null` sólo si el navegador devolviera algo que no es de las
   * opciones de abajo, que es lo mismo que decir nunca. */
  onSelect: (role: Role | null) => void;
  onSave: () => void;
}): React.JSX.Element {
  return (
    <li className="admin-member">
      <span className="admin-member-avatar" aria-hidden="true">
        {memberInitials(member.fullName)}
      </span>
      <div className="admin-member-identity">
        <span className="admin-member-name">{member.fullName}</span>
        <span className="admin-member-email">{member.email}</span>
      </div>
      <select
        className="admin-member-role"
        aria-label={translate("admin.members.roleLabel", {
          name: member.fullName,
        })}
        value={draftRole}
        disabled={isBusy}
        onChange={(event) => onSelect(parseRole(event.target.value))}
      >
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {translate(`role.${role}`)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="auth-submit"
        aria-label={translate("admin.members.saveLabel", {
          name: member.fullName,
        })}
        disabled={isBusy || draftRole === member.role}
        onClick={onSave}
      >
        {translate(isBusy ? "admin.members.saving" : "admin.members.save")}
      </button>
    </li>
  );
}

export function MemberRoleList({
  translate,
  members,
  notice,
  onSave,
}: {
  translate: Translator;
  members: readonly ClubMember[];
  notice: AdministrationNoticeState;
  onSave: (member: ClubMember, role: Role) => Promise<MemberRoleSaveResult>;
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<RoleDrafts>({});
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  // Como en la bandeja: el estado llega un pintado tarde para un doble clic.
  const isSavingRef = useRef(false);

  function selectRole(userId: string, role: Role | null): void {
    if (role === null) {
      return;
    }
    setDrafts((current) => ({ ...current, [userId]: role }));
  }

  function forgetDraft(userId: string): void {
    setDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([draftId]) => draftId !== userId),
      ),
    );
  }

  async function save(member: ClubMember, role: Role): Promise<void> {
    if (isSavingRef.current) {
      return;
    }
    isSavingRef.current = true;
    setSavingUserId(member.userId);
    const result = await onSave(member, role);
    isSavingRef.current = false;
    setSavingUserId(null);
    if (result === "settled") {
      forgetDraft(member.userId);
    }
  }

  return (
    <section className="admin-section" aria-labelledby="socios-del-club">
      <h2 id="socios-del-club">{translate("admin.members.title")}</h2>
      <AdministrationNotice notice={notice} />
      {members.length === 0 ? (
        <p className="admin-empty">{translate("admin.members.empty")}</p>
      ) : (
        <ul className="admin-members">
          {members.map((member) => {
            const draftRole = drafts[member.userId] ?? member.role;
            return (
              <MemberRow
                key={member.userId}
                translate={translate}
                member={member}
                draftRole={draftRole}
                isBusy={savingUserId === member.userId}
                onSelect={(role) => selectRole(member.userId, role)}
                onSave={() => void save(member, draftRole)}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
