import { describe, expect, it } from "vitest";
import { buildFileName } from "../../../scripts/mockups/filename.ts";

describe("nombre de archivo", () => {
  it("nombra una pantalla web sin prefijo de plataforma", () => {
    expect(
      buildFileName({ screen: "dashboard", platform: "web" }, "light"),
    ).toBe("dashboard-light.png");
  });

  it("nombra una pantalla móvil con el prefijo mobile-", () => {
    expect(buildFileName({ screen: "home", platform: "mobile" }, "dark")).toBe(
      "mobile-home-dark.png",
    );
  });

  it("distingue web y móvil cuando comparten nombre de pantalla", () => {
    const web = buildFileName({ screen: "calendar", platform: "web" }, "light");
    const mobile = buildFileName(
      { screen: "calendar", platform: "mobile" },
      "light",
    );
    expect(web).not.toBe(mobile);
  });

  it("es estable para la misma entrada", () => {
    const entry = { screen: "news", platform: "web" as const };
    expect(buildFileName(entry, "dark")).toBe(buildFileName(entry, "dark"));
  });

  it("incluye el tema en el nombre", () => {
    const entry = { screen: "payments", platform: "web" as const };
    expect(buildFileName(entry, "light")).not.toBe(
      buildFileName(entry, "dark"),
    );
  });
});
