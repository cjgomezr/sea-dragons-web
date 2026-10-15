import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { EventsForbiddenError } from "@/lib/events/event-creation";
import {
  type ClubPlace,
  PLACE_SEARCH_CACHE_TTL_MS,
  PLACE_SEARCH_TIMEOUT_MS,
  type PlaceSearchGateways,
  type PlaceSearchProvider,
  type SearchedPlace,
  createCachedPlaceSearch,
  suggestPlaces,
} from "@/lib/events/place-search";

/**
 * El buscador de lugares (#646, RF-5 y D1 del PRD de E24), con un doble de
 * Photon: primero los lugares del club que coinciden, por uso, y después
 * hasta 3 de Photon. Si Photon falla o tarda, quedan los del club.
 */

const CALLER_ID = "c0c0c0c0-0000-4000-8000-000000000001";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";

function clubPlace(
  name: string,
  overrides: Partial<ClubPlace> = {},
): ClubPlace {
  return {
    name,
    address: null,
    lat: null,
    lng: null,
    eventCount: 1,
    ...overrides,
  } as ClubPlace;
}

const MSAC = clubPlace("MSAC", {
  address: "Aughtie Dr, Albert Park VIC 3206",
  lat: -37.84231,
  lng: 144.96012,
  eventCount: 12,
});
const PRINCES_POOL = clubPlace("Prince's Pool", {
  address: "Princes Hill, Carlton North",
  lat: -37.7841,
  lng: 144.9702,
  eventCount: 4,
});
const BOX_HILL = clubPlace("Box Hill Aquatic Centre", {
  address: "Surrey Dr, Box Hill",
  lat: -37.8189,
  lng: 145.1223,
  eventCount: 7,
});
const PRINCESS_HALL = clubPlace("Princess Hall", { eventCount: 2 });

const CLUB_PLACES: readonly ClubPlace[] = [
  MSAC,
  BOX_HILL,
  PRINCES_POOL,
  PRINCESS_HALL,
  clubPlace("Fitzroy Pool", { eventCount: 1 }),
  clubPlace("Brunswick Baths", { eventCount: 1 }),
];

function searched(name: string, lat: number, lng: number): SearchedPlace {
  return { name, address: `${name} St, Melbourne`, lat, lng };
}

const PHOTON_RESULTS: readonly SearchedPlace[] = [
  searched("Princes Park", -37.7838, 144.9611),
  searched("Princes Bridge", -37.8197, 144.9682),
  searched("Princes Theatre", -37.8104, 144.9734),
  searched("Princes Hill Primary", -37.7826, 144.9702),
];

type World = {
  readonly gateways: PlaceSearchGateways;
  readonly search: ReturnType<typeof vi.fn<PlaceSearchProvider["search"]>>;
  readonly listClubPlaces: ReturnType<typeof vi.fn>;
};

function world(
  options: {
    readonly role?: Role;
    readonly clubPlaces?: readonly ClubPlace[];
    readonly search?: PlaceSearchProvider["search"];
  } = {},
): World {
  const search = vi.fn<PlaceSearchProvider["search"]>(
    options.search ?? (async () => PHOTON_RESULTS),
  );
  const listClubPlaces = vi.fn(async () => options.clubPlaces ?? CLUB_PLACES);
  return {
    search,
    listClubPlaces,
    gateways: {
      members: {
        findRoleRequestMember: async () => ({
          clubId: CLUB_ID,
          fullName: "Olga Organiza",
          role: options.role ?? "Committee",
        }),
      },
      clubPlaces: { listClubPlaces },
      placeSearch: { search },
    },
  };
}

function suggest(target: World, query: string) {
  return suggestPlaces(target.gateways, { callerId: CALLER_ID, query });
}

