import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  NewRoleRequest,
  RoleRequest,
  RoleRequestInsert,
} from "@/lib/auth/role-request";
import { JUSTIFICATION_MAX_LENGTH } from "@/lib/auth/role-request";
import type { Role } from "@/lib/auth/roles";
import { ROLE_REQUESTS_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";

/**
 * El endpoint con el que un socio pide Coach o Committee (FR-010). Actúa
 * siempre sobre quien identifica la cookie de sesión. La regla de una sola
 * pendiente la garantiza la base; aquí se prueba que cada rechazo sale con su
 * código de la convención.
 */

const ORIGIN = "http://localhost:3417";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const CREATED: RoleRequest = {
  id: "0f0e0d0c-0b0a-4908-8706-050403020100",
  requestedRole: "Coach",
  status: "pending",
  createdAt: "2026-09-17T08:30:00.000Z",
};

type WiringOptions = {
  readonly callerId?: string | null;
  readonly role?: Role;
  readonly latestRequest?: RoleRequest | null;
  readonly insertResult?: RoleRequestInsert;
};

const inserts: NewRoleRequest[] = [];
const databaseReads: string[] = [];

function mockWiring(options: WiringOptions = {}): void {
  vi.doMock("@/lib/auth/supabase-role-request-gateways", () => ({
    createSupabaseRoleRequestGateways: () => ({
      kind: "ready",
      gateways: {
        members: {
          findRoleRequestMember: async (userId: string) => {
            databaseReads.push(userId);
            return {
              clubId: CLUB_ID,
              fullName: "Nerea Ruiz",
              role: options.role ?? "Player",
            };
          },
        },
        requests: {
          findLatestRequest: async () => options.latestRequest ?? null,
          insertPendingRequest: async (request: NewRoleRequest) => {
            inserts.push(request);
            return (
              options.insertResult ?? { kind: "created", request: CREATED }
            );
          },
        },
      },
    }),
  }));

  vi.doMock("@/lib/supabase/session-client", () => ({
    readIncomingCookies: () => [],
    applySessionCookies: () => undefined,
    createSessionClient: () => ({
      kind: "ready",
      client: {},
      recorder: { recorded: () => ({ cookies: [], headers: {} }) },
    }),
  }));

  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () =>
      options.callerId === undefined ? USER_ID : options.callerId,
  }));
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest(new URL(ROLE_REQUESTS_API_PATH, ORIGIN), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postRoleRequest(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/v1/role-requests/route");
  return POST(postRequest(body));
}

beforeEach(() => {
  inserts.length = 0;
  databaseReads.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/auth/supabase-role-request-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
});

describe("POST /api/v1/role-requests", () => {
  it("responde 201 con la solicitud pendiente de quien llama", async () => {
    mockWiring();

    const response = await postRoleRequest({
      requestedRole: "Coach",
      justification: "Entreno a los juveniles.",
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: CREATED });
    expect(inserts).toEqual([
      {
        clubId: CLUB_ID,
        userId: USER_ID,
        requestedRole: "Coach",
        justification: "Entreno a los juveniles.",
      },
    ]);
  });

  it("acepta la solicitud sin justificación", async () => {
    mockWiring();

    const response = await postRoleRequest({ requestedRole: "Committee" });

    expect(response.status).toBe(201);
    expect(inserts[0]?.justification).toBeNull();
  });

  it("responde 409 cuando ya hay una solicitud pendiente", async () => {
    mockWiring({ latestRequest: CREATED });

    const response = await postRoleRequest({ requestedRole: "Committee" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "conflict" },
    });
    expect(inserts).toEqual([]);
  });

  it("responde 409, y no 500, cuando la escritura choca con el índice", async () => {
    mockWiring({ insertResult: { kind: "pending_exists" } });

    const response = await postRoleRequest({ requestedRole: "Coach" });

    expect(response.status).toBe(409);
  });

  it("responde 422 con su motivo a quien pide el rol que ya tiene", async () => {
    mockWiring({ role: "Coach" });

    const response = await postRoleRequest({ requestedRole: "Coach" });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "business_rule", reason: "role_already_held" },
    });
    expect(inserts).toEqual([]);
  });

  it("responde 422 con su motivo a un Admin", async () => {
    mockWiring({ role: "Admin" });

    const response = await postRoleRequest({ requestedRole: "Committee" });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "business_rule", reason: "admin_has_every_capability" },
    });
  });

  it.each([["Admin"], ["Player"], ["Capitán"], [null]])(
    "responde 400 al pedir %s, sin tocar la base",
    async (requestedRole) => {
      mockWiring();

      const response = await postRoleRequest({ requestedRole });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "validation_error" },
      });
      expect(databaseReads).toEqual([]);
      expect(inserts).toEqual([]);
    },
  );

  it("responde 400 a una justificación más larga que el límite", async () => {
    mockWiring();

    const response = await postRoleRequest({
      requestedRole: "Coach",
      justification: "a".repeat(JUSTIFICATION_MAX_LENGTH + 1),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error" },
    });
    expect(inserts).toEqual([]);
  });

  it("responde 400 a una justificación desmesurada, sin tocar la base", async () => {
    mockWiring();

    const response = await postRoleRequest({
      requestedRole: "Coach",
      justification: "a".repeat(JUSTIFICATION_MAX_LENGTH * 10),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error" },
    });
    expect(databaseReads).toEqual([]);
  });

  it("responde 401 sin sesión", async () => {
    mockWiring({ callerId: null });

    const response = await postRoleRequest({ requestedRole: "Coach" });

    expect(response.status).toBe(401);
    expect(inserts).toEqual([]);
  });

  // El GET dejó de ser "otro método" en #212: es la bandeja del Admin, y sus
  // casos viven en tests/unit/api/administration-reads-route.test.ts.
  it("no acepta un método que el endpoint no implementa", async () => {
    mockWiring();
    const { PUT } = await import("@/app/api/v1/role-requests/route");

    const response = await PUT(
      new NextRequest(new URL(ROLE_REQUESTS_API_PATH, ORIGIN), {
        method: "PUT",
      }),
    );

    expect(response.status).toBe(405);
  });
});

