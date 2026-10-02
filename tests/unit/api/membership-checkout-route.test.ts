// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBERSHIP_CHECKOUT_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { MembershipRecord } from "@/lib/membership/membership";

/**
 * `POST /api/v1/membership/checkout` (#454, RF-3 del PRD de E12). La
 * petición entra por el proxy de verdad: la ruta es justo el camino para
 * ponerse al día, así que la frontera la deja pasar a quien no lo está. Lo
 * único doble es la base y la llamada a Stripe.
 */

const ORIGIN = "https://preview.seadragons.example";
const CONTINUE_HEADER = "x-middleware-next";
const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_123";
const ORIGINAL_ENV = { ...process.env };

const PENDING_FULL: MembershipRecord = {
  userId: USER_ID,
  clubId: CLUB_ID,
  plan: "Full",
  status: "pending",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  currentPeriodEnd: null,
  trialEnd: null,
  card: null,
  waiver: null,
};

const readSessionState = vi.fn();
const findByUserId = vi.fn<() => Promise<MembershipRecord | null>>();
const createSession = vi.fn();

vi.mock("stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stripe")>();
  class FakeStripe {
    static errors = actual.default.errors;
    checkout = {
      sessions: {
        create: (...args: unknown[]) => createSession(...args),
      },
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
  createMemberEmailGateway: () => ({
    findEmail: async () => "alba@example.com",
  }),
}));

const { default: Stripe } = await import("stripe");
const { proxy } = await import("@/proxy");
const { GET, POST } = await import("@/app/api/v1/membership/checkout/route");

function configureStripe(): void {
  process.env.STRIPE_SECRET_KEY = "sk_test_clave_de_prueba";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_secreto_de_prueba";
  process.env.STRIPE_PRICE_FULL = "price_full_test";
  process.env.STRIPE_PRICE_STUDENT = "price_student_test";
}

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

function checkoutRequest(): NextRequest {
  return new NextRequest(new URL(MEMBERSHIP_CHECKOUT_API_PATH, ORIGIN), {
    method: "POST",
  });
}

async function postCheckout(): Promise<Response> {
  const boundaryResponse = await proxy(checkoutRequest());
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? POST(checkoutRequest())
    : boundaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  configureStripe();
  givenSession({ kind: "active", role: "Player", membershipCurrent: false });
  findByUserId.mockResolvedValue(PENDING_FULL);
  createSession.mockResolvedValue({ url: CHECKOUT_URL });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/v1/membership/checkout", () => {
  it("deja pasar a quien no está al día y responde la dirección de Checkout", async () => {
    const response = await postCheckout();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { url: CHECKOUT_URL },
    });
  });

  it("pide la sesión con el socio en los metadatos de la suscripción y la vuelta al origen de la petición", async () => {
    await postCheckout();

    expect(createSession).toHaveBeenCalledTimes(1);
    const [params] = createSession.mock.calls[0] ?? [];
    expect(params).toMatchObject({
      client_reference_id: USER_ID,
      subscription_data: { metadata: { user_id: USER_ID } },
      success_url: `${ORIGIN}/pagos?checkout=ok`,
      cancel_url: `${ORIGIN}/pagos?checkout=cancelado`,
    });
  });

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await postCheckout();

    expect(response.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("responde 409 con su motivo a quien ya está al día", async () => {
    givenSession({ kind: "active", role: "Player", membershipCurrent: true });
    findByUserId.mockResolvedValue({ ...PENDING_FULL, status: "active" });

    const response = await postCheckout();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "conflict", reason: "membership_current" },
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("responde 409 a un Casual: no hay Checkout para Casual en E12", async () => {
    findByUserId.mockResolvedValue({ ...PENDING_FULL, plan: "Casual" });

    const response = await postCheckout();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "casual_plan" },
    });
  });

  it("responde 503 con su motivo, sin nombrarla, cuando falta una variable de Stripe", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    delete process.env.STRIPE_PRICE_STUDENT;

    const response = await postCheckout();

    expect(response.status).toBe(503);
    const rawBody = await response.text();
    expect(JSON.parse(rawBody)).toMatchObject({
      error: { code: "service_unavailable", reason: "stripe_not_configured" },
    });
    expect(rawBody).not.toContain("STRIPE_PRICE_STUDENT");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("responde 503 con su motivo cuando Stripe no contesta", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createSession.mockRejectedValue(
      new Stripe.errors.StripeConnectionError({ message: "timeout" }),
    );

    const response = await postCheckout();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "service_unavailable", reason: "stripe_unavailable" },
    });
  });

  it("responde 405 a un GET", async () => {
    const response = await GET(
      new NextRequest(new URL(MEMBERSHIP_CHECKOUT_API_PATH, ORIGIN)),
    );

    expect(response.status).toBe(405);
  });
});
