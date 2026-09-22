import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type {
  DecidedRoleRequest,
  RoleRequestDecisionWrite,
  RoleRequestDecisionWriteInput,
} from "@/lib/auth/role-request-decision";
import type { Role } from "@/lib/auth/roles";
import { ROLE_REQUEST_DECISION_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";

/**
 * El endpoint con el que un Admin aprueba o rechaza una solicitud de rol
 * (FR-011, AC-006). Quién puede llamarlo lo decide la frontera; qué pasa con
 * cada respuesta de la base, el dominio. Aquí se prueba que cada caso sale con
 * su código de la convención.
 */

const ORIGIN = "http://localhost:3417";
const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const REQUEST_ID = "0f0e0d0c-0b0a-4908-8706-050403020100";

const APPROVED: DecidedRoleRequest = {
  id: REQUEST_ID,
  status: "approved",
  decidedBy: ADMIN_ID,
  decidedAt: "2026-09-17T10:15:00.000Z",
};

type WiringOptions = {
  readonly deciderRole?: Role;
  readonly write?: RoleRequestDecisionWrite;
  readonly auditFailure?: string;
  readonly notificationFailure?: string;
};

const writes: RoleRequestDecisionWriteInput[] = [];
const auditRows: AuditLogInsertRow[] = [];

function mockWiring(options: WiringOptions = {}): void {
  vi.doMock("@/lib/auth/supabase-role-request-decision-gateways", () => ({
    createSupabaseRoleRequestDecisionGateways: () => ({
      kind: "ready",
      gateways: {
        members: {
          findRoleRequestMember: async () => ({
            clubId: CLUB_ID,
            fullName: "Ana Admin",
            role: options.deciderRole ?? "Admin",
          }),
        },
        decisions: {
          applyDecision: async (input: RoleRequestDecisionWriteInput) => {
            writes.push(input);
            return (
              options.write ?? {
                kind: "approved",
                request: APPROVED,
                roleChange: {
                  memberUserId: "b1b1b1b1-0000-4000-8000-00000000000b",
                  previousRole: "Player",
                  newRole: "Coach",
                },
              }
            );
          },
        },
        audit: {
          insertAuditLogRow: async (row: AuditLogInsertRow) => {
            if (options.auditFailure !== undefined) {
              return { error: { message: options.auditFailure } };
            }
            auditRows.push(row);
            return { error: null };
          },
        },
        notifications: {
          findRecipient: async () => ({
            clubId: CLUB_ID,
            accountStatus: "active",
          }),
          insertNotification: async () => {
            if (options.notificationFailure !== undefined) {
              throw new Error(options.notificationFailure);
            }
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
    readAuthenticatedUserId: async () => ADMIN_ID,
    readSessionState: async () => ({ kind: "active", role: "Admin" }),
  }));
}

function decisionPath(requestId: string): string {
  return ROLE_REQUEST_DECISION_API_PATH.replace("[id]", requestId);
}

function decisionRequest(requestId: string, body: unknown): NextRequest {
  return new NextRequest(new URL(decisionPath(requestId), ORIGIN), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postDecision(
  body: unknown,
  requestId: string = REQUEST_ID,
): Promise<Response> {
  const { POST } =
    await import("@/app/api/v1/role-requests/[id]/decision/route");
  return POST(decisionRequest(requestId, body), {
    params: Promise.resolve({ id: requestId }),
  });
}

beforeEach(() => {
  writes.length = 0;
  auditRows.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/auth/supabase-role-request-decision-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("POST /api/v1/role-requests/{id}/decision", () => {
  it("responde 200 con la solicitud aprobada", async () => {
    mockWiring();

    const response = await postDecision({ decision: "approved" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: APPROVED });
    expect(writes).toEqual([
      {
        requestId: REQUEST_ID,
        clubId: CLUB_ID,
        decidedBy: ADMIN_ID,
        decision: "approved",
      },
    ]);
  });

  it("responde 200 con la solicitud rechazada", async () => {
    const rejected: DecidedRoleRequest = { ...APPROVED, status: "rejected" };
    mockWiring({
      write: {
        kind: "rejected",
        request: rejected,
        requester: {
          memberUserId: "b1b1b1b1-0000-4000-8000-00000000000b",
          requestedRole: "Coach",
        },
      },
    });

    const response = await postDecision({ decision: "rejected" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: rejected });
    expect(writes[0]?.decision).toBe("rejected");
  });

  it("responde 409 con el motivo cuando ya estaba resuelta", async () => {
    mockWiring({ write: { kind: "already_decided", status: "approved" } });

    const response = await postDecision({ decision: "rejected" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "conflict", reason: "already_approved" },
    });
  });

  it("responde 422 si el socio ya tiene ese rol o uno mayor", async () => {
    mockWiring({ write: { kind: "role_already_granted" } });

    const response = await postDecision({ decision: "approved" });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "business_rule", reason: "role_already_granted" },
    });
  });

  it("responde 404 si la solicitud no existe o es de otro club", async () => {
    mockWiring({ write: { kind: "not_found" } });

    const response = await postDecision({ decision: "approved" });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("responde 404 a un id que no es un uuid, sin tocar la base", async () => {
    mockWiring();

    const response = await postDecision({ decision: "approved" }, "abc");

    expect(response.status).toBe(404);
    expect(writes).toEqual([]);
  });

  it.each([[{ decision: "pending" }], [{ decision: "Approved" }], [{}]])(
    "responde 400 a la decisión inválida %o, sin tocar la base",
    async (body) => {
      mockWiring();

      const response = await postDecision(body);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "validation_error" },
      });
      expect(writes).toEqual([]);
    },
  );

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s aunque llegue a la ruta, sin escribir",
    async (role) => {
      mockWiring({ deciderRole: role });

      const response = await postDecision({ decision: "approved" });

      expect(response.status).toBe(403);
      expect(writes).toEqual([]);
    },
  );

  it("no finge éxito si la bitácora falla, y deja el error en el servidor", async () => {
    mockWiring({ auditFailure: "connection reset" });
    const serverLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await postDecision({ decision: "approved" });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "internal_error", reason: "audit_not_recorded" },
    });
    expect(JSON.stringify(serverLog.mock.calls)).toContain("connection reset");
  });

  it("responde igual si el aviso al socio falla, y deja el error en el servidor", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mockWiring({ notificationFailure: "timeout" });

    const response = await postDecision({ decision: "approved" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: APPROVED });
    expect(errorLog).toHaveBeenCalledWith(
      "[notifications] aviso sin guardar",
      expect.anything(),
    );
  });

  it("no acepta otro método", async () => {
    mockWiring();
    const { GET } =
      await import("@/app/api/v1/role-requests/[id]/decision/route");

    const response = await GET(
      new NextRequest(new URL(decisionPath(REQUEST_ID), ORIGIN)),
    );

    expect(response.status).toBe(405);
  });
});

describe("POST /api/v1/role-requests/{id}/decision en la frontera", () => {
  /** Lo que hace Next con la respuesta del proxy: si sigue, llega a la ruta. */
  const CONTINUE_HEADER = "x-middleware-next";

  async function boundaryResponse(session: SessionState): Promise<Response> {
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
    const { proxy } = await import("@/proxy");
    return proxy(decisionRequest(REQUEST_ID, { decision: "approved" }));
  }

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s sin llegar a la ruta",
    async (role) => {
      const response = await boundaryResponse({ kind: "active", role });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "forbidden" },
      });
    },
  );

  it("deja pasar a un Admin", async () => {
    const response = await boundaryResponse({ kind: "active", role: "Admin" });

    expect(response.headers.get(CONTINUE_HEADER)).toBe("1");
  });
});