function namesOf(places: readonly { readonly name: string }[]): string[] {
  return places.map((place) => place.name);
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("suggestPlaces", () => {
  it("responde primero los lugares del club que coinciden y después hasta 3 de Photon", async () => {
    const target = world();

    const result = await suggest(target, "princes");

    expect(result.searchAvailable).toBe(true);
    expect(result.places.map((place) => [place.source, place.name])).toEqual([
      ["club", "Prince's Pool"],
      ["club", "Princess Hall"],
      ["search", "Princes Park"],
      ["search", "Princes Bridge"],
      ["search", "Princes Theatre"],
    ]);
  });

  it("devuelve cada lugar con nombre, dirección, lat y lng", async () => {
    const target = world();

    const result = await suggest(target, "msac");

    expect(result.places[0]).toEqual({
      source: "club",
      name: "MSAC",
      address: "Aughtie Dr, Albert Park VIC 3206",
      lat: -37.84231,
      lng: 144.96012,
    });
    expect(result.places[1]).toEqual({
      source: "search",
      name: "Princes Park",
      address: "Princes Park St, Melbourne",
      lat: -37.7838,
      lng: 144.9611,
    });
  });

  it("busca en el club por la dirección también", async () => {
    const target = world();

    const result = await suggest(target, "albert park");

    expect(result.places[0]?.name).toBe("MSAC");
  });

  it("compara sin tildes ni mayúsculas", async () => {
    const target = world({
      clubPlaces: [clubPlace("Piscina Olímpica de Peñalolén")],
    });

    const result = await suggest(target, "OLIMPICA de PENA");

    expect(result.places[0]).toMatchObject({
      source: "club",
      name: "Piscina Olímpica de Peñalolén",
    });
  });

  it("ordena los del club por número de eventos, como llegan de la base", async () => {
    const target = world({
      clubPlaces: [
        clubPlace("Pool B", { eventCount: 9 }),
        clubPlace("Pool A", { eventCount: 3 }),
      ],
    });

    const result = await suggest(target, "pool");

    expect(namesOf(result.places).slice(0, 2)).toEqual(["Pool B", "Pool A"]);
  });

  it("le pregunta a Photon el texto recortado", async () => {
    const target = world();

    await suggest(target, "  princes  ");

    expect(target.search).toHaveBeenCalledWith(
      "princes",
      expect.any(AbortSignal),
    );
  });

  it("lee los lugares del club de quien llama", async () => {
    const target = world();

    await suggest(target, "princes");

    expect(target.listClubPlaces).toHaveBeenCalledWith(CLUB_ID);
  });
});

describe("suggestPlaces con un resultado de Photon que ya es del club", () => {
  it("lo devuelve una sola vez, como del club", async () => {
    const target = world({
      search: async () => [
        searched("MSAC Melbourne", -37.84229, 144.96008),
        searched("Princes Park", -37.7838, 144.9611),
      ],
    });

    const result = await suggest(target, "msac");

    expect(result.places.map((place) => [place.source, place.name])).toEqual([
      ["club", "MSAC"],
      ["search", "Princes Park"],
    ]);
  });

  it("enseña el del club aunque su nombre no coincida con lo escrito", async () => {
    const target = world({
      search: async () => [
        searched("Melbourne Sports Centre", -37.8423, 144.9601),
      ],
    });

    const result = await suggest(target, "melbourne sports");

    expect(result.places.map((place) => [place.source, place.name])).toEqual([
      ["club", "MSAC"],
    ]);
  });

  it("no los cuenta entre los 3 de Photon", async () => {
    const target = world({
      search: async () => [
        searched("MSAC Melbourne", -37.8423, 144.9601),
        ...PHOTON_RESULTS,
      ],
    });

    const result = await suggest(target, "msac");

    expect(
      result.places.filter((place) => place.source === "search"),
    ).toHaveLength(3);
  });
});

describe("suggestPlaces con menos de 3 caracteres", () => {
  it.each(["", "  ", "pr", " p "])(
    "con %j devuelve los 5 lugares del club más usados sin llamar a Photon",
    async (query) => {
      const target = world();

      const result = await suggest(target, query);

      expect(namesOf(result.places)).toEqual([
        "MSAC",
        "Box Hill Aquatic Centre",
        "Prince's Pool",
        "Princess Hall",
        "Fitzroy Pool",
      ]);
      expect(result.places.every((place) => place.source === "club")).toBe(
        true,
      );
      expect(target.search).not.toHaveBeenCalled();
    },
  );
});

describe("suggestPlaces cuando Photon no responde bien", () => {
  it("responde sólo los del club y searchAvailable false si Photon falla", async () => {
    const target = world({
      search: async () => {
        throw new Error("Photon respondió 502");
      },
    });

    const result = await suggest(target, "princes");

    expect(result).toEqual({
      places: [
        expect.objectContaining({ source: "club", name: "Prince's Pool" }),
        expect.objectContaining({ source: "club", name: "Princess Hall" }),
      ],
      searchAvailable: false,
    });
  });

  it("deja constancia del fallo en el registro", async () => {
    const target = world({
      search: async () => {
        throw new Error("Photon respondió 502");
      },
    });

    await suggest(target, "princes");

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Photon respondió 502"),
    );
  });

  it("deja de esperar a Photon a los 3 s y aborta la petición", async () => {
    vi.useFakeTimers();
    let signalSeen: AbortSignal | null = null;
    const target = world({
      search: (_query, signal) => {
        signalSeen = signal;
        return new Promise(() => undefined);
      },
    });

    const pending = suggest(target, "princes");
    await vi.advanceTimersByTimeAsync(PLACE_SEARCH_TIMEOUT_MS);
    const result = await pending;

    expect(result.searchAvailable).toBe(false);
    expect(namesOf(result.places)).toEqual(["Prince's Pool", "Princess Hall"]);
    expect(signalSeen).toMatchObject({ aborted: true });
  });

  it("espera a Photon mientras no pasen los 3 s", async () => {
    vi.useFakeTimers();
    const target = world({
      search: () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve(PHOTON_RESULTS),
            PLACE_SEARCH_TIMEOUT_MS - 1,
          );
        }),
    });

    const pending = suggest(target, "princes");
    await vi.advanceTimersByTimeAsync(PLACE_SEARCH_TIMEOUT_MS - 1);
    const result = await pending;

    expect(result.searchAvailable).toBe(true);
  });
});

