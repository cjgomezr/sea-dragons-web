import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { GROUPS_API_PATH } from "@/lib/auth/routes";
import type { GroupAudienceRecords } from "@/lib/groups/group-audience";

/**
 * `GET /api/v1/groups/{id}/audience` (#827, D9 del PRD de E32). Qué cuenta
 * lo prueba el dominio; aquí, la forma de la respuesta y cada código.
 */

const ORIGIN = "http://localhost:3417";
const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const GROUP_ID = "9a9a9a9a-0000-4000-8000-000000000009";
const EVENT_ID = "e1e1e1e1-0000-4000-8000-0000000000e1";
const SERIES_ID = "5e5e5e5e-0000-4000-8000-00000000005e";
const SESSION_ID = "5f5f5f5f-0000-4000-8000-00000000005f";
const POST_ID = "a1a1a1a1-0000-4000-8000-0000000000a1";

/** Lejos en el futuro: la ruta lee la fecha de verdad. */
const RECORDS: GroupAudienceRecords = {
  events: [
    {
      id: EVENT_ID,
      title: "Torneo de otoño",
      groupIds: [GROUP_ID],
      startsOn: "2099-10-24",
      startTime: "09:30",
      status: "scheduled",
    },
  ],
  series: [
    {
      id: SERIES_ID,
      title: "Entrenamiento",
      groupIds: [GROUP_ID],
      weekdays: [3],
      startTime: "18:00",
      endsOn: "2099-12-16",
      nextSession: { id: SESSION_ID, startsOn: "2099-10-21" },
    },
  ],
  posts: [
    {
      id: POST_ID,
      title: "Convocatoria",
      groupIds: [GROUP_ID],
      status: "published",
      publishedAt: "2026-10-12T00:00:00.000Z",
    },
  ],
};

type WiringOptions = {
  readonly callerRole?: Role;
  readonly missingGroup?: true;
};

const databaseCalls: string[] = [];

function mockWiring(options: WiringOptions = {}): void {
  vi.doMock("@/lib/groups/supabase-groups-gateways", () => ({
    createSupabaseGroupAudienceGateways: () => ({
      kind: "ready",
      gateways: {
        members: {
          findRoleRequestMember: async () => ({
            clubId: CLUB_ID,
            fullName: "Carla Coach",
            role: options.callerRole ?? "Coach",
          }),
        },
        audience: {
          findGroupAudience: async (query: {
            clubId: string;
            groupId: string;
          }) => {
            databaseCalls.push(`audience ${query.clubId} ${query.groupId}`);
            return options.missingGroup
              ? { kind: "group_not_found" }
              : { kind: "found", records: RECORDS };
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
    readAuthenticatedUserId: async () => CALLER_ID,
    readSessionState: async () => ({
      kind: "active",
      role: options.callerRole ?? "Coach",
      membershipCurrent: true,
    }),
  }));
}

function audiencePath(groupId: string): string {
  return `${GROUPS_API_PATH}/${groupId}/audience`;
}

async function getAudience(groupId: string = GROUP_ID): Promise<Response> {
  const { GET } = await import("@/app/api/v1/groups/[id]/audience/route");
  return GET(new NextRequest(new URL(audiencePath(groupId), ORIGIN)), {
    params: Promise.resolve({ id: groupId }),
  });
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

describe("audiencia de un grupo", () => {
  it("responde 200 con los eventos y las noticias, cada lista con su total", async () => {
    mockWiring();

    const response = await getAudience();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        events: {
          total: 2,
          items: [
            {
              kind: "series",
              id: SERIES_ID,
              title: "Entrenamiento",
              weekdays: [3],
              startTime: "18:00",
              nextSession: { id: SESSION_ID, startsOn: "2099-10-21" },
            },
            {
              kind: "event",
              id: EVENT_ID,
              title: "Torneo de otoño",
              startsOn: "2099-10-24",
              startTime: "09:30",
            },
          ],
        },
        posts: {
          total: 1,
          items: [
            {
              id: POST_ID,
              title: "Convocatoria",
              publishedAt: "2026-10-12T00:00:00.000Z",
            },
          ],
        },
      },
    });
    expect(databaseCalls).toEqual([`audience ${CLUB_ID} ${GROUP_ID}`]);
  });

  it("responde 404 a un grupo que no existe, es de otro club o acaban de borrar", async () => {
    mockWiring({ missingGroup: true });

    await expectErrorCode(await getAudience(), 404, "not_found");
  });

  it("responde 404 a un id que no es un uuid, sin tocar la base", async () => {
    mockWiring();

    await expectErrorCode(await getAudience("no-es-un-uuid"), 404, "not_found");
    expect(databaseCalls).toEqual([]);
  });

  it("responde 403 a un Player aunque llegue a la ruta, sin tocar la base", async () => {
    mockWiring({ callerRole: "Player" });

    await expectErrorCode(await getAudience(), 403, "forbidden");
    expect(databaseCalls).toEqual([]);
  });

  it("responde 403 a un Player en la frontera, sin llegar a la ruta", async () => {
    mockWiring({ callerRole: "Player" });
    const { proxy } = await import("@/proxy");

    const response = await proxy(
      new NextRequest(new URL(audiencePath(GROUP_ID), ORIGIN)),
    );

    await expectErrorCode(response, 403, "forbidden");
  });
});
