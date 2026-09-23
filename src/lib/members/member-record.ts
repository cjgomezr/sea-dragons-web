import {
  type AuditActor,
  type AuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import {
  MemberNotFoundError,
  requiresGuardianConsent,
} from "@/lib/auth/account-activation";
import type { AccountStatus } from "@/lib/auth/account-status";
import {
  isRealCalendarDate,
  validateDateOfBirthOn,
} from "@/lib/auth/registration";
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
 * sólo edita un Admin, que es su registro federativo (AUF, BR-008), sus
 * grupos y la corrección de su fecha de nacimiento (#272, RF-10). Contado sin
 * Supabase delante.
 *
 * La fecha de nacimiento no la edita el propio miembro a propósito: de ella
 * depende si necesita el consentimiento de su tutor (NFR-012, FR-082), y
 * poder cambiarla le dejaría saltárselo.
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
  /** `incomplete` es quien todavía no activó su cuenta: la pantalla le ofrece
   * al Admin reenviarle la invitación (#243). */
  readonly accountStatus: AccountStatus;
  readonly aufNumber: string | null;
  readonly aufExpiry: string | null;
  /** YYYY-MM-DD, o null en quien todavía no completó el registro. */
  readonly dateOfBirth: string | null;
  /** `members.created_at`: la edad que decide el consentimiento del tutor es
   * la de ese día (#134). */
  readonly registeredAt: string;
  /** Sólo si hay uno registrado: quién lo dio es un dato personal del tutor
   * que la ficha no necesita. */
  readonly hasGuardianConsent: boolean;
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
  /** Null sólo vale para quien todavía no tiene fecha: la corrección no
   * borra la que ya hay. */
  readonly dateOfBirth: string | null;
};

export const MEMBER_RECORD_ISSUE_CODES = [
  "auf_number_too_long",
  "auf_expiry_not_a_date",
  "auf_expiry_before_joined",
  "date_of_birth_not_a_date",
  "date_of_birth_in_future",
  "date_of_birth_too_early",
  "date_of_birth_required",
] as const;

export type MemberRecordIssueCode = (typeof MEMBER_RECORD_ISSUE_CODES)[number];

export type MemberRecordIssue = {
  readonly field: "aufNumber" | "aufExpiry" | "dateOfBirth";
  readonly code: MemberRecordIssueCode;
};

/** Los `reason` con los que la API distingue qué no se encontró o qué regla
 * de Grupos se incumplió: un 404 puede ser del socio o de un grupo. La
 * pantalla los lee para decir cuál. */
export const MEMBER_NOT_FOUND_REASON = "member_not_found";
export const GROUP_NOT_FOUND_REASON = "group_not_found";
export const MEMBER_INACTIVE_REASON = "member_inactive";
export const MEMBER_STATUS_CHANGED_REASON = "member_status_changed";

/** En la bitácora el socio es la entidad, como en su consentimiento. */
const AUDITED_ENTITY_TYPE = "member";

export type MemberScope = { readonly clubId: string; readonly userId: string };

export type AufUpdateResult =
  { readonly kind: "updated" } | { readonly kind: "member_not_found" };

/** La fecha y el estado con el que la cuenta queda, en una sola escritura.
 * `fromStatus` es el que se leyó: si otra petición lo cambió entretanto, la
 * corrección no se escribe, o una baja recién hecha volvería a `incomplete`. */
export type DateOfBirthCorrection = {
  readonly dateOfBirth: string;
  readonly fromStatus: AccountStatus;
  readonly toStatus: AccountStatus;
};

export type DateOfBirthCorrectionResult =
  | { readonly kind: "corrected" }
  | { readonly kind: "member_not_found" }
  | { readonly kind: "status_changed" };

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
    correctDateOfBirth(
      scope: MemberScope,
      correction: DateOfBirthCorrection,
    ): Promise<DateOfBirthCorrectionResult>;
  };
  readonly groups: Pick<GroupsGateways["groups"], "findClubGroups">;
  readonly audit: AuditLogWriter;
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

/** El estado de la cuenta cambió entre la lectura y la corrección de la
 * fecha. Volver a guardar la aplica sobre el estado nuevo. */
