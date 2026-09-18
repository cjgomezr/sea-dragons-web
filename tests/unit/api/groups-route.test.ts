import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { GROUPS_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { Group } from "@/lib/groups/groups";

/**
 * Los endpoints de los grupos del club (#226). Quién puede llamarlos lo decide
 * la frontera; qué pasa con cada respuesta de la base, el dominio. Aquí se
 * prueba que cada caso sale con su código de la convención.
 */

const ORIGIN = "http://localhost:3417";
const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const GROUP_ID = "9a9a9a9a-0000-4000-8000-000000000009";

const GROUPS: readonly Group[] = [
  { id: GROUP_ID, name: "Junior Squad", memberCount: 4 },
  {
    id: "8b8b8b8b-0000-4000-8000-000000000008",
    name: "Senior Squad",
    memberCount: 0,
  },
];

type WiringOptions = {
  readonly callerRole?: Role;
  readonly nameTaken?: true;
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

function mockWiring(options: WiringOptions = {}): void {
  vi.doMock("@/lib/groups/supabase-groups-gateways", () => ({
    createSupabaseGroupsGateways: () => ({
      kind: "ready",
      gateways: {
        members: {
          findRoleRequestMember: async () => ({
            clubId: CLUB_ID,
            fullName: "Carla Coach",
            role: options.callerRole ?? "Coach",
          }),
        },
        groups: {
          findClubGroups: async (clubId: string) => {
            databaseCalls.push(`list ${clubId}`);
            return GROUPS;
          },
          insertGroup: async (input: { clubId: string; name: string }) => {
            databaseCalls.push(`insert ${input.clubId} ${input.name}`);
            return options.nameTaken
              ? { kind: "name_taken" }
              : {
                  kind: "created",
                  group: { id: GROUP_ID, name: input.name, memberCount: 0 },
                };
          },
          renameGroup: async (input: {
            clubId: string;
            groupId: string;
            name: string;
          }) => {
            databaseCalls.push(
              `rename ${input.clubId} ${input.groupId} ${input.name}`,
            );
            if (options.missingGroup) {
              return { kind: "not_found" };
            }
            return options.nameTaken
              ? { kind: "name_taken" }
              : {
                  kind: "renamed",
                  group: { id: GROUP_ID, name: input.name, memberCount: 4 },
                };
          },
          deleteGroup: async (input: { clubId: string; groupId: string }) => {
            databaseCalls.push(`delete ${input.clubId} ${input.groupId}`);
            return options.missingGroup
              ? { kind: "not_found" }
              : { kind: "deleted" };
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

function groupPath(groupId: string): string {
  return `${GROUPS_API_PATH}/${groupId}`;
}

function jsonRequest(
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
): NextRequest {
  return new NextRequest(new URL(path, ORIGIN), {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function listGroups(): Promise<Response> {
  const { GET } = await import("@/app/api/v1/groups/route");
  return GET(new NextRequest(new URL(GROUPS_API_PATH, ORIGIN)));
}

async function postGroup(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/v1/groups/route");
  return POST(jsonRequest(GROUPS_API_PATH, "POST", body));
}

async function patchGroup(
  body: unknown,
  groupId: string = GROUP_ID,
): Promise<Response> {
  const { PATCH } = await import("@/app/api/v1/groups/[id]/route");
  return PATCH(jsonRequest(groupPath(groupId), "PATCH", body), {
    params: Promise.resolve({ id: groupId }),
  });
}

async function removeGroup(groupId: string = GROUP_ID): Promise<Response> {
  const { DELETE } = await import("@/app/api/v1/groups/[id]/route");
  return DELETE(
    new NextRequest(new URL(groupPath(groupId), ORIGIN), { method: "DELETE" }),
    { params: Promise.resolve({ id: groupId }) },
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

beforeEach(() => {
  databaseCalls.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/groups/supabase-groups-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("GET/POST /api/v1/groups", () => {
  it("GET responde 200 con los grupos del club y su conteo", async () => {
    mockWiring();

    const response = await listGroups();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { groups: GROUPS },
    });
    expect(databaseCalls).toEqual([`list ${CLUB_ID}`]);
  });

  it("POST responde 201 con el grupo y su conteo en 0", async () => {
    mockWiring();

    const response = await postGroup({ name: "Masters Squad" });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: { id: GROUP_ID, name: "Masters Squad", memberCount: 0 },
    });
  });

  it("POST responde 409 si el nombre ya existe en el club", async () => {
    mockWiring({ nameTaken: true });

    const response = await postGroup({ name: " senior squad " });

    await expectErrorCode(response, 409, "conflict");
  });

  it.each([
    ["un nombre vacío", { name: "" }],
    ["un nombre de más de 60 caracteres", { name: "x".repeat(61) }],
    ["un cuerpo sin nombre", {}],
    ["un nombre que no es texto", { name: 7 }],
  ])("POST responde 400 a %s sin tocar la base", async (_case, body) => {
    mockWiring();

    const response = await postGroup(body);

    await expectErrorCode(response, 400, "validation_error");
    expect(databaseCalls).toEqual([]);
  });

  it.each([
    ["GET", listGroups],
    ["POST", () => postGroup({ name: "Masters Squad" })],
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

    const response = await listGroups();

    await expectErrorCode(response, 401, "unauthenticated");
  });
});

describe("PATCH/DELETE /api/v1/groups/{id}", () => {
  it("PATCH responde 200 con el grupo renombrado y sus socios", async () => {
    mockWiring();

    const response = await patchGroup({ name: "Senior Squad A" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { id: GROUP_ID, name: "Senior Squad A", memberCount: 4 },
    });
    expect(databaseCalls).toEqual([
      `rename ${CLUB_ID} ${GROUP_ID} Senior Squad A`,
    ]);
  });

  it("PATCH responde 409 si otro grupo del club ya usa el nombre", async () => {
    mockWiring({ nameTaken: true });

    const response = await patchGroup({ name: "Junior Squad" });

    await expectErrorCode(response, 409, "conflict");
  });

  it("PATCH responde 400 a un nombre de solo espacios sin tocar la base", async () => {
    mockWiring();

    const response = await patchGroup({ name: "   " });

    await expectErrorCode(response, 400, "validation_error");
    expect(databaseCalls).toEqual([]);
  });

  it("DELETE responde 204 sin cuerpo", async () => {
    mockWiring();

    const response = await removeGroup();

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
    expect(databaseCalls).toEqual([`delete ${CLUB_ID} ${GROUP_ID}`]);
  });

  it.each([
    ["PATCH", () => patchGroup({ name: "Senior Squad" })],
    ["DELETE", () => removeGroup()],
  ] as const)(
    "%s responde 404 a un grupo que no existe o es de otro club",
    async (_method, call) => {
      mockWiring({ missingGroup: true });

      const response = await call();

      await expectErrorCode(response, 404, "not_found");
    },
  );

  it.each([
    ["PATCH", () => patchGroup({ name: "Senior Squad" }, "no-es-un-uuid")],
    ["DELETE", () => removeGroup("no-es-un-uuid")],
  ] as const)(
    "%s responde 404 a un id que no es un uuid, sin tocar la base",
    async (_method, call) => {
      mockWiring();

      const response = await call();

      await expectErrorCode(response, 404, "not_found");
      expect(databaseCalls).toEqual([]);
    },
  );

  it.each([
    ["PATCH", () => patchGroup({ name: "Senior Squad" })],
    ["DELETE", () => removeGroup()],
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

    const response = await removeGroup();

    await expectErrorCode(response, 401, "unauthenticated");
  });
});

describe("los grupos en la frontera", () => {
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
    return proxy(new NextRequest(new URL(path, ORIGIN)));
  }

  it.each([GROUPS_API_PATH, groupPath(GROUP_ID)])(
    "responde 403 a un Player que pide %s, sin llegar a la ruta",
    async (path) => {
      const response = await boundaryResponse(path, {
        kind: "active",
        role: "Player",
      });

      await expectErrorCode(response, 403, "forbidden");
    },
  );

  it("responde 401 sin sesión", async () => {
    const response = await boundaryResponse(GROUPS_API_PATH, {
      kind: "anonymous",
    });

    await expectErrorCode(response, 401, "unauthenticated");
  });

  it("responde 403 a una cuenta incompleta", async () => {
    const response = await boundaryResponse(GROUPS_API_PATH, {
      kind: "incomplete",
    });

    await expectErrorCode(response, 403, "forbidden");
  });

  it.each(["Admin", "Coach", "Committee"] as const)(
    "deja pasar a un %s",
    async (role) => {
      const response = await boundaryResponse(GROUPS_API_PATH, {
        kind: "active",
        role,
      });

      expect(response.headers.get(CONTINUE_HEADER)).toBe("1");
    },
  );
});
