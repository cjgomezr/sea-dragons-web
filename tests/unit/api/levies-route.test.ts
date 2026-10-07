// @vitest-environment node
import { NextRequest } from "next/server";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEVIES_API_PATH, LEVY_CHECKOUT_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { MembershipRecord } from "@/lib/membership/membership";

/**
 * `GET /api/v1/levies` y `POST /api/v1/levies/{priceId}/checkout` (#473,
 * RF-6 del PRD de E13, D4 y D8). Las peticiones entran por el proxy de
 * verdad: un socio que no está al día también ve y paga los levies. Lo único
 * doble es la base y Stripe.
 */

const ORIGIN = "https://preview.seadragons.example";
const CONTINUE_HEADER = "x-middleware-next";
const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_levy";
const LEVY_PRODUCT = "prod_nationals";
const LEVY_PRICE = "price_nationals";
const ORIGINAL_ENV = { ...process.env };

const PAST_DUE_FULL: MembershipRecord = {
  userId: USER_ID,
  clubId: CLUB_ID,
  plan: "Full",
  status: "past_due",
  stripeCustomerId: "cus_Alba",
  stripeSubscriptionId: "sub_Alba",
  currentPeriodEnd: null,
  trialEnd: null,
  card: null,
  waiver: null,
  scheduledChange: null,
};

const STRIPE_PRODUCTS = [
  {
    id: LEVY_PRODUCT,
    object: "product",
    name: "Nationals 2026",
    description: "Entry for the national championship",
    active: true,
    metadata: { seadragons_kind: "levy" },
    default_price: {
      id: LEVY_PRICE,
      object: "price",
      active: true,
      type: "one_time",
      currency: "aud",
      unit_amount: 8000,
    },
  },
  {
    id: "prod_full",
    object: "product",
    name: "Full membership",
    description: null,
    active: true,
    metadata: {},
    default_price: {
      id: "price_full_test",
      object: "price",
      active: true,
      type: "recurring",
      currency: "aud",
      unit_amount: 6000,
    },
  },
] as unknown as readonly Stripe.Product[];

const readSessionState = vi.fn();
const listProducts = vi.fn();
const createSession = vi.fn();
const findPaidProductIds = vi.fn<() => Promise<ReadonlySet<string>>>();

vi.mock("stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stripe")>();
  class FakeStripe {
    static errors = actual.default.errors;
    products = {
      list: (...args: unknown[]) => ({
        autoPagingToArray: () => listProducts(...args),
      }),
    };
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
  createMembershipGateway: () => ({ findByUserId: async () => PAST_DUE_FULL }),
  createMemberEmailGateway: () => ({
    findEmail: async () => "alba@example.com",
  }),
  createPaidProductsGateway: () => ({ findPaidProductIds }),
}));

const { default: StripeSdk } = await import("stripe");
const { proxy } = await import("@/proxy");
const leviesRoute = await import("@/app/api/v1/levies/route");
const checkoutRoute =
  await import("@/app/api/v1/levies/[priceId]/checkout/route");

function configureStripe(): void {
  process.env.STRIPE_SECRET_KEY = "sk_test_clave_de_prueba";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_secreto_de_prueba";
  process.env.STRIPE_PRICE_FULL = "price_full_test";
  process.env.STRIPE_PRICE_STUDENT = "price_student_test";
}

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

function checkoutPath(priceId: string): string {
  return LEVY_CHECKOUT_API_PATH.replace("[priceId]", priceId);
}

async function throughProxy(
  makeRequest: () => NextRequest,
  handle: (request: NextRequest) => Promise<Response>,
): Promise<Response> {
  const boundaryResponse = await proxy(makeRequest());
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? handle(makeRequest())
    : boundaryResponse;
}

function getLevies(): Promise<Response> {
  return throughProxy(
    () => new NextRequest(new URL(LEVIES_API_PATH, ORIGIN)),
    (request) => leviesRoute.GET(request),
  );
}

