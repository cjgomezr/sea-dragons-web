"use client";

import { useState } from "react";
import type { Role } from "@/lib/auth/roles";
import type { Translator } from "@/lib/i18n/translator";
import type { AdministrationNoticeState } from "./AdministrationNotice";
import type { RoleEditableMember, SaveMemberRole } from "./MemberRoleControl";
import {
  describeAdministrationFailure,
  isChangeRefused,
  submitMemberRole,
} from "./role-administration-client";

/**
 * Guardar el rol de un miembro desde el directorio (#240) y contar cómo fue.
 *
 * Es lo que hacía la pantalla de administración de E3 (#212), sin cambiar
 * nada: el rol nuevo sólo llega a la lista cuando el servidor lo confirma, y
 * lo que el servidor rechaza por una regla (el último Admin) no se reintenta.
 * La ficha (#549) y el panel lateral del directorio (#550) lo usan igual.
 */

/** Cómo terminó un cambio de rol, con el error ya escrito en el idioma de la
 * pantalla. `isRefused` dice si el servidor lo rechazó por una regla (volver
 * a mandarlo daría lo mismo) o si fue un tropiezo que vale la pena
 * reintentar. */
export type RoleChangeResult =
  | { readonly kind: "changed"; readonly role: Role }
  | {
      readonly kind: "failed";
      readonly message: string;
      readonly isRefused: boolean;
    };

export async function requestRoleChange(
  translate: Translator,
  member: RoleEditableMember,
  role: Role,
): Promise<RoleChangeResult> {
  const outcome = await submitMemberRole(member.userId, role);
  if (outcome.kind === "failed") {
    return {
      kind: "failed",
      message: describeAdministrationFailure(translate, "roleChange", outcome),
      isRefused: isChangeRefused(outcome.failure),
    };
  }
  return { kind: "changed", role: outcome.role };
}

export function useMemberRoleChange(
  translate: Translator,
  onRoleChanged: (userId: string, role: Role) => void,
): {
  readonly notice: AdministrationNoticeState;
  readonly saveRole: SaveMemberRole;
} {
  const [notice, setNotice] = useState<AdministrationNoticeState>(null);

  const saveRole: SaveMemberRole = async (member, role) => {
    const result = await requestRoleChange(translate, member, role);
    if (result.kind === "failed") {
      setNotice({ kind: "error", message: result.message });
      return result.isRefused ? "settled" : "retryable";
    }
    onRoleChanged(member.userId, result.role);
    setNotice({
      kind: "success",
      message: translate("admin.members.saved", {
        name: member.fullName,
        role: translate(`role.${result.role}`),
      }),
    });
    return "settled";
  };

  return { notice, saveRole };
}
