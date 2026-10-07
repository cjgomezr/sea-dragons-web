// @vitest-environment node
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import type { MembershipRecord } from "@/lib/membership/membership";
import {
  type OpenInvoices,
  type PaymentRetryGateways,
  startPaymentRetry,
} from "@/lib/membership/retry-payment";

/**
 * Reintentar un cobro fallido (#474, RF-7 del PRD de E13, D5): la factura
 * abierta de la suscripción del socio, en la página que aloja Stripe. La
 * tarjeta nunca pasa por la aplicación.
 */

const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const NOW = new Date("2026-10-07T09:00:00.000Z");
const INVOICE_URL = "https://invoice.stripe.com/i/acct_1/test_inv_open";

function pastDueMembership(
  change: Partial<MembershipRecord> = {},
): MembershipRecord {
  return {
    userId: USER_ID,
    clubId: "c1",
    plan: "Full",
    status: "past_due",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    currentPeriodEnd: null,
    trialEnd: null,
    card: null,
    waiver: null,
    scheduledChange: null,
    ...change,
  };
}

type InvoicesDouble = OpenInvoices & {
  readonly list: ReturnType<typeof vi.fn<OpenInvoices["list"]>>;
};

function invoicesDouble(
  invoices: ReadonlyArray<{ readonly hosted_invoice_url?: string | null }>,
): InvoicesDouble {
  return {
    list: vi.fn<OpenInvoices["list"]>(async () => ({ data: invoices })),
  };
}

function gateways(
  record: MembershipRecord | null,
  invoices: OpenInvoices = invoicesDouble([
    { hosted_invoice_url: INVOICE_URL },
  ]),
): PaymentRetryGateways {
  return {
    membership: { findByUserId: async () => record },
    stripe: { kind: "configured", invoices },
  };
}

function start(
  target: PaymentRetryGateways,
): ReturnType<typeof startPaymentRetry> {
  return startPaymentRetry(target, { userId: USER_ID, now: NOW });
}

describe("startPaymentRetry", () => {
  it("responde la página de Stripe de la factura abierta de su suscripción", async () => {
    const invoices = invoicesDouble([{ hosted_invoice_url: INVOICE_URL }]);

    const outcome = await start(gateways(pastDueMembership(), invoices));

    expect(outcome).toEqual({ kind: "found", url: INVOICE_URL });
    expect(invoices.list).toHaveBeenCalledWith(
      expect.objectContaining({ subscription: "sub_123", status: "open" }),
    );
  });

  it("rechaza con no_open_invoice cuando la suscripción no tiene factura abierta", async () => {
    const outcome = await start(
      gateways(pastDueMembership(), invoicesDouble([])),
    );

    expect(outcome).toEqual({ kind: "refused", reason: "no_open_invoice" });
  });

  it("rechaza sin preguntar a Stripe a quien no tiene suscripción", async () => {
    const invoices = invoicesDouble([]);

    const outcome = await start(
      gateways(pastDueMembership({ stripeSubscriptionId: null }), invoices),
    );

    expect(outcome).toEqual({ kind: "refused", reason: "no_open_invoice" });
    expect(invoices.list).not.toHaveBeenCalled();
  });

  it("rechaza a quien no tiene membresía", async () => {
    const outcome = await start(gateways(null));

    expect(outcome).toEqual({ kind: "refused", reason: "no_open_invoice" });
  });

  it("rechaza sin Stripe configurado", async () => {
    const outcome = await startPaymentRetry(
      {
        membership: { findByUserId: async () => pastDueMembership() },
        stripe: { kind: "unconfigured" },
      },
      { userId: USER_ID, now: NOW },
    );

    expect(outcome).toEqual({
      kind: "refused",
      reason: "stripe_not_configured",
    });
  });

  it("deja subir el fallo de Stripe para que la ruta lo responda", async () => {
    const failure = new Stripe.errors.StripeConnectionError({
      message: "timeout",
    });
    const invoices: OpenInvoices = {
      list: vi.fn<OpenInvoices["list"]>(async () => {
        throw failure;
      }),
    };

    await expect(start(gateways(pastDueMembership(), invoices))).rejects.toBe(
      failure,
    );
  });

  it("falla con contexto si la factura abierta no tiene página en Stripe", async () => {
    await expect(
      start(
        gateways(
          pastDueMembership(),
          invoicesDouble([{ hosted_invoice_url: null }]),
        ),
      ),
    ).rejects.toThrow(/sin página/);
  });
});
