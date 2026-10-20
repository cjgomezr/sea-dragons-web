import { describe, expect, it } from "vitest";
import { shortTeamName } from "@/lib/teams/team-short-name";

/**
 * El nombre corto de un equipo (#761, D10 del PRD de E28): el que llevan los
 * botones Añadir del banco y las pestañas del móvil.
 */

describe("shortTeamName", () => {
  it('quita "Team " al principio', () => {
    expect(shortTeamName("Team Kelp")).toBe("Kelp");
  });

  it('quita "Equipo " al principio', () => {
    expect(shortTeamName("Equipo Marea")).toBe("Marea");
  });

  it("deja entero el nombre que no empieza por un prefijo", () => {
    expect(shortTeamName("Tiburones")).toBe("Tiburones");
  });

  it("corta con puntos suspensivos el nombre largo", () => {
    expect(shortTeamName("Barracudas del Sur")).toBe("Barracuda…");
  });

  it("corta también lo que queda tras el prefijo si es largo", () => {
    expect(shortTeamName("Team Barracudas del Sur")).toBe("Barracuda…");
  });

  it("deja entero el nombre que justo cabe", () => {
    expect(shortTeamName("Barracudas")).toBe("Barracudas");
  });

  it("no quita el prefijo en medio del nombre", () => {
    expect(shortTeamName("Our Team Kelp")).toBe("Our Team…");
  });
});
