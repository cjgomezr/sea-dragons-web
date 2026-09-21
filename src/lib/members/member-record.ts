import { MemberNotFoundError } from "@/lib/auth/account-activation";
import { isRealCalendarDate } from "@/lib/auth/registration";
import type { RoleRequestMember } from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";
import {
  type GroupMembersGateways,
  assignGroupMember,
  removeGroupMember,
} from "@/lib/groups/group-members";
import { GroupNotFoundError, type GroupsGateways } from "@/lib/groups/groups";
import { type MemberGroup, listMemberGroups } from "@/lib/groups/member-groups";

/**
 * La ficha reservada al Admin (#242, RF-4 del PRD de E5): lo que de un miembro
 * sólo edita un Admin, que es su registro federativo (AUF, BR-008) y sus
 * grupos. Contado sin Supabase delante.
 *
 * El resto de la ficha es de cada miembro (#241) y aquí no entra: este módulo
 * arma lo que se escribe campo a campo, así que nada más llega a la base.
 *
 * Los grupos no se escriben aquí. Se agregan y se quitan con las funciones de
 * la sección Grupos (#227), para que valgan sus mismas reglas y los conteos
 * no puedan divergir según desde dónde se cambió.
 */

/** El mismo tope que el `check` de `members.auf_number` en
 * `0016_member_profile_fields.sql`, en caracteres y no en unidades UTF-16. */
export const AUF_NUMBER_MAX_LENGTH = 40;

/** El registro federativo tal como se escribe. Sin número no hay registro, y
 * un vencimiento suelto no significaría nada: por eso no existe esa forma. */
export type AufRegistration =
  | { readonly kind: "none" }
  | {
      readonly kind: "registered";
      readonly number: string;
      /** YYYY-MM-DD, o null si el registro no tiene vencimiento conocido. */
      readonly expiry: string | null;
    };

/** La fila del miembro, con lo que la ficha necesita leer. */
export type StoredMemberRecord = {
  readonly userId: string;
  readonly fullName: string;
  /** YYYY-MM-DD, el día del club en que ingresó (#237). */
  readonly joinedOn: string;
  readonly aufNumber: string | null;
  readonly aufExpiry: string | null;
};

/** La ficha tal como la sirve la API. */
export type MemberRecord = StoredMemberRecord & {
  readonly isAufExpired: boolean;
  readonly groups: readonly MemberGroup[];
};

/** Lo que llega a guardarse, sin validar todavía. Un número vacío o en null
 * es borrar el registro, y con él su vencimiento. `groupIds` es la lista
 * entera de grupos con la que el miembro tiene que quedar. */
export type MemberRecordSubmission = {
  readonly aufNumber: string | null;
  readonly aufExpiry: string | null;
  readonly groupIds: readonly string[];
};

export const MEMBER_RECORD_ISSUE_CODES = [
  "auf_number_too_long",
  "auf_expiry_not_a_date",
  "auf_expiry_before_joined",
] as const;

export type MemberRecordIssueCode = (typeof MEMBER_RECORD_ISSUE_CODES)[number];

export type MemberRecordIssue = {
  readonly field: "aufNumber" | "aufExpiry";
  readonly code: MemberRecordIssueCode;
};

/** Los `reason` con los que la API distingue qué no se encontró o qué regla
 * de Grupos se incumplió: un 404 puede ser del socio o de un grupo. La
 * pantalla los lee para decir cuál. */
export const MEMBER_NOT_FOUND_REASON = "member_not_found";
export const GROUP_NOT_FOUND_REASON = "group_not_found";
export const MEMBER_INACTIVE_REASON = "member_inactive";

export type MemberScope = { readonly clubId: string; readonly userId: string };

export type AufUpdateResult =
  { readonly kind: "updated" } | { readonly kind: "member_not_found" };

export type MemberRecordGateways = Pick<
  GroupMembersGateways,
  "members" | "groupMembers"
