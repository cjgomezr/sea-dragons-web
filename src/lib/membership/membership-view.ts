import type {
  MembershipPlan,
  MembershipReading,
  MembershipStatus,
} from "./membership";

/**
 * Lo que Pagos sabe pintar de la membresía de quien la abre (#454): el plan,
 * el estado que cuenta hoy y el fin de la prueba, si la tuvo. Es lo que sirve
 * `GET /api/v1/membership` y lo que la página lee al pintarse; #455 lo
 * completa con la tarjeta y el próximo cobro.
 */
export type MembershipView = {
  /** Sin las variables de Stripe no se ofrece Checkout (RF-9). */
  readonly paymentsConfigured: boolean;
  readonly membership: {
    readonly plan: MembershipPlan | null;
    readonly status: MembershipStatus;
    /** ISO 8601. Que exista dice además que ya tuvo su mes de prueba. */
    readonly trialEnd: string | null;
  } | null;
};

export function toMembershipView(
  reading: MembershipReading,
  paymentsConfigured: boolean,
): MembershipView {
  if (reading.kind === "none") {
    return { paymentsConfigured, membership: null };
  }
  const { plan, status, trialEnd } = reading.membership;
  return {
    paymentsConfigured,
    membership: {
      plan,
      status,
      trialEnd: trialEnd === null ? null : trialEnd.toISOString(),
    },
  };
}
