import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import { MEMBERSHIP_WAIVER_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type {
  WaiverRemoval,
  WaiverScope,
  WaiverWrite,
  WaiverWriteInput,
} from "@/lib/membership/membership-waiver";

/**
 * El endpoint con el que un Admin exime de cuota a un socio y le retira la
 * exención (#457, RF-4 del PRD de E12). Quién puede llamarlo lo decide la
 * frontera; qué pasa con cada respuesta de la base, el dominio. Aquí se
 * prueba que cada caso sale con su código de la convención.
 */

const ORIGIN = "http://localhost:3417";
const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const MEMBER_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const UNTIL_INSTANT = "2099-02-28T13:00:00.000Z";

type WiringOptions = {
  readonly actorRole?: Role;
  readonly write?: WaiverWrite;
  readonly removal?: WaiverRemoval;
  readonly auditFailure?: string;
};

const writes: WaiverWriteInput[] = [];
const removals: WaiverScope[] = [];
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
  vi.doMock("@/lib/membership/supabase-membership-waiver-gateways", () => ({
    createSupabaseMembershipWaiverGateways: () => ({
      kind: "ready",
      gateways: {
        members: {
          findRoleRequestMember: async () => ({
            clubId: CLUB_ID,
            fullName: "Ana Admin",
            role: options.actorRole ?? "Admin",
          }),
        },
        waivers: {
          applyWaiver: async (input: WaiverWriteInput) => {
            writes.push(input);
            return (
              options.write ?? {
                kind: "waived",
                previousStatus: "pending",
                stripeSubscriptionId: null,
                reason: input.reason,
                until: input.until === null ? null : new Date(UNTIL_INSTANT),
              }
            );
          },
          removeWaiver: async (scope: WaiverScope) => {
            removals.push(scope);
            return options.removal ?? { kind: "removed", status: "pending" };
          },
        },
        subscriptions: { kind: "unconfigured" },
        audit: {
          insertAuditLogRow: async (row: AuditLogInsertRow) => {
            if (options.auditFailure !== undefined) {
              return { error: { message: options.auditFailure } };
            }
            auditRows.push(row);
            return { error: null };
          },
        },
        log: () => undefined,
      },
    }),
  }));
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => ADMIN_ID,
    readSessionState: async () => ({
      kind: "active",
      role: "Admin",
      membershipCurrent: true,
    }),
  }));
}

function waiverPath(memberId: string): string {
  return MEMBERSHIP_WAIVER_API_PATH.replace("[id]", memberId);
}

function waiverRequest(
  method: "POST" | "DELETE",
  memberId: string,
  body?: unknown,
): NextRequest {
  return new NextRequest(new URL(waiverPath(memberId), ORIGIN), {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function postWaiver(
  body: unknown,
  memberId: string = MEMBER_ID,
): Promise<Response> {
  const { POST } =
    await import("@/app/api/v1/members/[id]/membership-waiver/route");
  return POST(waiverRequest("POST", memberId, body), {
    params: Promise.resolve({ id: memberId }),
  });
}

async function deleteWaiver(memberId: string = MEMBER_ID): Promise<Response> {
  const { DELETE } =
    await import("@/app/api/v1/members/[id]/membership-waiver/route");
  return DELETE(waiverRequest("DELETE", memberId), {
    params: Promise.resolve({ id: memberId }),
  });
}

beforeEach(() => {
  writes.length = 0;
  removals.length = 0;
  auditRows.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/membership/supabase-membership-waiver-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("POST /api/v1/members/{id}/membership-waiver", () => {
  it("responde 200 con la membresía exenta", async () => {
    mockWiring();

    const response = await postWaiver({
      reason: "Entrenador",
      until: "2099-03-01",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        userId: MEMBER_ID,
        membershipStatus: "waived",
        waiver: { reason: "Entrenador", until: UNTIL_INSTANT },
      },
    });
    expect(writes).toEqual([
      {
        targetUserId: MEMBER_ID,
        clubId: CLUB_ID,
        actorId: ADMIN_ID,
        reason: "Entrenador",
        until: "2099-03-01",
      },
    ]);
    expect(auditRows.map((row) => row.action)).toEqual(["membership.waived"]);
  });

  it("acepta la exención sin fecha de fin", async () => {
    mockWiring();

    const response = await postWaiver({ reason: "Voluntaria" });

    expect(response.status).toBe(200);
    expect(writes[0]?.until).toBeNull();
  });

  it.each([
    ["una fecha ya pasada", { reason: "Entrenador", until: "2020-01-01" }],
    ["un motivo vacío", { reason: "  " }],
    ["un motivo de 201 caracteres", { reason: "a".repeat(201) }],
    ["un día que no existe", { reason: "Entrenador", until: "2099-02-30" }],
    ["sin motivo", { until: "2099-03-01" }],
    ["un motivo que no es texto", { reason: 7 }],
  ])("responde 400 a %s, sin escribir nada", async (_case, body) => {
    mockWiring();

    const response = await postWaiver(body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error" },
    });
    expect(writes).toEqual([]);
    expect(auditRows).toEqual([]);
  });

  it("nombra en reason el problema de la fecha pasada", async () => {
    mockWiring();

    const response = await postWaiver({
      reason: "Entrenador",
      until: "2020-01-01",
    });

    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "until_not_after_today" },
    });
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s aunque llegue a la ruta, sin escribir",
    async (role) => {
      mockWiring({ actorRole: role });

      const response = await postWaiver({ reason: "Entrenador" });

      expect(response.status).toBe(403);
      expect(writes).toEqual([]);
    },
  );

  it("responde 404 si el socio no existe o es de otro club", async () => {
    mockWiring({ write: { kind: "not_found" } });

    const response = await postWaiver({ reason: "Entrenador" });

    expect(response.status).toBe(404);
  });

  it("responde 404 a un id que no es un uuid, sin tocar la base", async () => {
    mockWiring();

    const response = await postWaiver({ reason: "Entrenador" }, "abc");

    expect(response.status).toBe(404);
    expect(writes).toEqual([]);
  });

  it("no finge éxito si la bitácora falla, y deja el error en el servidor", async () => {
    mockWiring({ auditFailure: "connection reset" });
    const serverLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await postWaiver({ reason: "Entrenador" });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "internal_error", reason: "audit_not_recorded" },
    });
    expect(JSON.stringify(serverLog.mock.calls)).toContain("connection reset");
  });
});

