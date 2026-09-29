import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  EVENT_TEAM_API_PATH,
  TEAM_AUTO_BALANCE_API_PATH,
  TEAM_BUILDER_API_PATH,
  TEAM_PUBLICATION_API_PATH,
  TEAMS_API_PATH,
} from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import {
  DEFAULT_TEAM_LABELS,
  type StoredTeamSplit,
} from "@/lib/teams/team-builder";
import {
  EVENT_ID,
  type FakePlayer,
  type FakeTeamsClub,
  type FakeTeamsClubOptions,
  PUBLISHED_AT,
  SCRIMMAGE,
  TEAMS_CALLER_ID,
  TEAMS_NOW,
  fakeTeamsClub,
  playerId,
} from "../helpers/team-builder-club";

/**
 * Los endpoints del team builder y de "mi equipo" (#401, RF-3 a RF-8 del PRD
 * de E10). La petición entra por el proxy y sólo llega al handler si la
 * frontera la deja seguir, como en producción. El dominio va entero; sólo la
 * base es un doble. Qué decide cada caso lo prueba el dominio; aquí, que cada
 * uno sale con su código: 200, 201, 400, 401, 403, 404 y 422.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const MISSING_EVENT_ID = "e9e9e9e9-0000-4000-8000-00000000000e";

const ANA: FakePlayer = {
  userId: playerId(1),
  fullName: "Ana Zamora",
  response: "yes",
  ratings: [8],
};
const BRUNO: FakePlayer = {
  userId: playerId(2),
  fullName: "Bruno Yáñez",
  response: "yes",
};

const readSessionState = vi.fn();
let callerRole: Role = "Coach";
let club: FakeTeamsClub;

vi.mock("@/lib/supabase/session-client", () => ({
  readIncomingCookies: () => [],
  applySessionCookies: () => undefined,
  createSessionClient: () => ({
    kind: "ready",
    client: {},
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  }),
}));

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
  readAuthenticatedUserId: async () => TEAMS_CALLER_ID,
}));

vi.mock("@/lib/teams/supabase-team-builder-gateways", () => ({
  createSupabaseTeamBuilderGateways: () => ({
    kind: "ready",
    gateways: club.gateways,
  }),
  createSupabaseMyTeamGateways: () => ({
    kind: "ready",
    gateways: club.myTeamGateways,
  }),
}));

const eventsRoute = await import("@/app/api/v1/teams/route");
const builderRoute = await import("@/app/api/v1/teams/[eventId]/route");
const autoBalanceRoute =
  await import("@/app/api/v1/teams/[eventId]/auto-balance/route");
const publicationRoute =
  await import("@/app/api/v1/teams/[eventId]/publication/route");
const myTeamRoute = await import("@/app/api/v1/events/[id]/team/route");
const { proxy } = await import("@/proxy");

function givenClub(options: FakeTeamsClubOptions = {}): void {
  club = fakeTeamsClub({ callerRole, players: [ANA, BRUNO], ...options });
}

function givenSession(session: SessionState): void {
  if (session.kind === "active") {
    callerRole = session.role;
  }
  readSessionState.mockResolvedValue(session);
  givenClub();
}

async function throughProxy(
  request: NextRequest,
  handle: () => Promise<Response>,
): Promise<Response> {
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? handle()
    : boundaryResponse;
}

function requestTo(
  path: string,
  init: { readonly method?: string; readonly body?: unknown } = {},
): NextRequest {
  const url = new URL(path, ORIGIN);
  if (init.body === undefined) {
    return new NextRequest(url, { method: init.method ?? "GET" });
  }
  return new NextRequest(url, {
    method: init.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(init.body),
  });
}

function builderPath(template: string, eventId: string): string {
  return template.replace("[eventId]", eventId);
}

function openBuilder(eventId: string = EVENT_ID): Promise<Response> {
  const request = requestTo(builderPath(TEAM_BUILDER_API_PATH, eventId));
  return throughProxy(request, () =>
    builderRoute.GET(request, { params: Promise.resolve({ eventId }) }),
  );
}

function saveSplit(
  body: unknown,
  eventId: string = EVENT_ID,
): Promise<Response> {
  const request = requestTo(builderPath(TEAM_BUILDER_API_PATH, eventId), {
    method: "PUT",
    body,
  });
  return throughProxy(request, () =>
    builderRoute.PUT(request, { params: Promise.resolve({ eventId }) }),
  );
}

function autoBalance(eventId: string = EVENT_ID): Promise<Response> {
  const request = requestTo(builderPath(TEAM_AUTO_BALANCE_API_PATH, eventId), {
    method: "POST",
  });
  return throughProxy(request, () =>
    autoBalanceRoute.POST(request, { params: Promise.resolve({ eventId }) }),
  );
}

function publish(eventId: string = EVENT_ID): Promise<Response> {
  const request = requestTo(builderPath(TEAM_PUBLICATION_API_PATH, eventId), {
    method: "POST",
  });
  return throughProxy(request, () =>
    publicationRoute.POST(request, { params: Promise.resolve({ eventId }) }),
  );
}

function listEvents(): Promise<Response> {
  const request = requestTo(TEAMS_API_PATH);
  return throughProxy(request, () => eventsRoute.GET(request));
}

function openMyTeam(eventId: string = EVENT_ID): Promise<Response> {
  const request = requestTo(EVENT_TEAM_API_PATH.replace("[id]", eventId));
  return throughProxy(request, () =>
    myTeamRoute.GET(request, { params: Promise.resolve({ id: eventId }) }),
  );
}

async function expectError(
  response: Response,
  status: number,
  error: { readonly code: string; readonly reason?: string },
): Promise<void> {
  expect(response.status).toBe(status);
  const body = (await response.json()) as { error: Record<string, unknown> };
  expect(body.error).toMatchObject(error);
}

const MANUAL_SPLIT = {
  teams: DEFAULT_TEAM_LABELS,
  assignments: [
    { userId: ANA.userId, team: "a" },
    { userId: BRUNO.userId, team: "b" },
  ],
};

const DRAFT: StoredTeamSplit = {
  teams: DEFAULT_TEAM_LABELS,
  mode: "manual",
  publishedAt: null,
  assignments: [{ userId: ANA.userId, team: "a" }],
};

const BUILDER_CALLS = [
  ["GET", openBuilder],
  ["PUT", () => saveSplit(MANUAL_SPLIT)],
  ["POST auto-balance", autoBalance],
  ["POST publication", publish],
] as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TEAMS_NOW);
  readSessionState.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("la frontera del builder", () => {
  it.each(
    (["Committee", "Player"] as const).flatMap((role) =>
      BUILDER_CALLS.map(([name, call]) => [role, name, call] as const),
    ),
  )("responde 403 a un %s en %s", async (role, _, call) => {
    givenSession({ kind: "active", role });

    await expectError(await call(), 403, { code: "forbidden" });
  });

  it.each(BUILDER_CALLS)("responde 401 sin sesión en %s", async (_, call) => {
    givenSession({ kind: "anonymous" });

    expect((await call()).status).toBe(401);
  });

  it.each(BUILDER_CALLS)(
    "responde 404 con un evento que no existe en %s",
    async (name) => {
      givenSession({ kind: "active", role: "Coach" });
      const calls = {
        GET: () => openBuilder(MISSING_EVENT_ID),
        PUT: () => saveSplit(MANUAL_SPLIT, MISSING_EVENT_ID),
        "POST auto-balance": () => autoBalance(MISSING_EVENT_ID),
        "POST publication": () => publish(MISSING_EVENT_ID),
      };

      await expectError(await calls[name](), 404, { code: "not_found" });
    },
  );

  it.each(BUILDER_CALLS)(
    "responde 422 con un evento cancelado en %s",
    async (_, call) => {
      givenSession({ kind: "active", role: "Coach" });
      givenClub({
        events: [{ ...SCRIMMAGE, status: "cancelled" }],
        split: DRAFT,
      });

      await expectError(await call(), 422, {
        code: "business_rule",
        reason: "team_event_cancelled",
      });
    },
  );
});

describe("GET /api/v1/teams/[eventId]", () => {
  it.each<Role>(["Coach", "Admin"])(
    "sirve a un %s la escuadra con su OVR",
    async (role) => {
      givenSession({ kind: "active", role });

      const response = await openBuilder();

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { available: { fullName: string; rating: number }[] };
      };
      expect(
        body.data.available.map((entry) => [entry.fullName, entry.rating]),
      ).toEqual([
        [ANA.fullName, 8],
        [BRUNO.fullName, 5],
      ]);
    },
  );

  it("responde 404 con un id que no es uuid", async () => {
    givenSession({ kind: "active", role: "Coach" });

    await expectError(await openBuilder("no-es-un-uuid"), 404, {
      code: "not_found",
    });
  });

  it.each([
    ["team_event_not_buildable", { ...SCRIMMAGE, eventType: "meeting" }],
    ["team_event_past", { ...SCRIMMAGE, startsOn: "2027-06-14" }],
  ] as const)("responde 422 con %s", async (reason, event) => {
    givenSession({ kind: "active", role: "Coach" });
    givenClub({ events: [event] });

    await expectError(await openBuilder(), 422, {
      code: "business_rule",
      reason,
    });
  });
});

describe("PUT /api/v1/teams/[eventId]", () => {
  it("guarda el reparto en borrador y responde 200", async () => {
    givenSession({ kind: "active", role: "Coach" });

    const response = await saveSplit(MANUAL_SPLIT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { eventId: EVENT_ID, mode: "manual", assignedCount: 2 },
    });
    expect(club.saves).toHaveLength(1);
  });

  it.each([
    [
      "un jugador repetido",
      {
        ...MANUAL_SPLIT,
        assignments: [
          { userId: ANA.userId, team: "a" },
          { userId: ANA.userId, team: "b" },
        ],
      },
    ],
    [
      "un equipo fuera de a y b",
      { ...MANUAL_SPLIT, assignments: [{ userId: ANA.userId, team: "c" }] },
    ],
    [
      "un color que no es #RRGGBB",
      {
        ...MANUAL_SPLIT,
        teams: { ...DEFAULT_TEAM_LABELS, a: { name: "Kelp", color: "blue" } },
      },
    ],
    [
      "un nombre vacío",
      {
        ...MANUAL_SPLIT,
        teams: { ...DEFAULT_TEAM_LABELS, b: { name: "  ", color: "#000000" } },
      },
    ],
    [
      "un id que no es uuid",
      { ...MANUAL_SPLIT, assignments: [{ userId: "ana", team: "a" }] },
    ],
  ])("responde 400 con %s y no escribe nada", async (_, body) => {
    givenSession({ kind: "active", role: "Coach" });

    await expectError(await saveSplit(body), 400, {
      code: "validation_error",
    });
    expect(club.saves).toEqual([]);
  });

  it("responde 422 con alguien fuera de la escuadra y no escribe nada", async () => {
    givenSession({ kind: "active", role: "Coach" });

    await expectError(
      await saveSplit({
        ...MANUAL_SPLIT,
        assignments: [{ userId: playerId(9), team: "a" }],
      }),
      422,
      { code: "business_rule", reason: "team_player_outside_squad" },
    );
    expect(club.saves).toEqual([]);
  });
});

describe("POST /api/v1/teams/[eventId]/auto-balance", () => {
  it("responde 200 con los dos equipos y los totales", async () => {
    givenSession({ kind: "active", role: "Coach" });

    const response = await autoBalance();

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { mode: string; totals: { ratingDifference: number } };
    };
    expect(body.data.mode).toBe("auto");
    expect(body.data.totals.ratingDifference).toBe(3);
  });

  it("responde 422 con la escuadra vacía", async () => {
    givenSession({ kind: "active", role: "Coach" });
    givenClub({ players: [] });

    await expectError(await autoBalance(), 422, {
      code: "business_rule",
      reason: "team_squad_empty",
    });
  });
});

describe("POST /api/v1/teams/[eventId]/publication", () => {
  it("publica y responde 201 con cuántos se avisaron", async () => {
    givenSession({ kind: "active", role: "Coach" });
    givenClub({ split: DRAFT });

    const response = await publish();

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: {
        eventId: EVENT_ID,
        publishedAt: PUBLISHED_AT.toISOString(),
        assignedCount: 1,
        notifiedCount: 1,
      },
    });
  });

  it("responde 422 con un reparto vacío", async () => {
    givenSession({ kind: "active", role: "Coach" });

    await expectError(await publish(), 422, {
      code: "business_rule",
      reason: "team_split_empty",
    });
  });
});

describe("GET /api/v1/teams", () => {
  it.each<Role>(["Coach", "Admin"])(
    "sirve a un %s los eventos armables",
    async (role) => {
      givenSession({ kind: "active", role });

      const response = await listEvents();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: {
          events: [
            {
              id: SCRIMMAGE.id,
              title: SCRIMMAGE.title,
              eventType: SCRIMMAGE.eventType,
              startsOn: SCRIMMAGE.startsOn,
              startTime: SCRIMMAGE.startTime,
            },
          ],
        },
      });
    },
  );

  it.each<Role>(["Committee", "Player"])(
    "responde 403 a un %s",
    async (role) => {
      givenSession({ kind: "active", role });

      await expectError(await listEvents(), 403, { code: "forbidden" });
    },
  );

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    expect((await listEvents()).status).toBe(401);
  });
});

describe("GET /api/v1/events/[id]/team", () => {
  it.each<Role>(["Player", "Committee", "Coach", "Admin"])(
    "sirve a un %s el reparto publicado sin OVR",
    async (role) => {
      givenSession({ kind: "active", role });
      givenClub({ split: { ...DRAFT, publishedAt: PUBLISHED_AT } });

      const response = await openMyTeam();

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(JSON.parse(text)).toMatchObject({
        data: { status: "published", me: null },
      });
      expect(text).not.toMatch(/rating/i);
    },
  );

  it("responde que no hay equipos publicados con un borrador", async () => {
    givenSession({ kind: "active", role: "Player" });
    givenClub({ split: DRAFT });

    const response = await openMyTeam();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { status: "not_published" },
    });
  });

  it.each(["no-es-un-uuid", MISSING_EVENT_ID])(
    "responde 404 con el evento %s",
    async (eventId) => {
      givenSession({ kind: "active", role: "Player" });

      await expectError(await openMyTeam(eventId), 404, {
        code: "not_found",
      });
    },
  );

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    expect((await openMyTeam()).status).toBe(401);
  });
});