function postCheckout(priceId = LEVY_PRICE): Promise<Response> {
  return throughProxy(
    () =>
      new NextRequest(new URL(checkoutPath(priceId), ORIGIN), {
        method: "POST",
      }),
    (request) =>
      checkoutRoute.POST(request, { params: Promise.resolve({ priceId }) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  configureStripe();
  givenSession({ kind: "active", role: "Player", membershipCurrent: false });
  listProducts.mockResolvedValue(STRIPE_PRODUCTS);
  findPaidProductIds.mockResolvedValue(new Set());
  createSession.mockResolvedValue({ url: CHECKOUT_URL });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/v1/levies", () => {
  it("deja pasar a un socio que no está al día y le lista los levies", async () => {
    const response = await getLevies();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        levies: [
          {
            id: LEVY_PRICE,
            name: "Nationals 2026",
            description: "Entry for the national championship",
            amountCents: 8000,
            isPaid: false,
          },
        ],
      },
    });
  });

  it("pide a Stripe sólo los productos activos, con su precio expandido", async () => {
    await getLevies();

    expect(listProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        active: true,
        expand: ["data.default_price"],
      }),
    );
  });

  it("marca como pagado el levy que el socio ya pagó", async () => {
    findPaidProductIds.mockResolvedValue(new Set([LEVY_PRODUCT]));

    const response = await getLevies();

    await expect(response.json()).resolves.toMatchObject({
      data: { levies: [{ isPaid: true }] },
    });
  });

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await getLevies();

    expect(response.status).toBe(401);
    expect(listProducts).not.toHaveBeenCalled();
  });

  it("responde 503 con su motivo, sin nombrarla, cuando falta la configuración de Stripe", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    delete process.env.STRIPE_SECRET_KEY;

    const response = await getLevies();

    expect(response.status).toBe(503);
    const rawBody = await response.text();
    expect(JSON.parse(rawBody)).toMatchObject({
      error: { code: "service_unavailable", reason: "stripe_not_configured" },
    });
    expect(rawBody).not.toContain("STRIPE_SECRET_KEY");
  });

  it("responde 503 con su motivo cuando Stripe no contesta", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    listProducts.mockRejectedValue(
      new StripeSdk.errors.StripeConnectionError({ message: "timeout" }),
    );

    const response = await getLevies();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "stripe_unavailable" },
    });
  });

  it("responde 405 a un POST", async () => {
    const response = await leviesRoute.POST(
      new NextRequest(new URL(LEVIES_API_PATH, ORIGIN), { method: "POST" }),
    );

    expect(response.status).toBe(405);
  });
});

describe("POST /api/v1/levies/{priceId}/checkout", () => {
  it("deja pasar a un socio que no está al día y responde la dirección de Checkout", async () => {
    const response = await postCheckout();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { url: CHECKOUT_URL },
    });
  });

  it("pide un pago de una unidad del levy, con el socio y el producto, y la vuelta al origen", async () => {
    await postCheckout();

    expect(createSession).toHaveBeenCalledTimes(1);
    const [params] = createSession.mock.calls[0] ?? [];
    expect(params).toMatchObject({
      mode: "payment",
      line_items: [{ price: LEVY_PRICE, quantity: 1 }],
      client_reference_id: USER_ID,
      customer: "cus_Alba",
      metadata: {
        user_id: USER_ID,
        kind: "levy",
        levy_product_id: LEVY_PRODUCT,
      },
      success_url: `${ORIGIN}/pagos?levy=ok`,
      cancel_url: `${ORIGIN}/pagos?levy=cancelado`,
    });
  });

  it("responde 404 a un precio que no es de un levy activo", async () => {
    const response = await postCheckout("price_full_test");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found", reason: "levy_not_found" },
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("responde 409 con su motivo a un levy que el socio ya pagó", async () => {
    findPaidProductIds.mockResolvedValue(new Set([LEVY_PRODUCT]));

    const response = await postCheckout();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "conflict", reason: "levy_already_paid" },
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await postCheckout();

    expect(response.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("responde 503 cuando falta la configuración de Stripe", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const response = await postCheckout();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "stripe_not_configured" },
    });
  });

  it("responde 503 con su motivo cuando Stripe no contesta", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createSession.mockRejectedValue(
      new StripeSdk.errors.StripeConnectionError({ message: "timeout" }),
    );

    const response = await postCheckout();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "stripe_unavailable" },
    });
  });

  it("responde 405 a un GET", async () => {
    const response = await checkoutRoute.GET(
      new NextRequest(new URL(checkoutPath(LEVY_PRICE), ORIGIN)),
    );

    expect(response.status).toBe(405);
  });
});