describe("DELETE /api/v1/members/{id}/membership-waiver", () => {
  it("responde 200 con el estado al que vuelve la membresía", async () => {
    mockWiring({ removal: { kind: "removed", status: "active" } });

    const response = await deleteWaiver();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { userId: MEMBER_ID, membershipStatus: "active", waiver: null },
    });
    expect(removals).toEqual([
      { targetUserId: MEMBER_ID, clubId: CLUB_ID, actorId: ADMIN_ID },
    ]);
    expect(auditRows.map((row) => row.action)).toEqual([
      "membership.waiver_removed",
    ]);
  });

  it("responde 422 si la membresía no está exenta", async () => {
    mockWiring({ removal: { kind: "not_waived" } });

    const response = await deleteWaiver();

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "business_rule", reason: "not_waived" },
    });
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s aunque llegue a la ruta",
    async (role) => {
      mockWiring({ actorRole: role });

      const response = await deleteWaiver();

      expect(response.status).toBe(403);
      expect(removals).toEqual([]);
    },
  );

  it("responde 404 si el socio no existe o es de otro club", async () => {
    mockWiring({ removal: { kind: "not_found" } });

    const response = await deleteWaiver();

    expect(response.status).toBe(404);
  });
});

describe("/api/v1/members/{id}/membership-waiver en la frontera", () => {
  /** Lo que hace Next con la respuesta del proxy: si sigue, llega a la ruta. */
  const CONTINUE_HEADER = "x-middleware-next";

  async function boundaryResponse(
    session: SessionState,
    method: "POST" | "DELETE",
  ): Promise<Response> {
    mockSessionClient();
    vi.doMock("@/lib/auth/session-reader", () => ({
      readSessionState: async () => session,
    }));
    const { proxy } = await import("@/proxy");
    return proxy(
      waiverRequest(
        method,
        MEMBER_ID,
        method === "POST" ? { reason: "Entrenador" } : undefined,
      ),
    );
  }

  it("responde 401 sin sesión", async () => {
    const response = await boundaryResponse({ kind: "anonymous" }, "POST");

    expect(response.status).toBe(401);
  });

  it.each([
    ["Coach", "POST"],
    ["Committee", "POST"],
    ["Player", "POST"],
    ["Coach", "DELETE"],
    ["Committee", "DELETE"],
    ["Player", "DELETE"],
  ] as const)(
    "responde 403 a un %s que hace %s sin llegar a la ruta",
    async (role, method) => {
      const response = await boundaryResponse(
        { kind: "active", role, membershipCurrent: true },
        method,
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "forbidden" },
      });
    },
  );

  it("deja pasar a un Admin", async () => {
    const response = await boundaryResponse(
      { kind: "active", role: "Admin", membershipCurrent: true },
      "POST",
    );

    expect(response.headers.get(CONTINUE_HEADER)).toBe("1");
  });
});
