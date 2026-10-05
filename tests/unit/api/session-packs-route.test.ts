import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import { CLUB_SESSION_PACKS_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { SessionPacksGateways } from "@/lib/club/session-packs";
import type { ClubPrice } from "@/lib/membership/stripe-prices";

/**
 * Los packs de sesiones del club por la API (#469, RF-4 del PRD de E13 y
 * FR-080). GET los sirve a cualquier cuenta activa con su precio, que es el
 * de una sesión Casual en Stripe por el tamaño; PUT deja la lista nueva, y
 * sólo lo puede un Admin o un Committee. La petición entra por el proxy y
 * sólo llega al handler si la frontera la deja seguir: el 401 es el de
 * verdad.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
/** Lo que diría Stripe de una sesión Casual en este test: no es el precio
 * del club, para que nada pase por casualidad con el de verdad. */
const SESSION_PRICE_CENTS = 1990;

const readSessionState = vi.fn();
const writes: string[] = [];
let callerRole: Role = "Admin";
let storedSizes: readonly number[] = [5, 10];
let sessionPrice: ClubPrice = {
  amountCents: SESSION_PRICE_CENTS,
  currency: "AUD",
};
let auditRows: AuditLogInsertRow[] = [];

function sessionPacksGateways(): SessionPacksGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Carmen Committee",
        role: callerRole,
      }),
    },
    packs: {
      findPackSizes: async () => storedSizes,
      replacePackSizes: async (_clubId, sizes) => {
        writes.push(`packs ${sizes.join(",")}`);
        storedSizes = sizes;
      },
    },
    sessionPrice: { readCasualSessionPrice: async () => sessionPrice },
    audit: {
      insertAuditLogRow: async (row: AuditLogInsertRow) => {
        writes.push(`audit ${row.action}`);
        auditRows = [...auditRows, row];
        return { error: null };
      },
    },
  };
}

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
  readAuthenticatedUserId: async () => CALLER_ID,
}));

