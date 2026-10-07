import { type MembershipStanding, resolveStandingStatus } from "./membership";

/**
 * La alerta de pago fallido (#474, RF-7 del PRD de E13, FR-070): se enseña
 * en toda la aplicación mientras la membresía esté en `past_due`, con la
 * fecha del último cobro fallido. Desaparece sola en la siguiente petición
 * cuando el webhook de `invoice.paid` la vuelve a `active` (FR-071).
 */

export type FailedPaymentAlert = {
  /** El último cobro de cuota fallido. Nulo si el webhook que lo escribe
   * (#452) todavía no llegó: la alerta sale igual, sin fecha. */
  readonly failedAt: Date | null;
};

export type FailedPaymentAlertGateway = {
  findStanding(userId: string): Promise<MembershipStanding | null>;
  findLastFailedInvoiceAt(userId: string): Promise<Date | null>;
};

export async function readFailedPaymentAlert(
  gateway: FailedPaymentAlertGateway,
  request: { readonly userId: string; readonly now: Date },
): Promise<FailedPaymentAlert | null> {
  const standing = await gateway.findStanding(request.userId);
  if (
    standing === null ||
    resolveStandingStatus(standing, request.now) !== "past_due"
  ) {
    return null;
  }
  return {
    failedAt: await gateway.findLastFailedInvoiceAt(request.userId),
  };
}