describe("POST /api/v1/role-requests en la frontera", () => {
  /** Lo que hace Next con la respuesta del proxy: si sigue, llega a la ruta. */
  const CONTINUE_HEADER = "x-middleware-next";

  function mockBoundary(session: SessionState): void {
    vi.doMock("@/lib/supabase/session-client", () => ({
      readIncomingCookies: () => [],
      applySessionCookies: () => undefined,
      createSessionClient: () => ({
        kind: "ready",
        client: {},
        recorder: { recorded: () => ({ cookies: [], headers: {} }) },
      }),
    }));
    vi.doMock("@/lib/auth/session-reader", () => ({
      readSessionState: async () => session,
    }));
  }

  async function boundaryResponse(session: SessionState): Promise<Response> {
    mockBoundary(session);
    const { proxy } = await import("@/proxy");
    return proxy(postRequest({ requestedRole: "Coach" }));
  }

  it("responde 403 a una cuenta incompleta sin llegar a la ruta", async () => {
    const response = await boundaryResponse({ kind: "incomplete" });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
  });

  it("responde 401 sin sesión sin llegar a la ruta", async () => {
    const response = await boundaryResponse({ kind: "anonymous" });

    expect(response.status).toBe(401);
  });

  it.each([["Admin"], ["Coach"], ["Committee"], ["Player"]] as const)(
    "deja pasar a un %s con la cuenta activa",
    async (role) => {
      const response = await boundaryResponse({ kind: "active", role });

      expect(response.headers.get(CONTINUE_HEADER)).toBe("1");
    },
  );
});
