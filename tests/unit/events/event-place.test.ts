import { describe, expect, it } from "vitest";
import { buildMapsUrl } from "@/lib/events/event-place";

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
