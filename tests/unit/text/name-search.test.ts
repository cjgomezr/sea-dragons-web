import { describe, expect, it } from "vitest";
import { matchesNameSearch } from "@/lib/text/name-search";

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
