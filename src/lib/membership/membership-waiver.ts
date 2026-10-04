import {
  type AuditActor,
  type AuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import { MemberToChangeNotFoundError } from "@/lib/auth/member-role-change";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import type { MembershipStatus, UnwaivedStatus } from "./membership";
import type { MembershipWaiverView } from "./membership-view";

/**
 * La exención manual del Admin (#457, RF-4 del PRD de E12, D4): eximir de
 * cuota a un socio desde su ficha, con motivo y fecha de fin opcional, y
 * retirarle la exención. Contado sin Supabase ni Stripe delante.
 *
 * La escritura es de `waive_membership` y `remove_membership_waiver`
 * (`0054_membership_waiver.sql`), que vuelven a mirar que quien actúa siga
 * siendo Admin. Aquí se valida lo escrito, se cancela en Stripe la
 * suscripción de quien queda exento y se deja la bitácora.
 *
 * La fecha de fin es un día del club: la exención deja de contar al empezar
 * ese día en Melbourne, sin scheduler (#451).
 */

export const WAIVER_REASON_MAX_LENGTH = 200;

export const WAIVER_ISSUE_CODES = [
  "reason_required",
  "reason_too_long",
  "until_not_a_date",
  "until_not_after_today",
] as const;

export type WaiverIssueCode = (typeof WAIVER_ISSUE_CODES)[number];

/** Lo que escribe el Admin, sin validar. `until` es un día YYYY-MM-DD. */
export type WaiverSubmission = {
  readonly reason: string;
  readonly until: string | null;
};

/** La membresía del socio después del cambio, tal como la pinta la ficha. */
export type MembershipWaiverChange = {
  readonly userId: string;
  readonly membershipStatus: MembershipStatus;
  /** Sólo la de una membresía exenta. */
  readonly waiver: MembershipWaiverView | null;
};

export type WaiverScope = {
  readonly targetUserId: string;
  readonly clubId: string;
  readonly actorId: string;
};

export type WaiverWriteInput = WaiverScope & {
  readonly reason: string;
  readonly until: string | null;
};

/** Lo que responde la base al eximir. El estado anterior y la suscripción
 * dicen si hay algo que cancelar en Stripe. */
export type WaiverWrite =
  | {
      readonly kind: "waived";
      readonly previousStatus: MembershipStatus;
      readonly stripeSubscriptionId: string | null;
      readonly reason: string;
      readonly until: Date | null;
    }
  | { readonly kind: "actor_not_admin" }
  | { readonly kind: "not_found" };

export type WaiverRemoval =
  | { readonly kind: "removed"; readonly status: UnwaivedStatus }
  | { readonly kind: "not_waived" }
  | { readonly kind: "actor_not_admin" }
  | { readonly kind: "not_found" };

export type SubscriptionCanceller =
  | {
      readonly kind: "configured";
      cancelAtPeriodEnd(subscriptionId: string): Promise<void>;
    }
  | { readonly kind: "unconfigured" };

export type MembershipWaiverGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly waivers: {
    applyWaiver(input: WaiverWriteInput): Promise<WaiverWrite>;
    removeWaiver(scope: WaiverScope): Promise<WaiverRemoval>;
  };
  readonly subscriptions: SubscriptionCanceller;
  readonly audit: AuditLogWriter;
  readonly log: (line: string) => void;
};

const MEMBER_ENTITY_TYPE = "member";
const LOG_PREFIX = "[membership/waiver]";
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_LENGTH = "YYYY-MM-DD".length;

/** Los estados en los que Stripe todavía va a cobrar: eximir los corta. */
const BILLABLE_STATUSES: ReadonlySet<MembershipStatus> = new Set([
  "trialing",
  "active",
  "past_due",
]);

export class MembershipWaiverForbiddenError extends Error {
  constructor() {
    super("Sólo un Admin puede eximir de cuota o retirar una exención.");
    this.name = "MembershipWaiverForbiddenError";
  }
}

export class MembershipWaiverValidationError extends Error {
  readonly code: WaiverIssueCode;

  constructor(code: WaiverIssueCode, message: string) {
    super(message);
    this.name = "MembershipWaiverValidationError";
    this.code = code;
  }
}

export class MembershipNotWaivedError extends Error {
  constructor() {
    super(
      "La membresía de este socio no está exenta: no hay nada que retirar.",
    );
    this.name = "MembershipNotWaivedError";
  }
}

/** La exención quedó escrita en la base, pero su rastro no llegó a la
 * bitácora. No es un éxito completo y no se responde como tal. */
export class WaiverNotAuditedError extends Error {
  readonly change: MembershipWaiverChange;

  constructor(change: MembershipWaiverChange, cause: unknown) {
    super(
      `La membresía de ${change.userId} quedó ${change.membershipStatus}, pero no se pudo registrar en la bitácora.`,
    );
    this.name = "WaiverNotAuditedError";
    this.change = change;
    this.cause = cause;
  }
}

/** Si `day` es un día de calendario que existe: `2027-02-30` no lo es. */
function isCalendarDay(day: string): boolean {
  if (!DAY_PATTERN.test(day)) {
    return false;
  }
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, ISO_DATE_LENGTH) === day
  );
}

function validateUntil(until: string | null, now: Date): string | null {
  if (until === null) {
    return null;
  }
  if (!isCalendarDay(until)) {
    throw new MembershipWaiverValidationError(
      "until_not_a_date",
      "La fecha de fin tiene que ser un día (YYYY-MM-DD).",
    );
  }
  // Comparados como texto, los YYYY-MM-DD ordenan igual que los días.
  if (until <= clubCalendarDate(now)) {
    throw new MembershipWaiverValidationError(
      "until_not_after_today",
      "La fecha de fin tiene que ser posterior a hoy.",
    );
  }
  return until;
}

