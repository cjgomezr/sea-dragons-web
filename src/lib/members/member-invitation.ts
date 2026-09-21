import {
  type IdentityConfirmationReader,
  MemberNotFoundError,
} from "@/lib/auth/account-activation";
import type { AccountStatus } from "@/lib/auth/account-status";
import { resendConfirmationEmail } from "@/lib/auth/confirmation-email-resend";
import type { EmailRequestLog } from "@/lib/auth/email-request-log";
import type {
  ConfirmationEmailGateway,
  IdentityCreation,
} from "@/lib/auth/register-member";
import {
  isRealCalendarDate,
  looksLikeEmail,
  validateCountryField,
} from "@/lib/auth/registration";
import type { RoleRequestMember } from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";
import type { EmailDeliveryAvailabilityCheck } from "@/lib/email/email-delivery-availability";
import {
  type GroupMembersGateways,
  assignGroupMember,
} from "@/lib/groups/group-members";
import type { GroupsGateways } from "@/lib/groups/groups";
import type { Locale } from "@/lib/i18n/locale";
import {
  MemberRecordNotFoundError,
  type MemberScope,
  assertClubGroups,
  isAufNumberTooLong,
} from "./member-record";
import {
  type ExperienceLevel,
  type Gender,
  type Position,
  parseExperienceLevel,
  parseGender,
  parsePosition,
} from "./profile-fields";

/**
 * El alta de un miembro por un Admin y su invitación por correo (#243, RF-5
 * del PRD de E5: FR-020, FR-021, AC-011), contados sin Supabase delante.
 *
 * El miembro nace como nace quien se registra solo: Player y `incomplete`
 * (FR-083). Lo que le falta lo pide la pantalla de completar registro que ya
 * existe, y es ella la que activa la cuenta.
 *
 * La identidad nace sin contraseña y sin confirmar. El enlace de la invitación
 * es el de elegir contraseña nueva: canjearlo confirma el correo, y con la
 * contraseña elegida el miembro entra y termina su registro. Así no hace falta
 * ninguna pantalla nueva del lado del invitado.
 *
 * El correo se manda antes de responder, a diferencia del registro. Allí se
 * difiere para que lo que tarda la respuesta no delate qué direcciones tienen
 * cuenta; aquí quien llama es un Admin que ya sabe si el alta salió, y la
 * pantalla tiene que decirle si la invitación no salió para ofrecer reenviarla.
 */

export type NewMemberSubmission = {
  readonly fullName: string;
  readonly email: string;
  readonly country: string;
  readonly position: string;
  readonly experienceLevel: string;
  readonly gender: string;
  readonly aufNumber: string;
  /** YYYY-MM-DD. */
  readonly aufExpiry: string;
  readonly groupIds: readonly string[];
};

export type NewMemberField = Exclude<keyof NewMemberSubmission, "groupIds">;

export const NEW_MEMBER_ISSUE_CODES = [
  "full_name_missing",
  "email_malformed",
  "country_unknown",
  "position_unknown",
  "experience_level_unknown",
  "gender_unknown",
  "auf_number_missing",
  "auf_number_too_long",
  "auf_expiry_not_a_date",
  "auf_expiry_before_joined",
] as const;

export type NewMemberIssueCode = (typeof NEW_MEMBER_ISSUE_CODES)[number];

export type NewMemberIssue = {
  readonly field: NewMemberField;
  readonly code: NewMemberIssueCode;
};

/** Columnas de `public.members` que escribe el alta, en snake_case porque es
 * la fila que va a la base. `joined_on` no va: su defecto es el día del club,
 * que es cuando ingresa quien se da de alta. */
export type InvitedMemberRow = {
  readonly club_id: string;
  readonly user_id: string;
  readonly full_name: string;
  readonly email: string;
  readonly country: string;
  readonly position: Position;
  readonly experience_level: ExperienceLevel;
  readonly gender: Gender;
  readonly auf_number: string;
  readonly auf_expiry: string;
  readonly role: "Player";
  readonly account_status: "incomplete";
  /** El idioma del Admin: es el único que se conoce del miembro hasta que
   * entre, y es en el que le llegan los correos (E17, RF-6). */
  readonly email_locale: Locale;
};

