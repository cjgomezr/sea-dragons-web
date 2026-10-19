import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { CLUB_TEAM_LABELS_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import { DEFAULT_TEAM_LABELS } from "@/lib/teams/team-builder";
import {
  type FakeTeamsClub,
  TEAMS_CALLER_ID,
  TEAMS_CLUB_ID,
  fakeTeamsClub,
} from "../helpers/team-builder-club";

/**
 * `GET` y `PATCH /api/v1/club/team-labels` (#755, RF-1 y D2 a D3 del PRD de
 * E28). La petición entra por el proxy y sólo llega al handler si la frontera
 * la deja seguir, como en producción. El dominio va entero; sólo la base es
 * un doble.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";

const ORCAS_AND_RAYS = {
  a: { name: "Orcas", color: "#D64545" },
  b: { name: "Rayas", color: "#2B3F7A" },
};

const readSessionState = vi.fn();
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

const route = await import("@/app/api/v1/club/team-labels/route");
const { proxy } = await import("@/proxy");

function givenSession(role: Role): void {
  const session: SessionState = {
    kind: "active",
    role,
    membershipCurrent: true,
  };
  readSessionState.mockResolvedValue(session);
  club = fakeTeamsClub({ callerRole: role });
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

function readTeams(): Promise<Response> {
  const request = new NextRequest(new URL(CLUB_TEAM_LABELS_API_PATH, ORIGIN));
  return throughProxy(request, () => route.GET(request));
}

function changeTeams(body: unknown): Promise<Response> {
  const request = new NextRequest(new URL(CLUB_TEAM_LABELS_API_PATH, ORIGIN), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return throughProxy(request, () => route.PATCH(request));
}

async function expectValidationError(
  response: Response,
  fields: readonly string[],
): Promise<void> {
  expect(response.status).toBe(400);
  const body = (await response.json()) as {
    error: { code: string; message: string };
  };
  expect(body.error.code).toBe("validation_error");
  for (const field of fields) {
    expect(body.error.message).toContain(field);
  }
}

beforeEach(() => {
  readSessionState.mockReset();
});

describe("GET /api/v1/club/team-labels", () => {
  it.each<Role>(["Admin", "Coach"])(
    "da a un %s los equipos del club",
    async (role) => {
      givenSession(role);

      const response = await readTeams();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: DEFAULT_TEAM_LABELS,
      });
    },
  );

  it.each<Role>(["Committee", "Player"])(
    "responde 403 a un %s",
    async (role) => {
      givenSession(role);

      expect((await readTeams()).status).toBe(403);
    },
  );
});

describe("PATCH /api/v1/club/team-labels", () => {
  it.each<Role>(["Admin", "Coach"])(
    "guarda los de un %s y responde 200 con ellos",
    async (role) => {
      givenSession(role);

      const response = await changeTeams({
        a: { name: "  Orcas ", color: "#d64545" },
        b: ORCAS_AND_RAYS.b,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: ORCAS_AND_RAYS });
      expect(club.clubTeamChanges).toEqual([
        { clubId: TEAMS_CLUB_ID, teams: ORCAS_AND_RAYS },
      ]);
    },
  );

  it.each<Role>(["Committee", "Player"])(
    "responde 403 a un %s y no guarda nada",
    async (role) => {
      givenSession(role);

      expect((await changeTeams(ORCAS_AND_RAYS)).status).toBe(403);
      expect(club.clubTeamChanges).toEqual([]);
    },
  );

  it.each([
    [
      "un nombre vacío tras recortar",
      { ...ORCAS_AND_RAYS, a: { name: "   ", color: "#D64545" } },
      ["a.name"],
    ],
    [
      "un nombre de más de 24 caracteres",
      { ...ORCAS_AND_RAYS, b: { name: "x".repeat(25), color: "#2B3F7A" } },
      ["b.name"],
    ],
    [
      "un color fuera del muestrario",
      { ...ORCAS_AND_RAYS, a: { name: "Orcas", color: "#123456" } },
      ["a.color"],
    ],
    [
      "los dos colores iguales",
      {
        a: { name: "Orcas", color: "#D64545" },
        b: { name: "Rayas", color: "#D64545" },
      },
      ["a.color", "b.color"],
    ],
  ])("responde 400 con %s y no guarda nada", async (_, body, fields) => {
    givenSession("Coach");

    await expectValidationError(await changeTeams(body), fields);
    expect(club.clubTeamChanges).toEqual([]);
  });
});
