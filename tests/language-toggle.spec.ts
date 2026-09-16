/**
 * E17 RF-3: cambiar de idioma. El idioma lo decide el servidor al armar cada
 * pantalla (#183), así que lo que hay que ver en un navegador de verdad es que
 * el interruptor consigue que el servidor la rehaga: el atributo `lang` del
 * documento sólo lo escribe el servidor, y por eso es la prueba de que el
 * cambio no se quedó en el botón.
 *
 * Las pantallas todavía dicen su texto en español en los dos idiomas (lo
 * traducen #185 y #186). Lo que cambia hoy con el idioma es el propio
 * interruptor y el atributo del documento, y eso es lo que se mira.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  E2E_STORAGE_STATE_PATH,
  readE2eSessionState,
} from "./support/e2e-session";

const APP_URL = process.env.APP_URL ?? "http://localhost:3417";
const SIGN_IN_PATH = "/entrar";

// Matches --touch-target-min in globals.css (WCAG 2.5.5).
const TOUCH_TARGET_MIN_PX = 44;
const MOBILE = { width: 375, height: 812 } as const;
const DESKTOP = { width: 1440, height: 900 } as const;

// Lo que tiene delante el interruptor en la cabecera de entrar es el del
// tema; unas cuantas pulsaciones de más cubren cualquier cambio de orden sin
// que el test llegue a los campos del formulario y se dé por bueno.
const MAX_TAB_PRESSES = 6;

// Quien llega sin ninguna pista ve inglés (#183), así que cada test fija el
// navegador en inglés en vez de depender del idioma de la máquina.
test.use({ locale: "en-AU" });

function englishToggle(page: Page): Locator {
  return page.getByRole("button", { name: /switch to español/i });
}

function spanishToggle(page: Page): Locator {
  return page.getByRole("button", { name: /cambiar a english/i });
}

async function expectDocumentLanguage(page: Page, lang: string): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
}

test.describe("interruptor de idioma fuera de la aplicación", () => {
  test("pasa la pantalla de entrar al español sin salir de ella", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${SIGN_IN_PATH}`);
    await expectDocumentLanguage(page, "en");

    await englishToggle(page).click();

    await expect(spanishToggle(page)).toBeVisible();
    await expectDocumentLanguage(page, "es");
    expect(new URL(page.url()).pathname).toBe(SIGN_IN_PATH);
  });

  test("no borra lo que ya estaba escrito en el formulario", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${SIGN_IN_PATH}`);
    const email = page.getByLabel(/correo electrónico/i);
    await email.fill("nerea@example.test");

    await englishToggle(page).click();
    await expect(spanishToggle(page)).toBeVisible();

    await expect(email).toHaveValue("nerea@example.test");
  });

  test("sigue en el idioma elegido al volver más tarde", async ({ page }) => {
    await page.goto(`${APP_URL}${SIGN_IN_PATH}`);
    await englishToggle(page).click();
    await expect(spanishToggle(page)).toBeVisible();

    await page.reload();

    await expectDocumentLanguage(page, "es");
    await expect(spanishToggle(page)).toBeVisible();
  });

  test("se alcanza y se usa con el teclado, con el foco a la vista", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${SIGN_IN_PATH}`);
    const toggle = englishToggle(page);

    for (let press = 0; press < MAX_TAB_PRESSES; press += 1) {
      await page.keyboard.press("Tab");
      if (
        await toggle.evaluate((element) => element === document.activeElement)
      ) {
        break;
      }
    }
    await expect(toggle).toBeFocused();
    const outlineWidth = await toggle.evaluate((element) => {
      const style = getComputedStyle(element);
      return style.outlineStyle === "none" ? 0 : parseFloat(style.outlineWidth);
    });
    expect(
      outlineWidth,
      "el foco del interruptor tiene que verse",
    ).toBeGreaterThan(0);

    await page.keyboard.press("Enter");

    await expectDocumentLanguage(page, "es");
  });

  test("cumple el objetivo táctil de 44px en móvil", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${APP_URL}${SIGN_IN_PATH}`);

    const box = await englishToggle(page).boundingBox();

    expect(box, "el interruptor no tiene caja").not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    expect(box!.height).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
  });
});

const E2E_SESSION = readE2eSessionState();

test.describe("interruptor de idioma dentro de la aplicación", () => {
  test.skip(
    E2E_SESSION.kind === "unavailable",
    E2E_SESSION.kind === "unavailable"
      ? `sin sesión de prueba: ${E2E_SESSION.reason}`
      : "",
  );

  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  test("con sesión, la pantalla siguiente también sale en el idioma nuevo", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${APP_URL}/dashboard`);
    await expectDocumentLanguage(page, "en");

    await englishToggle(page).click();
    await expectDocumentLanguage(page, "es");
    await page
      .getByRole("navigation", { name: "Principal" })
      .getByRole("link", { name: "Calendario" })
      .click();

    await expect(page).toHaveURL(/\/calendario$/);
    await expectDocumentLanguage(page, "es");
    await expect(spanishToggle(page)).toBeVisible();
  });

  test("cumple el objetivo táctil de 44px en móvil", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${APP_URL}/dashboard`);

    const box = await englishToggle(page).boundingBox();

    expect(box, "el interruptor no tiene caja").not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    expect(box!.height).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
  });
});