function validateSubmission(
  submission: WaiverSubmission,
  now: Date,
): WaiverSubmission {
  const reason = submission.reason.trim();
  if (reason.length === 0) {
    throw new MembershipWaiverValidationError(
      "reason_required",
      "El motivo de la exención es obligatorio.",
    );
  }
  if (reason.length > WAIVER_REASON_MAX_LENGTH) {
    throw new MembershipWaiverValidationError(
      "reason_too_long",
      `El motivo no puede pasar de ${WAIVER_REASON_MAX_LENGTH} caracteres.`,
    );
  }
  return { reason, until: validateUntil(submission.until, now) };
}

/** El club de quien actúa. La frontera ya niega la ruta a quien no es Admin;
 * cerrar una puerta que cobra no se deja a un solo cerrojo. */
async function findAdminClubId(
  gateways: MembershipWaiverGateways,
  actorId: string,
): Promise<string> {
  const actor = await gateways.members.findRoleRequestMember(actorId);
  if (actor === null) {
    throw new MemberNotFoundError(actorId);
  }
  if (!hasCapability(actor.role, "manageUsersAndRoles")) {
    throw new MembershipWaiverForbiddenError();
  }
  return actor.clubId;
}

/** Que Stripe no cobre más a quien queda exento: la suscripción termina al
 * final del periodo ya pagado. Un fallo no deshace la exención (el socio
 * queda al día igual); se deja en el log para quien mantiene la plataforma. */
async function cancelSubscriptionOf(
  gateways: MembershipWaiverGateways,
  write: Extract<WaiverWrite, { readonly kind: "waived" }>,
): Promise<void> {
  const subscriptionId = write.stripeSubscriptionId;
  if (subscriptionId === null || !BILLABLE_STATUSES.has(write.previousStatus)) {
    return;
  }
  const { subscriptions } = gateways;
  if (subscriptions.kind === "unconfigured") {
    gateways.log(
      `${LOG_PREFIX} Stripe sin configurar: la suscripción ${subscriptionId} sigue viva y hay que cancelarla a mano.`,
    );
    return;
  }
  try {
    await subscriptions.cancelAtPeriodEnd(subscriptionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    gateways.log(
      `${LOG_PREFIX} No se pudo cancelar la suscripción ${subscriptionId}: ${message}`,
    );
  }
}

async function auditWaiverChange(
  audit: AuditLogWriter,
  entry: {
    readonly actor: AuditActor;
    readonly change: MembershipWaiverChange;
    readonly action: "membership.waived" | "membership.waiver_removed";
    readonly metadata: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await recordAuditEvent(audit, {
      actor: entry.actor,
      clubId: entry.actor.clubId,
      action: entry.action,
      entityType: MEMBER_ENTITY_TYPE,
      entityId: entry.change.userId,
      result: "success",
      metadata: entry.metadata,
    });
  } catch (error) {
    throw new WaiverNotAuditedError(entry.change, error);
  }
}

type WaiverRequest = {
  readonly actorId: string;
  readonly targetUserId: string;
  readonly submission: WaiverSubmission;
  readonly now: Date;
};

/** Exime al socio, cancela su suscripción si Stripe le iba a cobrar y lo
 * deja en la bitácora. Stripe va antes que la bitácora: un fallo de ésta no
 * puede dejar a un socio exento pagando. */
export async function waiveMembership(
  gateways: MembershipWaiverGateways,
  request: WaiverRequest,
): Promise<MembershipWaiverChange> {
  const submission = validateSubmission(request.submission, request.now);
  const clubId = await findAdminClubId(gateways, request.actorId);
  const write = await gateways.waivers.applyWaiver({
    targetUserId: request.targetUserId,
    clubId,
    actorId: request.actorId,
    ...submission,
  });
  if (write.kind === "actor_not_admin") {
    throw new MembershipWaiverForbiddenError();
  }
  if (write.kind === "not_found") {
    throw new MemberToChangeNotFoundError(request.targetUserId);
  }
  await cancelSubscriptionOf(gateways, write);
  const waiver: MembershipWaiverView = {
    reason: write.reason,
    until: write.until === null ? null : write.until.toISOString(),
  };
  const change: MembershipWaiverChange = {
    userId: request.targetUserId,
    membershipStatus: "waived",
    waiver,
  };
  await auditWaiverChange(gateways.audit, {
    actor: { id: request.actorId, clubId },
    change,
    action: "membership.waived",
    metadata: { ...waiver },
  });
  return change;
}

/** Retira la exención: la membresía vuelve a `pending` o a lo que digan las
 * fechas de su suscripción, como lo decide la base. */
export async function removeMembershipWaiver(
  gateways: MembershipWaiverGateways,
  request: { readonly actorId: string; readonly targetUserId: string },
): Promise<MembershipWaiverChange> {
  const clubId = await findAdminClubId(gateways, request.actorId);
  const removal = await gateways.waivers.removeWaiver({
    targetUserId: request.targetUserId,
    clubId,
    actorId: request.actorId,
  });
  switch (removal.kind) {
    case "actor_not_admin":
      throw new MembershipWaiverForbiddenError();
    case "not_found":
      throw new MemberToChangeNotFoundError(request.targetUserId);
    case "not_waived":
      throw new MembershipNotWaivedError();
    case "removed":
      break;
  }
  const change: MembershipWaiverChange = {
    userId: request.targetUserId,
    membershipStatus: removal.status,
    waiver: null,
  };
  await auditWaiverChange(gateways.audit, {
    actor: { id: request.actorId, clubId },
    change,
    action: "membership.waiver_removed",
    metadata: { newStatus: removal.status },
  });
  return change;
}
