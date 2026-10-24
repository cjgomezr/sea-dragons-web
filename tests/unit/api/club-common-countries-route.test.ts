import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { CLUB_COMMON_COUNTRIES_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { CommonCountriesGateways } from "@/lib/club/common-countries";

/**
 * Los países más comunes del club por la API (#864, RF-11 del PRD de E33).
 * La petición entra por el proxy y sólo llega al handler si la frontera la
 * deja seguir, como en producción: el 401 y el 403 son los de verdad.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const readSessionState = vi.fn();
let callerRole: Role = "Admin";

function commonCountriesGateways(): CommonCountriesGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Ana Admin",
        role: callerRole,
      }),
    },
    countries: {
      listMemberCountries: async () => ["CO", "AU", "AU", "ES"],
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
  readAuthenticatedUserId: async () => ADMIN_ID,
}));

vi.mock("@/lib/club/supabase-common-countries", () => ({
  createSupabaseCommonCountriesGateways: () => ({
    kind: "ready",
    gateways: commonCountriesGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const { GET, POST } = await import("@/app/api/v1/club/common-countries/route");

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

function requestCommonCountries(
  handle: (request: NextRequest) => Promise<Response>,
  method = "GET",
): Promise<Response> {
  return throughBoundary(
    new NextRequest(new URL(CLUB_COMMON_COUNTRIES_API_PATH, ORIGIN), {
      method,
    }),
    handle,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  givenSession({ kind: "active", role: "Admin", membershipCurrent: true });
});

describe("endpoint de los países más comunes del club", () => {
  it("responde 200 con los países del club de más a menos a un Admin", async () => {
    const response = await requestCommonCountries(GET);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { countries: ["AU", "CO", "ES"] },
    });
  });

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await requestCommonCountries(GET);

    expect(response.status).toBe(401);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s",
    async (role) => {
      givenSession({ kind: "active", role, membershipCurrent: true });

      const response = await requestCommonCountries(GET);

      expect(response.status).toBe(403);
    },
  );

  it("responde 403 desde el dominio aunque la frontera dejara pasar a un Player", async () => {
    callerRole = "Player";

    const response = await GET(
      new NextRequest(new URL(CLUB_COMMON_COUNTRIES_API_PATH, ORIGIN)),
    );

    expect(response.status).toBe(403);
  });

  it("responde 405 a un POST", async () => {
    const response = await requestCommonCountries(POST, "POST");

    expect(response.status).toBe(405);
  });
});
