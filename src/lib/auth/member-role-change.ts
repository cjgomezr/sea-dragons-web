import {
  type AuditActor,
  type AuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import {
  type NotificationWriter,
  notifyMember,
} from "@/lib/notifications/notify-member";
import { MemberNotFoundError } from "./account-activation";
import type { RoleRequestGateways, RoleRequestMember } from "./role-request";
import { type Role, hasCapability } from "./roles";

/**
 * Cambiar el rol de un socio (FR-014, AC-008, RF-6 y RF-7 del PRD de E3),
 * contado sin Supabase delante.
 *
 * La regla que no puede depender de la aplicación vive en la base, en
 * `change_member_role` de `0014_change_member_role.sql`: el club nunca se
 * queda sin Admin, tampoco con dos degradaciones simultáneas. Aquí se decide
 * quién puede pedirlo, qué queda en la bitácora y a quién se avisa (RF-6 del
 * PRD de E6).
 *
 * El socio se nombra por su `user_id`, el mismo id con el que la bitácora
 * nombra al socio en `role.changed` desde #210.
 */

/** El rol de un socio tras la petición. Si ya tenía el rol pedido, los dos
 * son iguales y no se escribió nada. */
export type MemberRoleChange = {
  readonly userId: string;
  readonly previousRole: Role;
  readonly role: Role;
};

export type MemberRoleChangeWriteInput = {
  readonly targetUserId: string;
  readonly clubId: string;
  readonly actorId: string;
  readonly newRole: Role;
};

/** Lo que responde la base a un cambio. Sólo `changed` escribió algo. */
export type MemberRoleChangeWrite =
  | {
      readonly kind: "changed";
      readonly previousRole: Role;
      readonly newRole: Role;
    }
  | { readonly kind: "unchanged"; readonly role: Role }
  | { readonly kind: "last_admin" }
  | { readonly kind: "actor_not_admin" }
  | { readonly kind: "not_found" };

export type MemberRoleChangeGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly roles: {
    applyRoleChange(
      input: MemberRoleChangeWriteInput,
    ): Promise<MemberRoleChangeWrite>;
  };
  readonly audit: AuditLogWriter;
  readonly notifications: NotificationWriter;
};

const MEMBER_ENTITY_TYPE = "member";
/** El único rol que la base protege de quedarse sin nadie. */
const PROTECTED_ROLE: Role = "Admin";
const LAST_ADMIN_REASON = "last_admin";

export class MemberRoleChangeForbiddenError extends Error {
  constructor() {
    super("Sólo un Admin puede cambiar el rol de un socio.");
    this.name = "MemberRoleChangeForbiddenError";
  }
}

export class MemberToChangeNotFoundError extends Error {
  constructor(userId: string) {
    super(`No existe el socio ${userId} en tu club.`);
    this.name = "MemberToChangeNotFoundError";
  }
}

export class LastAdminError extends Error {
  constructor() {
    super(
      "Es el último Admin del club y no se le puede cambiar el rol. Nombra antes a otro Admin.",
    );
    this.name = "LastAdminError";
  }
}

/** El rol quedó cambiado en la base, pero su rastro no llegó a la bitácora.
 * No es un éxito completo y no se responde como tal. */
export class RoleChangeNotAuditedError extends Error {
  readonly change: MemberRoleChange;

  constructor(change: MemberRoleChange, cause: unknown) {
    super(
      `El socio ${change.userId} pasó de ${change.previousRole} a ${change.role}, pero no se pudo registrar en la bitácora.`,
    );
    this.name = "RoleChangeNotAuditedError";
    this.change = change;
    this.cause = cause;
  }
}

async function findActor(
  gateways: MemberRoleChangeGateways,
  actorId: string,
): Promise<RoleRequestMember> {
  const actor = await gateways.members.findRoleRequestMember(actorId);
  if (actor === null) {
    throw new MemberNotFoundError(actorId);
  }
  // La frontera ya lo niega por la ruta. Cambiar roles no se deja a un solo
  // cerrojo, como en `decideRoleRequest`.
  if (!hasCapability(actor.role, "manageUsersAndRoles")) {
    throw new MemberRoleChangeForbiddenError();
  }
  return actor;
}

