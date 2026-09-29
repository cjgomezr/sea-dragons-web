import { describe, expect, it } from "vitest";
import { nameTeamColor } from "@/lib/teams/team-color-name";

/**
 * El color de un equipo dicho con palabras (#403): el lector de pantalla oye
 * "de color azul", no un `#1C6EA4`, y quien no distingue colores lo lee.
 */

describe("nameTeamColor", () => {
  it("llama azul al Team Kelp por defecto", () => {
    expect(nameTeamColor("#1C6EA4")).toBe("blue");
  });

  it("llama amarillo al Team Tide por defecto", () => {
    expect(nameTeamColor("#C99A3E")).toBe("yellow");
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

  it("lee el hexadecimal en minúsculas igual que en mayúsculas", () => {
    expect(nameTeamColor("#1c6ea4")).toBe("blue");
  });
});
