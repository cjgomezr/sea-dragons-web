import type Stripe from "stripe";
import type { PaymentStatus } from "./membership-view";

/**
 * El recibo de Stripe de un pago cobrado (#630, RF-4 y D6 del PRD de E23).
 * Una cuota llega como factura y su recibo es la página que Stripe aloja para
 * ella; un pack o un extra llega como cobro suelto y su recibo es el del
 * último cargo del PaymentIntent. La URL no se guarda: Stripe la hace caducar,
 * así que se pide en cada petición.
 */

/** De dónde sale el recibo, según cómo entró el pago (`0050`). */
export type ReceiptSource =
  | { readonly kind: "invoice"; readonly invoiceId: string }
  | { readonly kind: "payment_intent"; readonly paymentIntentId: string };

export type ReceiptablePayment = {
  readonly status: PaymentStatus;
  readonly source: ReceiptSource;
};

/** El pago, o `null` cuando no existe o la RLS no deja leerlo. */
export type PaymentReceiptGateway = {
  findById(paymentId: string): Promise<ReceiptablePayment | null>;
};

export type ReceiptInvoices = {
  retrieve(
    invoiceId: string,
  ): Promise<{ readonly hosted_invoice_url?: string | null }>;
};

export type ReceiptPaymentIntents = {
  retrieve(
    paymentIntentId: string,
    params: Stripe.PaymentIntentRetrieveParams,
  ): Promise<{
    readonly latest_charge:
      string | { readonly receipt_url: string | null } | null;
  }>;
};

export type PaymentReceiptStripe =
  | {
      readonly kind: "configured";
      readonly invoices: ReceiptInvoices;
      readonly paymentIntents: ReceiptPaymentIntents;
    }
  | { readonly kind: "unconfigured" };

export type PaymentReceiptGateways = {
  readonly payments: PaymentReceiptGateway;
  readonly stripe: PaymentReceiptStripe;
};

export type PaymentReceiptRefusal =
  "stripe_not_configured" | "receipt_not_found";

export type PaymentReceiptLookup =
  | { readonly kind: "found"; readonly url: string }
  | { readonly kind: "refused"; readonly reason: PaymentReceiptRefusal };

const RECEIPT_NOT_FOUND: PaymentReceiptLookup = {
  kind: "refused",
  reason: "receipt_not_found",
};

type ConfiguredStripe = Extract<PaymentReceiptStripe, { kind: "configured" }>;

/** Sin `expand` Stripe sólo devuelve el id del cargo, sin su recibo. */
const LATEST_CHARGE_EXPANSION = ["latest_charge"];

async function readReceiptUrl(
  stripe: ConfiguredStripe,
  source: ReceiptSource,
): Promise<string | null> {
  if (source.kind === "invoice") {
    const invoice = await stripe.invoices.retrieve(source.invoiceId);
    return invoice.hosted_invoice_url ?? null;
  }
  const { latest_charge: charge } = await stripe.paymentIntents.retrieve(
    source.paymentIntentId,
    { expand: LATEST_CHARGE_EXPANSION },
  );
  return charge === null || typeof charge === "string"
    ? null
    : charge.receipt_url;
}

/** Un fallo de Stripe sube tal cual: la ruta decide cómo responderlo. */
export async function findPaymentReceipt(
  gateways: PaymentReceiptGateways,
  paymentId: string,
): Promise<PaymentReceiptLookup> {
  const { stripe } = gateways;
  if (stripe.kind === "unconfigured") {
    return { kind: "refused", reason: "stripe_not_configured" };
  }
  const payment = await gateways.payments.findById(paymentId);
  if (payment === null || payment.status !== "paid") {
    return RECEIPT_NOT_FOUND;
  }
  const url = await readReceiptUrl(stripe, payment.source);
  return url ? { kind: "found", url } : RECEIPT_NOT_FOUND;
}
