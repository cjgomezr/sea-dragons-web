import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALE_COOKIE_NAME } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

const incoming = {
  cookies: new Map<string, string>(),
  headers: new Headers(),
};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = incoming.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: async () => incoming.headers,
}));
// La marca sale de la base (#292): la del test es otra que la de Victoria,
// así que un nombre escrito a mano en la pantalla no pasaría.
vi.mock("@/lib/club/supabase-club-brand", () => ({
  readClubBrand: async () => ({ name: "Hobart Orcas", initials: "HO" }),
}));

const { readRequestLocale } = await import("@/lib/i18n/request-locale");
const { default: RootLayout, generateMetadata } = await import("@/app/layout");

async function servedHtmlTag(): Promise<string> {
  const markup = renderToStaticMarkup(await RootLayout({ children: <main /> }));
  const htmlTag = /<html[^>]*>/.exec(markup);
  if (htmlTag === null) {
    throw new Error(`El layout no pintó un <html>: ${markup}`);
  }
  return htmlTag[0];
}

beforeEach(() => {
  incoming.cookies.clear();
  incoming.headers = new Headers();
});

describe("idioma de la petición", () => {
  it("lee la cookie de idioma de la petición", async () => {
    incoming.cookies.set(LOCALE_COOKIE_NAME, "es");
    incoming.headers.set("accept-language", "en-AU");

    expect(await readRequestLocale()).toBe("es");
  });

  it("lee la cabecera accept-language cuando no hay cookie", async () => {
    incoming.headers.set("accept-language", "es-CO,es;q=0.9");

    expect(await readRequestLocale()).toBe("es");
  });

  it("decide inglés en una petición sin ninguna pista", async () => {
    expect(await readRequestLocale()).toBe("en");
  });
});

describe("documento servido", () => {
  it("marca el documento en español cuando la visita es en español", async () => {
    incoming.cookies.set(LOCALE_COOKIE_NAME, "es");

    expect(await servedHtmlTag()).toContain('lang="es"');
  });

  it("marca el documento en inglés cuando la visita es en inglés", async () => {
    incoming.headers.set("accept-language", "en-AU");

    expect(await servedHtmlTag()).toContain('lang="en"');
  });
});

describe("metadatos por idioma", () => {
  it("describe la aplicación en inglés cuando la visita es en inglés", async () => {
    incoming.headers.set("accept-language", "en-AU");

    const metadata = await generateMetadata();

    expect(metadata.description).toBe(
      createTranslator("en")("app.metaDescription"),
    );
    expect(metadata.description).toMatch(/underwater rugby/i);
  });

  it("describe la aplicación en español cuando la visita es en español", async () => {
    incoming.cookies.set(LOCALE_COOKIE_NAME, "es");

    const metadata = await generateMetadata();

    expect(metadata.description).toBe(
      createTranslator("es")("app.metaDescription"),
    );
    expect(metadata.description).toMatch(/rugby subacuático/i);
  });

  it("titula el documento con el nombre del club en los dos idiomas", async () => {
    incoming.cookies.set(LOCALE_COOKIE_NAME, "es");

    expect((await generateMetadata()).title).toBe("Hobart Orcas");
  });
});
