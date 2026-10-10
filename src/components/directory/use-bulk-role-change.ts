"use client";

import { useRef, useState } from "react";
import type { BulkRoleChangeFailureReason } from "@/lib/auth/bulk-role-change-reasons";
import type {
  BulkRoleChange,
  BulkRoleChangeResult,
} from "@/lib/auth/member-roles-bulk-change";
import type { Role } from "@/lib/auth/roles";
import type { DirectoryMember } from "@/lib/directory/directory";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import type { AdministrationNoticeState } from "./AdministrationNotice";
import {
  describeAdministrationFailure,
  submitMemberRoles,
} from "./role-administration-client";

/**
 * El cambio de rol en bloque de un Admin (#552) desde el directorio, y el
 * aviso de cómo fue. Como el cambio de uno (#550), la fila sólo cambia cuando
 * el servidor lo confirma, y mientras una petición está en vuelo no sale
 * otra: un doble clic en "Cambiar roles" la manda una vez.
 */

const FAILURE_REASON_MESSAGES = {
  last_admin: "directory.bulk.reason.last_admin",
  not_found: "directory.bulk.reason.not_found",
  forbidden: "directory.bulk.reason.forbidden",
  not_audited: "directory.bulk.reason.not_audited",
  unexpected: "directory.bulk.reason.unexpected",
} as const satisfies Readonly<Record<BulkRoleChangeFailureReason, MessageKey>>;

type FailedResult = Extract<BulkRoleChangeResult, { kind: "failed" }>;

function describeFailures(
  translate: Translator,
  failed: readonly FailedResult[],
  nameOf: (userId: string) => string,
): string {
  const members = failed
    .map((result) =>
      translate("directory.bulk.failedMember", {
        name: nameOf(result.userId),
        reason: translate(FAILURE_REASON_MESSAGES[result.reason]),
      }),
    )
    .join(", ");
  return translate("directory.bulk.failed", { members });
}

/** "{n} socios ahora son {rol}.", cuántos ya lo eran y cuáles no cambiaron
 * y por qué. Con algún fallo es un error: hay que mirarlo. */
export function describeBulkRoleChange(
  translate: Translator,
  change: BulkRoleChange,
  nameOf: (userId: string) => string,
): AdministrationNoticeState {
  const role = translate(`role.${change.role}`);
  const count = (kind: BulkRoleChangeResult["kind"]): number =>
    change.results.filter((result) => result.kind === kind).length;
  const failed = change.results.filter(
    (result): result is FailedResult => result.kind === "failed",
  );
  const sentences = [
    count("changed") > 0
      ? translate("directory.bulk.changed", { count: count("changed"), role })
      : null,
    count("unchanged") > 0
      ? translate("directory.bulk.unchanged", { count: count("unchanged") })
      : null,
    failed.length > 0 ? describeFailures(translate, failed, nameOf) : null,
  ].filter((sentence) => sentence !== null);
  return {
    kind: failed.length > 0 ? "error" : "success",
    message: sentences.join(" "),
  };
}

/** El rol que la fila tiene que enseñar tras el resultado, o `null` si no
 * cambió. Uno que cambió sin quedar en la bitácora también cambió. */
function appliedRoleOf(result: BulkRoleChangeResult, role: Role): Role | null {
  if (result.kind === "changed") {
    return result.role;
  }
  return result.kind === "failed" && result.reason === "not_audited"
    ? role
    : null;
}

export function useBulkRoleChange({
  translate,
  onRoleChanged,
  onApplied,
}: {
  translate: Translator;
  onRoleChanged: (userId: string, role: Role) => void;
  /** Tras una respuesta del servidor con el resultado de cada socio. */
  onApplied: () => void;
}): {
  readonly notice: AdministrationNoticeState;
  readonly isSaving: boolean;
  readonly changeRoles: (
    members: readonly DirectoryMember[],
    role: Role,
  ) => Promise<void>;
} {
  const [notice, setNotice] = useState<AdministrationNoticeState>(null);
  const [isSaving, setIsSaving] = useState(false);
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSavingRef = useRef(false);

  async function changeRoles(
    members: readonly DirectoryMember[],
    role: Role,
  ): Promise<void> {
    if (isSavingRef.current) {
      return;
    }
    isSavingRef.current = true;
    setIsSaving(true);
    setNotice(null);
    const outcome = await submitMemberRoles(
      members.map((member) => member.userId),
      role,
    );
    isSavingRef.current = false;
    setIsSaving(false);
    if (outcome.kind === "failed") {
      setNotice({
        kind: "error",
        message: describeAdministrationFailure(
          translate,
          "roleChange",
          outcome,
        ),
      });
      return;
    }
    for (const result of outcome.change.results) {
      const appliedRole = appliedRoleOf(result, outcome.change.role);
      if (appliedRole !== null) {
        onRoleChanged(result.userId, appliedRole);
      }
    }
    const names = new Map(
      members.map((member) => [member.userId, member.fullName]),
    );
    setNotice(
      describeBulkRoleChange(
        translate,
        outcome.change,
        // El servidor sólo responde por los socios que se le mandaron; el id
        // es por si la lista se rehízo entre medias y ya no está.
        (userId) => names.get(userId) ?? userId,
      ),
    );
    onApplied();
  }

  return { notice, isSaving, changeRoles };
}
