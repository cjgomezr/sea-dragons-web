import { describe, expect, it } from "vitest";
import {
  buildMapEmbedUrl,
  buildMapsUrl,
  mapBoundsAround,
} from "@/lib/events/event-place";

/**
 * El enlace al mapa de un evento (#645, RF-4 del PRD de E24): con
 * coordenadas va al punto exacto; sin ellas, busca el nombre y la dirección
 * o, en lo anterior a E24, el texto libre.
 */

const SEARCH_URL = "https://www.google.com/maps/search/?api=1&query=";

describe("buildMapsUrl", () => {
  it("apunta a las coordenadas cuando el lugar las tiene", () => {
    const url = buildMapsUrl({
      location: "MSAC",
      place: {
        name: "MSAC",
        address: "Aughtie Dr, Albert Park VIC 3206",
        lat: -37.8423,
        lng: 144.9601,
      },
    });

    expect(url).toBe(`${SEARCH_URL}-37.8423,144.9601`);
  });

  it("busca el nombre y la dirección cuando el lugar no tiene coordenadas", () => {
    const url = buildMapsUrl({
      location: "MSAC",
      place: {
        name: "MSAC",
        address: "Aughtie Dr, Albert Park",
        lat: null,
        lng: null,
      },
    });

    expect(url).toBe(
      `${SEARCH_URL}${encodeURIComponent("MSAC, Aughtie Dr, Albert Park")}`,
    );
  });

  it("busca sólo el nombre cuando el lugar no tiene dirección ni coordenadas", () => {
    const url = buildMapsUrl({
      location: "MSAC",
      place: { name: "MSAC", address: null, lat: null, lng: null },
    });

    expect(url).toBe(`${SEARCH_URL}MSAC`);
  });

  it("busca el texto libre cuando el evento no tiene lugar elegido", () => {
    const url = buildMapsUrl({ location: "Piscina de Box Hill", place: null });

    expect(url).toBe(`${SEARCH_URL}Piscina%20de%20Box%20Hill`);
  });

  it("codifica &, # y las tildes para que no rompan la búsqueda", () => {
    const url = buildMapsUrl({
      location: "Bar & Café #2, Peñalolén",
      place: null,
    });

    expect(url).toBe(
      `${SEARCH_URL}Bar%20%26%20Caf%C3%A9%20%232%2C%20Pe%C3%B1alol%C3%A9n`,
    );
  });
});

describe("mapBoundsAround", () => {
  it("encierra el punto en una caja más ancha que alta, centrada en él", () => {
    const bounds = mapBoundsAround({ lat: -37.8676, lng: 144.9741 });

    expect(bounds).toEqual({
      west: 144.9676,
      south: -37.8694,
      east: 144.9806,
      north: -37.8658,
    });
  });

  it("no se sale del mundo cerca de un polo ni del antimeridiano", () => {
    const bounds = mapBoundsAround({ lat: 89.9995, lng: -179.999 });

    expect(bounds).toEqual({
      west: -180,
      south: 89.9977,
      east: -179.9925,
      north: 90,
    });
  });
});

describe("buildMapEmbedUrl", () => {
  it("apunta al mapa embebido de OpenStreetMap con la caja y el marcador", () => {
    const url = buildMapEmbedUrl({ lat: -37.8676, lng: 144.9741 });

    expect(url).toBe(
      "https://www.openstreetmap.org/export/embed.html" +
        "?bbox=144.9676%2C-37.8694%2C144.9806%2C-37.8658" +
        "&layer=mapnik&marker=-37.8676%2C144.9741",
    );
  });
});
