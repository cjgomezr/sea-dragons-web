// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBERSHIP_RETRY_PAYMENT_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { MembershipRecord } from "@/lib/membership/membership";

/**
 * `POST /api/v1/membership/retry-payment` (#474, RF-7 del PRD de E13, D5):
 * la página de Stripe de la factura abierta. Entra por el proxy de verdad:
 * quien tiene un cobro fallido no está al día y tiene que alcanzarla. Lo
 * único doble es la base y la llamada a Stripe.
 */

const ORIGIN = "https://preview.seadragons.example";
const CONTINUE_HEADER = "x-middleware-next";
const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const INVOICE_URL = "https://invoice.stripe.com/i/acct_1/test_inv_open";
const ORIGINAL_ENV = { ...process.env };

const PAST_DUE_FULL: MembershipRecord = {
  userId: USER_ID,
  clubId: CLUB_ID,
  plan: "Full",
  status: "past_due",
  stripeCustomerId: "cus_123",
  stripeSubscriptionId: "sub_123",
  currentPeriodEnd: null,
  trialEnd: null,
  card: null,
  waiver: null,
  scheduledChange: null,
};

const readSessionState = vi.fn();
const findByUserId = vi.fn<() => Promise<MembershipRecord | null>>();
const listInvoices = vi.fn();

vi.mock("stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stripe")>();
  class FakeStripe {
    static errors = actual.default.errors;
    invoices = {
      list: (...args: unknown[]) => listInvoices(...args),
    };
  }
  return { default: FakeStripe };
});

vi.mock("@/lib/supabase/session-client", () => ({
  readIncomingCookies: () => [],
  applySessionCookies: () => undefined,
  createSessionClient: () => ({
    kind: "ready",
    client: {},
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  }),
}));

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
  readAuthenticatedUserId: async () => USER_ID,
}));

vi.mock("@/lib/supabase/service-client", () => ({
  createServiceRoleClient: () => ({}),
}));

vi.mock("@/lib/membership/supabase-membership-gateways", () => ({
  createMembershipGateway: () => ({ findByUserId }),
}));

const { default: Stripe } = await import("stripe");
const { proxy } = await import("@/proxy");
const { GET, POST } =
  await import("@/app/api/v1/membership/retry-payment/route");

function configureStripe(): void {
  process.env.STRIPE_SECRET_KEY = "sk_test_clave_de_prueba";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_secreto_de_prueba";
  process.env.STRIPE_PRICE_FULL = "price_full_test";
  process.env.STRIPE_PRICE_STUDENT = "price_student_test";
}

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

function retryRequest(): NextRequest {
  return new NextRequest(new URL(MEMBERSHIP_RETRY_PAYMENT_API_PATH, ORIGIN), {
    method: "POST",
  });
}

async function postRetry(): Promise<Response> {
  const boundaryResponse = await proxy(retryRequest());
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? POST(retryRequest())
    : boundaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  configureStripe();
  givenSession({ kind: "active", role: "Player", membershipCurrent: false });
  findByUserId.mockResolvedValue(PAST_DUE_FULL);
  listInvoices.mockResolvedValue({
    data: [{ hosted_invoice_url: INVOICE_URL }],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/v1/membership/retry-payment", () => {
  it("deja pasar a quien no está al día y responde la página de la factura abierta", async () => {
    const response = await postRetry();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { url: INVOICE_URL },
    });
  });

  it("busca la factura abierta de su suscripción", async () => {
    await postRetry();

    expect(listInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ subscription: "sub_123", status: "open" }),
    );
  });

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await postRetry();

    expect(response.status).toBe(401);
    expect(listInvoices).not.toHaveBeenCalled();
  });

  it("responde 409 con su motivo cuando no hay factura abierta", async () => {
    listInvoices.mockResolvedValue({ data: [] });

    const response = await postRetry();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "conflict", reason: "no_open_invoice" },
    });
  });

  it("responde 502 con su motivo cuando Stripe falla", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    listInvoices.mockRejectedValue(
      new Stripe.errors.StripeConnectionError({ message: "timeout" }),
    );

    const response = await postRetry();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "bad_gateway", reason: "stripe_failed" },
    });
  });

  it("responde 503 con su motivo, sin nombrarla, cuando falta una variable de Stripe", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    delete process.env.STRIPE_SECRET_KEY;

    const response = await postRetry();

    expect(response.status).toBe(503);
    const rawBody = await response.text();
    expect(JSON.parse(rawBody)).toMatchObject({
      error: { code: "service_unavailable", reason: "stripe_not_configured" },
    });
    expect(rawBody).not.toContain("STRIPE_SECRET_KEY");
    expect(listInvoices).not.toHaveBeenCalled();
  });

  it("responde 405 a un GET", async () => {
    const response = await GET(
      new NextRequest(new URL(MEMBERSHIP_RETRY_PAYMENT_API_PATH, ORIGIN)),
    );

    expect(response.status).toBe(405);
  });
});
