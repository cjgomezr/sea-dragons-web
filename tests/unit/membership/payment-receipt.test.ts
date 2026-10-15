// @vitest-environment node
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
  type PaymentReceiptGateways,
  type ReceiptablePayment,
  type ReceiptInvoices,
  type ReceiptPaymentIntents,
  findPaymentReceipt,
} from "@/lib/membership/payment-receipt";

/**
 * El recibo de Stripe de un pago cobrado (#630, RF-4 y D6 del PRD de E23):
 * la página de la factura para una cuota, el recibo del cobro para un pack o
 * un extra. La URL caduca, así que se pide a Stripe cada vez.
 */

const PAYMENT_ID = "0f3a2b1c-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const INVOICE_URL = "https://invoice.stripe.com/i/acct_1/test_inv_paid";
const RECEIPT_URL = "https://pay.stripe.com/receipts/payment/test_receipt";

const MEMBERSHIP_PAYMENT: ReceiptablePayment = {
  status: "paid",
  source: { kind: "invoice", invoiceId: "in_123" },
};

const PACK_PAYMENT: ReceiptablePayment = {
  status: "paid",
  source: { kind: "payment_intent", paymentIntentId: "pi_123" },
};

type StripeDoubles = {
  readonly invoices: ReceiptInvoices & {
    readonly retrieve: ReturnType<typeof vi.fn<ReceiptInvoices["retrieve"]>>;
  };
  readonly paymentIntents: ReceiptPaymentIntents & {
    readonly retrieve: ReturnType<
      typeof vi.fn<ReceiptPaymentIntents["retrieve"]>
    >;
  };
};

function stripeDoubles(
  urls: {
    readonly invoiceUrl?: string | null;
    readonly receiptUrl?: string | null;
  } = { invoiceUrl: INVOICE_URL, receiptUrl: RECEIPT_URL },
): StripeDoubles {
  return {
    invoices: {
      retrieve: vi.fn<ReceiptInvoices["retrieve"]>(async () => ({
        hosted_invoice_url: urls.invoiceUrl ?? null,
      })),
    },
    paymentIntents: {
      retrieve: vi.fn<ReceiptPaymentIntents["retrieve"]>(async () => ({
        latest_charge: { receipt_url: urls.receiptUrl ?? null },
      })),
    },
  };
}

function gateways(
  payment: ReceiptablePayment | null,
  stripe: StripeDoubles = stripeDoubles(),
): PaymentReceiptGateways {
  return {
    payments: { findById: async () => payment },
    stripe: { kind: "configured", ...stripe },
  };
}

describe("findPaymentReceipt", () => {
  it("responde la página de la factura de un pago de membresía cobrado", async () => {
    const stripe = stripeDoubles();

    const outcome = await findPaymentReceipt(
      gateways(MEMBERSHIP_PAYMENT, stripe),
      PAYMENT_ID,
    );

    expect(outcome).toEqual({ kind: "found", url: INVOICE_URL });
    expect(stripe.invoices.retrieve).toHaveBeenCalledWith("in_123");
  });

  it("responde el recibo del último cobro de un pack o un extra pagado", async () => {
    const stripe = stripeDoubles();

    const outcome = await findPaymentReceipt(
      gateways(PACK_PAYMENT, stripe),
      PAYMENT_ID,
    );

    expect(outcome).toEqual({ kind: "found", url: RECEIPT_URL });
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_123", {
      expand: ["latest_charge"],
    });
  });

  it("no encuentra recibo de un pago que la base no le deja leer", async () => {
    const outcome = await findPaymentReceipt(gateways(null), PAYMENT_ID);

    expect(outcome).toEqual({ kind: "refused", reason: "receipt_not_found" });
  });

  it.each(["failed", "pending"] as const)(
    "no encuentra recibo de un pago %s y no pregunta a Stripe",
    async (status) => {
      const stripe = stripeDoubles();

      const outcome = await findPaymentReceipt(
        gateways({ ...MEMBERSHIP_PAYMENT, status }, stripe),
        PAYMENT_ID,
      );

      expect(outcome).toEqual({ kind: "refused", reason: "receipt_not_found" });
      expect(stripe.invoices.retrieve).not.toHaveBeenCalled();
    },
  );

  it("no encuentra recibo cuando la factura no tiene página", async () => {
    const outcome = await findPaymentReceipt(
      gateways(MEMBERSHIP_PAYMENT, stripeDoubles({ invoiceUrl: null })),
      PAYMENT_ID,
    );

    expect(outcome).toEqual({ kind: "refused", reason: "receipt_not_found" });
  });

  it("no encuentra recibo cuando el cobro no tiene URL de recibo", async () => {
    const outcome = await findPaymentReceipt(
      gateways(PACK_PAYMENT, stripeDoubles({ receiptUrl: null })),
      PAYMENT_ID,
    );

    expect(outcome).toEqual({ kind: "refused", reason: "receipt_not_found" });
  });

  it("no encuentra recibo cuando el PaymentIntent todavía no tiene cobro", async () => {
    const stripe = stripeDoubles();
    stripe.paymentIntents.retrieve.mockResolvedValue({ latest_charge: null });

    const outcome = await findPaymentReceipt(
      gateways(PACK_PAYMENT, stripe),
      PAYMENT_ID,
    );

    expect(outcome).toEqual({ kind: "refused", reason: "receipt_not_found" });
  });

  it("deja subir el fallo de Stripe para que la ruta lo responda", async () => {
    const stripe = stripeDoubles();
    const failure = new Stripe.errors.StripeConnectionError({
      message: "timeout",
    });
    stripe.invoices.retrieve.mockRejectedValue(failure);

    await expect(
      findPaymentReceipt(gateways(MEMBERSHIP_PAYMENT, stripe), PAYMENT_ID),
    ).rejects.toBe(failure);
  });

  it("rechaza sin leer el pago cuando Stripe no está configurado", async () => {
    const findById = vi.fn(async () => MEMBERSHIP_PAYMENT);

    const outcome = await findPaymentReceipt(
      { payments: { findById }, stripe: { kind: "unconfigured" } },
      PAYMENT_ID,
    );

    expect(outcome).toEqual({
      kind: "refused",
      reason: "stripe_not_configured",
    });
    expect(findById).not.toHaveBeenCalled();
  });
});
