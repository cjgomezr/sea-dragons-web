import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import { GROUPS_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { GroupMember, Membership } from "@/lib/groups/group-members";

/**
 * Los endpoints de los socios de un grupo (#227). Quién puede llamarlos lo
 * decide la frontera; qué pasa con cada respuesta de la base, el dominio. Aquí
 * se prueba que cada caso sale con su código de la convención.
 */

const ORIGIN = "http://localhost:3417";
const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const GROUP_ID = "9a9a9a9a-0000-4000-8000-000000000009";
const MEMBER_ID = "b1b1b1b1-0000-4000-8000-00000000000b";

const ANA: GroupMember = {
  id: "c2c2c2c2-0000-4000-8000-00000000000c",
  fullName: "Ana Active",
  isPendingActivation: false,
};
const PAULA: GroupMember = {
  id: MEMBER_ID,
  fullName: "Paula Player",
  isPendingActivation: false,
};

type WiringOptions = {
  readonly callerRole?: Role;
  readonly memberStatus?: AccountStatus;
  readonly missingMember?: true;
  readonly missingGroup?: true;
};

const databaseCalls: string[] = [];

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

function describeMembership(verb: string, membership: Membership): string {
  return `${verb} ${membership.clubId} ${membership.groupId} ${membership.userId}`;
}

function mockWiring(options: WiringOptions = {}): void {
  const groupResult = (members: readonly GroupMember[]) =>
    options.missingGroup
      ? { kind: "group_not_found" }
      : { kind: "found", members };
  vi.doMock("@/lib/groups/supabase-group-members-gateways", () => ({
    createSupabaseGroupMembersGateways: () => ({
      kind: "ready",
      gateways: {
        members: {
          findRoleRequestMember: async () => ({
            clubId: CLUB_ID,
            fullName: "Carla Coach",
            role: options.callerRole ?? "Coach",
          }),
        },
        groupMembers: {
          findGroupMembers: async (scope: { clubId: string }) => {
            databaseCalls.push(`members ${scope.clubId}`);
            return groupResult([PAULA]);
          },
          findCandidates: async (scope: { clubId: string }) => {
            databaseCalls.push(`candidates ${scope.clubId}`);
            return groupResult([ANA]);
          },
          findClubMember: async (input: { clubId: string; userId: string }) => {
            databaseCalls.push(`member ${input.clubId} ${input.userId}`);
            return options.missingMember
              ? null
              : { ...PAULA, accountStatus: options.memberStatus ?? "active" };
          },
          insertMembership: async (membership: Membership) => {
            databaseCalls.push(describeMembership("insert", membership));
            return options.missingGroup
              ? { kind: "group_not_found" }
              : { kind: "assigned" };
          },
          deleteMembership: async (membership: Membership) => {
            databaseCalls.push(describeMembership("delete", membership));
            return options.missingGroup
              ? { kind: "group_not_found" }
              : { kind: "removed" };
          },
        },
      },
    }),
  }));
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => CALLER_ID,
    readSessionState: async () => ({
      kind: "active",
      role: options.callerRole ?? "Coach",
    }),
  }));
}

function mockAnonymousCaller(): void {
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => null,
  }));
}

function membersPath(groupId: string = GROUP_ID): string {
  return `${GROUPS_API_PATH}/${groupId}/members`;
}

function candidatesPath(groupId: string = GROUP_ID): string {
  return `${GROUPS_API_PATH}/${groupId}/candidates`;
}

function memberPath(groupId: string, userId: string): string {
  return `${membersPath(groupId)}/${userId}`;
}

async function getMembers(groupId: string = GROUP_ID): Promise<Response> {
  const { GET } = await import("@/app/api/v1/groups/[id]/members/route");
  return GET(new NextRequest(new URL(membersPath(groupId), ORIGIN)), {
    params: Promise.resolve({ id: groupId }),
  });
}

async function getCandidates(groupId: string = GROUP_ID): Promise<Response> {
  const { GET } = await import("@/app/api/v1/groups/[id]/candidates/route");
  return GET(new NextRequest(new URL(candidatesPath(groupId), ORIGIN)), {
    params: Promise.resolve({ id: groupId }),
  });
}

type MembershipCall = { readonly groupId?: string; readonly userId?: string };

async function putMember(call: MembershipCall = {}): Promise<Response> {
  const { groupId = GROUP_ID, userId = MEMBER_ID } = call;
  const { PUT } =
    await import("@/app/api/v1/groups/[id]/members/[userId]/route");
  return PUT(
    new NextRequest(new URL(memberPath(groupId, userId), ORIGIN), {
      method: "PUT",
    }),
    { params: Promise.resolve({ id: groupId, userId }) },
  );
}

async function deleteMember(call: MembershipCall = {}): Promise<Response> {
  const { groupId = GROUP_ID, userId = MEMBER_ID } = call;
  const { DELETE } =
    await import("@/app/api/v1/groups/[id]/members/[userId]/route");
  return DELETE(
    new NextRequest(new URL(memberPath(groupId, userId), ORIGIN), {
      method: "DELETE",
    }),
    { params: Promise.resolve({ id: groupId, userId }) },
  );
}

async function expectErrorCode(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error: { code } });
}