/** Lo que el reenvío necesita saber del miembro. */
export type Invitee = {
  readonly email: string;
  readonly accountStatus: AccountStatus;
};

export type InvitationDelivery =
  | { readonly kind: "sent" }
  /** El motivo es para el registro del servidor; nunca lleva la dirección. */
  | { readonly kind: "not_sent"; readonly reason: string };

export type CreatedMember = {
  readonly member: {
    readonly userId: string;
    readonly fullName: string;
    readonly email: string;
  };
  readonly invitation: InvitationDelivery;
};

export type MemberInvitationGateways = Pick<
  GroupMembersGateways,
  "members" | "groupMembers"
> & {
  readonly groups: Pick<GroupsGateways["groups"], "findClubGroups">;
  readonly identities: IdentityConfirmationReader & {
    /** Sin contraseña y sin confirmar: la elige el miembro con el enlace. */
    createInvitedIdentity(email: string): Promise<IdentityCreation>;
    deleteIdentity(userId: string): Promise<void>;
  };
  readonly invitees: {
    insertInvitedMember(row: InvitedMemberRow): Promise<void>;
    findInvitee(scope: MemberScope): Promise<Invitee | null>;
  };
  /** Emite el enlace y manda la invitación. Tiene la forma del correo de
   * confirmación para que el reenvío use su mismo límite. */
  readonly invitationEmail: ConfirmationEmailGateway;
  readonly emailDeliveryForClub: (
    clubId: string,
  ) => EmailDeliveryAvailabilityCheck;
  /** El registro de envíos del reenvío de la confirmación: la invitación se
   * limita con él, contando por dirección. */
  readonly invitationRequestsForClub: (clubId: string) => EmailRequestLog;
};

export class MemberInvitationForbiddenError extends Error {
  constructor() {
    super(
      "Sólo un Admin puede dar de alta a un miembro o reenviarle la invitación.",
    );
    this.name = "MemberInvitationForbiddenError";
  }
}

export class NewMemberValidationError extends Error {
  readonly issues: readonly NewMemberIssue[];

  constructor(issues: readonly NewMemberIssue[]) {
    super(
      `El alta trae campos que no valen: ${issues
        .map((issue) => `${issue.field} (${issue.code})`)
        .join(", ")}.`,
    );
    this.name = "NewMemberValidationError";
    this.issues = issues;
  }
}

export class MemberEmailTakenError extends Error {
  constructor() {
    super("Ese correo ya tiene una cuenta.");
    this.name = "MemberEmailTakenError";
  }
}

export class InvitationNotPendingError extends Error {
  constructor() {
    super("Ese miembro ya entró: no hay invitación que reenviar.");
    this.name = "InvitationNotPendingError";
  }
}

export class InvitationRateLimitedError extends Error {
  readonly retryAfterMinutes: number;

  constructor(retryAfterMinutes: number) {
    super(
      `Se pidieron varias invitaciones seguidas. Espera ${retryAfterMinutes} minutos antes de pedir otra.`,
    );
    this.name = "InvitationRateLimitedError";
    this.retryAfterMinutes = retryAfterMinutes;
  }
}

/** El motivo es del proveedor o del cupo, y va al registro del servidor; el
 * mensaje, que es lo que llega a quien llama, no lo repite. */
export class InvitationNotSentError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super("No se pudo mandar la invitación. Inténtalo de nuevo más tarde.");
    this.name = "InvitationNotSentError";
    this.reason = reason;
  }
}

type ValidNewMember = Omit<
  InvitedMemberRow,
  "club_id" | "user_id" | "role" | "account_status" | "email_locale"
>;

type FieldCheck = readonly [NewMemberField, NewMemberIssueCode | null];

function checkAufExpiry(
  aufExpiry: string,
  todayInClub: string,
): NewMemberIssueCode | null {
  if (!isRealCalendarDate(aufExpiry)) {
    return "auf_expiry_not_a_date";
  }
  // Ingresa hoy, y un registro no puede caducar antes de que la persona fuera
  // del club: la misma regla que la ficha (#242).
  return aufExpiry < todayInClub ? "auf_expiry_before_joined" : null;
}

