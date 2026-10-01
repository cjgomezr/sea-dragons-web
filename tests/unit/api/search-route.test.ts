import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { SEARCH_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { SearchGateways } from "@/lib/search/search";

/**
 * La búsqueda global por API (#425, RF-7 del PRD de E14, CON-002). La
 * petición entra por el proxy y sólo llega al handler si la frontera la deja
 * seguir, como en producción.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const readSessionState = vi.fn();
let memberExists: boolean;
let role: Role;
const searchedTexts: string[] = [];

function searchGateways(): SearchGateways {
  return {
    members: {
      findRoleRequestMember: async () =>
        memberExists
          ? { clubId: CLUB_ID, fullName: "Alba Ferrer", role }
          : null,
    },
    memberGroups: { listGroupsOf: async () => [] },
    directory: {
      findMembersMatching: async (_clubId, text) => {
        searchedTexts.push(text);
        return [];
      },
    },
    positions: { findClubPositions: async () => [] },
    photos: { signPhotoUrls: async () => new Map() },
    events: {
      findEventsMatching: async ({ period }) =>
        period === "upcoming"
          ? {
              total: 1,
              rows: [
                {
                  id: "e1",
                  title: "Scrimmage vs Geelong",
                  startsOn: "2027-07-10",
                  startTime: "19:00",
                  location: "MSAC",
                  eventType: "competition",
                  status: "scheduled",
                },
              ],
            }
          : { total: 0, rows: [] },
    },
    news: { findNewsMatching: async () => ({ total: 0, rows: [] }) },
  };
}

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
  readAuthenticatedUserId: async () => USER_ID,
}));

vi.mock("@/lib/search/supabase-search-gateways", () => ({
  createSupabaseSearchGateways: () => ({
    kind: "ready",
    gateways: searchGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const route = await import("@/app/api/v1/search/route");

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

async function search(query: string | null): Promise<Response> {
  const url = new URL(SEARCH_API_PATH, ORIGIN);
  if (query !== null) {
    url.searchParams.set("q", query);
  }
  const request = new NextRequest(url);
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? route.GET(request)
    : boundaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  searchedTexts.length = 0;
  memberExists = true;
  role = "Player";
});

describe("GET /api/v1/search", () => {
  it.each<Role>(["Admin", "Coach", "Committee", "Player"])(
    "responde a un %s con los tres grupos en orden",
    async (sessionRole) => {
      givenSession({ kind: "active", role: sessionRole });
      role = sessionRole;

      const response = await search("geelong");

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(Object.keys(body.data)).toEqual(["members", "events", "news"]);
      expect(body.data.events).toEqual({
        total: 1,
        items: [
          {
            kind: "event",
            id: "e1",
            title: "Scrimmage vs Geelong",
            startsOn: "2027-07-10",
            startTime: "19:00",
            location: "MSAC",
            eventType: "competition",
            isCancelled: false,
          },
        ],
      });
    },
  );

  it("busca con el texto de `q` sin los espacios de los extremos", async () => {
    givenSession({ kind: "active", role: "Player" });

    await search("  50%_o'neil ");

    expect(searchedTexts).toEqual(["50%_o'neil"]);
  });

  it.each([null, "", "a", "    "])(
    "responde 400 con motivo a q=%j",
    async (query) => {
      givenSession({ kind: "active", role: "Player" });

      const response = await search(query);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "validation_error", reason: "too_short" },
      });
      expect(searchedTexts).toEqual([]);
    },
  );

  // Una cuenta dada de baja llega a la frontera como sin sesión
  // (`session-reader.ts`), así que este caso también la cubre.
  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await search("geelong");

    expect(response.status).toBe(401);
  });

  it("responde 403 a una cuenta incompleta", async () => {
    givenSession({ kind: "incomplete" });

    const response = await search("geelong");

    expect(response.status).toBe(403);
  });

  it("responde 403 a una sesión que no corresponde a ningún socio", async () => {
    givenSession({ kind: "active", role: "Player" });
    memberExists = false;

    const response = await search("geelong");

    expect(response.status).toBe(403);
  });

  it("no acepta escrituras", async () => {
    const response = await route.POST(
      new NextRequest(new URL(SEARCH_API_PATH, ORIGIN), { method: "POST" }),
    );

    expect(response.status).toBe(405);
  });
});
