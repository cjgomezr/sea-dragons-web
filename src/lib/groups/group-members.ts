import type { AccountStatus } from "@/lib/auth/account-status";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { GroupNotFoundError, findGroupManager } from "./groups";

/**
 * Meter y sacar socios de un grupo (#227, RF-6 y RF-7 del PRD de E4), contado
 * sin Supabase delante.
 *
 * Como los grupos, todo sale del club de quien llama y nunca de un parámetro:
 * un grupo o un socio de otro club responde igual que uno que no existe.
 */

/** Lo único que se enseña de un socio a quien gestiona grupos: Coach y
 * Committee no pueden leer la ficha completa (`GET /api/v1/members` es de
 * Admin), así que aquí no viaja ni el correo ni nada más. */
export type GroupMember = {
  readonly id: string;
  readonly fullName: string;
  /** La cuenta todavía no está activa: el alta de un Admin (#243) o un
   * registro a medias. Pertenece al grupo, pero no cuenta como miembro activo
   * en su conteo. */
  readonly isPendingActivation: boolean;
};

export type ClubMember = {
  readonly id: string;
  readonly fullName: string;
  readonly accountStatus: AccountStatus;
};

/** Lo que se enseña de un socio del club a quien gestiona grupos. */
export function toGroupMember(member: ClubMember): GroupMember {
  return {
    id: member.id,
    fullName: member.fullName,
    isPendingActivation: member.accountStatus === "incomplete",
  };
}

export type GroupScope = { readonly clubId: string; readonly groupId: string };
export type Membership = GroupScope & { readonly userId: string };

export type GroupMembersResult =
  | { readonly kind: "found"; readonly members: readonly GroupMember[] }
  | { readonly kind: "group_not_found" };

/** Que el grupo exista lo decide la clave foránea al escribir, no una lectura
 * previa: así un grupo que otro acaba de borrar también responde 404. */
export type MembershipInsertResult =
  | { readonly kind: "assigned" }
  | { readonly kind: "group_not_found" }
  | { readonly kind: "member_not_found" };

export type MembershipDeletionResult =
  { readonly kind: "removed" } | { readonly kind: "group_not_found" };

export type GroupMembersGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly groupMembers: {
    /** Los socios asignados que no están dados de baja, en orden alfabético. */
    findGroupMembers(scope: GroupScope): Promise<GroupMembersResult>;
    /** Los socios del club que no están en el grupo ni dados de baja, en
     * orden alfabético. */
    findCandidates(scope: GroupScope): Promise<GroupMembersResult>;
    findClubMember(input: {
      readonly clubId: string;
      readonly userId: string;
    }): Promise<ClubMember | null>;
    /** Asignar dos veces no duplica nada: la segunda no hace nada. */
    insertMembership(membership: Membership): Promise<MembershipInsertResult>;
    /** Quitar a quien no estaba no es un error. */
    deleteMembership(membership: Membership): Promise<MembershipDeletionResult>;
  };
};

type GroupRequest = { readonly callerId: string; readonly groupId: string };
type MembershipRequest = GroupRequest & { readonly userId: string };

export class GroupMemberNotFoundError extends Error {
  constructor() {
    super("No existe ese socio en tu club.");
    this.name = "GroupMemberNotFoundError";
  }
}

export class InactiveMemberError extends Error {
  constructor() {
    super("Un socio dado de baja no se puede asignar a un grupo.");
    this.name = "InactiveMemberError";
  }
}

function membersOrThrow(result: GroupMembersResult): readonly GroupMember[] {
  if (result.kind === "group_not_found") {
    throw new GroupNotFoundError();
  }
  return result.members;
}

/** Los socios del grupo, sin los dados de baja: siguen asignados, pero no
 * cuentan en el conteo ni son audiencia (RF-3, RF-9). */
export async function listGroupMembers(
  gateways: GroupMembersGateways,
  request: GroupRequest,
): Promise<readonly GroupMember[]> {
  const caller = await findGroupManager(gateways, request.callerId);
  return membersOrThrow(
    await gateways.groupMembers.findGroupMembers({
      clubId: caller.clubId,
      groupId: request.groupId,
    }),
  );
}

/** A quién se puede agregar al grupo (RF-6). */
export async function listGroupCandidates(
  gateways: GroupMembersGateways,
  request: GroupRequest,
): Promise<readonly GroupMember[]> {
  const caller = await findGroupManager(gateways, request.callerId);
  return membersOrThrow(
    await gateways.groupMembers.findCandidates({
      clubId: caller.clubId,
      groupId: request.groupId,
    }),
  );
}

async function findMembershipTarget(
  gateways: GroupMembersGateways,
  request: MembershipRequest,
): Promise<{ readonly membership: Membership; readonly member: ClubMember }> {
  const caller = await findGroupManager(gateways, request.callerId);
  const member = await gateways.groupMembers.findClubMember({
    clubId: caller.clubId,
    userId: request.userId,
  });
  if (member === null) {
    throw new GroupMemberNotFoundError();
  }
  return {
    membership: {
      clubId: caller.clubId,
      groupId: request.groupId,
      userId: request.userId,
    },
    member,
  };
}

/** Asigna al socio y lo devuelve, para que quien asigna lo sume a la lista.
 * Un socio con la cuenta incompleta sí se asigna: el alta de E5 crea socios
 * incompletos que ya pertenecen a sus grupos. */
export async function assignGroupMember(
  gateways: GroupMembersGateways,
  request: MembershipRequest,
): Promise<GroupMember> {
  const { membership, member } = await findMembershipTarget(gateways, request);
  if (member.accountStatus === "inactive") {
    throw new InactiveMemberError();
  }
  const result = await gateways.groupMembers.insertMembership(membership);
  switch (result.kind) {
    case "assigned":
      return toGroupMember(member);
    case "group_not_found":
      throw new GroupNotFoundError();
    case "member_not_found":
      throw new GroupMemberNotFoundError();
  }
}

export async function removeGroupMember(
  gateways: GroupMembersGateways,
  request: MembershipRequest,
): Promise<void> {
  const { membership } = await findMembershipTarget(gateways, request);
  const result = await gateways.groupMembers.deleteMembership(membership);
  if (result.kind === "group_not_found") {
    throw new GroupNotFoundError();
  }
}