export class MemberRecordConflictError extends Error {
  constructor() {
    super(
      "El estado de la cuenta cambió mientras se guardaba: vuelve a abrir la ficha.",
    );
    this.name = "MemberRecordConflictError";
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

/**
 * Si guardar esta fecha deja la cuenta pidiendo el consentimiento del tutor.
 * Es la regla del registro (`requiresGuardianConsent`): menor el día en que
 * se registró. Sólo cambia una cuenta `active`: una `incomplete` ya pasa por
 * completar el registro, que le pedirá el consentimiento, y una `inactive` lo
 * hará al reactivarse. La usan el dominio y el aviso del formulario.
 */
export function correctionRequiresGuardianConsent(
  record: Pick<
    StoredMemberRecord,
    "accountStatus" | "registeredAt" | "hasGuardianConsent"
  >,
  dateOfBirth: string,
): boolean {
  return (
    record.accountStatus === "active" &&
    !record.hasGuardianConsent &&
    requiresGuardianConsent({ dateOfBirth, registeredAt: record.registeredAt })
  );
}

function aufIssuesOf(submission: MemberRecordSubmission): MemberRecordIssue[] {
  const number = submission.aufNumber?.trim() ?? "";
  if (number === "") {
    return [];
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
  return issues;
}

function dateOfBirthIssuesOf(
  dateOfBirth: string | null,
  todayInClub: string,
): MemberRecordIssue[] {
  if (dateOfBirth === null) {
    return [];
  }
  const validation = validateDateOfBirthOn(dateOfBirth, todayInClub);
  return validation.ok ? [] : [{ field: "dateOfBirth", code: validation.code }];
}

/** Lo que se puede decidir sin leer la base: la forma del número y de las
 * fechas. Así una petición mal hecha no toca nada. */
function assertSubmissionShape(
  submission: MemberRecordSubmission,
  todayInClub: string,
): void {
  const issues = [
    ...aufIssuesOf(submission),
    ...dateOfBirthIssuesOf(submission.dateOfBirth, todayInClub),
  ];
  if (issues.length > 0) {
    throw new MemberRecordValidationError(issues);
  }
}

/** Ya validado: un número vacío es no tener registro. */
function toAufRegistration(
  submission: MemberRecordSubmission,
): AufRegistration {
  const number = submission.aufNumber?.trim() ?? "";
  return number === ""
    ? { kind: "none" }
    : { kind: "registered", number, expiry: submission.aufExpiry };
}

/** Una fecha que ya estaba no se borra: sin ella la cuenta no sabría si es
 * de un menor. */
function assertDateOfBirthKept(
  dateOfBirth: string | null,
  record: StoredMemberRecord,
): void {
  if (dateOfBirth === null && record.dateOfBirth !== null) {
    throw new MemberRecordValidationError([
      { field: "dateOfBirth", code: "date_of_birth_required" },
    ]);
  }
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
 * de lo contrario la mitad de los grupos quedaría cambiada. La usa también el
 * alta de un miembro (#243). */
export async function assertClubGroups(
  gateways: {
    readonly groups: Pick<GroupsGateways["groups"], "findClubGroups">;
  },
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

/**
 * Corrige la fecha si cambió, y con ella el estado: quien queda menor sin
 * consentimiento pasa a `incomplete`, y la frontera lo manda a completar el
 * registro, que le pide los datos del tutor. El consentimiento que ya hubiera
 * no se toca.
 *
 * La bitácora va después de la escritura, como en el consentimiento: auditar
 * primero dejaría rastro de una corrección que no se guardó. Sin metadata:
 * ni la fecha nueva ni la anterior, que son datos personales.
 */
async function applyDateOfBirthCorrection(
  gateways: MemberRecordGateways,
  request: {
    readonly actor: AuditActor;
    readonly scope: MemberScope;
    readonly record: StoredMemberRecord;
  },
  dateOfBirth: string | null,
): Promise<void> {
  const { actor, scope, record } = request;
  if (dateOfBirth === null || dateOfBirth === record.dateOfBirth) {
    return;
  }
  const result = await gateways.records.correctDateOfBirth(scope, {
    dateOfBirth,
    fromStatus: record.accountStatus,
    toStatus: correctionRequiresGuardianConsent(record, dateOfBirth)
      ? "incomplete"
      : record.accountStatus,
  });
  if (result.kind === "member_not_found") {
    throw new MemberRecordNotFoundError();
  }
  if (result.kind === "status_changed") {
    throw new MemberRecordConflictError();
  }
  await recordAuditEvent(gateways.audit, {
    actor,
    clubId: actor.clubId,
    action: "member.date_of_birth_corrected",
    entityType: AUDITED_ENTITY_TYPE,
    entityId: scope.userId,
    result: "success",
  });
}

export async function updateMemberRecord(
  gateways: MemberRecordGateways,
  request: MemberRecordRequest & {
    readonly submission: MemberRecordSubmission;
  },
): Promise<MemberRecord> {
  const { submission } = request;
  assertSubmissionShape(submission, request.todayInClub);
  const registration = toAufRegistration(submission);
  const caller = await findAdministrator(gateways, request.callerId);
  const scope = { clubId: caller.clubId, userId: request.userId };
  const record = await findStoredRecord(gateways, scope);
  assertExpiryAfterJoining(registration, record);
  assertDateOfBirthKept(submission.dateOfBirth, record);
  const groupIds = new Set(submission.groupIds);
  await assertClubGroups(gateways, caller.clubId, groupIds);

  // Los grupos van primero porque son lo que una regla puede rechazar a estas
  // alturas. Si el socio desapareciera justo en medio, el 404 llega con sus
  // pertenencias ya cambiadas, pero las de una fila borrada se van con ella
  // por la cascada. Igual con el 409 de la fecha: los grupos ya quedaron
  // guardados, y volver a guardar la ficha no los repite.
  await applyGroupChanges(
    gateways,
    { callerId: request.callerId, scope },
    groupIds,
  );
  await applyDateOfBirthCorrection(
    gateways,
    {
      actor: { id: request.callerId, clubId: caller.clubId },
      scope,
      record,
    },
    submission.dateOfBirth,
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
