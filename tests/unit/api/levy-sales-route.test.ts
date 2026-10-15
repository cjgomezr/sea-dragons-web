// @vitest-environment node
import { NextRequest } from "next/server";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { LEVY_BUYERS_API_PATH, LEVY_SALES_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { ClubMemberRecord } from "@/lib/membership/levy-payers";
import type { PaidLevyPayment } from "@/lib/membership/levy-sales";

/**
 * `GET /api/v1/levies/sales` y `GET /api/v1/levies/products/{productId}/buyers`
 * (#634): el resumen de ventas de los extras y sus compradores. Las peticiones
 * entran por el proxy de verdad, que es quien deja pasar sólo a un Admin o a
 * un Committee. Lo único doble es la base y Stripe.
 */

const ORIGIN = "https://preview.seadragons.example";
const CONTINUE_HEADER = "x-middleware-next";
const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const HOODIE_PRODUCT = "prod_hoodie";
const ORIGINAL_ENV = { ...process.env };

const STRIPE_PRODUCTS = [
  {
    id: HOODIE_PRODUCT,
    object: "product",
    name: "Hoodie",
    description: null,
    active: true,
    metadata: { seadragons_kind: "levy" },
    default_price: {
      id: "price_hoodie",
      object: "price",
      active: true,
      type: "one_time",
      currency: "aud",
      unit_amount: 6000,
    },
  },
] as unknown as readonly Stripe.Product[];

const MEMBERS: readonly ClubMemberRecord[] = [
  {
    userId: "bruno",
    fullName: "Bruno Díaz",
    email: "bruno@club.test",
    status: "active",
  },
];

const PAYMENTS: readonly PaidLevyPayment[] = [
  {
    productId: HOODIE_PRODUCT,
    userId: "bruno",
    quantity: 2,
    amountCents: 12000,
    description: "Hoodie",
    paidAt: "2026-10-02T10:00:00.000Z",
    option: "L",
  },
];

const readSessionState = vi.fn();
const listProducts = vi.fn();
const listClubLevyPayments = vi.fn();
const listProductPayments = vi.fn();

vi.mock("stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stripe")>();
  class FakeStripe {
    static errors = actual.default.errors;
    products = {
      list: (...args: unknown[]) => ({
        autoPagingToArray: () => listProducts(...args),
      }),
    };
    checkout = { sessions: { create: vi.fn() } };
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

vi.mock("@/lib/membership/supabase-levy-payers-gateways", () => ({
  createClubMembersGateway: () => ({
    findMemberClubId: async () => CLUB_ID,
    listClubMembers: async () => MEMBERS,
  }),
}));

vi.mock("@/lib/membership/supabase-levy-sales-gateways", () => ({
  createLevySalesPaymentsGateway: () => ({
    listClubLevyPayments: (...args: unknown[]) => listClubLevyPayments(...args),
    listProductPayments: (...args: unknown[]) => listProductPayments(...args),
  }),
}));

const { default: StripeSdk } = await import("stripe");
const { proxy } = await import("@/proxy");
const salesRoute = await import("@/app/api/v1/levies/sales/route");
const buyersRoute =
  await import("@/app/api/v1/levies/products/[productId]/buyers/route");

function configureStripe(): void {
  process.env.STRIPE_SECRET_KEY = "sk_test_clave_de_prueba";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_secreto_de_prueba";
  process.env.STRIPE_PRICE_FULL = "price_full_test";
  process.env.STRIPE_PRICE_STUDENT = "price_student_test";
}

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

function givenRole(role: Role): void {
  givenSession({ kind: "active", role, membershipCurrent: true });
}

async function throughBoundary(
  path: string,
  handle: (request: NextRequest) => Promise<Response>,
): Promise<Response> {
  const makeRequest = (): NextRequest => new NextRequest(new URL(path, ORIGIN));
  const boundaryResponse = await proxy(makeRequest());
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? handle(makeRequest())
    : boundaryResponse;
}

function getSales(): Promise<Response> {
  return throughBoundary(LEVY_SALES_API_PATH, (request) =>
    salesRoute.GET(request),
  );
}

function getBuyers(productId = HOODIE_PRODUCT): Promise<Response> {
  return throughBoundary(
    LEVY_BUYERS_API_PATH.replace("[productId]", productId),
    (request) =>
      buyersRoute.GET(request, { params: Promise.resolve({ productId }) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  configureStripe();
  givenRole("Admin");
  listProducts.mockResolvedValue(STRIPE_PRODUCTS);
  listClubLevyPayments.mockResolvedValue(PAYMENTS);
  listProductPayments.mockResolvedValue(PAYMENTS);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/v1/levies/sales", () => {
  it.each<Role>(["Admin", "Committee"])(
    "a un %s le responde el resumen de cada extra",
    async (role) => {
      givenRole(role);

      const response = await getSales();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: {
          sales: [
            {
              productId: HOODIE_PRODUCT,
              priceId: "price_hoodie",
              name: "Hoodie",
              description: null,
              amountCents: 6000,
              status: "open",
              soldQuantity: 2,
              buyerCount: 1,
              soldByOption: [{ option: "L", quantity: 2 }],
            },
          ],
        },
      });
    },
  );

  it("lee el catálogo de Stripe una vez, con los productos archivados", async () => {
    await getSales();

    expect(listProducts).toHaveBeenCalledTimes(1);
    expect(listProducts).toHaveBeenCalledWith(
      expect.not.objectContaining({ active: expect.anything() }),
    );
    expect(listClubLevyPayments).toHaveBeenCalledWith(CLUB_ID);
  });

  it.each<Role>(["Player", "Coach"])(
    "a un %s le responde 403 sin leer nada",
    async (role) => {
      givenRole(role);

      const response = await getSales();

      expect(response.status).toBe(403);
      expect(listProducts).not.toHaveBeenCalled();
      expect(listClubLevyPayments).not.toHaveBeenCalled();
    },
  );

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await getSales();

    expect(response.status).toBe(401);
    expect(listClubLevyPayments).not.toHaveBeenCalled();
  });

  it("responde 503 con stripe_not_configured cuando falta Stripe, como el listado de levies", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    delete process.env.STRIPE_SECRET_KEY;

    const response = await getSales();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "service_unavailable", reason: "stripe_not_configured" },
    });
  });

  it("responde 503 con su motivo cuando Stripe no contesta", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    listProducts.mockRejectedValue(
      new StripeSdk.errors.StripeConnectionError({ message: "timeout" }),
    );

    const response = await getSales();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "stripe_unavailable" },
    });
  });

  it("responde 405 a un POST", async () => {
    const response = await salesRoute.POST(
      new NextRequest(new URL(LEVY_SALES_API_PATH, ORIGIN), {
        method: "POST",
      }),
    );

    expect(response.status).toBe(405);
  });
});

