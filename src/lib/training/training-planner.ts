import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { AuditActor } from "@/lib/audit/audit-log";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";

/**
 * Quién planifica el entrenamiento (#903, D3 del PRD de E35): Admin y Coach.
 * La frontera ya reserva `/api/v1/training/manage` a esos dos roles; el
 * dominio lo vuelve a comprobar, como en el resto de la app.
 */

export class TrainingPlannerForbiddenError extends Error {
  constructor() {
    super("Sólo un Admin o un Coach planifica el entrenamiento.");
    this.name = "TrainingPlannerForbiddenError";
  }
}

/** El actor de la bitácora si quien llama planifica; si no, el rechazo. */
export async function findTrainingPlanner(
  members: RoleRequestGateways["members"],
  callerId: string,
): Promise<AuditActor> {
  const caller = await members.findRoleRequestMember(callerId);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  if (!hasCapability(caller.role, "planTraining")) {
    throw new TrainingPlannerForbiddenError();
  }
  return { id: callerId, clubId: caller.clubId };
}
