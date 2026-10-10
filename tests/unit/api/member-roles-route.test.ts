import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MemberRoleChangeWrite,
  MemberRoleChangeWriteInput,
} from "@/lib/auth/member-role-change";
import { MAX_BULK_ROLE_CHANGE_MEMBERS } from "@/lib/auth/member-roles-bulk-change";
import type { Role } from "@/lib/auth/roles";
import { MEMBER_ROLES_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";

/**
 * El endpoint con el que un Admin cambia el rol de varios socios a la vez
 * (#552). Qué le pasa a cada socio lo decide el dominio; aquí se prueba la
 * forma de la petición, la respuesta y quién llega.
 */

const ORIGIN = "http://localhost:3417";
const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const FIRST_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const SECOND_ID = "c2c2c2c2-0000-4000-8000-00000000000c";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const writes: MemberRoleChangeWriteInput[] = [];

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

function mockWiring(
  options: {
    readonly actorRole?: Role;
    readonly writeFor?: (
      input: MemberRoleChangeWriteInput,
    ) => MemberRoleChangeWrite;
    readonly authenticatedUserId?: string | null;
  } = {},
): void {
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
            return options.writeFor === undefined
              ? {
                  kind: "changed",
                  previousRole: "Player",
                  newRole: input.newRole,
                }
              : options.writeFor(input);
          },
        },
        audit: {
          insertAuditLogRow: async () => ({
            error: null,
          }),
        },
        notifications: {
          findRecipient: async () => ({
            clubId: CLUB_ID,
            accountStatus: "active",
          }),
          insertNotification: async () => undefined,
        },
      },
    }),
  }));
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () =>
      options.authenticatedUserId === undefined
        ? ADMIN_ID
        : options.authenticatedUserId,
    readSessionState: async () => ({
      kind: "active",
      role: "Admin",
      membershipCurrent: true,
    }),
  }));
}

function rolesRequest(body: unknown): NextRequest {
  return new NextRequest(new URL(MEMBER_ROLES_API_PATH, ORIGIN), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postRoles(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/v1/members/roles/route");
  return POST(rolesRequest(body));
}

beforeEach(() => {
  writes.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/auth/supabase-member-role-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("POST /api/v1/members/roles", () => {
  it("responde 200 con el resultado de cada socio", async () => {
    mockWiring({
      writeFor: (input) =>
        input.targetUserId === SECOND_ID
          ? { kind: "last_admin" }
          : { kind: "changed", previousRole: "Player", newRole: "Coach" },
    });

    const response = await postRoles({
      userIds: [FIRST_ID, SECOND_ID],
      role: "Coach",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        role: "Coach",
        results: [
          {
            kind: "changed",
            userId: FIRST_ID,
            previousRole: "Player",
            role: "Coach",
          },
          { kind: "failed", userId: SECOND_ID, reason: "last_admin" },
        ],
      },
    });
  });

  it.each([
    ["una lista vacía", { userIds: [], role: "Coach" }],
    ["un id que no es un uuid", { userIds: ["abc"], role: "Coach" }],
    ["un rol inválido", { userIds: [FIRST_ID], role: "Owner" }],
    ["sin rol", { userIds: [FIRST_ID] }],
    ["sin socios", { role: "Coach" }],
  ])("responde 400 a %s, sin tocar la base", async (_case, body) => {
    mockWiring();

    const response = await postRoles(body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error" },
    });
    expect(writes).toEqual([]);
  });

  it("responde 400 a una lista más larga que el tope", async () => {
    mockWiring();
    const userIds = Array.from(
      { length: MAX_BULK_ROLE_CHANGE_MEMBERS + 1 },
      (_, index) =>
        `b1b1b1b1-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );

    const response = await postRoles({ userIds, role: "Coach" });

    expect(response.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it("acepta una lista justo en el tope", async () => {
    mockWiring();
    const userIds = Array.from(
      { length: MAX_BULK_ROLE_CHANGE_MEMBERS },
      (_, index) =>
        `b1b1b1b1-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );

    const response = await postRoles({ userIds, role: "Coach" });

    expect(response.status).toBe(200);
  });

  it("responde 401 sin sesión", async () => {
    mockWiring({ authenticatedUserId: null });

    const response = await postRoles({ userIds: [FIRST_ID], role: "Coach" });

    expect(response.status).toBe(401);
    expect(writes).toEqual([]);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s que llega a la ruta, sin cambiar a nadie",
    async (actorRole) => {
      mockWiring({ actorRole });

      const response = await postRoles({
        userIds: [FIRST_ID, SECOND_ID],
        role: "Admin",
      });

      expect(response.status).toBe(403);
      expect(writes).toEqual([]);
    },
  );
});

describe("POST /api/v1/members/roles en la frontera", () => {
  async function boundaryResponse(session: SessionState): Promise<Response> {
    mockSessionClient();
    vi.doMock("@/lib/auth/session-reader", () => ({
      readSessionState: async () => session,
    }));
    const { proxy } = await import("@/proxy");
    return proxy(rolesRequest({ userIds: [FIRST_ID], role: "Admin" }));
  }

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s sin llegar a la ruta",
    async (role) => {
      const response = await boundaryResponse({
        kind: "active",
        role,
        membershipCurrent: true,
      });

      expect(response.status).toBe(403);
    },
  );
});
