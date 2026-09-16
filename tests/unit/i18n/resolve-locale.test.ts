import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  isLocale,
} from "@/lib/i18n/locale";
import {
  localeFromAcceptLanguage,
  resolveLocale,
} from "@/lib/i18n/resolve-locale";

describe("elegir idioma", () => {
  it("usa el idioma de la cookie aunque el navegador pida otro", () => {
    const locale = resolveLocale({
      cookie: "es",
      acceptLanguage: "en-AU,en;q=0.9",
    });

    expect(locale).toBe("es");
  });

  it("usa la cabecera del navegador cuando no hay cookie", () => {
    const locale = resolveLocale({
      cookie: undefined,
      acceptLanguage: "es-CO,es;q=0.9",
    });

    expect(locale).toBe("es");
  });

  it("cae en inglés cuando no hay cookie ni cabecera", () => {
    const locale = resolveLocale({ cookie: undefined, acceptLanguage: null });

    expect(locale).toBe("en");
  });

  it("tiene el inglés como idioma de respaldo", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("guarda la elección en una cookie con nombre propio del proyecto", () => {
    expect(LOCALE_COOKIE_NAME).toBe("seadragons-locale");
  });
});

describe("cookie inválida", () => {
  it("ignora un valor que no es ningún idioma y decide por la cabecera", () => {
    const locale = resolveLocale({
      cookie: "klingon",
      acceptLanguage: "es",
    });

    expect(locale).toBe("es");
  });

  it("ignora una cookie vacía y cae en inglés sin otra pista", () => {
    const decide = (): string =>
      resolveLocale({ cookie: "", acceptLanguage: null });

    expect(decide).not.toThrow();
    expect(decide()).toBe("en");
  });

  it("no acepta un idioma escrito con otra forma que la del catálogo", () => {
    expect(isLocale("ES")).toBe(false);
    expect(isLocale("es-AR")).toBe(false);
  });
});

describe("cabecera del navegador", () => {
  it("elige el primero de la lista que la aplicación habla", () => {
    expect(localeFromAcceptLanguage("fr-FR,fr;q=0.9,es;q=0.8,en;q=0.7")).toBe(
      "es",
    );
  });

  it("reconoce un idioma por su región, como es-AR", () => {
    expect(localeFromAcceptLanguage("es-AR")).toBe("es");
  });

  it("no distingue mayúsculas en la etiqueta", () => {
    expect(localeFromAcceptLanguage("ES-mx")).toBe("es");
  });

  it("respeta el orden de los pesos: es;q=0.9,en;q=0.8 elige español", () => {
    expect(localeFromAcceptLanguage("es;q=0.9,en;q=0.8")).toBe("es");
  });

  it("ordena por peso aunque la lista no venga ordenada", () => {
    expect(localeFromAcceptLanguage("en;q=0.5, es;q=0.9")).toBe("es");
  });

  it("descarta un idioma con peso cero", () => {
    expect(localeFromAcceptLanguage("es;q=0, en;q=0.1")).toBe("en");
  });

  it("devuelve null cuando la lista no trae ningún idioma conocido", () => {
    expect(localeFromAcceptLanguage("fr-FR,de;q=0.9,*;q=0.1")).toBeNull();
  });

  it("devuelve null para una cabecera vacía", () => {
    expect(localeFromAcceptLanguage("")).toBeNull();
  });

  it("devuelve null para una cabecera ausente", () => {
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });

  it("no lanza con una cabecera mal escrita", () => {
    expect(localeFromAcceptLanguage(";;q=abc,,es;q=")).toBe("es");
  });

  it("cae en inglés cuando el navegador sólo pide idiomas desconocidos", () => {
    const locale = resolveLocale({
      cookie: undefined,
      acceptLanguage: "fr-FR,de;q=0.9",
    });

    expect(locale).toBe("en");
  });
});
