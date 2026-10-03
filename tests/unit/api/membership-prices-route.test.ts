// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBERSHIP_PRICES_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";

/**
 * `GET /api/v1/membership/prices` (#486, RF-5 del PRD de E12): los precios
 * del club leídos de Stripe, para las pantallas que los enseñan. Lo alcanza
 * cualquier cuenta activa, también quien no está al día, porque es lo que
 * mira antes de pagar. Entra por el proxy de verdad; Stripe va doblado.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const ORIGINAL_ENV = { ...process.env };

function stripePrice(
  id: string,
  unitAmount: number,
  type: "recurring" | "one_time",
): object {
  return {
    id,
    unit_amount: unitAmount,
    currency: "aud",
    type,
    recurring:
      type === "recurring" ? { interval: "month", interval_count: 1 } : null,
  };
}

const STRIPE_PRICES: Readonly<Record<string, object>> = {
  price_full_test: stripePrice("price_full_test", 5150, "recurring"),
  price_student_test: stripePrice("price_student_test", 3675, "recurring"),
  price_casual_test: stripePrice("price_casual_test", 1990, "one_time"),
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

const { default: Stripe } = await import("stripe");
const { clearClubPriceCache } = await import("@/lib/stripe/club-prices");
const { proxy } = await import("@/proxy");
const { GET, POST } = await import("@/app/api/v1/membership/prices/route");

function configureStripe(): void {
  process.env.STRIPE_SECRET_KEY = "sk_test_clave_de_prueba";
  process.env.STRIPE_PRICE_FULL = "price_full_test";
  process.env.STRIPE_PRICE_STUDENT = "price_student_test";
  process.env.STRIPE_PRICE_CASUAL_SESSION = "price_casual_test";
}

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

function pricesRequest(): NextRequest {
  return new NextRequest(new URL(MEMBERSHIP_PRICES_API_PATH, ORIGIN));
}

async function getPrices(): Promise<Response> {
  const boundaryResponse = await proxy(pricesRequest());
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? GET(pricesRequest())
    : boundaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearClubPriceCache();
  process.env = { ...ORIGINAL_ENV };
  configureStripe();
  givenSession({ kind: "active", role: "Player", membershipCurrent: true });
  retrievePrice.mockImplementation(async (priceId) => {
    const price = STRIPE_PRICES[priceId];
    if (price === undefined) {
      throw new Error(`precio inesperado ${priceId}`);
    }
    return price;
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/v1/membership/prices", () => {
  it("sirve los tres precios de Stripe en centavos y con su moneda", async () => {
    const response = await getPrices();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        full: { amountCents: 5150, currency: "AUD" },
        student: { amountCents: 3675, currency: "AUD" },
        casualSession: { amountCents: 1990, currency: "AUD" },
      },
    });
  });

  it("los sirve también a quien no está al día", async () => {
    givenSession({ kind: "active", role: "Player", membershipCurrent: false });

    const response = await getPrices();

    expect(response.status).toBe(200);
  });

  it("no vuelve a llamar a Stripe en la siguiente petición", async () => {
    await getPrices();

    await getPrices();

    expect(retrievePrice).toHaveBeenCalledTimes(3);
  });

  it("sirve nulo con su motivo el precio que Stripe no da, y los demás", async () => {
    retrievePrice.mockImplementation(async (priceId) => {
      if (priceId === "price_student_test") {
        throw new Stripe.errors.StripeConnectionError({
          message: "socket hang up",
        });
      }
      return STRIPE_PRICES[priceId] ?? {};
    });

    const response = await getPrices();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        full: { amountCents: 5150, currency: "AUD" },
        student: { amountCents: null, reason: "stripe_unavailable" },
        casualSession: { amountCents: 1990, currency: "AUD" },
      },
    });
  });

  it("sirve not_configured para la variable que falta", async () => {
    delete process.env.STRIPE_PRICE_CASUAL_SESSION;

    const response = await getPrices();

    await expect(response.json()).resolves.toMatchObject({
      data: { casualSession: { amountCents: null, reason: "not_configured" } },
    });
  });

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await getPrices();

    expect(response.status).toBe(401);
    expect(retrievePrice).not.toHaveBeenCalled();
  });

  it("responde 405 a un POST", async () => {
    const response = await POST(
      new NextRequest(new URL(MEMBERSHIP_PRICES_API_PATH, ORIGIN), {
        method: "POST",
      }),
    );

    expect(response.status).toBe(405);
  });
});
