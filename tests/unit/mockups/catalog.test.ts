import { describe, expect, it } from "vitest";
import { MOCKUP_SCREENS, THEMES } from "../../../scripts/mockups/catalog.ts";

describe("catálogo de pantallas", () => {
  it("contiene las catorce combinaciones de pantalla y plataforma esperadas", () => {
    expect(MOCKUP_SCREENS).toHaveLength(14);
  });

  it("incluye las nueve pantallas web del ticket", () => {
    const webScreens = MOCKUP_SCREENS.filter(
      (entry) => entry.platform === "web",
    ).map((entry) => entry.screen);
    expect(webScreens).toEqual([
      "dashboard",
      "directory",
      "calendar",
      "attendance",
      "team",
      "evaluations",
      "news",
      "payments",
      "auth",
    ]);
  });

  it("incluye las cinco pantallas móviles que expone el prototipo", () => {
    const mobileScreens = MOCKUP_SCREENS.filter(
      (entry) => entry.platform === "mobile",
    ).map((entry) => entry.screen);
    expect(mobileScreens).toEqual([
      "home",
      "calendar",
      "team",
      "news",
      "profile",
    ]);
  });

  it("no repite ninguna combinación de pantalla y plataforma", () => {
    const keys = MOCKUP_SCREENS.map(
      (entry) => `${entry.platform}:${entry.screen}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("define claro y oscuro como los únicos temas a exportar", () => {
    expect(THEMES).toEqual(["light", "dark"]);
  });
});
