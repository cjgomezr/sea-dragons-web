import { describe, expect, it, vi } from "vitest";
import {
  PLACE_ADDRESS_MAX_LENGTH,
  PLACE_NAME_MAX_LENGTH,
} from "@/lib/events/event-place";
import {
  MELBOURNE_BIAS,
  PHOTON_API_URL,
  PLACE_SEARCH_USER_AGENT,
  createPhotonPlaceSearch,
  toSearchedPlace,
} from "@/lib/events/photon-place-search";

/**
 * Photon desde nuestro servidor (#646, D1 del PRD de E24): a qué dirección
 * va, qué manda y cómo se traduce su GeoJSON a un lugar.
 */

type PhotonProperties = Record<string, string>;

function feature(
  properties: PhotonProperties,
  coordinates: readonly [number, number] = [144.9601, -37.8423],
): unknown {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates },
    properties: { countrycode: "AU", ...properties },
  };
}

function photonResponse(features: readonly unknown[]): Response {
  return new Response(JSON.stringify({ type: "FeatureCollection", features }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fetchReturning(response: Response) {
  return vi.fn<typeof fetch>(async () => response);
}

function requestedUrl(fetchDouble: ReturnType<typeof fetchReturning>): URL {
  const [input] = fetchDouble.mock.calls[0] ?? [];
  return new URL(String(input));
}

function requestedInit(
  fetchDouble: ReturnType<typeof fetchReturning>,
): RequestInit {
  const [, init] = fetchDouble.mock.calls[0] ?? [];
  return init ?? {};
}

const SIGNAL = new AbortController().signal;

describe("toSearchedPlace", () => {
  it("toma el nombre, arma la dirección y da la vuelta a las coordenadas", () => {
    const place = toSearchedPlace(
      feature({
        name: "Melbourne Sports and Aquatic Centre",
        housenumber: "30",
        street: "Aughtie Drive",
        city: "Melbourne",
        state: "Victoria",
        postcode: "3206",
      }),
    );

    expect(place).toEqual({
      name: "Melbourne Sports and Aquatic Centre",
      address: "30 Aughtie Drive, Melbourne, Victoria 3206",
      lat: -37.8423,
      lng: 144.9601,
    });
  });

  it("arma la dirección sin número", () => {
    const place = toSearchedPlace(
      feature({
        name: "Princes Park",
        street: "Royal Parade",
        city: "Carlton",
      }),
    );

    expect(place?.address).toBe("Royal Parade, Carlton");
  });

  it("usa el barrio cuando no hay ciudad", () => {
    const place = toSearchedPlace(
      feature({
        name: "Fitzroy Pool",
        street: "Alexandra Parade",
        district: "Fitzroy",
      }),
    );

    expect(place?.address).toBe("Alexandra Parade, Fitzroy");
  });

  it("deja la dirección vacía sin calle, ciudad, estado ni código", () => {
    const place = toSearchedPlace(feature({ name: "Albert Park Lake" }));

    expect(place).toMatchObject({ name: "Albert Park Lake", address: null });
  });

  it("nombra por la calle a una dirección sin nombre, sin repetirla", () => {
    const place = toSearchedPlace(
      feature({
        housenumber: "12",
        street: "Smith Street",
        city: "Collingwood",
      }),
    );

    expect(place).toMatchObject({
      name: "12 Smith Street",
      address: "Collingwood",
    });
  });

  it("descarta un resultado sin nombre ni calle", () => {
    expect(toSearchedPlace(feature({ city: "Melbourne" }))).toBeNull();
  });

  it("recorta el nombre y la dirección a lo que admite un evento", () => {
    const place = toSearchedPlace(
      feature({
        name: "N".repeat(PLACE_NAME_MAX_LENGTH + 10),
        street: "S".repeat(PLACE_ADDRESS_MAX_LENGTH + 10),
      }),
    );

    expect(place?.name).toHaveLength(PLACE_NAME_MAX_LENGTH);
    expect(place?.address).toHaveLength(PLACE_ADDRESS_MAX_LENGTH);
  });
});

describe("createPhotonPlaceSearch", () => {
  it("pregunta a Photon con el texto, sesgado a Melbourne", async () => {
    const fetchDouble = fetchReturning(photonResponse([]));

    await createPhotonPlaceSearch(fetchDouble).search("princes park", SIGNAL);

    const url = requestedUrl(fetchDouble);
    expect(`${url.origin}${url.pathname}`).toBe(PHOTON_API_URL);
    expect(url.searchParams.get("q")).toBe("princes park");
    expect(url.searchParams.get("lat")).toBe(String(MELBOURNE_BIAS.lat));
    expect(url.searchParams.get("lon")).toBe(String(MELBOURNE_BIAS.lon));
  });

  it("se identifica con un User-Agent de la aplicación y no manda nada del usuario", async () => {
    const fetchDouble = fetchReturning(photonResponse([]));

    await createPhotonPlaceSearch(fetchDouble).search("princes", SIGNAL);

    const init = requestedInit(fetchDouble);
    expect(init.headers).toEqual({ "User-Agent": PLACE_SEARCH_USER_AGENT });
    expect(PLACE_SEARCH_USER_AGENT).toMatch(/Seadragons/);
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.signal).toBe(SIGNAL);
    expect([...requestedUrl(fetchDouble).searchParams.keys()].sort()).toEqual([
      "lang",
      "lat",
      "limit",
      "lon",
      "q",
    ]);
  });

  it("deja sólo los resultados de Australia", async () => {
    const fetchDouble = fetchReturning(
      photonResponse([
        feature({ name: "Princes Park", countrycode: "AU" }),
        feature({ name: "Princes Street Gardens", countrycode: "GB" }),
        feature({ name: "Princes Wharf", countrycode: "NZ" }),
      ]),
    );

    const places = await createPhotonPlaceSearch(fetchDouble).search(
      "princes",
      SIGNAL,
    );

    expect(places.map((place) => place.name)).toEqual(["Princes Park"]);
  });

  it("descarta los resultados que no se pueden nombrar", async () => {
    const fetchDouble = fetchReturning(
      photonResponse([
        feature({ city: "Melbourne" }),
        feature({ name: "MSAC" }),
      ]),
    );

    const places = await createPhotonPlaceSearch(fetchDouble).search(
      "msac",
      SIGNAL,
    );

    expect(places.map((place) => place.name)).toEqual(["MSAC"]);
  });

  it("salta un resultado sin la forma de GeoJSON y se queda con los demás", async () => {
    const fetchDouble = fetchReturning(
      photonResponse([
        {
          geometry: { coordinates: "roto" },
          properties: { countrycode: "AU" },
        },
        feature({ name: "MSAC" }),
      ]),
    );

    const places = await createPhotonPlaceSearch(fetchDouble).search(
      "msac",
      SIGNAL,
    );

    expect(places.map((place) => place.name)).toEqual(["MSAC"]);
  });

  it("falla con el código cuando Photon responde un error", async () => {
    const fetchDouble = fetchReturning(new Response("", { status: 502 }));

    await expect(
      createPhotonPlaceSearch(fetchDouble).search("princes", SIGNAL),
    ).rejects.toThrow(/502/);
  });

  it("falla cuando Photon responde algo que no es GeoJSON", async () => {
    const fetchDouble = fetchReturning(
      new Response(JSON.stringify({ hola: 1 }), { status: 200 }),
    );

    await expect(
      createPhotonPlaceSearch(fetchDouble).search("princes", SIGNAL),
    ).rejects.toThrow();
  });
});
