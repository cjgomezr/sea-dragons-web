"use client";

import { useRef, useState } from "react";
import { ROLES, type Role, parseRole } from "@/lib/auth/roles";
import type { DirectoryMember } from "@/lib/directory/directory";
import type { Translator } from "@/lib/i18n/translator";

/**
 * El cambio de rol de un miembro desde su fila del directorio (#240), mudado
 * tal cual desde la lista de la pantalla de administración de E3 (#212).
 *
 * El rol que se elige es un borrador hasta que el servidor lo confirma. Si lo
 * rechaza (el último Admin del club, por ejemplo), el borrador vuelve al rol
 * que el miembro tiene de verdad: la fila no enseña un cambio que no ocurrió.
 */

/** Lo que el control necesita saber del miembro de su fila. */
export type RoleEditableMember = Pick<
  DirectoryMember,
  "userId" | "fullName" | "role"
>;

/**
 * Qué hacer con el rol que se eligió cuando la petición termina.
 *
 * - `settled`: el servidor dijo la última palabra, la haya aplicado o la haya
 *   rechazado por una regla. El borrador se tira y la fila vuelve a enseñar el
 *   rol que el miembro tiene de verdad, que es lo que pide el caso del último
 *   Admin.
 * - `retryable`: no se sabe (la red, un 500). El borrador se queda puesto para
 *   que volver a intentarlo sea un clic y no elegir el rol otra vez.
 */
export type MemberRoleSaveResult = "settled" | "retryable";

export type SaveMemberRole = (
  member: RoleEditableMember,
  role: Role,
) => Promise<MemberRoleSaveResult>;

type RoleDrafts = Readonly<Record<string, Role>>;

export type RoleDraftsControl = {
  readonly draftFor: (member: RoleEditableMember) => Role;
  readonly savingUserId: string | null;
  readonly select: (userId: string, role: Role | null) => void;
  readonly save: (member: RoleEditableMember) => void;
};

/** Los borradores de toda la tabla y el guardado en curso. Viven arriba de
 * las filas porque mientras se guarda un rol no sale ningún otro, sea de la
 * fila que sea. */
export function useRoleDrafts(onSave: SaveMemberRole): RoleDraftsControl {
  const [drafts, setDrafts] = useState<RoleDrafts>({});
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  // El estado desactiva los botones en el siguiente pintado, pero un doble
  // clic llega antes. La referencia cambia en el acto.
  const isSavingRef = useRef(false);

  function draftFor(member: RoleEditableMember): Role {
    return drafts[member.userId] ?? member.role;
  }

  function select(userId: string, role: Role | null): void {
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

  async function saveDraft(member: RoleEditableMember): Promise<void> {
    if (isSavingRef.current) {
      return;
    }
    isSavingRef.current = true;
    setSavingUserId(member.userId);
    const result = await onSave(member, draftFor(member));
    isSavingRef.current = false;
    setSavingUserId(null);
    if (result === "settled") {
      forgetDraft(member.userId);
    }
  }

  return {
    draftFor,
    savingUserId,
    select,
    save: (member) => void saveDraft(member),
  };
}

export function MemberRoleControl({
  translate,
  member,
  drafts,
}: {
  translate: Translator;
  member: RoleEditableMember;
  drafts: RoleDraftsControl;
}): React.JSX.Element {
  const draftRole = drafts.draftFor(member);
  // Hay un guardado en curso, de este miembro o de otro: el clic no saldría.
  const isLocked = drafts.savingUserId !== null;
  const isSaving = drafts.savingUserId === member.userId;
  return (
    <span className="directory-role-control">
      <select
        className="admin-member-role"
        aria-label={translate("admin.members.roleLabel", {
          name: member.fullName,
        })}
        value={draftRole}
        disabled={isLocked}
        onChange={(event) =>
          drafts.select(member.userId, parseRole(event.target.value))
        }
      >
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {translate(`role.${role}`)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="admin-secondary"
        aria-label={translate("admin.members.saveLabel", {
          name: member.fullName,
        })}
        disabled={isLocked || draftRole === member.role}
        onClick={() => drafts.save(member)}
      >
        {translate(isSaving ? "admin.members.saving" : "admin.members.save")}
      </button>
    </span>
  );
}
