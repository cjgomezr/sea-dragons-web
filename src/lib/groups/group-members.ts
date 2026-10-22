import type { AccountStatus } from "@/lib/auth/account-status";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { type PositionNames, positionName } from "@/lib/club/club-positions";
import type { Locale } from "@/lib/i18n/locale";
import {
  type ProfilePhotoSigner,
  signPhotosOrNone,
  signedPhotoUrl,
} from "@/lib/members/profile-photo-urls";
import { compareNames } from "@/lib/text/name-order";
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

/** Un socio de la lista de un grupo (E32): además, su posición en el idioma
 * de quien pide y su foto firmada, o null. */
export type GroupRosterMember = GroupMember & {
  readonly positionName: string | null;
  readonly photoUrl: string | null;
};

/** A quien se puede añadir, con en cuántos grupos del club está ya. */
export type GroupCandidate = GroupRosterMember & {
  readonly groupCount: number;
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

/** Un socio del club que no está dado de baja, con los grupos del club en
 * los que está. */
export type AssignableMember = ClubMember & {
  readonly photoPath: string | null;
  readonly position: PositionNames | null;
  readonly groupIds: readonly string[];
};

export type AssignableMembersResult =
  | { readonly kind: "found"; readonly members: readonly AssignableMember[] }
  | { readonly kind: "group_not_found" };

/** Que el grupo exista lo decide la clave foránea al escribir, no una lectura
 * previa: así un grupo que otro acaba de borrar también responde 404. */
export type MembershipInsertResult =
  | { readonly kind: "assigned" }
  | { readonly kind: "group_not_found" }
  | { readonly kind: "member_not_found" };

export type MembershipDeletionResult =
  { readonly kind: "removed" } | { readonly kind: "group_not_found" };

/** Por qué un socio pedido en el alta masiva no entró (D3 de E32): está dado
 * de baja, o no es del club de quien llama (o no existe, que se responde
 * igual). */
export type RejectionReason = "inactive" | "not_in_club";

export type RejectedMember = {
  readonly userId: string;
  readonly reason: RejectionReason;
};

/** La lista del grupo y sus candidatos, leídas a la vez. */
export type GroupRoster = {
  readonly members: readonly GroupRosterMember[];
  readonly candidates: readonly GroupCandidate[];
};

export type BulkAssignment = GroupRoster & {
  readonly rejected: readonly RejectedMember[];
};

export type GroupMembersGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly groupMembers: {
    /** Los socios del club que no están dados de baja, estén o no en el
     * grupo, o `group_not_found` si el grupo no es del club. */
    findAssignableMembers(scope: GroupScope): Promise<AssignableMembersResult>;
    findClubMember(input: {
      readonly clubId: string;
      readonly userId: string;
    }): Promise<ClubMember | null>;
    /** Asignar dos veces no duplica nada: la segunda no hace nada. */
    insertMembership(membership: Membership): Promise<MembershipInsertResult>;
    /** Quitar a quien no estaba no es un error. */
    deleteMembership(membership: Membership): Promise<MembershipDeletionResult>;
  };
  readonly bulkMemberships: {
    /** Los socios del club entre `userIds`, dados de baja incluidos. */
    findClubMembers(input: {
      readonly clubId: string;
      readonly userIds: readonly string[];
    }): Promise<readonly ClubMember[]>;
    /** En una sola escritura: entran todos o ninguno. Quien ya estaba no se
     * duplica. */
    insertMemberships(
      memberships: GroupScope & { readonly userIds: readonly string[] },
    ): Promise<MembershipInsertResult>;
  };
  readonly photos: ProfilePhotoSigner;
};

/** Asignar y quitar no leen listas ni firman fotos: el alta de E5 y la ficha
 * del socio los usan con sus propios adaptadores. */
export type GroupMembershipGateways = Pick<
  GroupMembersGateways,
  "members" | "groupMembers"
>;

type GroupRequest = { readonly callerId: string; readonly groupId: string };
type GroupListRequest = GroupRequest & { readonly locale: Locale };
type MembershipRequest = GroupRequest & { readonly userId: string };
type BulkMembershipRequest = GroupListRequest & {
  readonly userIds: readonly string[];
};

export class GroupMemberNotFoundError extends Error {
  constructor() {
    super("No existe ese socio en tu club.");
    this.name = "GroupMemberNotFoundError";
  }
}

export class EmptyMemberSelectionError extends Error {
  constructor() {
    super("Elige al menos un socio para añadir al grupo.");
    this.name = "EmptyMemberSelectionError";
  }
}

export class InactiveMemberError extends Error {
  constructor() {
    super("Un socio dado de baja no se puede asignar a un grupo.");
    this.name = "InactiveMemberError";
  }
}

/** Los socios del club que no están de baja, en orden alfabético, con el
 * grupo comprobado. */
async function findSortedAssignable(
  gateways: GroupMembersGateways,
  scope: GroupScope,
): Promise<readonly AssignableMember[]> {
  const result = await gateways.groupMembers.findAssignableMembers(scope);
  if (result.kind === "group_not_found") {
    throw new GroupNotFoundError();
  }
  return [...result.members].sort((first, second) =>
    compareNames(first.fullName, second.fullName),
  );
}

function isInGroup(member: AssignableMember, groupId: string): boolean {
  return member.groupIds.includes(groupId);
}

/** Los socios del club que no están de baja, repartidos según estén o no en
 * el grupo, en orden alfabético: `side` elige qué mitad. */
async function findMembersBy(
  gateways: GroupMembersGateways,
  request: GroupRequest,
  side: "in_group" | "outside_group",
): Promise<readonly AssignableMember[]> {
  const caller = await findGroupManager(gateways, request.callerId);
  const members = await findSortedAssignable(gateways, {
    clubId: caller.clubId,
    groupId: request.groupId,
  });
  return members.filter(
    (member) => isInGroup(member, request.groupId) === (side === "in_group"),
  );
}