> & {
  readonly records: {
    findMemberRecord(scope: MemberScope): Promise<StoredMemberRecord | null>;
    findMemberGroups(scope: MemberScope): Promise<readonly MemberGroup[]>;
    /** Número y vencimiento en una sola escritura: dos Admin que guardan a la
     * vez no pueden dejar el número de uno con el vencimiento del otro. */
    updateAufRegistration(
      scope: MemberScope,
      registration: AufRegistration,
    ): Promise<AufUpdateResult>;
  };
  readonly groups: Pick<GroupsGateways["groups"], "findClubGroups">;
};

export class MemberRecordForbiddenError extends Error {
  constructor() {
    super("Sólo un Admin puede ver y editar la ficha reservada de un socio.");
    this.name = "MemberRecordForbiddenError";
  }
}

export class MemberRecordNotFoundError extends Error {
  constructor() {
    super("No existe ese socio en tu club.");
    this.name = "MemberRecordNotFoundError";
  }
}

export class MemberRecordValidationError extends Error {
  readonly issues: readonly MemberRecordIssue[];

  constructor(issues: readonly MemberRecordIssue[]) {
    super(
      `La ficha trae campos que no valen: ${issues
        .map((issue) => `${issue.field} (${issue.code})`)
        .join(", ")}.`,
    );
    this.name = "MemberRecordValidationError";
    this.issues = issues;
  }
}

/** Vencido es haber caducado antes de hoy: el registro vale todo el día de su
 * vencimiento. Los dos son días del club en YYYY-MM-DD, que se comparan como
 * texto. Quien no tiene vencimiento no lo tiene vencido. */
export function isAufExpired(
  aufExpiry: string | null,
  todayInClub: string,
): boolean {
  return aufExpiry !== null && aufExpiry < todayInClub;
}

/** La usan el formulario, para avisar antes de enviar, y el dominio. */
export function isAufNumberTooLong(aufNumber: string): boolean {
  return [...aufNumber.trim()].length > AUF_NUMBER_MAX_LENGTH;
}

/** Lo que se puede decidir sin leer la base: la forma del número y de la
 * fecha. Así una petición mal hecha no toca nada. */
function toAufRegistration(
  submission: MemberRecordSubmission,
): AufRegistration {
  const number = submission.aufNumber?.trim() ?? "";
  if (number === "") {
    return { kind: "none" };
  }
  const issues: MemberRecordIssue[] = [];
  if (isAufNumberTooLong(number)) {
    issues.push({ field: "aufNumber", code: "auf_number_too_long" });
  }
  if (
    submission.aufExpiry !== null &&
    !isRealCalendarDate(submission.aufExpiry)
  ) {
    issues.push({ field: "aufExpiry", code: "auf_expiry_not_a_date" });
  }
  if (issues.length > 0) {
    throw new MemberRecordValidationError(issues);
  }
  return { kind: "registered", number, expiry: submission.aufExpiry };
}

/** El vencimiento se compara con el ingreso (#237): un registro no puede
 * caducar antes de que la persona fuera del club. */
function assertExpiryAfterJoining(
  registration: AufRegistration,
  record: StoredMemberRecord,
): void {
  if (
    registration.kind === "registered" &&
    registration.expiry !== null &&
    registration.expiry < record.joinedOn
  ) {
    throw new MemberRecordValidationError([
      { field: "aufExpiry", code: "auf_expiry_before_joined" },
    ]);
  }
}

/** Quien llama, con su club, si puede gestionar usuarios y roles. */
async function findAdministrator(
  gateways: Pick<MemberRecordGateways, "members">,
  callerId: string,
): Promise<RoleRequestMember> {
  const caller = await gateways.members.findRoleRequestMember(callerId);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  if (!hasCapability(caller.role, "manageUsersAndRoles")) {
    throw new MemberRecordForbiddenError();
  }
  return caller;
}

