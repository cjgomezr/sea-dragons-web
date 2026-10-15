// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBERSHIP_PAYMENT_RECEIPT_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { ReceiptablePayment } from "@/lib/membership/payment-receipt";

/**
 * `GET /api/v1/membership/payments/{paymentId}/receipt` (#630, RF-4 y D6 del
 * PRD de E23): el recibo de Stripe de un pago cobrado. Entra por el proxy de
 * verdad: un socio que no está al día también tiene recibos que pedir. Lo
 * único doble es la base y Stripe.
 */

const ORIGIN = "https://preview.seadragons.example";
const CONTINUE_HEADER = "x-middleware-next";
const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const PAYMENT_ID = "0f3a2b1c-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const INVOICE_URL = "https://invoice.stripe.com/i/acct_1/test_inv_paid";
const RECEIPT_URL = "https://pay.stripe.com/receipts/payment/test_receipt";
const STRIPE_SECRET_MESSAGE = "No such invoice: 'in_123'; sk_test_clave";
const ORIGINAL_ENV = { ...process.env };

const PAID_INVOICE: ReceiptablePayment = {
  status: "paid",
  source: { kind: "invoice", invoiceId: "in_123" },
};

const readSessionState = vi.fn();
const findById = vi.fn<() => Promise<ReceiptablePayment | null>>();
const retrieveInvoice = vi.fn();
const retrievePaymentIntent = vi.fn();
const createPaymentReceiptGateway = vi.fn((client: unknown) => {
  void client;
  return { findById };
});
const SESSION_CLIENT = { name: "cliente de la sesión" };

vi.mock("stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stripe")>();
  class FakeStripe {
    static errors = actual.default.errors;
    invoices = {
      retrieve: (...args: unknown[]) => retrieveInvoice(...args),
    };
    paymentIntents = {
      retrieve: (...args: unknown[]) => retrievePaymentIntent(...args),
    };
  }
  return { default: FakeStripe };
});

vi.mock("@/lib/supabase/session-client", () => ({
  readIncomingCookies: () => [],
  applySessionCookies: () => undefined,
  createSessionClient: () => ({
    kind: "ready",
    client: SESSION_CLIENT,
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  }),
}));

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
  readAuthenticatedUserId: async () => USER_ID,
}));

vi.mock("@/lib/membership/supabase-membership-gateways", () => ({
  createPaymentReceiptGateway: (client: unknown) =>
    createPaymentReceiptGateway(client),
}));

const { default: Stripe } = await import("stripe");
const { proxy } = await import("@/proxy");
const { GET, POST } =
  await import("@/app/api/v1/membership/payments/[paymentId]/receipt/route");

function configureStripe(): void {
  process.env.STRIPE_SECRET_KEY = "sk_test_clave_de_prueba";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_secreto_de_prueba";
  process.env.STRIPE_PRICE_FULL = "price_full_test";
  process.env.STRIPE_PRICE_STUDENT = "price_student_test";
}

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

function receiptPath(paymentId: string): string {
  return MEMBERSHIP_PAYMENT_RECEIPT_API_PATH.replace("[paymentId]", paymentId);
}

function receiptRequest(paymentId: string): NextRequest {
  return new NextRequest(new URL(receiptPath(paymentId), ORIGIN));
}

async function getReceipt(paymentId = PAYMENT_ID): Promise<Response> {
  const boundaryResponse = await proxy(receiptRequest(paymentId));
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? GET(receiptRequest(paymentId), {
        params: Promise.resolve({ paymentId }),
      })
    : boundaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  configureStripe();
  givenSession({ kind: "active", role: "Player", membershipCurrent: false });
  findById.mockResolvedValue(PAID_INVOICE);
  retrieveInvoice.mockResolvedValue({ hosted_invoice_url: INVOICE_URL });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/v1/membership/payments/{paymentId}/receipt", () => {
  it("deja pasar a quien no está al día y responde la URL del recibo", async () => {
    const response = await getReceipt();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { url: INVOICE_URL },
    });
  });

  it("responde el recibo del cobro de un pack o un extra", async () => {
    findById.mockResolvedValue({
      status: "paid",
      source: { kind: "payment_intent", paymentIntentId: "pi_123" },
    });
    retrievePaymentIntent.mockResolvedValue({
      latest_charge: { receipt_url: RECEIPT_URL },
    });

    const response = await getReceipt();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { url: RECEIPT_URL },
    });
  });

  it("lee el pago con el cliente de la sesión, para que decida la RLS", async () => {
    await getReceipt();

    expect(createPaymentReceiptGateway).toHaveBeenCalledWith(SESSION_CLIENT);
    expect(findById).toHaveBeenCalledWith(PAYMENT_ID);
  });

  it("responde 400 sin leer la base cuando el id no es un UUID", async () => {
    const response = await getReceipt("no-es-un-uuid");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error" },
    });
    expect(findById).not.toHaveBeenCalled();
  });

  it("responde 404 cuando la base no devuelve el pago (no existe o es de otro socio)", async () => {
    givenSession({ kind: "active", role: "Admin", membershipCurrent: true });
    findById.mockResolvedValue(null);

    const response = await getReceipt();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found", reason: "receipt_not_found" },
    });
  });

  it("responde 404 a un pago fallido", async () => {
    findById.mockResolvedValue({ ...PAID_INVOICE, status: "failed" });

    const response = await getReceipt();

    expect(response.status).toBe(404);
  });

  it("responde 404 cuando Stripe no devuelve URL", async () => {
    retrieveInvoice.mockResolvedValue({ hosted_invoice_url: null });

    const response = await getReceipt();

    expect(response.status).toBe(404);
  });

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await getReceipt();

    expect(response.status).toBe(401);
    expect(findById).not.toHaveBeenCalled();
  });

  it("responde 502 sin filtrar el mensaje de Stripe cuando Stripe falla", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    retrieveInvoice.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: STRIPE_SECRET_MESSAGE,
      }),
    );

    const response = await getReceipt();

    expect(response.status).toBe(502);
    const rawBody = await response.text();
    expect(JSON.parse(rawBody)).toMatchObject({
      error: { code: "bad_gateway", reason: "stripe_failed" },
    });
    expect(rawBody).not.toContain("in_123");
    expect(rawBody).not.toContain("sk_test");
  });

  it("responde 503 con el motivo de los otros endpoints de membresía cuando falta Stripe", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    delete process.env.STRIPE_SECRET_KEY;

    const response = await getReceipt();

    expect(response.status).toBe(503);
    const rawBody = await response.text();
    expect(JSON.parse(rawBody)).toMatchObject({
      error: { code: "service_unavailable", reason: "stripe_not_configured" },
    });
    expect(rawBody).not.toContain("STRIPE_SECRET_KEY");
  });

  it("responde 405 a un POST", async () => {
    const response = await POST(receiptRequest(PAYMENT_ID));

    expect(response.status).toBe(405);
  });
});
