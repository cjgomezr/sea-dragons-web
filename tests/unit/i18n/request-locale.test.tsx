import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALE_COOKIE_NAME } from "@/lib/i18n/locale";

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

const { readRequestLocale } = await import("@/lib/i18n/request-locale");
const { default: RootLayout } = await import("@/app/layout");

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
