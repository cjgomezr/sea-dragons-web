import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClubMember,
  PendingRoleRequest,
} from "@/lib/auth/club-administration";
import type { Role } from "@/lib/auth/roles";
import { MEMBERS_API_PATH, ROLE_REQUESTS_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";

/**
 * Las dos lecturas de la pantalla de administración (#212): la bandeja de
 * solicitudes pendientes y la lista de socios. Sólo las alcanza quien gestiona
 * usuarios y roles, y sólo devuelven lo del club de quien llama.
 */

const ORIGIN = "http://localhost:3417";
const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const MEMBERS: readonly ClubMember[] = [
  {
    userId: "b1b1b1b1-0000-4000-8000-00000000000b",
    fullName: "Nerea Ruiz",
    email: "nerea@example.test",
    role: "Player",
  },
];

const PENDING: readonly PendingRoleRequest[] = [
  {
    id: "0f0e0d0c-0b0a-4908-8706-050403020100",
    userId: "b1b1b1b1-0000-4000-8000-00000000000b",
    fullName: "Nerea Ruiz",
    requestedRole: "Coach",
    justification: "Entreno a los juveniles.",
    createdAt: "2026-09-17T08:30:00.000Z",
  },
];

const clubsRead: string[] = [];

function mockSessionClient(): void {
  vi.doMock("@/lib/supabase/session-client", () => ({
    readIncomingCookies: () => [],
    applySessionCookies: () => undefined,
    createSessionClient: () => ({
      kind: "ready",
      client: {},
      recorder: { recorded: () => ({ cookies: [], headers: {} }) },
    }),
  }));
}

function mockWiring(callerRole: Role = "Admin"): void {
  vi.doMock("@/lib/auth/supabase-club-administration-gateways", () => ({
    createSupabaseClubAdministrationGateways: () => ({
      kind: "ready",
      gateways: {
        members: {
          findRoleRequestMember: async () => ({
            clubId: CLUB_ID,
            fullName: "Ana Admin",
            role: callerRole,
          }),
          findClubMembers: async (clubId: string) => {
            clubsRead.push(clubId);
            return MEMBERS;
          },
        },
        requests: {
          findPendingRequests: async (clubId: string) => {
            clubsRead.push(clubId);
            return PENDING.map((request) => ({
              ...request,
              requesterStatus: "active",
            }));
          },
        },
      },
    }),
  }));
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => ADMIN_ID,
    readSessionState: async () => ({ kind: "active", role: callerRole }),
  }));
}

function getRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, ORIGIN), { method: "GET" });
}

beforeEach(() => {
  clubsRead.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/auth/supabase-club-administration-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("GET /api/v1/members", () => {
  async function listMembers(): Promise<Response> {
    const { GET } = await import("@/app/api/v1/members/route");
    return GET(getRequest(MEMBERS_API_PATH));
  }

  it("responde 200 con nombre, correo y rol de cada socio del club", async () => {
    mockWiring();

    const response = await listMembers();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { members: MEMBERS },
    });
    expect(clubsRead).toEqual([CLUB_ID]);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s aunque llegue a la ruta, sin leer la base",
    async (role) => {
      mockWiring(role);

      const response = await listMembers();

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "forbidden" },
      });
      expect(clubsRead).toEqual([]);
    },
  );

  // El POST es el alta de un miembro (#243); los demás siguen sin existir.
  it("no acepta otro método", async () => {
    mockWiring();
    const { DELETE } = await import("@/app/api/v1/members/route");

    const response = await DELETE(
      new NextRequest(new URL(MEMBERS_API_PATH, ORIGIN), { method: "DELETE" }),
    );

    expect(response.status).toBe(405);
  });
});

describe("GET /api/v1/role-requests?status=pending", () => {
  async function listPending(query = "?status=pending"): Promise<Response> {
    const { GET } = await import("@/app/api/v1/role-requests/route");
    return GET(getRequest(`${ROLE_REQUESTS_API_PATH}${query}`));
  }

  it("responde 200 con socio, rol pedido, justificación y fecha", async () => {
    mockWiring();

    const response = await listPending();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { requests: PENDING },
    });
    expect(clubsRead).toEqual([CLUB_ID]);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s aunque llegue a la ruta, sin leer la base",
    async (role) => {
      mockWiring(role);

      const response = await listPending();

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "forbidden" },
      });
      expect(clubsRead).toEqual([]);
    },
  );

  it.each(["", "?status=approved", "?status=", "?estado=pending"])(
    "responde 400 a la consulta %s, que este endpoint no sabe contestar",
    async (query) => {
      mockWiring();

      const response = await listPending(query);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "validation_error" },
      });
      expect(clubsRead).toEqual([]);
    },
  );
});

describe("las lecturas de administración en la frontera", () => {
  /** Lo que hace Next con la respuesta del proxy: si sigue, llega a la ruta. */
  const CONTINUE_HEADER = "x-middleware-next";

  async function boundaryResponse(
    path: string,
    session: SessionState,
  ): Promise<Response> {
    mockSessionClient();
    vi.doMock("@/lib/auth/session-reader", () => ({
      readSessionState: async () => session,
    }));
    const { proxy } = await import("@/proxy");
    return proxy(getRequest(path));
  }

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s que pide la lista de socios, sin llegar a la ruta",
    async (role) => {
      const response = await boundaryResponse(MEMBERS_API_PATH, {
        kind: "active",
        role,
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "forbidden" },
      });
    },
  );

  it("deja pasar a un Admin a la lista de socios", async () => {
    const response = await boundaryResponse(MEMBERS_API_PATH, {
      kind: "active",
      role: "Admin",
    });

    expect(response.headers.get(CONTINUE_HEADER)).toBe("1");
  });

  it("sigue dejando a un Player pedir un rol por el mismo endpoint", async () => {
    const response = await boundaryResponse(ROLE_REQUESTS_API_PATH, {
      kind: "active",
      role: "Player",
    });

    expect(response.headers.get(CONTINUE_HEADER)).toBe("1");
  });
});