describe("GET /api/v1/levies/products/{productId}/buyers", () => {
  it.each<Role>(["Admin", "Committee"])(
    "a un %s le responde una fila por compra, sin faltantes",
    async (role) => {
      givenRole(role);

      const response = await getBuyers();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: {
          buyers: [
            {
              userId: "bruno",
              fullName: "Bruno Díaz",
              email: "bruno@club.test",
              quantity: 2,
              paidAt: "2026-10-02T10:00:00.000Z",
              amountCents: 12000,
              option: "L",
            },
          ],
        },
      });
    },
  );

  it("pide los pagos del producto en el club de quien llama, sin Stripe", async () => {
    delete process.env.STRIPE_SECRET_KEY;

    const response = await getBuyers("prod_cerrado");

    expect(response.status).toBe(200);
    expect(listProductPayments).toHaveBeenCalledWith({
      clubId: CLUB_ID,
      productId: "prod_cerrado",
    });
    expect(listProducts).not.toHaveBeenCalled();
  });

  it.each<Role>(["Player", "Coach"])(
    "a un %s le responde 403 sin leer nada",
    async (role) => {
      givenRole(role);

      const response = await getBuyers();

      expect(response.status).toBe(403);
      expect(listProductPayments).not.toHaveBeenCalled();
    },
  );

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await getBuyers();

    expect(response.status).toBe(401);
    expect(listProductPayments).not.toHaveBeenCalled();
  });

  it("responde 405 a un POST", async () => {
    const response = await buyersRoute.POST(
      new NextRequest(
        new URL(
          LEVY_BUYERS_API_PATH.replace("[productId]", HOODIE_PRODUCT),
          ORIGIN,
        ),
        { method: "POST" },
      ),
    );

    expect(response.status).toBe(405);
  });
});
