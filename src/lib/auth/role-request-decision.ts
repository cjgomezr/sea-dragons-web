import {
  type AuditActor,
  type AuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import {
  type NewNotification,
  type NotificationWriter,
  notifyMember,
} from "@/lib/notifications/notify-member";
import { MemberNotFoundError } from "./account-activation";
import type {
  RequestableRole,
  RoleRequestGateways,
  RoleRequestMember,
} from "./role-request";
import { type Role, hasCapability } from "./roles";

/**
 * Aprobar o rechazar una solicitud de rol (FR-011, AC-006, RF-5 del PRD de
 * E3), contado sin Supabase delante.
 *
 * Las dos reglas que no pueden depender de la aplicación viven en la base, en
 * `decide_role_request` de `0013_decide_role_request.sql`: solicitud y rol
 * cambian juntos o no cambia ninguno, y de dos decisiones simultáneas sólo se
 * aplica una. Aquí se decide quién puede pedirla, qué queda en la bitácora y
 * a quién se avisa (RF-6 del PRD de E6).
 */

export const ROLE_REQUEST_DECISIONS = ["approved", "rejected"] as const;

export type RoleRequestDecision = (typeof ROLE_REQUEST_DECISIONS)[number];

/** Una solicitud recién decidida, tal como la devuelve el endpoint. */
export type DecidedRoleRequest = {
  readonly id: string;
  readonly status: RoleRequestDecision;
  readonly decidedBy: string;
  readonly decidedAt: string;
};

export type RoleChange = {
  readonly memberUserId: string;
  readonly previousRole: Role;
  readonly newRole: RequestableRole;
};

/** Quién pidió el rol que se rechazó, para avisarle. */
export type RoleRequester = {
  readonly memberUserId: string;
  readonly requestedRole: RequestableRole;
};

export type RoleRequestDecisionWriteInput = {
  readonly requestId: string;
  readonly clubId: string;
  readonly decidedBy: string;
  readonly decision: RoleRequestDecision;
};

/** Lo que responde la base a una decisión. Sólo las dos primeras la aplicaron;
 * las demás no cambiaron nada. */
export type RoleRequestDecisionWrite =
  | {
      readonly kind: "approved";
      readonly request: DecidedRoleRequest;
      readonly roleChange: RoleChange;
    }
  | {
      readonly kind: "rejected";
      readonly request: DecidedRoleRequest;
      readonly requester: RoleRequester;
    }
  | { readonly kind: "already_decided"; readonly status: RoleRequestDecision }
  | { readonly kind: "role_already_granted" }
  | { readonly kind: "not_found" };

export type RoleRequestDecisionGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly decisions: {
    applyDecision(
      input: RoleRequestDecisionWriteInput,
    ): Promise<RoleRequestDecisionWrite>;
  };
  readonly audit: AuditLogWriter;
  readonly notifications: NotificationWriter;
};

/** Qué entidad nombra cada entrada de la bitácora. */
const ROLE_REQUEST_ENTITY_TYPE = "role_request";
const MEMBER_ENTITY_TYPE = "member";

export class RoleRequestDecisionForbiddenError extends Error {
  constructor() {
    super("Sólo un Admin puede aprobar o rechazar solicitudes de rol.");
    this.name = "RoleRequestDecisionForbiddenError";
  }
}

export class RoleRequestNotFoundError extends Error {
  constructor(requestId: string) {
    super(`No existe la solicitud de rol ${requestId} en tu club.`);
    this.name = "RoleRequestNotFoundError";
  }
}

export class RoleRequestAlreadyDecidedError extends Error {
  readonly status: RoleRequestDecision;

  constructor(status: RoleRequestDecision) {
    super(
      status === "approved"
        ? "Esta solicitud ya estaba aprobada. La primera decisión se conserva."
        : "Esta solicitud ya estaba rechazada. La primera decisión se conserva.",
    );
    this.name = "RoleRequestAlreadyDecidedError";
    this.status = status;
  }
}

export class RoleAlreadyGrantedError extends Error {
  constructor() {
    super(
      "Esa persona ya tiene ese rol o uno mayor. La solicitud sigue pendiente: recházala.",
    );
    this.name = "RoleAlreadyGrantedError";
  }
}

/** La decisión quedó aplicada en la base, pero su rastro no llegó a la
 * bitácora. No es un éxito completo y no se responde como tal. */
export class DecisionNotAuditedError extends Error {
  readonly request: DecidedRoleRequest;

