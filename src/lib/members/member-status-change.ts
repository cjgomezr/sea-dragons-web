import {
  type AuditActor,
  type AuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import {
  type IdentityConfirmationReader,
  type MemberAccountStore,
  MemberNotFoundError,
  resolveAccountStatus,
} from "@/lib/auth/account-activation";
import type { AccountStatus } from "@/lib/auth/account-status";
import { MemberToChangeNotFoundError } from "@/lib/auth/member-role-change";
import type {
  RoleRequestGateways,
  RoleRequestMember,
} from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";

/**
 * Dar de baja y reactivar a un miembro (FR-085, AC-040, RF-6 del PRD de E5),
 * contado sin Supabase delante.
 *
 * La regla que no puede depender de la aplicación vive en la base, en
 * `set_member_status` de `0017_set_member_status.sql`: el club nunca se queda
 * sin un Admin activo, tampoco con una baja y una degradación simultáneas.
 * Aquí se decide quién puede pedirlo, a qué estado vuelve quien se reactiva y
 * qué queda en la bitácora.
 *
 * La baja no borra nada. Lo que saca al miembro del directorio, de los conteos
 * de grupos, de la bandeja de solicitudes y de la sesión es que cada uno de
 * esos sitios mira su estado.
 */

/** Lo que un Admin puede pedir. `incomplete` no está: ese estado lo decide el
 * registro, no un Admin. */
export const REQUESTABLE_MEMBER_STATUSES = ["active", "inactive"] as const;

export type RequestableMemberStatus =
  (typeof REQUESTABLE_MEMBER_STATUSES)[number];

/** El estado del miembro antes y después de la petición. Pedir `active` puede
 * acabar en `incomplete` si al miembro le falta algo del registro. Si ya
 * estaba donde se pedía, los dos son iguales y no se escribió nada. */
export type MemberStatusChange = {
  readonly userId: string;
  readonly previousStatus: AccountStatus;
  readonly status: AccountStatus;
};

export type MemberStatusWriteInput = {
  readonly targetUserId: string;
  readonly clubId: string;
  readonly actorId: string;
  readonly newStatus: AccountStatus;
};

/** Lo que responde la base a un cambio. Sólo `changed` escribió algo. */
export type MemberStatusWrite =
  | {
      readonly kind: "changed";
      readonly previousStatus: AccountStatus;
      readonly newStatus: AccountStatus;
    }
  | { readonly kind: "unchanged"; readonly status: AccountStatus }
  | { readonly kind: "last_admin"; readonly previousStatus: AccountStatus }
  | { readonly kind: "self_deactivation" }
  | { readonly kind: "actor_not_admin" }
  | { readonly kind: "not_found" };

export type MemberStatusChangeGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly accounts: Pick<MemberAccountStore, "findByUserId">;
  readonly identities: IdentityConfirmationReader;
  readonly statuses: {
    applyStatusChange(
      input: MemberStatusWriteInput,
    ): Promise<MemberStatusWrite>;
  };
  readonly audit: AuditLogWriter;
};

const MEMBER_ENTITY_TYPE = "member";
const DEACTIVATED_STATUS: AccountStatus = "inactive";
const LAST_ADMIN_REASON = "last_admin";

export class MemberStatusChangeForbiddenError extends Error {
  constructor() {
    super("Sólo un Admin puede dar de baja o reactivar a un miembro.");
    this.name = "MemberStatusChangeForbiddenError";
  }
}

export class LastAdminDeactivationError extends Error {
  constructor() {
    super(
      "Es el último Admin del club y no se le puede dar de baja. Nombra antes a otro Admin.",
    );
    this.name = "LastAdminDeactivationError";
  }
}

export class SelfDeactivationError extends Error {
  constructor() {
    super(
      "Un Admin no puede darse de baja a sí mismo: la baja de un Admin la hace otro Admin.",
    );
    this.name = "SelfDeactivationError";
  }
}

/** El estado quedó cambiado en la base, pero su rastro no llegó a la
 * bitácora. No es un éxito completo y no se responde como tal. */
export class StatusChangeNotAuditedError extends Error {
  readonly change: MemberStatusChange;

  constructor(change: MemberStatusChange, cause: unknown) {
    super(
      `El miembro ${change.userId} pasó de ${change.previousStatus} a ${change.status}, pero no se pudo registrar en la bitácora.`,
    );
    this.name = "StatusChangeNotAuditedError";
    this.change = change;
    this.cause = cause;
  }
}

async function findActor(
  gateways: MemberStatusChangeGateways,
  actorId: string,
): Promise<RoleRequestMember> {
  const actor = await gateways.members.findRoleRequestMember(actorId);
  if (actor === null) {
    throw new MemberNotFoundError(actorId);
  }
  // La frontera ya lo niega por la ruta. Cerrar el acceso de alguien no se
  // deja a un solo cerrojo, como en `changeMemberRole`.
  if (!hasCapability(actor.role, "manageUsersAndRoles")) {
    throw new MemberStatusChangeForbiddenError();
  }
  return actor;
}

