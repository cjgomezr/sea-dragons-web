import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  isKnownCountryCode,
  listCountryOptions,
} from "@/lib/geo/countries";

describe("países", () => {
  it("reconoce un código ISO 3166-1 alfa-2 real", () => {
    expect(isKnownCountryCode("AU")).toBe(true);
  });

  it("acepta el código en minúsculas, porque un cliente puede mandarlo así", () => {
    expect(isKnownCountryCode("au")).toBe(true);
  });

  it("rechaza un código inventado", () => {
    expect(isKnownCountryCode("ZZ")).toBe(false);
  });

  it("rechaza la cadena vacía", () => {
    expect(isKnownCountryCode("")).toBe(false);
  });

  it("no repite ningún código", () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
  });

  it("nombra cada país en el idioma pedido", () => {
    const options = listCountryOptions("es");
    const australia = options.find((option) => option.code === "AU");

    expect(australia?.name).toBe("Australia");
  });

  it("ordena las opciones alfabéticamente por nombre", () => {
    const names = listCountryOptions("es").map((option) => option.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, "es"));

    expect(names).toEqual(sorted);
  });

  it("entrega una opción por código conocido", () => {
    expect(listCountryOptions("es")).toHaveLength(COUNTRY_CODES.length);
  });
});