describe("suggestPlaces sin createEvents", () => {
  it.each<Role>(["Player", "Coach"])(
    "a un %s lo rechaza sin leer nada",
    async (role) => {
      const target = world({ role });

      await expect(suggest(target, "princes")).rejects.toBeInstanceOf(
        EventsForbiddenError,
      );
      expect(target.listClubPlaces).not.toHaveBeenCalled();
      expect(target.search).not.toHaveBeenCalled();
    },
  );
});

describe("createCachedPlaceSearch", () => {
  function cachedWorld(): {
    readonly target: World;
    readonly provider: ReturnType<typeof vi.fn<PlaceSearchProvider["search"]>>;
    readonly advance: (milliseconds: number) => void;
  } {
    let now = 1_000_000;
    const provider = vi.fn<PlaceSearchProvider["search"]>(
      async () => PHOTON_RESULTS,
    );
    const cached = createCachedPlaceSearch({ search: provider }, () => now);
    const target = world({ search: cached.search });
    return {
      target,
      provider,
      advance: (milliseconds) => {
        now += milliseconds;
      },
    };
  }

  it("responde de la caché la misma búsqueda dentro de los 10 minutos", async () => {
    const { target, provider, advance } = cachedWorld();

    await suggest(target, "princes");
    advance(PLACE_SEARCH_CACHE_TTL_MS - 1);
    const second = await suggest(target, "Princes ");

    expect(provider).toHaveBeenCalledTimes(1);
    expect(namesOf(second.places)).toContain("Princes Park");
  });

  it("vuelve a preguntar a Photon pasados los 10 minutos", async () => {
    const { target, provider, advance } = cachedWorld();

    await suggest(target, "princes");
    advance(PLACE_SEARCH_CACHE_TTL_MS);
    await suggest(target, "princes");

    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("pregunta otra vez por una búsqueda distinta", async () => {
    const { target, provider } = cachedWorld();

    await suggest(target, "princes");
    await suggest(target, "princess");

    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("olvida la búsqueda más vieja al pasar de 500", async () => {
    const { target, provider } = cachedWorld();

    for (let index = 0; index <= 500; index += 1) {
      await suggest(target, `lugar ${index}`);
    }
    provider.mockClear();
    await suggest(target, "lugar 1");
    await suggest(target, "lugar 0");

    expect(provider.mock.calls.map(([query]) => query)).toEqual(["lugar 0"]);
  });

  it("no guarda un fallo: la siguiente vuelve a preguntar", async () => {
    const { target, provider } = cachedWorld();
    provider.mockRejectedValueOnce(new Error("Photon respondió 502"));

    const first = await suggest(target, "princes");
    const second = await suggest(target, "princes");

    expect(first.searchAvailable).toBe(false);
    expect(second.searchAvailable).toBe(true);
    expect(provider).toHaveBeenCalledTimes(2);
  });
});