/** A qué estado vuelve quien se reactiva: el que le da la regla del registro
 * (FR-083). Una cuenta que se dio de baja a medias vuelve a medias. Un dato
 * leído tarde sólo puede faltar, no sobrar: quien está de baja no edita su
 * perfil, así que en el peor caso vuelve `incomplete` y el registro lo
 * activa en cuanto lo abre. */
async function resolveReactivatedStatus(
  gateways: MemberStatusChangeGateways,
  target: { readonly userId: string; readonly clubId: string },
): Promise<AccountStatus> {
  const record = await gateways.accounts.findByUserId(target.userId);
  if (record === null || record.clubId !== target.clubId) {
    throw new MemberToChangeNotFoundError(target.userId);
  }
  return resolveAccountStatus({
    profile: record.profile,
    emailConfirmed: await gateways.identities.isEmailConfirmed(target.userId),
  });
}

/** Sólo identificadores y estados: ni nombre ni correo (NFR-010). */
async function auditLastAdminRefusal(
  audit: AuditLogWriter,
  actor: AuditActor,
  refusal: {
    readonly targetUserId: string;
    readonly previousStatus: AccountStatus;
  },
): Promise<void> {
  await recordAuditEvent(audit, {
    actor,
    clubId: actor.clubId,
    action: "member.status_changed",
    entityType: MEMBER_ENTITY_TYPE,
    entityId: refusal.targetUserId,
    result: "failure",
    metadata: {
      previousStatus: refusal.previousStatus,
      newStatus: DEACTIVATED_STATUS,
      reason: LAST_ADMIN_REASON,
    },
  });
}

async function auditAppliedChange(
  audit: AuditLogWriter,
  actor: AuditActor,
  change: MemberStatusChange,
): Promise<void> {
  try {
    await recordAuditEvent(audit, {
      actor,
      clubId: actor.clubId,
      action: "member.status_changed",
      entityType: MEMBER_ENTITY_TYPE,
      entityId: change.userId,
      result: "success",
      metadata: {
        previousStatus: change.previousStatus,
        newStatus: change.status,
      },
    });
  } catch (error) {
    throw new StatusChangeNotAuditedError(change, error);
  }
}

/** Traduce la respuesta de la base a un resultado o a un error, y deja en la
 * bitácora lo que corresponde a cada caso. */
async function settleStatusWrite(
  audit: AuditLogWriter,
  settlement: {
    readonly actor: AuditActor;
    readonly targetUserId: string;
    readonly write: MemberStatusWrite;
  },
): Promise<MemberStatusChange> {
  const { actor, targetUserId, write } = settlement;
  switch (write.kind) {
    case "changed": {
      const change: MemberStatusChange = {
        userId: targetUserId,
        previousStatus: write.previousStatus,
        status: write.newStatus,
      };
      await auditAppliedChange(audit, actor, change);
      return change;
    }
    case "unchanged":
      return {
        userId: targetUserId,
        previousStatus: write.status,
        status: write.status,
      };
    case "last_admin":
      await auditLastAdminRefusal(audit, actor, {
        targetUserId,
        previousStatus: write.previousStatus,
      });
      throw new LastAdminDeactivationError();
    case "self_deactivation":
      throw new SelfDeactivationError();
    case "actor_not_admin":
      throw new MemberStatusChangeForbiddenError();
    case "not_found":
      throw new MemberToChangeNotFoundError(targetUserId);
  }
}

type MemberStatusChangeInput = {
  readonly actorId: string;
  readonly targetUserId: string;
  readonly status: RequestableMemberStatus;
};

/** Aplica la baja o la reactivación de un Admin y la deja en la bitácora,
 * después de la escritura: auditar primero dejaría una entrada de éxito para
 * un cambio que la base no aplicó. */
export async function changeMemberStatus(
  gateways: MemberStatusChangeGateways,
  input: MemberStatusChangeInput,
): Promise<MemberStatusChange> {
  const actor = await findActor(gateways, input.actorId);
  const newStatus =
    input.status === DEACTIVATED_STATUS
      ? DEACTIVATED_STATUS
      : await resolveReactivatedStatus(gateways, {
          userId: input.targetUserId,
          clubId: actor.clubId,
        });
  const write = await gateways.statuses.applyStatusChange({
    targetUserId: input.targetUserId,
    clubId: actor.clubId,
    actorId: input.actorId,
    newStatus,
  });
  return settleStatusWrite(gateways.audit, {
    actor: { id: input.actorId, clubId: actor.clubId },
    targetUserId: input.targetUserId,
    write,
  });
}