/** Sólo identificadores y roles: ni nombre ni correo (NFR-010). */
async function auditLastAdminRefusal(
  audit: AuditLogWriter,
  actor: AuditActor,
  input: { readonly targetUserId: string; readonly newRole: Role },
): Promise<void> {
  await recordAuditEvent(audit, {
    actor,
    clubId: actor.clubId,
    action: "role.changed",
    entityType: MEMBER_ENTITY_TYPE,
    entityId: input.targetUserId,
    result: "failure",
    metadata: {
      previousRole: PROTECTED_ROLE,
      newRole: input.newRole,
      reason: LAST_ADMIN_REASON,
    },
  });
}

async function auditAppliedChange(
  audit: AuditLogWriter,
  actor: AuditActor,
  change: MemberRoleChange,
): Promise<void> {
  try {
    await recordAuditEvent(audit, {
      actor,
      clubId: actor.clubId,
      action: "role.changed",
      entityType: MEMBER_ENTITY_TYPE,
      entityId: change.userId,
      result: "success",
      metadata: { previousRole: change.previousRole, newRole: change.role },
    });
  } catch (error) {
    throw new RoleChangeNotAuditedError(change, error);
  }
}

type MemberRoleChangeInput = {
  readonly actorId: string;
  readonly targetUserId: string;
  readonly newRole: Role;
};

/** Traduce la respuesta de la base a un resultado o a un error, y deja en la
 * bitácora lo que corresponde a cada caso. */
async function settleRoleChangeWrite(
  gateways: Pick<MemberRoleChangeGateways, "audit" | "notifications">,
  settlement: {
    readonly actor: AuditActor;
    readonly input: MemberRoleChangeInput;
    readonly write: MemberRoleChangeWrite;
  },
): Promise<MemberRoleChange> {
  const { actor, input, write } = settlement;
  switch (write.kind) {
    case "changed": {
      const change: MemberRoleChange = {
        userId: input.targetUserId,
        previousRole: write.previousRole,
        role: write.newRole,
      };
      // `notifyMember` no lanza: un aviso perdido queda registrado y el
      // cambio responde igual. Va antes de la bitácora para que el socio se
      // entere también si ella falla, porque el rol ya cambió.
      await notifyMember(gateways.notifications, {
        recipientUserId: change.userId,
        type: "role_changed",
        data: { newRole: change.role },
      });
      await auditAppliedChange(gateways.audit, actor, change);
      return change;
    }
    case "unchanged":
      return {
        userId: input.targetUserId,
        previousRole: write.role,
        role: write.role,
      };
    case "last_admin":
      await auditLastAdminRefusal(gateways.audit, actor, input);
      throw new LastAdminError();
    case "actor_not_admin":
      throw new MemberRoleChangeForbiddenError();
    case "not_found":
      throw new MemberToChangeNotFoundError(input.targetUserId);
  }
}

/** Aplica el cambio de un Admin y lo deja en la bitácora. La bitácora va
 * después de la escritura: auditar primero dejaría una entrada de éxito para
 * un cambio que la base no aplicó. Un rol que ya se tenía no es un cambio y
 * no deja entrada. */
export async function changeMemberRole(
  gateways: MemberRoleChangeGateways,
  input: MemberRoleChangeInput,
): Promise<MemberRoleChange> {
  const actor = await findActor(gateways, input.actorId);
  const write = await gateways.roles.applyRoleChange({
    targetUserId: input.targetUserId,
    clubId: actor.clubId,
    actorId: input.actorId,
    newRole: input.newRole,
  });
  return settleRoleChangeWrite(gateways, {
    actor: { id: input.actorId, clubId: actor.clubId },
    input,
    write,
  });
}
