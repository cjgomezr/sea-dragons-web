import { describe, expect, it } from "vitest";
import { localeCookie } from "@/lib/i18n/locale-cookie";
import { otherLocale } from "@/lib/i18n/locale";

const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60;

describe("cookie de idioma", () => {
  it("guarda el idioma elegido bajo el nombre que lee el servidor", () => {
    expect(localeCookie("es")).toMatch(/^seadragons-locale=es;/);
  });

  it("vale para todas las pantallas, no solo para la que la escribió", () => {
    expect(localeCookie("es")).toContain("; Path=/");
  });

  it("sobrevive a cerrar el navegador durante un año", () => {
    expect(localeCookie("en")).toContain(`; Max-Age=${ONE_YEAR_IN_SECONDS}`);
  });

  it("no viaja en peticiones que otros sitios disparen", () => {
    expect(localeCookie("en")).toContain("; SameSite=Lax");
  });
});

describe("el otro idioma", () => {
  it("lleva del inglés al español", () => {
    expect(otherLocale("en")).toBe("es");
  });

  it("lleva del español al inglés", () => {
    expect(otherLocale("es")).toBe("en");
  });
});
