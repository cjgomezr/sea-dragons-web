import {
  LastAdminError,
  MemberRoleChangeForbiddenError,
  type MemberRoleChangeGateways,
  MemberToChangeNotFoundError,
  RoleChangeNotAuditedError,
  changeMemberRole,
  findRoleChangeActor,
} from "./member-role-change";
import type { Role } from "./roles";

/**
 * Cambiar el rol de varios socios a la vez (#552, RF-6 del PRD de E21).
 *
 * No hay una regla nueva: cada socio pasa por `changeMemberRole`, con la
 * misma función de la base, el mismo cuidado del último Admin y la misma
 * bitácora que el cambio de uno. Van de uno en uno y en orden, para que la
 * base vea cada degradación después de la anterior. Un socio que falla no
 * deshace a los que ya cambiaron ni frena a los que faltan: el resultado
 * cuenta qué pasó con cada uno.
 */

/** Cuántos socios admite una petición. El club tiene decenas; una lista más
 * larga no sale de la pantalla, y cada socio es una llamada a la base. */
export const MAX_BULK_ROLE_CHANGE_MEMBERS = 100;

/** Por qué un socio no cambió. `not_audited` sí cambió en la base, pero su
 * rastro no llegó a la bitácora, y eso no se da por bueno. */
export type BulkRoleChangeFailureReason =
  "last_admin" | "not_found" | "forbidden" | "not_audited" | "unexpected";

export type BulkRoleChangeResult =
  | {
      readonly kind: "changed";
      readonly userId: string;
      readonly previousRole: Role;
      readonly role: Role;
    }
  | { readonly kind: "unchanged"; readonly userId: string; readonly role: Role }
  | {
      readonly kind: "failed";
      readonly userId: string;
      readonly reason: BulkRoleChangeFailureReason;
    };

export type BulkRoleChange = {
  readonly role: Role;
  readonly results: readonly BulkRoleChangeResult[];
};

type BulkRoleChangeInput = {
  readonly actorId: string;
  readonly targetUserIds: readonly string[];
  readonly newRole: Role;
};

/** Sin repetidos, y quien actúa al final: si se degrada a sí mismo, los
 * demás ya cambiaron antes de que deje de ser Admin. */
function inChangeOrder(input: BulkRoleChangeInput): readonly string[] {
  const unique = [...new Set(input.targetUserIds)];
  const others = unique.filter((userId) => userId !== input.actorId);
  return others.length === unique.length ? others : [...others, input.actorId];
}

function failureReasonOf(
  error: unknown,
  userId: string,
): BulkRoleChangeFailureReason {
  if (error instanceof LastAdminError) {
    return "last_admin";
  }
  if (error instanceof MemberToChangeNotFoundError) {
    return "not_found";
  }
  if (error instanceof MemberRoleChangeForbiddenError) {
    return "forbidden";
  }
  // Los dos que quedan los tiene que ver quien mantiene la plataforma: quien
  // llama sólo recibe el motivo.
  console.error("[member-roles-bulk-change] socio sin cambiar", {
    userId,
    message: error instanceof Error ? error.message : String(error),
    cause: error instanceof Error ? error.cause : undefined,
  });
  return error instanceof RoleChangeNotAuditedError
    ? "not_audited"
    : "unexpected";
}

async function changeOne(
  gateways: MemberRoleChangeGateways,
  change: { readonly actorId: string; readonly userId: string; readonly newRole: Role },
): Promise<BulkRoleChangeResult> {
  try {
    const result = await changeMemberRole(gateways, {
      actorId: change.actorId,
      targetUserId: change.userId,
      newRole: change.newRole,
    });
    return result.previousRole === result.role
      ? { kind: "unchanged", userId: result.userId, role: result.role }
      : { kind: "changed", ...result };
  } catch (error) {
    return {
      kind: "failed",
      userId: change.userId,
      reason: failureReasonOf(error, change.userId),
    };
  }
}

/** Quien no es Admin no cambia a nadie: se le niega antes del primero. */
export async function changeMemberRoles(
  gateways: MemberRoleChangeGateways,
  input: BulkRoleChangeInput,
): Promise<BulkRoleChange> {
  await findRoleChangeActor(gateways, input.actorId);
  const results: BulkRoleChangeResult[] = [];
  for (const userId of inChangeOrder(input)) {
    results.push(
      await changeOne(gateways, {
        actorId: input.actorId,
        userId,
        newRole: input.newRole,
      }),
    );
  }
  return { role: input.newRole, results };
}
