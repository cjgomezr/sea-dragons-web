// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBERSHIP_CARD_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { MembershipRecord } from "@/lib/membership/membership";

/**
 * `POST /api/v1/membership/card` (#455, RF-5 del PRD de E12, D6): Checkout
 * en modo `setup` para cambiar la tarjeta. Entra por el proxy de verdad: quien
 * tiene un cobro fallido no está al día y tiene que alcanzarla. Lo único
 * doble es la base y la llamada a Stripe.
 */

const ORIGIN = "https://preview.seadragons.example";
const CONTINUE_HEADER = "x-middleware-next";
const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const SETUP_URL = "https://checkout.stripe.com/c/pay/cs_test_setup";
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
}));

const { default: Stripe } = await import("stripe");
const { proxy } = await import("@/proxy");
const { GET, POST } = await import("@/app/api/v1/membership/card/route");

function configureStripe(): void {
  process.env.STRIPE_SECRET_KEY = "sk_test_clave_de_prueba";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_secreto_de_prueba";
  process.env.STRIPE_PRICE_FULL = "price_full_test";
  process.env.STRIPE_PRICE_STUDENT = "price_student_test";
}

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

function cardRequest(): NextRequest {
  return new NextRequest(new URL(MEMBERSHIP_CARD_API_PATH, ORIGIN), {
    method: "POST",
  });
}

async function postCard(): Promise<Response> {
  const boundaryResponse = await proxy(cardRequest());
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? POST(cardRequest())
    : boundaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  configureStripe();
  givenSession({ kind: "active", role: "Player", membershipCurrent: false });
  findByUserId.mockResolvedValue(PAST_DUE_FULL);
  createSession.mockResolvedValue({ url: SETUP_URL });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/v1/membership/card", () => {
  it("deja pasar a quien tiene un cobro fallido y responde la dirección de Stripe", async () => {
    const response = await postCard();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { url: SETUP_URL },
    });
  });

  it("pide la sesión en modo setup para su cliente, con la vuelta al origen de la petición", async () => {
    await postCard();

    expect(createSession).toHaveBeenCalledTimes(1);
    const [params] = createSession.mock.calls[0] ?? [];
    expect(params).toMatchObject({
      mode: "setup",
      customer: "cus_123",
      success_url: `${ORIGIN}/pagos?tarjeta=ok`,
      cancel_url: `${ORIGIN}/pagos?tarjeta=cancelado`,
    });
  });

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await postCard();

    expect(response.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("responde 409 con su motivo a quien no tiene cliente en Stripe", async () => {
    findByUserId.mockResolvedValue({
      ...PAST_DUE_FULL,
      status: "pending",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });

    const response = await postCard();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "conflict", reason: "no_stripe_customer" },
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("responde 503 con su motivo, sin nombrarla, cuando falta una variable de Stripe", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    delete process.env.STRIPE_SECRET_KEY;

    const response = await postCard();

    expect(response.status).toBe(503);
    const rawBody = await response.text();
    expect(JSON.parse(rawBody)).toMatchObject({
      error: { code: "service_unavailable", reason: "stripe_not_configured" },
    });
    expect(rawBody).not.toContain("STRIPE_SECRET_KEY");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("responde 503 con su motivo cuando Stripe no contesta", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createSession.mockRejectedValue(
      new Stripe.errors.StripeConnectionError({ message: "timeout" }),
    );

    const response = await postCard();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "service_unavailable", reason: "stripe_unavailable" },
    });
  });

  it("responde 405 a un GET", async () => {
    const response = await GET(
      new NextRequest(new URL(MEMBERSHIP_CARD_API_PATH, ORIGIN)),
    );

    expect(response.status).toBe(405);
  });
});
