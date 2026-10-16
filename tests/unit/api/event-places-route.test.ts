import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { EVENT_PLACES_API_PATH } from "@/lib/auth/routes";
import type {
  ClubPlace,
  PlaceSearchGateways,
  SearchedPlace,
} from "@/lib/events/place-search";

/**
 * `GET /api/v1/events/manage/places?q=` (#646, RF-5 del PRD de E24). Qué
 * lugares salen y en qué orden lo prueba el dominio; aquí, que cada caso sale
 * con su código de la convención: 200, 400, 401 y 403.
 */

const ORIGIN = "http://localhost:3417";
const CALLER_ID = "c0c0c0c0-0000-4000-8000-000000000001";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";

const MSAC: ClubPlace = {
  name: "MSAC",
  address: "Aughtie Dr, Albert Park VIC 3206",
  lat: -37.8423,
  lng: 144.9601,
  eventCount: 12,
};

const PRINCES_PARK: SearchedPlace = {
  name: "Princes Park",
  address: "Royal Parade, Carlton",
  lat: -37.7838,
  lng: 144.9611,
};

const search = vi.fn<PlaceSearchGateways["placeSearch"]["search"]>();

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

function mockCaller(callerId: string | null): void {
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => callerId,
  }));
}

/**
 * Quien llama entra aquí y no en un `mockCaller` aparte: dos `vi.doMock` del
 * mismo módulo en un caso a veces dejan ganar al primero bajo carga (#696).
 */
function mockWiring(
  role: Role = "Committee",
  callerId: string | null = CALLER_ID,
): void {
  const gateways: PlaceSearchGateways = {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Olga Organiza",
        role,
      }),
    },
    clubPlaces: { listClubPlaces: async () => [MSAC] },
    placeSearch: { search },
  };
  vi.doMock("@/lib/events/supabase-place-search-gateways", () => ({
    createSupabasePlaceSearchGateways: () => ({ kind: "ready", gateways }),
  }));
  mockCaller(callerId);
}

async function getPlaces(query: string | null): Promise<Response> {
  const { GET } = await import("@/app/api/v1/events/manage/places/route");
  const url = new URL(EVENT_PLACES_API_PATH, ORIGIN);
  if (query !== null) {
    url.searchParams.set("q", query);
  }
  return GET(new NextRequest(url));
}

beforeEach(() => {
  vi.resetModules();
  search.mockReset();
  search.mockResolvedValue([PRINCES_PARK]);
});

afterEach(() => {
  vi.doUnmock("@/lib/events/supabase-place-search-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("GET /api/v1/events/manage/places", () => {
  it.each<Role>(["Admin", "Committee"])(
    "a un %s le responde 200 con los del club primero y después los de Photon",
    async (role) => {
      mockWiring(role);

      const response = await getPlaces("park");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: {
          places: [
            {
              source: "club",
              name: "MSAC",
              address: "Aughtie Dr, Albert Park VIC 3206",
              lat: -37.8423,
              lng: 144.9601,
            },
            { source: "search", ...PRINCES_PARK },
          ],
          searchAvailable: true,
        },
      });
    },
  );

  it("sin q responde 200 con los del club y no llama a Photon", async () => {
    mockWiring();

    const response = await getPlaces(null);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { places: [{ source: "club", name: "MSAC" }] },
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("acepta una q de 100 caracteres", async () => {
    mockWiring();

    const response = await getPlaces("p".repeat(100));

    expect(response.status).toBe(200);
  });

  it("cuenta en caracteres: acepta 100 emojis", async () => {
    mockWiring();

    const response = await getPlaces("🏊".repeat(100));

    expect(response.status).toBe(200);
  });

  it("responde 400 a una q de más de 100 caracteres sin llamar a Photon", async () => {
    mockWiring();

    const response = await getPlaces("p".repeat(101));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error" },
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("responde 401 sin sesión", async () => {
    mockWiring("Committee", null);

    const response = await getPlaces("park");

    expect(response.status).toBe(401);
    expect(search).not.toHaveBeenCalled();
  });

  it.each<Role>(["Player", "Coach"])(
    "a un %s le responde 403 sin llamar a Photon",
    async (role) => {
      mockWiring(role);

      const response = await getPlaces("park");

      expect(response.status).toBe(403);
      expect(search).not.toHaveBeenCalled();
    },
  );
});