const MEMBERSHIP = `${CLUB_ID} ${GROUP_ID} ${MEMBER_ID}`;

beforeEach(() => {
  databaseCalls.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/groups/supabase-group-members-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("endpoints de socios de un grupo", () => {
  it("GET members responde 200 con los socios del grupo, sólo id y nombre", async () => {
    mockWiring();

    const response = await getMembers();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { members: [PAULA] },
    });
    expect(databaseCalls).toEqual([`members ${CLUB_ID}`]);
  });

  it("PUT responde 200 con el socio asignado", async () => {
    mockWiring();

    const response = await putMember();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: PAULA });
    expect(databaseCalls).toEqual([
      `member ${CLUB_ID} ${MEMBER_ID}`,
      `insert ${MEMBERSHIP}`,
    ]);
  });

  it("PUT responde 200 a un socio con la cuenta incompleta", async () => {
    mockWiring({ memberStatus: "incomplete" });

    const response = await putMember();

    expect(response.status).toBe(200);
  });

  it("PUT responde 422 a un socio dado de baja sin escribir nada", async () => {
    mockWiring({ memberStatus: "inactive" });

    const response = await putMember();

    await expectErrorCode(response, 422, "business_rule");
    expect(databaseCalls).toEqual([`member ${CLUB_ID} ${MEMBER_ID}`]);
  });

  it("DELETE responde 204 sin cuerpo", async () => {
    mockWiring();

    const response = await deleteMember();

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
    expect(databaseCalls).toEqual([
      `member ${CLUB_ID} ${MEMBER_ID}`,
      `delete ${MEMBERSHIP}`,
    ]);
  });

  it.each([
    ["GET members", () => getMembers()],
    ["PUT", () => putMember()],
    ["DELETE", () => deleteMember()],
  ] as const)(
    "%s responde 404 a un grupo que no existe o es de otro club",
    async (_method, call) => {
      mockWiring({ missingGroup: true });

      const response = await call();

      await expectErrorCode(response, 404, "not_found");
    },
  );

  it.each([
    ["PUT", () => putMember()],
    ["DELETE", () => deleteMember()],
  ] as const)(
    "%s responde 404 a un socio que no existe o es de otro club, sin escribir",
    async (_method, call) => {
      mockWiring({ missingMember: true });

      const response = await call();

      await expectErrorCode(response, 404, "not_found");
      expect(databaseCalls).toEqual([`member ${CLUB_ID} ${MEMBER_ID}`]);
    },
  );

  it.each([
    ["GET members", () => getMembers("no-es-un-uuid")],
    ["GET candidates", () => getCandidates("no-es-un-uuid")],
    ["PUT con grupo", () => putMember({ groupId: "no-es-un-uuid" })],
    ["PUT con socio", () => putMember({ userId: "no-es-un-uuid" })],
    ["DELETE con grupo", () => deleteMember({ groupId: "no-es-un-uuid" })],
    ["DELETE con socio", () => deleteMember({ userId: "no-es-un-uuid" })],
  ] as const)(
    "%s responde 404 a un id que no es un uuid, sin tocar la base",
    async (_case, call) => {
      mockWiring();

      const response = await call();

      await expectErrorCode(response, 404, "not_found");
      expect(databaseCalls).toEqual([]);
    },
  );

  it.each([
    ["GET members", () => getMembers()],
    ["GET candidates", () => getCandidates()],
    ["PUT", () => putMember()],
    ["DELETE", () => deleteMember()],
  ] as const)(
    "%s responde 403 a un Player aunque llegue a la ruta, sin tocar la base",
    async (_method, call) => {
      mockWiring({ callerRole: "Player" });

      const response = await call();

      await expectErrorCode(response, 403, "forbidden");
      expect(databaseCalls).toEqual([]);
    },
  );

  it("responde 401 sin sesión", async () => {
    mockAnonymousCaller();

    const response = await putMember();

    await expectErrorCode(response, 401, "unauthenticated");
  });
});

describe("candidatos", () => {
  it("GET candidates responde 200 con los candidatos, sólo id y nombre", async () => {
    mockWiring();

    const response = await getCandidates();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { candidates: [ANA] },
    });
    expect(databaseCalls).toEqual([`candidates ${CLUB_ID}`]);
  });

  it("GET candidates responde 404 a un grupo que no existe o es de otro club", async () => {
    mockWiring({ missingGroup: true });

    const response = await getCandidates();

    await expectErrorCode(response, 404, "not_found");
  });
});

describe("los socios de un grupo en la frontera", () => {
  async function boundaryResponse(
    path: string,
    session: SessionState,
  ): Promise<Response> {
    mockSessionClient();
    vi.doMock("@/lib/auth/session-reader", () => ({
      readSessionState: async () => session,
    }));
    const { proxy } = await import("@/proxy");
    return proxy(new NextRequest(new URL(path, ORIGIN)));
  }

  it.each([membersPath(), candidatesPath(), memberPath(GROUP_ID, MEMBER_ID)])(
    "responde 403 a un Player que pide %s, sin llegar a la ruta",
    async (path) => {
      const response = await boundaryResponse(path, {
        kind: "active",
        role: "Player",
      });

      await expectErrorCode(response, 403, "forbidden");
    },
  );
});
