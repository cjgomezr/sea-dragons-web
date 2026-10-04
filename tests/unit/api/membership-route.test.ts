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

const FULL_PRICE_CENTS = 5150;
const STUDENT_PRICE_CENTS = 3675;
const CASUAL_SESSION_PRICE_CENTS = 1990;

function monthlyStripePrice(id: string, unitAmount: number): object {
  return {
    id,
    unit_amount: unitAmount,
    currency: "aud",
    type: "recurring",
    recurring: { interval: "month", interval_count: 1 },
  };
}

const STRIPE_PRICES: Readonly<Record<string, object>> = {
  price_full_test: monthlyStripePrice("price_full_test", FULL_PRICE_CENTS),
  price_student_test: monthlyStripePrice(
    "price_student_test",
    STUDENT_PRICE_CENTS,
  ),
  price_casual_test: {
    id: "price_casual_test",
    unit_amount: CASUAL_SESSION_PRICE_CENTS,
    currency: "aud",
    type: "one_time",
    recurring: null,
  },
};

const readSessionState = vi.fn();
const retrievePrice = vi.fn<(priceId: string) => Promise<object>>();

vi.mock("stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stripe")>();
  class FakeStripe {
    static errors = actual.default.errors;
    prices = { retrieve: (priceId: string) => retrievePrice(priceId) };
  }
  return { default: FakeStripe };
});
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

const { default: Stripe } = await import("stripe");
const { clearClubPriceCache } = await import("@/lib/stripe/club-prices");
const { proxy } = await import("@/proxy");
const { GET, POST } = await import("@/app/api/v1/membership/route");

function configureStripe(): void {
  process.env.STRIPE_SECRET_KEY = "sk_test_clave_de_prueba";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_secreto_de_prueba";
  process.env.STRIPE_PRICE_FULL = "price_full_test";
  process.env.STRIPE_PRICE_STUDENT = "price_student_test";
  process.env.STRIPE_PRICE_CASUAL_SESSION = "price_casual_test";
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
  clearClubPriceCache();
  process.env = { ...ORIGINAL_ENV };
  configureStripe();
  givenSession({ kind: "active", role: "Player", membershipCurrent: false });
  findByUserId.mockResolvedValue(PENDING_FULL);
  listByUserId.mockResolvedValue([]);
  retrievePrice.mockImplementation(async (priceId) => {
    const price = STRIPE_PRICES[priceId];
    if (price === undefined) {
      throw new Error(`precio inesperado ${priceId}`);
    }
    return price;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
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
          monthlyPriceCents: FULL_PRICE_CENTS,
          trialEnd: null,
          nextChargeAt: null,
          card: null,
          waiver: null,
          scheduledChange: null,
          canChangePlan: false,
          planPrices: { Full: FULL_PRICE_CENTS, Student: STUDENT_PRICE_CENTS },
          canChoosePlan: true,
          casualSessionPriceCents: CASUAL_SESSION_PRICE_CENTS,
          subscriptionEndsAt: null,
        },
        payments: [],
      },
    });
  });

  it("sirve el precio mensual del plan Student leído de Stripe", async () => {
    findByUserId.mockResolvedValue({ ...PENDING_FULL, plan: "Student" });

    const response = await getMembership();

    await expect(response.json()).resolves.toMatchObject({
      data: { membership: { monthlyPriceCents: STUDENT_PRICE_CENTS } },
    });
    expect(retrievePrice).toHaveBeenCalledWith("price_student_test");
  });

  it("sirve un precio nulo, y el resto de la membresía, cuando Stripe no contesta", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    retrievePrice.mockRejectedValue(
      new Stripe.errors.StripeConnectionError({ message: "socket hang up" }),
    );

    const response = await getMembership();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { membership: { plan: "Full", monthlyPriceCents: null } },
    });
  });

  // Un Casual no tiene cuota mensual (#486), y si además no puede cambiar de
  // plan (exento), nada en su Pagos enseña un precio: no se pregunta.
  it("no pide precio a Stripe para un Casual exento, que no enseña ninguno", async () => {
    findByUserId.mockResolvedValue({
      ...PENDING_FULL,
      plan: "Casual",
      status: "waived",
      waiver: { reason: "Entrenador", until: null, waivedBy: null },
    });

    const response = await getMembership();

    await expect(response.json()).resolves.toMatchObject({
      data: {
        membership: {
          plan: "Casual",
          monthlyPriceCents: null,
          planPrices: { Full: null, Student: null },
        },
      },
    });
    expect(retrievePrice).not.toHaveBeenCalled();
  });

  // El selector del cambio de plan (#456) le ofrece Full y Student con su
  // precio, que sale de Stripe como el resto.
  it("sirve a un Casual los precios de Stripe para pasar a Full o Student", async () => {
    findByUserId.mockResolvedValue({ ...PENDING_FULL, plan: "Casual" });

    const response = await getMembership();

    await expect(response.json()).resolves.toMatchObject({
      data: {
        membership: {
          plan: "Casual",
          monthlyPriceCents: null,
          canChangePlan: true,
          planPrices: { Full: FULL_PRICE_CENTS, Student: STUDENT_PRICE_CENTS },
        },
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
