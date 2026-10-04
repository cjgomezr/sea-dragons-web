import {
  type Membership,
  type MembershipGateway,
  type MembershipPlan,
  readMembership,
} from "./membership";

/**
 * Elegir el tipo de membresía en Pagos antes del primer pago (#479, D8 del
 * PRD de E12, FR-009 del SRD v1.5). Mientras no hay nada pagado el socio
 * cambia de opción cuanto quiera; en cuanto hay suscripción en Stripe, o la
 * membresía está al día o con un cobro fallido, el cambio es el de D5
 * (#456).
 */

export type PlanChoiceGateway = {
  /** Guarda el plan sólo si la membresía sigue sin suscripción en Stripe y
   * en un estado que deja elegir. `false` si ya no, porque el webhook o un
   * Admin la movió entre la lectura y la escritura. */
  savePlanChoice(userId: string, plan: MembershipPlan): Promise<boolean>;
};

export type PlanChoiceGateways = {
  readonly membership: MembershipGateway;
  readonly planChoices: PlanChoiceGateway;
};

export type PlanChoiceRefusal = "no_membership" | "membership_started";

export type PlanChoiceOutcome =
  | { readonly kind: "chosen" }
  | { readonly kind: "refused"; readonly reason: PlanChoiceRefusal };

/** Si Pagos le ofrece elegir plan: sin suscripción y sin estar al día ni
 * con un cobro fallido. Una exención vencida ya llega resuelta. */
export function canChoosePlan(membership: Membership): boolean {
  return (
    membership.stripeSubscriptionId === null &&
    (membership.status === "pending" || membership.status === "cancelled")
  );
}

export async function choosePlan(
  gateways: PlanChoiceGateways,
  request: {
    readonly userId: string;
    readonly plan: MembershipPlan;
    readonly now: Date;
  },
): Promise<PlanChoiceOutcome> {
  const reading = await readMembership(gateways.membership, request);
  if (reading.kind === "none") {
    return { kind: "refused", reason: "no_membership" };
  }
  if (!canChoosePlan(reading.membership)) {
    return { kind: "refused", reason: "membership_started" };
  }
  const isSaved = await gateways.planChoices.savePlanChoice(
    request.userId,
    request.plan,
  );
  return isSaved
    ? { kind: "chosen" }
    : { kind: "refused", reason: "membership_started" };
}