  constructor(request: DecidedRoleRequest, cause: unknown) {
    super(
      `La solicitud ${request.id} quedó ${request.status === "approved" ? "aprobada" : "rechazada"}, pero no se pudo registrar en la bitácora.`,
    );
    this.name = "DecisionNotAuditedError";
    this.request = request;
    this.cause = cause;
  }
}

async function findDecider(
  gateways: RoleRequestDecisionGateways,
  deciderId: string,
): Promise<RoleRequestMember> {
  const decider = await gateways.members.findRoleRequestMember(deciderId);
  if (decider === null) {
    throw new MemberNotFoundError(deciderId);
  }
  // La frontera ya lo niega por la ruta. Esto cubre que la ruta llegue por un
  // camino que la frontera no casó: cambiar roles no se deja a un solo cerrojo.
  if (!hasCapability(decider.role, "manageUsersAndRoles")) {
    throw new RoleRequestDecisionForbiddenError();
  }
  return decider;
}

type AppliedDecision = Extract<
  RoleRequestDecisionWrite,
  { readonly kind: "approved" | "rejected" }
>;

function assertApplied(
  write: RoleRequestDecisionWrite,
  requestId: string,
): AppliedDecision {
  switch (write.kind) {
    case "approved":
    case "rejected":
      return write;
    case "already_decided":
      throw new RoleRequestAlreadyDecidedError(write.status);
    case "role_already_granted":
      throw new RoleAlreadyGrantedError();
    case "not_found":
      throw new RoleRequestNotFoundError(requestId);
  }
}

/** Sólo identificadores y valores de estado o rol: ni nombre, ni correo, ni
 * justificación (NFR-010). */
async function auditDecision(
  audit: AuditLogWriter,
  actor: AuditActor,
  applied: AppliedDecision,
): Promise<void> {
  await recordAuditEvent(audit, {
    actor,
    clubId: actor.clubId,
    action: "role_request.decided",
    entityType: ROLE_REQUEST_ENTITY_TYPE,
    entityId: applied.request.id,
    result: "success",
    metadata: { decision: applied.request.status },
  });
  if (applied.kind === "approved") {
    await recordAuditEvent(audit, {
      actor,
      clubId: actor.clubId,
      action: "role.changed",
      entityType: MEMBER_ENTITY_TYPE,
      entityId: applied.roleChange.memberUserId,
      result: "success",
      metadata: {
        previousRole: applied.roleChange.previousRole,
        newRole: applied.roleChange.newRole,
        roleRequestId: applied.request.id,
      },
    });
  }
}

/** Sólo el rol, nuevo o pedido: ni nombre, ni correo, ni justificación
 * (privacidad del PRD de E6). */
function decisionNotification(applied: AppliedDecision): NewNotification {
  if (applied.kind === "approved") {
    return {
      recipientUserId: applied.roleChange.memberUserId,
      type: "role_changed",
      data: { newRole: applied.roleChange.newRole },
    };
  }
  return {
    recipientUserId: applied.requester.memberUserId,
    type: "role_request_rejected",
    data: { requestedRole: applied.requester.requestedRole },
  };
}

/** Aplica la decisión de un Admin y la deja en la bitácora. La bitácora va
 * después de la escritura, como en `recordGuardianConsent`: auditar primero
 * dejaría una entrada de éxito para una decisión que la base no aplicó. */
export async function decideRoleRequest(
  gateways: RoleRequestDecisionGateways,
  input: {
    readonly deciderId: string;
    readonly requestId: string;
    readonly decision: RoleRequestDecision;
  },
): Promise<DecidedRoleRequest> {
  const decider = await findDecider(gateways, input.deciderId);
  const write = await gateways.decisions.applyDecision({
    requestId: input.requestId,
    clubId: decider.clubId,
    decidedBy: input.deciderId,
    decision: input.decision,
  });
  const applied = assertApplied(write, input.requestId);
  // `notifyMember` no lanza: un aviso perdido queda registrado y la decisión
  // responde igual. Va antes de la bitácora para que el socio se entere
  // también si ella falla, porque la decisión ya está aplicada.
  await notifyMember(gateways.notifications, decisionNotification(applied));

  try {
    await auditDecision(
      gateways.audit,
      { id: input.deciderId, clubId: decider.clubId },
      applied,
    );
  } catch (error) {
    throw new DecisionNotAuditedError(applied.request, error);
  }
  return applied.request;
}
