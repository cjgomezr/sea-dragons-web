import { describe, expect, it } from "vitest";
import { findMissingFiles } from "../../../scripts/mockups/verify.ts";

describe("verificación de la exportación", () => {
  it("no reporta nada cuando todos los archivos esperados existen", () => {
    const expected = ["dashboard-light.png", "dashboard-dark.png"];
    expect(findMissingFiles(expected, expected)).toEqual([]);
  });

  it("reporta cuál archivo falta en lugar de pasar en silencio", () => {
    const expected = [
      "dashboard-light.png",
      "dashboard-dark.png",
      "calendar-light.png",
    ];
    const existing = ["dashboard-light.png", "calendar-light.png"];
    expect(findMissingFiles(expected, existing)).toEqual([
      "dashboard-dark.png",
    ]);
  });

  it("reporta varios archivos faltantes preservando el orden del catálogo", () => {
    const expected = ["a.png", "b.png", "c.png"];
    expect(findMissingFiles(expected, [])).toEqual(["a.png", "b.png", "c.png"]);
  });

  it("ignora archivos existentes que no pertenecen al catálogo esperado", () => {
    const expected = ["dashboard-light.png"];
    const existing = ["dashboard-light.png", "huerfano-de-otra-corrida.png"];
    expect(findMissingFiles(expected, existing)).toEqual([]);
  });
});
