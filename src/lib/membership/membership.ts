/**
 * La membresía de un socio y si está al día (#451, RF-1 del PRD de E12, D1).
 *
 * El estado lo guardan los webhooks de Stripe y la exención del Admin
 * (`0050_memberships.sql`). Lo único que se decide al leer es la exención con
 * fecha de fin: vencida, deja de contar sin que ningún scheduler la toque.
 */

import type { MembershipType } from "@/lib/auth/registration";

/** El plan es el tipo que el socio eligió al registrarse (FR-062). */
export type MembershipPlan = MembershipType;

export const MEMBERSHIP_STATUSES = [
  "pending",
  "trialing",
  "active",
  "past_due",
  "cancelled",
  "waived",
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Los estados que pone Stripe o el alta: todos menos la exención. */
export type UnwaivedStatus = Exclude<MembershipStatus, "waived">;

/** "Al día" según D1. `waived` cuenta sólo mientras no haya vencido, y una
 * membresía resuelta ya no trae exenciones vencidas. */
const CURRENT_STATUSES: ReadonlySet<MembershipStatus> = new Set([
  "trialing",
  "active",
  "waived",
]);

/** Lo que se enseña de la tarjeta, y nada más (NFR-006). */
export type MembershipCard = {
  readonly brand: string;
  readonly last4: string;
  readonly expMonth: number;
  readonly expYear: number;
};

export type MembershipWaiver = {
  readonly reason: string;
  /** Sin fecha, la exención no vence. */
  readonly until: Date | null;
  /** Nulo si el Admin que eximió ya no está en el club. */
  readonly waivedBy: string | null;
};

type MembershipDetails = {
  readonly userId: string;
  readonly clubId: string;
  /** Nulo sólo para quien aún no eligió tipo en su registro. */
  readonly plan: MembershipPlan | null;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly currentPeriodEnd: Date | null;
  readonly trialEnd: Date | null;
  readonly card: MembershipCard | null;
};

/** La fila tal como la guarda la base, antes de mirar la fecha. */
export type MembershipRecord = MembershipDetails & {
  readonly status: MembershipStatus;
  readonly waiver: MembershipWaiver | null;
};

/** La membresía tal como cuenta hoy: una exención vencida ya no es `waived`. */
export type Membership =
  | (MembershipDetails & {
      readonly status: "waived";
      readonly waiver: MembershipWaiver;
    })
  | (MembershipDetails & { readonly status: UnwaivedStatus });

export type MembershipReading =
  | { readonly kind: "found"; readonly membership: Membership }
  | { readonly kind: "none" };

export type MembershipGateway = {
  findByUserId(userId: string): Promise<MembershipRecord | null>;
};

function isAfter(date: Date | null, now: Date): boolean {
  return date !== null && date.getTime() > now.getTime();
}

/**
 * Lo que vale una exención vencida. Sin suscripción, el socio vuelve a no
 * haber puesto tarjeta. Con ella, eximir la canceló al final de su periodo
 * (RF-4), así que vale lo que digan sus fechas: en prueba, en curso o ya
 * terminada.
 */
function statusAfterWaiver(
  record: MembershipRecord,
  now: Date,
): UnwaivedStatus {
  if (record.stripeSubscriptionId === null) {
    return "pending";
  }
  if (isAfter(record.trialEnd, now)) {
    return "trialing";
  }
  return isAfter(record.currentPeriodEnd, now) ? "active" : "cancelled";
}

function hasWaiverExpired(waiver: MembershipWaiver, now: Date): boolean {
  return waiver.until !== null && !isAfter(waiver.until, now);
}

export function resolveMembership(
  record: MembershipRecord,
  now: Date,
): Membership {
  const { status, waiver, ...details } = record;
  if (status !== "waived") {
    return { ...details, status };
  }
  if (waiver === null) {
    throw new Error(
      `La membresía de ${record.userId} está exenta sin exención: la base debería impedirlo.`,
    );
  }
  if (hasWaiverExpired(waiver, now)) {
    return { ...details, status: statusAfterWaiver(record, now) };
  }
  return { ...details, status, waiver };
}

export function isMembershipCurrent(membership: Membership): boolean {
  return CURRENT_STATUSES.has(membership.status);
}

export async function readMembership(
  gateway: MembershipGateway,
  input: { readonly userId: string; readonly now: Date },
): Promise<MembershipReading> {
  const record = await gateway.findByUserId(input.userId);
  if (record === null) {
    return { kind: "none" };
  }
  return { kind: "found", membership: resolveMembership(record, input.now) };
}
