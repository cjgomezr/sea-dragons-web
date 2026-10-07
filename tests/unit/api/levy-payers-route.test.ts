// @vitest-environment node
import { NextRequest } from "next/server";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { LEVY_PAYERS_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type {
  ClubMemberRecord,
  LevyPaymentRecord,
} from "@/lib/membership/levy-payers";

/**
 * `GET /api/v1/levies/{priceId}/payers` (#531): quién pagó un levy y quién
 * falta. Las peticiones entran por el proxy de verdad, que es quien deja
 * pasar sólo a un Admin o a un Committee. Lo único doble es la base y Stripe.
 */

const ORIGIN = "https://preview.seadragons.example";
const CONTINUE_HEADER = "x-middleware-next";
const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const LEVY_PRODUCT = "prod_nationals";
const LEVY_PRICE = "price_nationals";
const ORIGINAL_ENV = { ...process.env };

const STRIPE_PRODUCTS = [
  {
    id: LEVY_PRODUCT,
    object: "product",
    name: "Nationals 2026",
    description: null,
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
] as unknown as readonly Stripe.Product[];

const MEMBERS: readonly ClubMemberRecord[] = [
  {
    userId: "alba",
    fullName: "Alba Ruiz",
    email: "alba@club.test",
    status: "active",
  },
  {
    userId: "bruno",
    fullName: "Bruno Díaz",
    email: "bruno@club.test",
    status: "active",
  },
];

const PAYMENTS: readonly LevyPaymentRecord[] = [
  {
    userId: "bruno",
    amountCents: 8000,
    status: "paid",
    paidAt: "2026-10-02T10:00:00.000Z",
  },
];

const readSessionState = vi.fn();
const listProducts = vi.fn();
const listLevyPayments = vi.fn();

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
  createLevyPaymentsGateway: () => ({
    listLevyPayments: (...args: unknown[]) => listLevyPayments(...args),
  }),
}));

const { default: StripeSdk } = await import("stripe");
const { proxy } = await import("@/proxy");
const payersRoute = await import("@/app/api/v1/levies/[priceId]/payers/route");

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

async function getPayers(priceId = LEVY_PRICE): Promise<Response> {
  const makeRequest = (): NextRequest =>
    new NextRequest(
      new URL(LEVY_PAYERS_API_PATH.replace("[priceId]", priceId), ORIGIN),
    );
  const boundaryResponse = await proxy(makeRequest());
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? payersRoute.GET(makeRequest(), {
        params: Promise.resolve({ priceId }),
      })
    : boundaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  configureStripe();
  givenRole("Admin");
  listProducts.mockResolvedValue(STRIPE_PRODUCTS);
  listLevyPayments.mockResolvedValue(PAYMENTS);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/v1/levies/{priceId}/payers", () => {
  it.each<Role>(["Admin", "Committee"])(
    "a un %s le responde quién pagó, quién falta y el resumen",
    async (role) => {
      givenRole(role);

      const response = await getPayers();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: {
          levy: { id: LEVY_PRICE, name: "Nationals 2026", amountCents: 8000 },
          summary: { paidCount: 1, missingCount: 1, collectedCents: 8000 },
          payers: [
            {
              userId: "bruno",
              fullName: "Bruno Díaz",
              email: "bruno@club.test",
              paidAt: "2026-10-02T10:00:00.000Z",
              amountCents: 8000,
            },
          ],
          missing: [
            { userId: "alba", fullName: "Alba Ruiz", email: "alba@club.test" },
          ],
        },
      });
    },
  );

  it("pide los pagos del producto del levy en el club de quien llama", async () => {
    await getPayers();

    expect(listLevyPayments).toHaveBeenCalledWith({
      clubId: CLUB_ID,
      productId: LEVY_PRODUCT,
    });
  });

  it.each<Role>(["Player", "Coach"])(
    "a un %s le responde 403 sin leer nada",
    async (role) => {
      givenRole(role);

      const response = await getPayers();

      expect(response.status).toBe(403);
      expect(listLevyPayments).not.toHaveBeenCalled();
      expect(listProducts).not.toHaveBeenCalled();
    },
  );

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await getPayers();

    expect(response.status).toBe(401);
    expect(listLevyPayments).not.toHaveBeenCalled();
  });

  it("responde 404 a un precio que no es de un levy activo", async () => {
    const response = await getPayers("price_archived");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found", reason: "levy_not_found" },
    });
  });

  it("responde 503 con su motivo cuando falta la configuración de Stripe", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    delete process.env.STRIPE_SECRET_KEY;

    const response = await getPayers();

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

    const response = await getPayers();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "stripe_unavailable" },
    });
  });

  it("responde 405 a un POST", async () => {
    const response = await payersRoute.POST(
      new NextRequest(
        new URL(LEVY_PAYERS_API_PATH.replace("[priceId]", LEVY_PRICE), ORIGIN),
        { method: "POST" },
      ),
    );

    expect(response.status).toBe(405);
  });
});