vi.mock("@/lib/club/supabase-session-packs-gateways", () => ({
  createSupabaseSessionPacksGateways: () => ({
    kind: "ready",
    gateways: sessionPacksGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const { GET, PUT, POST, PATCH, DELETE } =
  await import("@/app/api/v1/club/session-packs/route");

function givenSession(session: SessionState): void {
  if (session.kind === "active") {
    callerRole = session.role;
  }
  readSessionState.mockResolvedValue(session);
}

async function throughBoundary(
  request: NextRequest,
  handle: (request: NextRequest) => Promise<Response>,
): Promise<Response> {
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? handle(request)
    : boundaryResponse;
}

function packsRequest(method: string, body?: unknown): NextRequest {
  return new NextRequest(new URL(CLUB_SESSION_PACKS_API_PATH, ORIGIN), {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function getPacks(): Promise<Response> {
  return throughBoundary(packsRequest("GET"), GET);
}

function putPacks(body: unknown): Promise<Response> {
  return throughBoundary(packsRequest("PUT", body), PUT);
}

async function errorOf(
  response: Response,
): Promise<{ code: string; reason?: string }> {
  const body = (await response.json()) as {
    error: { code: string; reason?: string };
  };
  return body.error;
}

function pricedPack(sessions: number): object {
  return {
    sessions,
    price: { amountCents: sessions * SESSION_PRICE_CENTS, currency: "AUD" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  auditRows = [];
  storedSizes = [5, 10];
  sessionPrice = { amountCents: SESSION_PRICE_CENTS, currency: "AUD" };
  givenSession({ kind: "active", role: "Admin", membershipCurrent: true });
});

describe("GET /api/v1/club/session-packs", () => {
  it.each(["Admin", "Coach", "Committee", "Player"] as const)(
    "sirve a un %s los packs en orden con el precio de cada uno",
    async (role) => {
      givenSession({ kind: "active", role, membershipCurrent: true });
      storedSizes = [10, 5];

      const response = await getPacks();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: {
          packs: [pricedPack(10), pricedPack(5)],
          sessionPrice: { amountCents: SESSION_PRICE_CENTS, currency: "AUD" },
        },
      });
    },
  );

  it("los sirve también a quien no está al día, que es quien va a comprar", async () => {
    givenSession({ kind: "active", role: "Player", membershipCurrent: false });

    const response = await getPacks();

    expect(response.status).toBe(200);
  });

  it("sin el precio de Stripe sirve los packs con el precio nulo y su motivo", async () => {
    sessionPrice = { amountCents: null, reason: "stripe_unavailable" };

    const response = await getPacks();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        packs: [5, 10].map((sessions) => ({
          sessions,
          price: { amountCents: null, reason: "stripe_unavailable" },
        })),
        sessionPrice: { amountCents: null, reason: "stripe_unavailable" },
      },
    });
  });

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await getPacks();

    expect(response.status).toBe(401);
  });
});

describe("PUT /api/v1/club/session-packs", () => {
  it.each(["Admin", "Committee"] as const)(
    "un %s deja la lista nueva en ese orden",
    async (role) => {
      givenSession({ kind: "active", role, membershipCurrent: true });

      const response = await putPacks({ sessions: [20, 5, 1] });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: {
          packs: [pricedPack(20), pricedPack(5), pricedPack(1)],
          sessionPrice: { amountCents: SESSION_PRICE_CENTS, currency: "AUD" },
        },
      });
      expect(storedSizes).toEqual([20, 5, 1]);
    },
  );

  it("anota el cambio en la bitácora después de guardarlo", async () => {
    await putPacks({ sessions: [8, 12] });

    expect(writes).toEqual(["packs 8,12", "audit club.session_packs_changed"]);
    expect(auditRows[0]).toMatchObject({
      actor_id: CALLER_ID,
      club_id: CLUB_ID,
      entity_type: "club",
      entity_id: CLUB_ID,
      result: "success",
      metadata: { sessions: [8, 12] },
    });
  });

  it.each([
    { case: "una lista vacía", sessions: [], reason: "packs_required" },
    {
      case: "un pack de 0 sesiones",
      sessions: [0, 5],
      reason: "pack_sessions_out_of_range",
    },
    {
      case: "un pack de 51 sesiones",
      sessions: [5, 51],
      reason: "pack_sessions_out_of_range",
    },
    {
      case: "un tamaño repetido",
      sessions: [5, 10, 5],
      reason: "pack_sessions_repeated",
    },
  ])("con $case responde 400 con $reason y no cambia nada", async (rule) => {
    const response = await putPacks({ sessions: rule.sessions });

    expect(response.status).toBe(400);
    await expect(errorOf(response)).resolves.toMatchObject({
      code: "validation_error",
      reason: rule.reason,
    });
    expect(writes).toEqual([]);
  });

  it.each([
    { case: "sin la lista", body: {} },
    { case: "un tamaño que no es entero", body: { sessions: [2.5] } },
    { case: "un campo de más", body: { sessions: [5], price: 1 } },
  ])("con $case responde 400 sin escribir nada", async ({ body }) => {
    const response = await putPacks(body);

    expect(response.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it.each(["Coach", "Player"] as const)(
    "responde 403 a un %s sin escribir nada",
    async (role) => {
      givenSession({ kind: "active", role, membershipCurrent: true });

      const response = await putPacks({ sessions: [5] });

      expect(response.status).toBe(403);
      await expect(errorOf(response)).resolves.toMatchObject({
        code: "forbidden",
      });
      expect(writes).toEqual([]);
    },
  );

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await putPacks({ sessions: [5] });

    expect(response.status).toBe(401);
    expect(writes).toEqual([]);
  });
});

describe("los demás métodos", () => {
  it.each([
    ["POST", POST],
    ["PATCH", PATCH],
    ["DELETE", DELETE],
  ] as const)("%s responde 405", async (method, handle) => {
    const response = await throughBoundary(packsRequest(method), handle);

    expect(response.status).toBe(405);
  });
});
