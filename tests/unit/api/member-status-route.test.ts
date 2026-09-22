import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import { MEMBER_STATUS_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type {
  MemberStatusWrite,
  MemberStatusWriteInput,
} from "@/lib/members/member-status-change";

/**
 * El endpoint con el que un Admin da de baja o reactiva a un miembro (FR-085,
 * AC-040). Quién puede llamarlo lo decide la frontera; qué pasa con cada
 * respuesta de la base, el dominio. Aquí se prueba que cada caso sale con su
 * código de la convención.
 */

const ORIGIN = "http://localhost:3417";
const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const MEMBER_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

type WiringOptions = {
  readonly actorRole?: Role;
  readonly write?: MemberStatusWrite;
  readonly auditFailure?: string;
};

const writes: MemberStatusWriteInput[] = [];
const auditRows: AuditLogInsertRow[] = [];

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

function mockWiring(options: WiringOptions = {}): void {
  vi.doMock("@/lib/members/supabase-member-status-gateways", () => ({
    createSupabaseMemberStatusGateways: () => ({
      kind: "ready",
      gateways: {
        members: {
          findRoleRequestMember: async () => ({
            clubId: CLUB_ID,
            fullName: "Ana Admin",
            role: options.actorRole ?? "Admin",
          }),
        },
        accounts: {
          findByUserId: async () => ({
            memberId: "m-1",
            clubId: CLUB_ID,
            accountStatus: "inactive",
            profile: {
              country: "AU",
              dateOfBirth: "1990-04-01",
              membershipType: "full",
              guardianConsentAt: null,
              registeredAt: "2026-01-10T00:00:00.000Z",
            },
          }),
        },
        identities: { isEmailConfirmed: async () => true },
        statuses: {
          applyStatusChange: async (input: MemberStatusWriteInput) => {
            writes.push(input);
            return (
              options.write ?? {
                kind: "changed",
                previousStatus: "active",
                newStatus: input.newStatus,
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
      },
    }),
  }));
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => ADMIN_ID,
    readSessionState: async () => ({ kind: "active", role: "Admin" }),
  }));
}

function memberStatusPath(memberId: string): string {
  return MEMBER_STATUS_API_PATH.replace("[id]", memberId);
}

function statusRequest(memberId: string, body: unknown): NextRequest {
  return new NextRequest(new URL(memberStatusPath(memberId), ORIGIN), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchStatus(
  body: unknown,
  memberId: string = MEMBER_ID,
): Promise<Response> {
  const { PATCH } = await import("@/app/api/v1/members/[id]/status/route");
  return PATCH(statusRequest(memberId, body), {
    params: Promise.resolve({ id: memberId }),
  });
}

beforeEach(() => {
  writes.length = 0;
  auditRows.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/members/supabase-member-status-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("PATCH /api/v1/members/{id}/status", () => {
  it("responde 200 con el estado anterior y el nuevo al dar de baja", async () => {
    mockWiring();

    const response = await patchStatus({ status: "inactive" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        userId: MEMBER_ID,
        previousStatus: "active",
        status: "inactive",
      },
    });
    expect(writes).toEqual([
      {
        targetUserId: MEMBER_ID,
        clubId: CLUB_ID,
        actorId: ADMIN_ID,
        newStatus: "inactive",
      },
    ]);
  });

  it("responde 200 al reactivar", async () => {
    mockWiring({
      write: {
        kind: "changed",
        previousStatus: "inactive",
        newStatus: "active",
      },
    });

    const response = await patchStatus({ status: "active" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        userId: MEMBER_ID,
        previousStatus: "inactive",
        status: "active",
      },
    });
  });

  it.each([
    [{ status: "incomplete" }],
    [{ status: "deleted" }],
    [{ status: "Inactive" }],
    [{ status: null }],
    [{}],
  ])("responde 400 al estado inválido %o, sin tocar la base", async (body) => {
    mockWiring();

    const response = await patchStatus(body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error" },
    });
    expect(writes).toEqual([]);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s aunque llegue a la ruta, sin escribir",
    async (role) => {
      mockWiring({ actorRole: role });

      const response = await patchStatus({ status: "inactive" });

      expect(response.status).toBe(403);
      expect(writes).toEqual([]);
    },
  );

  it("responde 403 si la base dice que quien actúa ya no es Admin", async () => {
    mockWiring({ write: { kind: "actor_not_admin" } });

    const response = await patchStatus({ status: "inactive" });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
  });

  it("responde 404 si el miembro no existe o es de otro club", async () => {
    mockWiring({ write: { kind: "not_found" } });

    const response = await patchStatus({ status: "inactive" });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("responde 404 a un id que no es un uuid, sin tocar la base", async () => {
    mockWiring();

    const response = await patchStatus({ status: "inactive" }, "abc");

    expect(response.status).toBe(404);
    expect(writes).toEqual([]);
  });

  it("responde 422 explicando que es el último Admin, y lo deja en la bitácora", async () => {
    mockWiring({ write: { kind: "last_admin", previousStatus: "active" } });

    const response = await patchStatus({ status: "inactive" });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({
      error: { code: "business_rule", reason: "last_admin" },
    });
    expect(body.error.message).toMatch(/último Admin/);
    expect(auditRows.map((row) => row.result)).toEqual(["failure"]);
  });

  it("responde 422 cuando un Admin intenta darse de baja a sí mismo", async () => {
    mockWiring({ write: { kind: "self_deactivation" } });

    const response = await patchStatus({ status: "inactive" }, ADMIN_ID);

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({
      error: { code: "business_rule", reason: "self_deactivation" },
    });
    expect(body.error.message).toMatch(/otro Admin/);
  });

  it("no finge éxito si la bitácora falla, y deja el error en el servidor", async () => {
    mockWiring({ auditFailure: "connection reset" });
    const serverLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await patchStatus({ status: "inactive" });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "internal_error", reason: "audit_not_recorded" },
    });
    expect(JSON.stringify(serverLog.mock.calls)).toContain("connection reset");
  });

  it("no acepta otro método", async () => {
    mockWiring();
    const { POST } = await import("@/app/api/v1/members/[id]/status/route");

    const response = await POST(
      new NextRequest(new URL(memberStatusPath(MEMBER_ID), ORIGIN), {
        method: "POST",
      }),
    );

    expect(response.status).toBe(405);
  });
});

describe("PATCH /api/v1/members/{id}/status en la frontera", () => {
  /** Lo que hace Next con la respuesta del proxy: si sigue, llega a la ruta. */
  const CONTINUE_HEADER = "x-middleware-next";

  async function boundaryResponse(session: SessionState): Promise<Response> {
    mockSessionClient();
    vi.doMock("@/lib/auth/session-reader", () => ({
      readSessionState: async () => session,
    }));
    const { proxy } = await import("@/proxy");
    return proxy(statusRequest(MEMBER_ID, { status: "inactive" }));
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
