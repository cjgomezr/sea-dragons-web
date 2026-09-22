import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type {
  MemberRoleChangeWrite,
  MemberRoleChangeWriteInput,
} from "@/lib/auth/member-role-change";
import type { Role } from "@/lib/auth/roles";
import { MEMBER_ROLE_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";

/**
 * El endpoint con el que un Admin cambia el rol de un socio (FR-014, AC-008).
 * Quién puede llamarlo lo decide la frontera; qué pasa con cada respuesta de
 * la base, el dominio. Aquí se prueba que cada caso sale con su código de la
 * convención.
 */

const ORIGIN = "http://localhost:3417";
const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const MEMBER_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

type WiringOptions = {
  readonly actorRole?: Role;
  readonly write?: MemberRoleChangeWrite;
  readonly auditFailure?: string;
  readonly notificationFailure?: string;
};

const writes: MemberRoleChangeWriteInput[] = [];
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
  vi.doMock("@/lib/auth/supabase-member-role-gateways", () => ({
    createSupabaseMemberRoleGateways: () => ({
      kind: "ready",
      gateways: {
        members: {
          findRoleRequestMember: async () => ({
            clubId: CLUB_ID,
            fullName: "Ana Admin",
            role: options.actorRole ?? "Admin",
          }),
        },
        roles: {
          applyRoleChange: async (input: MemberRoleChangeWriteInput) => {
            writes.push(input);
            return (
              options.write ?? {
                kind: "changed",
                previousRole: "Player",
                newRole: input.newRole,
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
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => ADMIN_ID,
    readSessionState: async () => ({ kind: "active", role: "Admin" }),
  }));
}

function memberRolePath(memberId: string): string {
  return MEMBER_ROLE_API_PATH.replace("[id]", memberId);
}

function roleRequest(memberId: string, body: unknown): NextRequest {
  return new NextRequest(new URL(memberRolePath(memberId), ORIGIN), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchRole(
  body: unknown,
  memberId: string = MEMBER_ID,
): Promise<Response> {
  const { PATCH } = await import("@/app/api/v1/members/[id]/role/route");
  return PATCH(roleRequest(memberId, body), {
    params: Promise.resolve({ id: memberId }),
  });
}

beforeEach(() => {
  writes.length = 0;
  auditRows.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/auth/supabase-member-role-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("PATCH /api/v1/members/{id}/role", () => {
  it("responde 200 con el rol anterior y el nuevo", async () => {
    mockWiring();

    const response = await patchRole({ role: "Committee" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { userId: MEMBER_ID, previousRole: "Player", role: "Committee" },
    });
    expect(writes).toEqual([
      {
        targetUserId: MEMBER_ID,
        clubId: CLUB_ID,
        actorId: ADMIN_ID,
        newRole: "Committee",
      },
    ]);
  });

  it("responde 200 sin bitácora cuando el socio ya tenía ese rol", async () => {
    mockWiring({ write: { kind: "unchanged", role: "Coach" } });

    const response = await patchRole({ role: "Coach" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { userId: MEMBER_ID, previousRole: "Coach", role: "Coach" },
    });
    expect(auditRows).toEqual([]);
  });

  it.each([
    [{ role: "Owner" }],
    [{ role: "admin" }],
    [{ role: "" }],
    [{ role: null }],
    [{}],
  ])("responde 400 al rol inválido %o, sin tocar la base", async (body) => {
    mockWiring();

    const response = await patchRole(body);

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

      const response = await patchRole({ role: "Admin" });

      expect(response.status).toBe(403);
      expect(writes).toEqual([]);
    },
  );

  it("responde 403 si la base dice que quien actúa ya no es Admin", async () => {
    mockWiring({ write: { kind: "actor_not_admin" } });

    const response = await patchRole({ role: "Admin" });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
  });

  it("responde 404 si el socio no existe o es de otro club", async () => {
    mockWiring({ write: { kind: "not_found" } });

    const response = await patchRole({ role: "Coach" });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("responde 404 a un id que no es un uuid, sin tocar la base", async () => {
    mockWiring();

    const response = await patchRole({ role: "Coach" }, "abc");

    expect(response.status).toBe(404);
    expect(writes).toEqual([]);
  });

  it("responde 422 explicando que es el último Admin", async () => {
    mockWiring({ write: { kind: "last_admin" } });

    const response = await patchRole({ role: "Player" });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({
      error: { code: "business_rule", reason: "last_admin" },
    });
    expect(body.error.message).toMatch(/último Admin/);
    expect(auditRows.map((row) => row.result)).toEqual(["failure"]);
  });

  it("no finge éxito si la bitácora falla, y deja el error en el servidor", async () => {
    mockWiring({ auditFailure: "connection reset" });
    const serverLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await patchRole({ role: "Coach" });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "internal_error", reason: "audit_not_recorded" },
    });
    expect(JSON.stringify(serverLog.mock.calls)).toContain("connection reset");
  });

  it("responde igual si el aviso al socio falla, y deja el error en el servidor", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mockWiring({ notificationFailure: "timeout" });

    const response = await patchRole({ role: "Committee" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { userId: MEMBER_ID, previousRole: "Player", role: "Committee" },
    });
    expect(errorLog).toHaveBeenCalledWith(
      "[notifications] aviso sin guardar",
      expect.anything(),
    );
  });

  it("no acepta otro método", async () => {
    mockWiring();
    const { POST } = await import("@/app/api/v1/members/[id]/role/route");

    const response = await POST(
      new NextRequest(new URL(memberRolePath(MEMBER_ID), ORIGIN), {
        method: "POST",
      }),
    );

    expect(response.status).toBe(405);
  });
});

describe("PATCH /api/v1/members/{id}/role en la frontera", () => {
  /** Lo que hace Next con la respuesta del proxy: si sigue, llega a la ruta. */
  const CONTINUE_HEADER = "x-middleware-next";

  async function boundaryResponse(session: SessionState): Promise<Response> {
    mockSessionClient();
    vi.doMock("@/lib/auth/session-reader", () => ({
      readSessionState: async () => session,
    }));
    const { proxy } = await import("@/proxy");
    return proxy(roleRequest(MEMBER_ID, { role: "Admin" }));
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
