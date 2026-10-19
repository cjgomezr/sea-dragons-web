import { describe, expect, it } from "vitest";
import { messageCatalogs } from "@/lib/i18n/message-catalogs";
import { BIB_SWATCHES, nameTeamColor } from "@/lib/teams/team-color-name";

/**
 * El color de un equipo dicho con palabras (#403): el lector de pantalla oye
 * "de color azul", no un `#1C6EA4`, y quien no distingue colores lo lee.
 */

describe("nameTeamColor", () => {
  it("llama azul al Team Kelp por defecto", () => {
    expect(nameTeamColor("#1C6EA4")).toBe("blue");
  });

  it("llama dorado al Team Tide por defecto", () => {
    expect(nameTeamColor("#C99A3E")).toBe("gold");
  });

  it.each([
    ["#D32F2F", "red"],
    ["#F57C00", "orange"],
    ["#2E7D32", "green"],
    ["#6A1B9A", "purple"],
    ["#E91E63", "pink"],
  ] as const)("llama a %s por su tono: %s", (hex, name) => {
    expect(nameTeamColor(hex)).toBe(name);
  });

  it.each([
    ["#111111", "black"],
    ["#F5F5F5", "white"],
    ["#808080", "grey"],
  ] as const)("llama a %s, sin tono, por su luz: %s", (hex, name) => {
    expect(nameTeamColor(hex)).toBe(name);
  });

  it("llama a #E0B030, dorado pero fuera del muestrario, por su familia", () => {
    expect(nameTeamColor("#E0B030")).toBe("yellow");
  });

  it.each([
    ["#2AA0A0", "blue"],
    ["#334488", "blue"],
  ] as const)(
    "llama a %s, cerca del turquesa o del marino, por su familia: %s",
    (hex, name) => {
      expect(nameTeamColor(hex)).toBe(name);
    },
  );

  it("rechaza lo que no es un #RRGGBB", () => {
    expect(() => nameTeamColor("red")).toThrow("#RRGGBB");
  });

  it("lee el hexadecimal en minúsculas igual que en mayúsculas", () => {
    expect(nameTeamColor("#1c6ea4")).toBe("blue");
  });
});

/**
 * Los doce colores del muestrario tienen nombre propio (#756, D6 del PRD de
 * E28): el dorado se dice "dorado", no "amarillo" ni "naranja".
 */
describe("los doce colores del muestrario", () => {
  const EXPECTED_SWATCHES = [
    ["#D64545", "red"],
    ["#E07B2E", "orange"],
    ["#C99A3E", "gold"],
    ["#E8C547", "yellow"],
    ["#3E9B5F", "green"],
    ["#2A9D9A", "teal"],
    ["#1C6EA4", "blue"],
    ["#2B3F7A", "navy"],
    ["#7A5BC4", "purple"],
    ["#D9669A", "pink"],
    ["#2B2F36", "black"],
    ["#F2F4F6", "white"],
  ] as const;

  it("son los doce del handoff, en su orden", () => {
    expect(BIB_SWATCHES.map(({ hex, name }) => [hex, name])).toEqual(
      EXPECTED_SWATCHES,
    );
  });

  it.each(EXPECTED_SWATCHES)("llama a %s por su nombre: %s", (hex, name) => {
    expect(nameTeamColor(hex)).toBe(name);
  });

  it.each(EXPECTED_SWATCHES)("lee %s en minúsculas igual: %s", (hex, name) => {
    expect(nameTeamColor(hex.toLowerCase())).toBe(name);
  });

  it.each([
    ["gold", "gold", "dorado"],
    ["teal", "teal", "turquesa"],
    ["navy", "navy", "azul marino"],
  ] as const)("traduce %s en los dos idiomas", (name, english, spanish) => {
    const key = `calendar.teams.color.${name}` as const;

    expect(messageCatalogs.en[key]).toBe(english);
    expect(messageCatalogs.es[key]).toBe(spanish);
  });

  it("cada color del muestrario tiene texto en los dos idiomas", () => {
    const keys = BIB_SWATCHES.map(
      ({ name }) => `calendar.teams.color.${name}` as const,
    );

    expect(keys.filter((key) => !messageCatalogs.en[key])).toEqual([]);
    expect(keys.filter((key) => !messageCatalogs.es[key])).toEqual([]);
  });
});