function checkAufNumber(aufNumber: string): NewMemberIssueCode | null {
  if (aufNumber === "") {
    return "auf_number_missing";
  }
  return isAufNumberTooLong(aufNumber) ? "auf_number_too_long" : null;
}

/** Todos los campos que no valen, no el primero: el formulario los marca de
 * una vez. No lee nada, así que una petición mal hecha no toca la base. */
function validateNewMember(
  submission: NewMemberSubmission,
  todayInClub: string,
): ValidNewMember {
  const fullName = submission.fullName.trim();
  const aufNumber = submission.aufNumber.trim();
  const country = validateCountryField(submission.country);
  const position = parsePosition(submission.position);
  const experienceLevel = parseExperienceLevel(submission.experienceLevel);
  const gender = parseGender(submission.gender);
  const checks: readonly FieldCheck[] = [
    ["fullName", fullName === "" ? "full_name_missing" : null],
    ["email", looksLikeEmail(submission.email) ? null : "email_malformed"],
    ["country", country.ok ? null : "country_unknown"],
    ["position", position === null ? "position_unknown" : null],
    [
      "experienceLevel",
      experienceLevel === null ? "experience_level_unknown" : null,
    ],
    ["gender", gender === null ? "gender_unknown" : null],
    ["aufNumber", checkAufNumber(aufNumber)],
    ["aufExpiry", checkAufExpiry(submission.aufExpiry, todayInClub)],
  ];
  const issues = checks.flatMap(([field, code]) =>
    code === null ? [] : [{ field, code }],
  );
  if (
    issues.length > 0 ||
    !country.ok ||
    position === null ||
    experienceLevel === null ||
    gender === null
  ) {
    throw new NewMemberValidationError(issues);
  }
  return {
    full_name: fullName,
    email: submission.email.trim().toLowerCase(),
    country: country.value,
    position,
    experience_level: experienceLevel,
    gender,
    auf_number: aufNumber,
    auf_expiry: submission.aufExpiry,
  };
}

async function findAdministrator(
  gateways: Pick<MemberInvitationGateways, "members">,
  callerId: string,
): Promise<RoleRequestMember> {
  const caller = await gateways.members.findRoleRequestMember(callerId);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  if (!hasCapability(caller.role, "manageUsersAndRoles")) {
    throw new MemberInvitationForbiddenError();
  }
  return caller;
}

/** La identidad y la fila son dos escrituras en dos sistemas, sin transacción
 * que las cubra: si la fila falla, se deshace la identidad para que el correo
 * no quede tomado por una cuenta sin miembro. Como en el registro, un borrado
 * que también falla se dice en vez de esconderse. */
async function insertMemberOrUndoIdentity(
  gateways: MemberInvitationGateways,
  row: InvitedMemberRow,
): Promise<void> {
  try {
    await gateways.invitees.insertInvitedMember(row);
  } catch (insertError) {
    try {
      await gateways.identities.deleteIdentity(row.user_id);
    } catch (deleteError) {
      throw new Error(
        `No se pudo crear la fila del miembro y la identidad ${row.user_id} queda huérfana: ${String(deleteError)}`,
        { cause: insertError },
      );
    }
    throw insertError;
  }
}

async function assignGroups(
  gateways: MemberInvitationGateways,
  request: { readonly callerId: string; readonly userId: string },
  groupIds: ReadonlySet<string>,
): Promise<void> {
  for (const groupId of groupIds) {
    await assignGroupMember(gateways, { ...request, groupId });
  }
}

type InvitationRequest = {
  readonly clubId: string;
  readonly email: string;
  readonly now: Date;
  readonly appUrl: string;
};

async function sendInvitation(
  gateways: MemberInvitationGateways,
  request: InvitationRequest,
): Promise<InvitationDelivery> {
  const availability = await gateways
    .emailDeliveryForClub(request.clubId)
    .checkAvailability(request.now);
  if (availability.kind === "unavailable") {
    return { kind: "not_sent", reason: availability.reason };
  }
  const outcome = await gateways.invitationEmail.requestConfirmationEmail(
    request.email,
    request.appUrl,
  );
  return describeOutcome(outcome);
}

