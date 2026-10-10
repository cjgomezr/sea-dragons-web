"use client";

import type { Role } from "@/lib/auth/roles";
import type { Translator } from "@/lib/i18n/translator";
import { AdministrationNotice } from "./AdministrationNotice";
import {
  MemberRoleControl,
  type RoleEditableMember,
  useRoleDrafts,
} from "./MemberRoleControl";
import { useMemberRoleChange } from "./use-member-role-change";

/**
 * El cambio de rol desde la ficha del miembro (#549). La fila del directorio
 * dejó de llevarlo con el rediseño de E21, y hasta que llegue el panel lateral
 * (#550) es aquí donde el Admin lo cambia. Es el mismo control y el mismo
 * endpoint que tenía la fila (#240): el rol sólo cambia cuando el servidor lo
 * confirma.
 */
export function MemberRecordRole({
  translate,
  member,
  onRoleChanged,
}: {
  translate: Translator;
  member: RoleEditableMember;
  onRoleChanged: (role: Role) => void;
}): React.JSX.Element {
  const roleChange = useMemberRoleChange(translate, (_userId, role) =>
    onRoleChanged(role),
  );
  const drafts = useRoleDrafts(roleChange.saveRole);
  return (
    <section className="admin-section" aria-labelledby="ficha-rol">
      <h2 id="ficha-rol">{translate("memberRecord.role.title")}</h2>
      <AdministrationNotice notice={roleChange.notice} />
      <MemberRoleControl
        translate={translate}
        member={member}
        drafts={drafts}
      />
    </section>
  );
}
