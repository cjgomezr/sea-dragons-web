import type Stripe from "stripe";
import { type MembershipGateway, readMembership } from "./membership";

/**
 * Reintentar un cobro fallido (#474, RF-7 del PRD de E13, D5): la página que
 * aloja Stripe para la factura abierta de la suscripción del socio. Allí paga
 * con la misma tarjeta o con otra; ningún dato de tarjeta pasa por la
 * aplicación (NFR-006). La membresía vuelve a `active` por el webhook de
 * `invoice.paid` (#452), nunca por la pantalla.
 */

/** Lo único que se le pide a Stripe: las facturas de una suscripción. */
export type OpenInvoices = {
  list(params: Stripe.InvoiceListParams): Promise<{
    readonly data: ReadonlyArray<{
      readonly hosted_invoice_url?: string | null;
    }>;
  }>;
};

export type PaymentRetryStripe =
  | { readonly kind: "configured"; readonly invoices: OpenInvoices }
  | { readonly kind: "unconfigured" };

export type PaymentRetryGateways = {
  readonly membership: MembershipGateway;
  readonly stripe: PaymentRetryStripe;
};

/** Sin suscripción, o sin factura abierta en ella, no hay nada que pagar. */
export type PaymentRetryRefusal = "stripe_not_configured" | "no_open_invoice";

export type PaymentRetryStart =
  | { readonly kind: "found"; readonly url: string }
  | { readonly kind: "refused"; readonly reason: PaymentRetryRefusal };

export type PaymentRetryRequest = {
  readonly userId: string;
  readonly now: Date;
};

/** Una suscripción tiene como mucho una factura abierta a la vez: la del
 * periodo cuyo cobro falló. */
const OPEN_INVOICE_LIMIT = 1;

export async function startPaymentRetry(
  gateways: PaymentRetryGateways,
  request: PaymentRetryRequest,
): Promise<PaymentRetryStart> {
  const { stripe } = gateways;
  if (stripe.kind === "unconfigured") {
    return { kind: "refused", reason: "stripe_not_configured" };
  }
  const reading = await readMembership(gateways.membership, request);
  const subscriptionId =
    reading.kind === "found" ? reading.membership.stripeSubscriptionId : null;
  if (subscriptionId === null) {
    return { kind: "refused", reason: "no_open_invoice" };
  }
  const { data } = await stripe.invoices.list({
    subscription: subscriptionId,
    status: "open",
    limit: OPEN_INVOICE_LIMIT,
  });
  const [invoice] = data;
  if (invoice === undefined) {
    return { kind: "refused", reason: "no_open_invoice" };
  }
  if (!invoice.hosted_invoice_url) {
    throw new Error(
      `La factura abierta de ${subscriptionId} está sin página en Stripe.`,
    );
  }
  return { kind: "found", url: invoice.hosted_invoice_url };
}
