import { describe, expect, it } from "vitest";
import { isSameName, matchesNameSearch } from "@/lib/text/name-search";

describe("buscar por nombre", () => {
  it("encuentra un nombre con tilde escribiéndolo sin ella", () => {
    expect(matchesNameSearch("María Ñíguez", "maria")).toBe(true);
  });

  it("no distingue mayúsculas", () => {
    expect(matchesNameSearch("Zoe Zapata", "ZAPA")).toBe(true);
  });

  it("no encuentra lo que el nombre no contiene", () => {
    expect(matchesNameSearch("Zoe Zapata", "ruiz")).toBe(false);
  });
});

describe("comparar dos nombres", () => {
  it("da por iguales los que sólo cambian en mayúsculas, tildes y bordes", () => {
    expect(isSameName("Señor Squad", " senor SQUAD ")).toBe(true);
  });

  it("no da por igual un nombre que sólo contiene al otro", () => {
    expect(isSameName("Senior Squad", "Senior")).toBe(false);
  });
});
