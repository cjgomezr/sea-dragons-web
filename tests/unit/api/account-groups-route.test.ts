import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_GROUPS_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { MemberGroup } from "@/lib/groups/member-groups";

/**
 * Mis grupos por la API (#229): cualquier cuenta activa, de cualquier rol, lee
 * los grupos a los que pertenece. La petición entra por el proxy y sólo llega
 * al handler si la frontera la deja seguir, como en producción.
 */

const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const SESSION_CLIENT = { soy: "el cliente de la sesión" };

const SENIOR: MemberGroup = {
  id: "5e000000-0000-4000-8000-000000000001",
  name: "Senior Squad",
};
const MASTERS: MemberGroup = {
  id: "5e000000-0000-4000-8000-000000000002",
  name: "Masters Squad",
};

const readSessionState = vi.fn();
const readAuthenticatedUserId = vi.fn();
const listGroupsOf = vi.fn();
const createGatewayWith = vi.fn();

vi.mock("@/lib/supabase/session-client", () => ({
  readIncomingCookies: () => [],
  applySessionCookies: () => undefined,
  createSessionClient: () => ({
    kind: "ready",
    client: SESSION_CLIENT,
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  }),
}));

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
  readAuthenticatedUserId: (...args: unknown[]) =>
    readAuthenticatedUserId(...args),
}));

vi.mock("@/lib/groups/supabase-member-groups-gateway", () => ({
  createSupabaseMemberGroupsGateway: (client: unknown) => {
    createGatewayWith(client);
    return { listGroupsOf };
  },
}));

const { proxy } = await import("@/proxy");
const { GET, POST } = await import("@/app/api/v1/account/groups/route");

const ORIGIN = "http://localhost:3417";
/** Lo que hace Next con la respuesta del proxy: si es `NextResponse.next()`
 * la petición sigue hasta la ruta; si no, esa respuesta es la definitiva. */
const CONTINUE_HEADER = "x-middleware-next";

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

async function requestThroughBoundary(): Promise<Response> {
  const request = new NextRequest(new URL(ACCOUNT_GROUPS_API_PATH, ORIGIN));
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? GET(request)
    : boundaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  readAuthenticatedUserId.mockResolvedValue(USER_ID);
  listGroupsOf.mockResolvedValue([SENIOR, MASTERS]);
});

describe("GET /api/v1/account/groups", () => {
  it.each(["Admin", "Coach", "Committee", "Player"] as const)(
    "responde 200 a un %s con sus grupos, con id y nombre",
    async (role) => {
      givenSession({ kind: "active", role });

      const response = await requestThroughBoundary();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: { groups: [MASTERS, SENIOR] },
      });
    },
  );

  it("responde una lista vacía a quien no pertenece a ningún grupo", async () => {
    givenSession({ kind: "active", role: "Player" });
    listGroupsOf.mockResolvedValue([]);

    const response = await requestThroughBoundary();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { groups: [] } });
  });

  it("lee con la sesión de quien llama y sólo por su id", async () => {
    givenSession({ kind: "active", role: "Player" });

    await requestThroughBoundary();

    expect(createGatewayWith).toHaveBeenCalledWith(SESSION_CLIENT);
    expect(listGroupsOf).toHaveBeenCalledWith(USER_ID);
  });

  it("responde 401 sin sesión y no lee ningún grupo", async () => {
    givenSession({ kind: "anonymous" });

    const response = await requestThroughBoundary();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthenticated" },
    });
    expect(listGroupsOf).not.toHaveBeenCalled();
  });

  it("responde 403 a una cuenta incompleta y no lee ningún grupo", async () => {
    givenSession({ kind: "incomplete" });

    const response = await requestThroughBoundary();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
    expect(listGroupsOf).not.toHaveBeenCalled();
  });

  it("responde 401 si la sesión caduca entre la frontera y el handler", async () => {
    givenSession({ kind: "active", role: "Player" });
    readAuthenticatedUserId.mockResolvedValue(null);

    const response = await requestThroughBoundary();

    expect(response.status).toBe(401);
    expect(listGroupsOf).not.toHaveBeenCalled();
  });

  it("responde 500 sin filtrar el mensaje cuando la base falla", async () => {
    givenSession({ kind: "active", role: "Player" });
    listGroupsOf.mockRejectedValue(new Error("relation groups is on fire"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await requestThroughBoundary();

    expect(response.status).toBe(500);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain("on fire");
  });

  it("responde 405 a un método que no implementa", async () => {
    const response = await POST(
      new NextRequest(new URL(ACCOUNT_GROUPS_API_PATH, ORIGIN), {
        method: "POST",
      }),
    );

    expect(response.status).toBe(405);
  });
});
