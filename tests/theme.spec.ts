/**
 * FR-079: the theme choice must survive a reload. The visual baselines in
 * ui.spec.ts only ever photograph the light theme, so persistence needs its
 * own end-to-end check against a real browser and real localStorage.
 *
 * #174: y la paleta tiene que pintarse aunque el script del tema no llegue a
 * correr. Eso sólo se ve en un navegador de verdad: lo que falla es la
 * cascada, con `var(--color-background)` sin valor y la declaración entera
 * descartada. `tests/unit/theme-css.test.ts` vigila la forma de la hoja; esto
 * mide los colores que salen.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { THEME_STORAGE_KEY } from "@/lib/theme";

const APP_URL = process.env.APP_URL ?? "http://localhost:3417";
const SIGN_IN_PATH = "/entrar";

// Valores de design-system.md en la notación que devuelve getComputedStyle.
const LIGHT_BACKGROUND = "rgb(239, 243, 247)"; // --color-background #EFF3F7
const LIGHT_BORDER = "rgb(222, 230, 237)"; // --color-border #DEE6ED
const DARK_BACKGROUND = "rgb(12, 26, 38)"; // --color-background #0C1A26
const DARK_BORDER = "rgb(39, 64, 85)"; // --color-border #274055

// El script del tema es el único <script> en línea que nombra la clave de
// almacenamiento, y su cuerpo no lleva ningún `<`.
const THEME_SCRIPT_PATTERN = new RegExp(
  `<script[^>]*>[^<]*${THEME_STORAGE_KEY}[^<]*</script>`,
);

/**
 * Sirve la pantalla sin el script del tema, que es lo que reportaron en
 * producción con una extensión que bloquea scripts en línea.
 *
 * Simula el efecto, no el mecanismo: una extensión deja el tag en el HTML y le
 * impide ejecutarse, y esto lo quita. Para lo que se mide (la cascada cuando
 * `data-theme` no llega a escribirse) da igual.
 *
 * No hace falta comprobar aquí que el reemplazo encontró algo: cada test
 * empieza exigiendo que `data-theme` no exista, y ese atributo sólo puede
 * faltar si el script no corrió.
 */
async function serveWithoutThemeScript(page: Page): Promise<void> {
  await page.route(`${APP_URL}${SIGN_IN_PATH}`, async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({
      response,
      body: html.replace(THEME_SCRIPT_PATTERN, ""),
    });
  });
}

async function storeThemeChoice(page: Page, theme: string): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [THEME_STORAGE_KEY, theme] as const,
  );
}

function styleOf(target: Locator, property: string): Promise<string> {
  return target.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
}

function emailField(page: Page): Locator {
  return page.getByLabel("Email", { exact: true });
}

test("keeps the chosen theme after a reload", async ({ page }) => {
  await page.goto(APP_URL);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: /tema oscuro|dark theme/i }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.reload();

  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: /tema claro|light theme/i }),
  ).toBeVisible();
});

test.describe("sin el script del tema", () => {
  test("pinta la paleta clara con el sistema en claro", async ({ page }) => {
    await serveWithoutThemeScript(page);
    await page.goto(`${APP_URL}${SIGN_IN_PATH}`);

    const html = page.locator("html");
    await expect(html).not.toHaveAttribute("data-theme");
    expect(await styleOf(page.locator("body"), "background-color")).toBe(
      LIGHT_BACKGROUND,
    );
    expect(await styleOf(emailField(page), "border-top-color")).toBe(
      LIGHT_BORDER,
    );
    expect(await styleOf(html, "color-scheme")).toBe("light");
  });

  test.describe("con el sistema en oscuro", () => {
    test.use({ colorScheme: "dark" });

    test("pinta la paleta oscura", async ({ page }) => {
      await serveWithoutThemeScript(page);
      await page.goto(`${APP_URL}${SIGN_IN_PATH}`);

      const html = page.locator("html");
      await expect(html).not.toHaveAttribute("data-theme");
      expect(await styleOf(page.locator("body"), "background-color")).toBe(
        DARK_BACKGROUND,
      );
      expect(await styleOf(emailField(page), "border-top-color")).toBe(
        DARK_BORDER,
      );
      expect(await styleOf(html, "color-scheme")).toBe("dark");
    });
  });
});

test.describe("la elección guardada manda sobre la del sistema", () => {
  test.describe("tema claro guardado, sistema en oscuro", () => {
    test.use({ colorScheme: "dark" });

    test("pinta la paleta clara", async ({ page }) => {
      await storeThemeChoice(page, "light");
      await page.goto(`${APP_URL}${SIGN_IN_PATH}`);

      const html = page.locator("html");
      await expect(html).toHaveAttribute("data-theme", "light");
      expect(await styleOf(page.locator("body"), "background-color")).toBe(
        LIGHT_BACKGROUND,
      );
      expect(await styleOf(html, "color-scheme")).toBe("light");
    });
  });

  test.describe("tema oscuro guardado, sistema en claro", () => {
    test.use({ colorScheme: "light" });

    test("pinta la paleta oscura", async ({ page }) => {
      await storeThemeChoice(page, "dark");
      await page.goto(`${APP_URL}${SIGN_IN_PATH}`);

      const html = page.locator("html");
      await expect(html).toHaveAttribute("data-theme", "dark");
      expect(await styleOf(page.locator("body"), "background-color")).toBe(
        DARK_BACKGROUND,
      );
      expect(await styleOf(html, "color-scheme")).toBe("dark");
    });
  });
});

test("serves the versioned health endpoint", async ({ request }) => {
  const response = await request.get(`${APP_URL}/api/v1/health`);
  const body = await response.json();

  // 503 without Supabase credentials is the honest answer, not a failure.
  expect([200, 503]).toContain(response.status());
  if (response.status() === 200) {
    expect(body).toMatchObject({
      data: { database: expect.any(String), status: expect.any(String) },
    });
  } else {
    expect(body).toMatchObject({
      error: { code: expect.any(String), message: expect.any(String) },
    });
  }
});
