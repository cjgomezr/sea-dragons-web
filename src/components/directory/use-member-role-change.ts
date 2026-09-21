"use client";

import { useState } from "react";
import type { Role } from "@/lib/auth/roles";
import type { Translator } from "@/lib/i18n/translator";
import type { AdministrationNoticeState } from "./AdministrationNotice";
import type { SaveMemberRole } from "./MemberRoleControl";
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
 */
export function useMemberRoleChange(
  translate: Translator,
  onRoleChanged: (userId: string, role: Role) => void,
): {
  readonly notice: AdministrationNoticeState;
  readonly saveRole: SaveMemberRole;
} {
  const [notice, setNotice] = useState<AdministrationNoticeState>(null);

  const saveRole: SaveMemberRole = async (member, role) => {
    const outcome = await submitMemberRole(member.userId, role);
    if (outcome.kind === "failed") {
      setNotice({
        kind: "error",
        message: describeAdministrationFailure(
          translate,
          "roleChange",
          outcome,
        ),
      });
      return isChangeRefused(outcome.failure) ? "settled" : "retryable";
    }
    onRoleChanged(member.userId, outcome.role);
    setNotice({
      kind: "success",
      message: translate("admin.members.saved", {
        name: member.fullName,
        role: translate(`role.${outcome.role}`),
      }),
    });
    return "settled";
  };

  return { notice, saveRole };
}