async function findStoredRecord(
  gateways: MemberRecordGateways,
  scope: MemberScope,
): Promise<StoredMemberRecord> {
  const record = await gateways.records.findMemberRecord(scope);
  if (record === null) {
    throw new MemberRecordNotFoundError();
  }
  return record;
}

async function composeRecord(
  gateways: MemberRecordGateways,
  scope: MemberScope,
  todayInClub: string,
): Promise<MemberRecord> {
  const [record, groups] = await Promise.all([
    findStoredRecord(gateways, scope),
    listMemberGroups(
      { listGroupsOf: () => gateways.records.findMemberGroups(scope) },
      scope.userId,
    ),
  ]);
  return {
    ...record,
    isAufExpired: isAufExpired(record.aufExpiry, todayInClub),
    groups,
  };
}

type MemberRecordRequest = {
  readonly callerId: string;
  readonly userId: string;
  /** El día del club (NFR-003), contra el que se mide si el AUF venció. Lo
   * pone quien llama para que este módulo no dependa del reloj. */
  readonly todayInClub: string;
};

export async function readMemberRecord(
  gateways: MemberRecordGateways,
  request: MemberRecordRequest,
): Promise<MemberRecord> {
  const caller = await findAdministrator(gateways, request.callerId);
  return composeRecord(
    gateways,
    { clubId: caller.clubId, userId: request.userId },
    request.todayInClub,
  );
}

/** Un id que no es de un grupo del club se rechaza antes de escribir nada:
 * de lo contrario la mitad de los grupos quedaría cambiada. */
async function assertClubGroups(
  gateways: MemberRecordGateways,
  clubId: string,
  groupIds: ReadonlySet<string>,
): Promise<void> {
  const clubGroups = await gateways.groups.findClubGroups(clubId);
  const clubGroupIds = new Set(clubGroups.map((group) => group.id));
  if ([...groupIds].some((groupId) => !clubGroupIds.has(groupId))) {
    throw new GroupNotFoundError();
  }
}

/** Primero las altas y después las bajas: una alta es lo único que una regla
 * de Grupos puede rechazar (un miembro dado de baja), y así el rechazo llega
 * antes de haber quitado nada. */
async function applyGroupChanges(
  gateways: MemberRecordGateways,
  request: { readonly callerId: string; readonly scope: MemberScope },
  groupIds: ReadonlySet<string>,
): Promise<void> {
  const current = await gateways.records.findMemberGroups(request.scope);
  const currentIds = new Set(current.map((group) => group.id));
  const membership = (groupId: string) => ({
    callerId: request.callerId,
    groupId,
    userId: request.scope.userId,
  });
  for (const groupId of groupIds) {
    if (!currentIds.has(groupId)) {
      await assignGroupMember(gateways, membership(groupId));
    }
  }
  for (const groupId of currentIds) {
    if (!groupIds.has(groupId)) {
      await removeGroupMember(gateways, membership(groupId));
    }
  }
}

export async function updateMemberRecord(
  gateways: MemberRecordGateways,
  request: MemberRecordRequest & {
    readonly submission: MemberRecordSubmission;
  },
): Promise<MemberRecord> {
  const registration = toAufRegistration(request.submission);
  const caller = await findAdministrator(gateways, request.callerId);
  const scope = { clubId: caller.clubId, userId: request.userId };
  assertExpiryAfterJoining(
    registration,
    await findStoredRecord(gateways, scope),
  );
  const groupIds = new Set(request.submission.groupIds);
  await assertClubGroups(gateways, caller.clubId, groupIds);

  await applyGroupChanges(
    gateways,
    { callerId: request.callerId, scope },
    groupIds,
  );
  const result = await gateways.records.updateAufRegistration(
    scope,
    registration,
  );
  if (result.kind === "member_not_found") {
    throw new MemberRecordNotFoundError();
  }
  return composeRecord(gateways, scope, request.todayInClub);
}