function signMemberPhotos(
  gateways: GroupMembersGateways,
  members: readonly AssignableMember[],
): Promise<ReadonlyMap<string, string>> {
  return signPhotosOrNone(
    gateways.photos,
    members.map(({ photoPath }) => photoPath),
    "groups",
  );
}

type RosterContext = {
  readonly photoUrls: ReadonlyMap<string, string>;
  readonly locale: Locale;
};

function toRosterMember(
  member: AssignableMember,
  context: RosterContext,
): GroupRosterMember {
  return {
    ...toGroupMember(member),
    positionName:
      member.position === null
        ? null
        : positionName(member.position, context.locale),
    photoUrl: signedPhotoUrl(context.photoUrls, member.photoPath),
  };
}

/** Los socios del grupo, sin los dados de baja: siguen asignados, pero no
 * cuentan en el conteo ni son audiencia (RF-3, RF-9). */
export async function listGroupMembers(
  gateways: GroupMembersGateways,
  request: GroupListRequest,
): Promise<readonly GroupRosterMember[]> {
  const members = await findMembersBy(gateways, request, "in_group");
  const photoUrls = await signMemberPhotos(gateways, members);
  return members.map((member) =>
    toRosterMember(member, { photoUrls, locale: request.locale }),
  );
}

/** A quién se puede agregar al grupo (RF-6), con en cuántos grupos del club
 * está ya. */
export async function listGroupCandidates(
  gateways: GroupMembersGateways,
  request: GroupListRequest,
): Promise<readonly GroupCandidate[]> {
  const candidates = await findMembersBy(gateways, request, "outside_group");
  const photoUrls = await signMemberPhotos(gateways, candidates);
  return candidates.map((candidate) =>
    toCandidate(candidate, { photoUrls, locale: request.locale }),
  );
}

function toCandidate(
  member: AssignableMember,
  context: RosterContext,
): GroupCandidate {
  return {
    ...toRosterMember(member, context),
    groupCount: member.groupIds.length,
  };
}

/** Las dos mitades de una sola lectura, con las fotos firmadas en una
 * llamada. */
async function readGroupRoster(
  gateways: GroupMembersGateways,
  request: GroupScope & { readonly locale: Locale },
): Promise<GroupRoster> {
  const assignable = await findSortedAssignable(gateways, request);
  const photoUrls = await signMemberPhotos(gateways, assignable);
  const context = { photoUrls, locale: request.locale };
  return {
    members: assignable
      .filter((member) => isInGroup(member, request.groupId))
      .map((member) => toRosterMember(member, context)),
    candidates: assignable
      .filter((member) => !isInGroup(member, request.groupId))
      .map((member) => toCandidate(member, context)),
  };
}

/** Quién de lo pedido puede entrar y quién no, en el orden en que llegó. */
function sortOutRequested(
  userIds: readonly string[],
  clubMembers: readonly ClubMember[],
): {
  readonly assignableIds: readonly string[];
  readonly rejected: readonly RejectedMember[];
} {
  const statusById = new Map(
    clubMembers.map(({ id, accountStatus }) => [id, accountStatus]),
  );
  const rejected: RejectedMember[] = [];
  const assignableIds: string[] = [];
  for (const userId of userIds) {
    const status = statusById.get(userId);
    if (status === undefined) {
      rejected.push({ userId, reason: "not_in_club" });
    } else if (status === "inactive") {
      rejected.push({ userId, reason: "inactive" });
    } else {
      assignableIds.push(userId);
    }
  }
  return { assignableIds, rejected };
}

async function insertAssignable(
  gateways: GroupMembersGateways,
  memberships: GroupScope & { readonly userIds: readonly string[] },
): Promise<void> {
  if (memberships.userIds.length === 0) {
    return;
  }
  const result = await gateways.bulkMemberships.insertMemberships(memberships);
  if (result.kind === "group_not_found") {
    throw new GroupNotFoundError();
  }
  if (result.kind === "member_not_found") {
    throw new GroupMemberNotFoundError();
  }
}

/** Añade a varios socios al grupo de una vez (D3 de E32). Quien ya estaba no
 * se duplica; el dado de baja y el de otro club no entran y vuelven en
 * `rejected`, sin tumbar al resto. Responde las dos listas ya actualizadas,
 * para que la pantalla no tenga que pedirlas otra vez. */
export async function assignGroupMembers(
  gateways: GroupMembersGateways,
  request: BulkMembershipRequest,
): Promise<BulkAssignment> {
  const userIds = [...new Set(request.userIds)];
  if (userIds.length === 0) {
    throw new EmptyMemberSelectionError();
  }
  const caller = await findGroupManager(gateways, request.callerId);
  const scope = { clubId: caller.clubId, groupId: request.groupId };
  const clubMembers = await gateways.bulkMemberships.findClubMembers({
    clubId: caller.clubId,
    userIds,
  });
  const { assignableIds, rejected } = sortOutRequested(userIds, clubMembers);
  await insertAssignable(gateways, { ...scope, userIds: assignableIds });
  const roster = await readGroupRoster(gateways, {
    ...scope,
    locale: request.locale,
  });
  return { ...roster, rejected };
}

async function findMembershipTarget(
  gateways: GroupMembershipGateways,
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
  gateways: GroupMembershipGateways,
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
  gateways: GroupMembershipGateways,
  request: MembershipRequest,
): Promise<void> {
  const { membership } = await findMembershipTarget(gateways, request);
  const result = await gateways.groupMembers.deleteMembership(membership);
  if (result.kind === "group_not_found") {
    throw new GroupNotFoundError();
  }
}