function describeOutcome(
  outcome: Awaited<
    ReturnType<ConfirmationEmailGateway["requestConfirmationEmail"]>
  >,
): InvitationDelivery {
  switch (outcome.kind) {
    case "requested":
      return { kind: "sent" };
    case "not_requested":
      return {
        kind: "not_sent",
        reason: "La identidad del miembro ya no existe.",
      };
    case "failed":
    case "rate_limited":
      return { kind: "not_sent", reason: outcome.reason };
  }
}

export type NewMemberRequest = {
  readonly callerId: string;
  readonly submission: NewMemberSubmission;
  /** El día del club (NFR-003): el de ingreso, contra el que se mide el
   * vencimiento del AUF. */
  readonly todayInClub: string;
  readonly now: Date;
  /** El idioma con el que trabaja el Admin. */
  readonly locale: Locale;
  /** La dirección de la petición: el enlace vuelve a este despliegue. */
  readonly appUrl: string;
};

export async function createInvitedMember(
  gateways: MemberInvitationGateways,
  request: NewMemberRequest,
): Promise<CreatedMember> {
  const member = validateNewMember(request.submission, request.todayInClub);
  const caller = await findAdministrator(gateways, request.callerId);
  const groupIds = new Set(request.submission.groupIds);
  // Antes de crear la identidad: un grupo que no es del club no deja nada a
  // medias.
  await assertClubGroups(gateways, caller.clubId, groupIds);

  const identity = await gateways.identities.createInvitedIdentity(
    member.email,
  );
  if (identity.kind === "already_registered") {
    throw new MemberEmailTakenError();
  }
  await insertMemberOrUndoIdentity(gateways, {
    ...member,
    club_id: caller.clubId,
    user_id: identity.userId,
    role: "Player",
    account_status: "incomplete",
    email_locale: request.locale,
  });
  await assignGroups(
    gateways,
    { callerId: request.callerId, userId: identity.userId },
    groupIds,
  );

  return {
    member: {
      userId: identity.userId,
      fullName: member.full_name,
      email: member.email,
    },
    invitation: await sendInvitation(gateways, {
      clubId: caller.clubId,
      email: member.email,
      now: request.now,
      appUrl: request.appUrl,
    }),
  };
}

/** Todavía no entró quien sigue a medias y no canjeó ningún enlace: canjear
 * el de la invitación confirma el correo. Una cuenta activa o de baja ya no
 * tiene invitación pendiente. */
async function findPendingInvitee(
  gateways: MemberInvitationGateways,
  scope: MemberScope,
): Promise<Invitee> {
  const invitee = await gateways.invitees.findInvitee(scope);
  if (invitee === null) {
    throw new MemberRecordNotFoundError();
  }
  if (
    invitee.accountStatus !== "incomplete" ||
    (await gateways.identities.isEmailConfirmed(scope.userId))
  ) {
    throw new InvitationNotPendingError();
  }
  return invitee;
}

export type InvitationResendRequest = {
  readonly callerId: string;
  readonly userId: string;
  readonly now: Date;
  readonly appUrl: string;
};

/** Reenvía la invitación con un enlace nuevo, que invalida el anterior. El
 * límite es el del reenvío de la confirmación, con su mismo registro. */
export async function resendInvitation(
  gateways: MemberInvitationGateways,
  request: InvitationResendRequest,
): Promise<void> {
  const caller = await findAdministrator(gateways, request.callerId);
  const invitee = await findPendingInvitee(gateways, {
    clubId: caller.clubId,
    userId: request.userId,
  });
  const resend = await resendConfirmationEmail(
    {
      requests: gateways.invitationRequestsForClub(caller.clubId),
      confirmationEmail: gateways.invitationEmail,
      emailDelivery: gateways.emailDeliveryForClub(caller.clubId),
    },
    { email: invitee.email, now: request.now, appUrl: request.appUrl },
  );
  if (resend.kind === "rate_limited") {
    throw new InvitationRateLimitedError(resend.retryAfterMinutes);
  }
  if (resend.kind === "email_unavailable") {
    throw new InvitationNotSentError(resend.reason);
  }
  const delivery = describeOutcome(await resend.deliver());
  if (delivery.kind === "not_sent") {
    throw new InvitationNotSentError(delivery.reason);
  }
}
