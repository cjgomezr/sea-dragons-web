/**
 * E17 RF-2: el idioma de cada visita se decide en el servidor. Estos tests
 * leen el HTML tal cual sale, sin ejecutar nada en el navegador: si el
 * atributo `lang` ya viene bien ahí, no hay forma de que la primera carga
 * pinte un idioma y luego otro.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { LOCALE_COOKIE_NAME } from "@/lib/i18n/locale";

// Pública: responde igual con sesión y sin ella.
const SIGN_IN_PATH = "/entrar";

async function servedLang(
  request: APIRequestContext,
  headers: Record<string, string>,
): Promise<string | undefined> {
  const response = await request.get(SIGN_IN_PATH, { headers });
  expect(response.ok()).toBe(true);
  const html = await response.text();
  return /<html[^>]*\slang="([^"]*)"/.exec(html)?.[1];
}

test.describe("idioma de la página servida", () => {
  test("sale en español con la cookie de idioma en español", async ({
    request,
  }) => {
    const lang = await servedLang(request, {
      cookie: `${LOCALE_COOKIE_NAME}=es`,
      "accept-language": "en-AU,en;q=0.9",
    });

    expect(lang).toBe("es");
  });

  test("sale en español sin cookie y con el navegador en español", async ({
    request,
  }) => {
    const lang = await servedLang(request, {
      "accept-language": "es-CO,es;q=0.9",
    });

    expect(lang).toBe("es");
  });

  test("sale en inglés sin cookie y con un idioma que no se habla", async ({
    request,
  }) => {
    const lang = await servedLang(request, { "accept-language": "fr-FR" });

    expect(lang).toBe("en");
  });

  test("no sirve una copia cacheada de otro idioma", async ({ request }) => {
    const spanish = await servedLang(request, { "accept-language": "es" });
    const english = await servedLang(request, { "accept-language": "en" });

    expect([spanish, english]).toEqual(["es", "en"]);
  });
});
