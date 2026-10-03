// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBERSHIP_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { MembershipRecord } from "@/lib/membership/membership";
import type { PaymentRecord } from "@/lib/membership/membership-view";

/**
 * `GET /api/v1/membership` (#454, #455): la membresía de quien llama y su
 * historial, que pinta Pagos y vuelve a pedir mientras espera el webhook de
 * Stripe. La alcanza cualquier cuenta activa, al día o no. Entra por el proxy
 * de verdad.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const TRIAL_END = "2026-11-01T09:00:00.000Z";
const PERIOD_END = "2026-11-01T09:00:00.000Z";
const PAID_AT = "2026-10-01T09:00:00.000Z";
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
  scheduledChange: null,
};

const readSessionState = vi.fn();
const findByUserId = vi.fn<() => Promise<MembershipRecord | null>>();
const listByUserId = vi.fn<() => Promise<readonly PaymentRecord[]>>();

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

vi.mock("@/lib/membership/supabase-membership-gateways", () => ({
  createMembershipGateway: () => ({ findByUserId }),
  createPaymentHistoryGateway: () => ({ listByUserId }),
}));

const { proxy } = await import("@/proxy");
const { GET, POST } = await import("@/app/api/v1/membership/route");

function configureStripe(): void {
  process.env.STRIPE_SECRET_KEY = "sk_test_clave_de_prueba";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_secreto_de_prueba";
  process.env.STRIPE_PRICE_FULL = "price_full_test";
  process.env.STRIPE_PRICE_STUDENT = "price_student_test";
}

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

async function getMembership(): Promise<Response> {
  const request = new NextRequest(new URL(MEMBERSHIP_API_PATH, ORIGIN));
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? GET(request)
    : boundaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  configureStripe();
  givenSession({ kind: "active", role: "Player", membershipCurrent: false });
  findByUserId.mockResolvedValue(PENDING_FULL);
  listByUserId.mockResolvedValue([]);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/v1/membership", () => {
  it("sirve la membresía pendiente a quien no está al día", async () => {
    const response = await getMembership();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        paymentsConfigured: true,
        membership: {
          plan: "Full",
          status: "pending",
          monthlyPriceCents: 4500,
          trialEnd: null,
          nextChargeAt: null,
          card: null,
          waiver: null,
          scheduledChange: null,
        },
        payments: [],
      },
    });
  });

  it("sirve el fin de la prueba cuando el webhook ya llegó", async () => {
    givenSession({ kind: "active", role: "Player", membershipCurrent: true });
    findByUserId.mockResolvedValue({
      ...PENDING_FULL,
      status: "trialing",
      trialEnd: new Date(TRIAL_END),
    });

    const response = await getMembership();

    await expect(response.json()).resolves.toMatchObject({
      data: { membership: { status: "trialing", trialEnd: TRIAL_END } },
    });
  });

  it("sirve la tarjeta, el próximo cobro y el historial de quien está activo", async () => {
    givenSession({ kind: "active", role: "Player", membershipCurrent: true });
    findByUserId.mockResolvedValue({
      ...PENDING_FULL,
      status: "active",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      currentPeriodEnd: new Date(PERIOD_END),
      card: { brand: "visa", last4: "4242", expMonth: 8, expYear: 2028 },
    });
    listByUserId.mockResolvedValue([
      {
        id: "pay-1",
        amountCents: 4500,
        description: "Monthly membership",
        status: "paid",
        paidAt: new Date(PAID_AT),
        createdAt: new Date(PAID_AT),
      },
    ]);

    const response = await getMembership();

    await expect(response.json()).resolves.toMatchObject({
      data: {
        membership: {
          nextChargeAt: PERIOD_END,
          card: { brand: "visa", last4: "4242", expMonth: 8, expYear: 2028 },
        },
        payments: [
          {
            id: "pay-1",
            date: PAID_AT,
            description: "Monthly membership",
            amountCents: 4500,
            status: "paid",
          },
        ],
      },
    });
  });

  it("sirve una membresía nula a quien no tiene", async () => {
    findByUserId.mockResolvedValue(null);

    const response = await getMembership();

    await expect(response.json()).resolves.toMatchObject({
      data: { membership: null },
    });
  });

  it("dice que los pagos no están configurados cuando falta Stripe", async () => {
    delete process.env.STRIPE_SECRET_KEY;

    const response = await getMembership();

    await expect(response.json()).resolves.toMatchObject({
      data: { paymentsConfigured: false },
    });
  });

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await getMembership();

    expect(response.status).toBe(401);
  });

  it("responde 405 a un POST", async () => {
    const response = await POST(
      new NextRequest(new URL(MEMBERSHIP_API_PATH, ORIGIN), { method: "POST" }),
    );

    expect(response.status).toBe(405);
  });
});
