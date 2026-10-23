/**
 * Visual regression + accessibility gate.
 *
 * - toHaveScreenshot() compares pixel-by-pixel against an approved baseline.
 *   Only the Linux baseline (tests/ui.spec.ts-snapshots/*-linux.png) is
 *   versioned and binding. On Linux (e.g. the factory worker), generate or
 *   update it the usual way: npx playwright test --update-snapshots, then
 *   commit the PNG like any other file. On every PR,
 *   .github/workflows/visual-baselines.yml (issue #58) only COMPARES: it
 *   never regenerates, commits or pushes, so a red check always lands on the
 *   PR's real HEAD and the diff is left as the visual-diff artifact for a
 *   person to look at. Accepting a new baseline is a separate, deliberate
 *   act: a human runs that workflow by hand against the PR's branch. The
 *   baseline still only ever comes from one place, which is what stops two
 *   UI PRs in parallel from fighting over the same binary file.
 *
 * - On any other platform (Windows, macOS) there is no versioned baseline:
 *   *-win32.png is gitignored. The first local run creates one and every
 *   run after that compares against it, but it's local and nobody reviewed
 *   it, so it's informative only, not what decides whether a PR passes. The
 *   command says so itself (see tests/support/visual-baseline-notice.ts,
 *   wired as globalSetup in playwright.config.ts). That first run does NOT
 *   fail for the snapshots it had to create (issue #96): it names each one
 *   and carries on. A snapshot that already exists and differs still fails.
 *
 * - AxeBuilder runs automated accessibility checks (contrast, labels, etc.).
 *   Requires: npm i -D @axe-core/playwright
 *
 * - REQUIRED in playwright.config.ts: a `webServer` block with
 *   `reuseExistingServer` off by default, so the suite boots its own dev
 *   server and never adopts one that belongs to another project answering on
 *   the same port. The Stop hook runs `npx playwright test` standalone;
 *   without webServer every test dies with ERR_CONNECTION_REFUSED and blocks
 *   the session for a reason unrelated to the code.
 */
import {
  test,
  expect,
  type Locator,
  type Page,
  type PageScreenshotOptions,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  E2E_STORAGE_STATE_PATH,
  GROUPED_MEMBER_GROUP_NAMES,
  GROUPED_MEMBER_STORAGE_STATE_PATH,
  PAST_DUE_MEMBER_STORAGE_STATE_PATH,
  PHOTOGRAPHED_MEMBERS,
  PROFILE_PHOTO_FIXTURE_PATH,
  UNPAID_MEMBER_STORAGE_STATE_PATH,
  incompleteStorageStatePath,
  readE2eSessionState,
  roleRequestStorageStatePath,
  seededMemberName,
} from "./support/e2e-session";
import { HOME_NOW, fixClockOnHome } from "./support/home-clock";
import { shouldCreateMissingSnapshot } from "./support/missing-snapshot-policy";
// Los presupuestos de píxeles y la tolerancia de color que los acompaña
// (#77, #606). La tolerancia la aplica playwright.config.ts.
import {
  COMPONENT_MAX_DIFF_PIXELS,
  PAGE_MAX_DIFF_PIXELS,
} from "./support/screenshot-tolerance";
import { isStatePhotographed } from "./support/spanish-captures";
import { snapshotCreatedNotice } from "./support/visual-baseline-notice";
import { waitForHydration } from "./support/wait-for-hydration";
import { waitForSectionsLoaded } from "./support/wait-for-sections";
import { servesCompiledApp } from "./support/web-server-command";
import {
  type AccentPalette,
  contrastRatio,
  evaluateAccentColor,
} from "@/lib/club/accent-color";
import { memberInitials } from "@/lib/auth/member-initials";
import { buildAccentStylesheet } from "@/lib/club/accent-stylesheet";
import type { ClubSettingsSection } from "@/lib/club/club-settings-sections";
import { shrinkProfilePhoto } from "@/lib/members/shrink-profile-photo";
import {
  shrinkNewsCover,
  shrinkNewsInlineImage,
} from "@/lib/news/shrink-news-cover";
import { LOCALE_COOKIE_NAME, type Locale, isLocale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

// Con qué condiciones se toma cada captura, sembrada o comparada. Hoy
// coinciden con los valores por defecto de toHaveScreenshot, pero se pasan a
// mano y a los dos lados a propósito: la captura sembrada la compara la
// propia corrida un instante después, así que si un día Playwright cambiara
// un default, la semilla y la comparación dejarían de salir de las mismas
// condiciones y la primera corrida volvería a fallar, esta vez disfrazada de
// regresión visual. Compartir la constante quita esa posibilidad.
const SCREENSHOT_OPTIONS = {
  animations: "disabled",
  caret: "hide",
  scale: "css",
} as const;

/**
 * Escribe la captura local que falte, ANTES de compararla.
 *
 * Fuera de Linux no hay línea base versionada, así que la primera corrida de
 * un checkout limpio no tiene con qué comparar. Playwright escribe la captura
 * que falta y aun así hunde el test (con `updateSnapshots: 'missing'`, que es
 * su valor por defecto, devuelve un `softError`): 16 capturas recién creadas
 * se leían como 16 regresiones visuales, y el remedio, correr Playwright dos
 * veces, no estaba escrito en ninguna parte (issue #96).
 *
 * El matcher corre igual, siempre. En la corrida que siembra compara contra la
 * foto recién tomada, así que ahí sólo puede fallar si la página no estaba
 * quieta; de la siguiente en adelante compara de verdad. Una captura que ya
 * existe no se toca, ni aquí ni en Linux.
 *
 * De lo que depende que la semilla sea buena: `toHaveScreenshot` reintenta
 * hasta que dos capturas seguidas coinciden, y esto toma una sola. Que valga
 * se apoya en que las animaciones van desactivadas y en que `goToWithTheme`
 * ya esperó a `document.fonts.ready`. Quien meta una entrada animada en la
 * página tendrá que mirar aquí antes de preguntarse por qué la primera
 * corrida se puso caprichosa.
 */
async function createMissingLocalBaseline(
  name: string,
  capture: () => Promise<Buffer>,
): Promise<void> {
  const expectedPath = test.info().snapshotPath(name, { kind: "screenshot" });
  if (
    !shouldCreateMissingSnapshot(process.platform, existsSync(expectedPath))
  ) {
    return;
  }
  await mkdir(path.dirname(expectedPath), { recursive: true });
  await writeFile(expectedPath, await capture());
  console.log(snapshotCreatedNotice(name));
}

// Filled by /bootstrap with this project's own port. Never hardcode 3000:
// every factory on the machine would fight over it and test each other's app.
const APP_URL = process.env.APP_URL ?? "http://localhost:3417";

const viewports = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

const themes = ["light", "dark"] as const;

// El dev server dibuja su propia burbuja de errores en una esquina, dentro de
// <nextjs-portal>, y aparece unos milisegundos después de la carga: la captura
// que siembra una línea base local salía sin ella y la comparación de un
// instante después, con ella. No forma parte del producto y no está en ninguna
// línea base aprobada, así que se oculta antes de capturar. Donde no se dibuja
// (que es donde se aprueban las líneas base) esto no cambia un solo píxel.
const HIDE_DEV_OVERLAY_CSS = "nextjs-portal { display: none !important; }";

/* El menú de la cuenta (#287): dentro de la aplicación el tema, el idioma, Mi
   perfil y cerrar sesión viven ahí, detrás del botón de la cuenta. */
const ACCOUNT_BUTTON_NAME = /^(My account|Mi cuenta)$/;
const BACK_BUTTON_NAME = /^(Back|Volver)$/;

/** El botón dice "Mi cuenta"; la pantalla que abre se titula "Cuenta" (#716). */
const ACCOUNT_MENU_NAME = /^(Account|Cuenta)$/;

function accountMenu(page: Page): Locator {
  return page.getByRole("region", { name: ACCOUNT_MENU_NAME });
}

async function openAccountMenu(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: ACCOUNT_BUTTON_NAME }).click();
  await expect(accountMenu(page)).toBeVisible();
  return accountMenu(page);
}

/** Cierra con el ratón, como quien lo usa: en el móvil con la flecha, que es
 * lo único que se ve, y en escritorio con el propio botón de la cuenta. Con
 * Escape el foco volvería pintando su anillo en todas las capturas. */
async function closeAccountMenu(page: Page): Promise<void> {
  const back = accountMenu(page).getByRole("button", {
    name: BACK_BUTTON_NAME,
  });
  const closer = (await back.isVisible())
    ? back
    : page.getByRole("button", { name: ACCOUNT_BUTTON_NAME });
  await closer.click();
  await expect(accountMenu(page)).toHaveCount(0);
  await page.mouse.move(0, 0);
}

/** Fuera de la aplicación el interruptor está a la vista; dentro, en el menú
 * de la cuenta (desde #716 un radio de Apariencia), que se cierra después
 * para que la captura no lo lleve. */
async function chooseDarkTheme(page: Page): Promise<void> {
  const isInsideApp =
    (await page.getByRole("button", { name: ACCOUNT_BUTTON_NAME }).count()) > 0;
  if (!isInsideApp) {
    await page.getByRole("button", { name: /tema oscuro|dark theme/i }).click();
    return;
  }
  const menu = await openAccountMenu(page);
  await menu.getByRole("radio", { name: /^(Dark|Oscuro)$/ }).click();
  await closeAccountMenu(page);
}

async function goToWithTheme(
  page: import("@playwright/test").Page,
  path: string,
  theme: (typeof themes)[number],
): Promise<void> {
  // El saludo del inicio sale de la hora: sin fijarla, la captura dependía
  // de a qué hora corría la visual (#561).
  await fixClockOnHome(page, path);
  await page.goto(`${APP_URL}${path}`);
  await page.addStyleTag({ content: HIDE_DEV_OVERLAY_CSS });
  if (theme === "dark") {
    await chooseDarkTheme(page);
  }
  // networkidle nunca llega mientras el dev server compila bajo carga paralela.
  // Lo que de verdad mueve píxeles son las fuentes, y toHaveScreenshot ya
  // reintenta hasta que la página deja de cambiar.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

type Screen = { readonly name: string; readonly path: string };

/** La visita elige español con la cookie, igual que tras usar el interruptor.
 * El navegador de la suite pide inglés (playwright.config.ts). */
async function chooseSpanish(page: Page): Promise<void> {
  await page
    .context()
    .addCookies([{ name: LOCALE_COOKIE_NAME, value: "es", url: APP_URL }]);
}

/** E17: axe pasa también por cada pantalla de cuentas en español. Los textos
 * cambian de largo y el documento cambia de `lang`, y ninguna de las dos cosas
 * la ve la pasada en inglés. */
async function expectNoAxeViolationsInSpanish(
  page: Page,
  screenPath: string,
): Promise<void> {
  await chooseSpanish(page);
  await page.goto(`${APP_URL}${screenPath}`);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2),
  ).toEqual([]);
}

// Las pantallas de este archivo que se alcanzan sin sesión. Las dos viven en
// el grupo de rutas (auth), con panel de marca propio y sin la cáscara de
// menú. La entrada es desde #135 la puerta de toda la aplicación, y el mockup
// que la describe es docs/mockups/auth-light.png.
const PUBLIC_PAGES: readonly Screen[] = [
  { name: "entrar", path: "/entrar" },
  { name: "registro", path: "/registro" },
];

function describeScreen(pg: Screen): void {
  for (const vp of viewports) {
    test.describe(`${pg.name} @ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const theme of themes) {
        test(`matches approved baseline (${theme})`, async ({ page }) => {
          await goToWithTheme(page, pg.path, theme);
          const name = `${pg.name}-${vp.name}-${theme}.png`;
          await createMissingLocalBaseline(name, () =>
            page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
          );
          await expect(page).toHaveScreenshot(name, {
            ...SCREENSHOT_OPTIONS,
            fullPage: true,
            maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
          });
        });
      }

      test("has no horizontal scroll", async ({ page }) => {
        await page.goto(`${APP_URL}${pg.path}`);
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        );
        expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
      });
    });
  }

  test(`${pg.name}: has no accessibility violations (axe-core)`, async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${pg.path}`);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations,
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);
  });

  // ASS-004: 360px is the narrowest viewport the shell must support.
  test(`${pg.name}: has no horizontal scroll at 360px (ASS-004 minimum)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`${APP_URL}${pg.path}`);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow, "horizontal overflow at 360px").toBe(false);
  });
}

for (const pg of PUBLIC_PAGES) {
  describeScreen(pg);
}

// Aire alrededor de los interruptores en su captura, el mismo --space-2 que
// los separa: sin él un borde recortado por medio píxel parecería regresión.
const TOGGLES_CORNER_PADDING_PX = 8;

type Clip = NonNullable<PageScreenshotOptions["clip"]>;

/**
 * La esquina donde conviven el tema y el idioma (E17 RF-3), recortada de la
 * página. En la cabecera de autenticación esos dos botones no tienen un
 * contenedor propio que encuadrar, así que se recorta la caja que los cubre a
 * ambos, y lo mismo en la cáscara para que las dos capturas se lean igual.
 */
async function togglesCornerClip(page: Page): Promise<Clip> {
  const boxes = await Promise.all([
    page.getByRole("button", { name: /tema|theme/i }).boundingBox(),
    page.getByRole("button", { name: /idioma|language/i }).boundingBox(),
  ]);
  const [theme, language] = boxes;
  if (theme === null || language === null) {
    throw new Error("los interruptores de tema e idioma no tienen caja");
  }
  const left = Math.min(theme.x, language.x) - TOGGLES_CORNER_PADDING_PX;
  const top = Math.min(theme.y, language.y) - TOGGLES_CORNER_PADDING_PX;
  const right =
    Math.max(theme.x + theme.width, language.x + language.width) +
    TOGGLES_CORNER_PADDING_PX;
  const bottom =
    Math.max(theme.y + theme.height, language.y + language.height) +
    TOGGLES_CORNER_PADDING_PX;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Sólo en la cabecera de autenticación: dentro de la aplicación el tema y
 * el idioma son controles del menú de la cuenta (#716), con sus capturas. */
function describeTogglesCorner(pg: Screen): void {
  for (const vp of viewports) {
    test.describe(`interruptores-${pg.name} @ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const theme of themes) {
        test(`matches approved baseline (${theme})`, async ({ page }) => {
          await goToWithTheme(page, pg.path, theme);
          const clip = await togglesCornerClip(page);
          const name = `interruptores-${pg.name}-${vp.name}-${theme}.png`;
          await createMissingLocalBaseline(name, () =>
            page.screenshot({ ...SCREENSHOT_OPTIONS, clip }),
          );
          await expect(page).toHaveScreenshot(name, {
            ...SCREENSHOT_OPTIONS,
            clip,
            maxDiffPixels: COMPONENT_MAX_DIFF_PIXELS,
          });
        });
      }
    });
  }
}

describeTogglesCorner({ name: "entrar", path: "/entrar" });

/* ---------------------------------------------------------------------------
   Recuperación de contraseña (#136). Sin mockup propio: se revisa contra el
   lenguaje de docs/mockups/auth-light.png. Las respuestas de los endpoints se
   sustituyen por dobles, así que la suite no emite enlaces de verdad ni gasta
   el límite de peticiones de nadie.
   --------------------------------------------------------------------------- */

const PASSWORD_RECOVERY_PATH = "/recuperar-contrasena";
const PASSWORD_RESET_PATH = "/recuperar-contrasena/nueva";
const PASSWORD_RECOVERY_ENDPOINT = "**/api/v1/auth/password-recovery";
const PASSWORD_RESET_ENDPOINT = "**/api/v1/auth/password-reset";
const RECOVERY_STUB_EMAIL = "nerea@example.test";
// Abrir la pantalla no canjea nada, así que un token inventado basta para
// dibujar el formulario.
const STUB_RESET_PATH = `${PASSWORD_RESET_PATH}?token_hash=enlace-de-prueba`;

// Las tres que se alcanzan por URL. La cuarta, la confirmación del envío, sólo
// sale enviando el formulario y va aparte.
const PASSWORD_RECOVERY_SCREENS: readonly Screen[] = [
  { name: "recuperar-contrasena", path: PASSWORD_RECOVERY_PATH },
  { name: "recuperar-contrasena-nueva", path: STUB_RESET_PATH },
  // Sin token, que para quien lo abre es lo mismo que caducado o ya usado.
  { name: "recuperar-contrasena-enlace-no-sirve", path: PASSWORD_RESET_PATH },
];

for (const pg of PASSWORD_RECOVERY_SCREENS) {
  describeScreen(pg);
}

/* ---------------------------------------------------------------------------
   Confirmar el correo con un botón (#477). Abrir el enlace no canjea nada, así
   que un token inventado basta para dibujar la pantalla.
   --------------------------------------------------------------------------- */

const EMAIL_CONFIRMATION_SCREEN: Screen = {
  name: "confirmar-correo",
  path: "/auth/confirmar?token_hash=enlace-de-prueba&type=signup",
};

describeScreen(EMAIL_CONFIRMATION_SCREEN);

// El POST del botón exige el mismo origen. Este recorrido es el que prueba que
// el navegador de verdad lo manda: con el token inventado, Supabase lo
// rechaza y la pantalla es la de enlace inválido, no un 403.
test("confirmar-correo: el botón canjea el enlace y lleva a su desenlace", async ({
  page,
}) => {
  await page.goto(`${APP_URL}${EMAIL_CONFIRMATION_SCREEN.path}`);

  await page.getByRole("button", { name: "Confirm my email" }).click();

  await expect(page).toHaveURL(/\/registro\?confirmacion=invalida$/);
  await expect(
    page.getByRole("heading", { name: "This link no longer works" }),
  ).toBeVisible();
});

// Las pantallas de cuentas que se alcanzan sin sesión, más el desenlace del
// enlace de confirmación, que es el panel con más texto.
for (const pg of [
  ...PUBLIC_PAGES,
  ...PASSWORD_RECOVERY_SCREENS,
  EMAIL_CONFIRMATION_SCREEN,
  { name: "registro-enlace-invalido", path: "/registro?confirmacion=invalida" },
]) {
  test(`${pg.name} en español: has no accessibility violations (axe-core)`, async ({
    page,
  }) => {
    await expectNoAxeViolationsInSpanish(page, pg.path);
  });
}

async function goToRecoveryRequested(
  page: import("@playwright/test").Page,
  theme: (typeof themes)[number],
): Promise<void> {
  await page.route(PASSWORD_RECOVERY_ENDPOINT, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { outcome: "recovery_requested", email: RECOVERY_STUB_EMAIL },
      }),
    }),
  );
  await goToWithTheme(page, PASSWORD_RECOVERY_PATH, theme);

  await page.getByLabel("Email").fill(RECOVERY_STUB_EMAIL);
  await page.getByRole("button", { name: "Send link" }).click();

  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
}

for (const vp of viewports) {
  test.describe(`recuperar-contrasena-enviado @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const theme of themes) {
      test(`matches approved baseline (${theme})`, async ({ page }) => {
        await goToRecoveryRequested(page, theme);
        const name = `recuperar-contrasena-enviado-${vp.name}-${theme}.png`;
        await createMissingLocalBaseline(name, () =>
          page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
        );
        await expect(page).toHaveScreenshot(name, {
          ...SCREENSHOT_OPTIONS,
          fullPage: true,
          maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
        });
      });
    }
  });
}

test("recuperar-contrasena-enviado: has no accessibility violations (axe-core)", async ({
  page,
}) => {
  await goToRecoveryRequested(page, "light");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2),
  ).toEqual([]);
});

test("el ¿Olvidaste tu contraseña? de la entrada lleva a pedir el enlace", async ({
  page,
}) => {
  await page.goto(`${APP_URL}/entrar`);

  await page.getByRole("link", { name: "Forgot your password?" }).click();

  await expect(
    page.getByRole("heading", { name: "Reset your password" }),
  ).toBeVisible();
});

test("un enlace ya usado o caducado ofrece pedir otro", async ({ page }) => {
  await page.route(PASSWORD_RESET_ENDPOINT, (route) =>
    route.fulfill({
      status: 410,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "gone",
          message: "Este enlace ya no sirve: caducó o ya se usó.",
        },
      }),
    }),
  );
  await page.goto(`${APP_URL}${STUB_RESET_PATH}`);

  await page.getByLabel("New password").fill("bajoelagua-nueva");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(
    page.getByRole("heading", { name: "This link no longer works" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Ask for another link" }).click();

  await expect(
    page.getByRole("heading", { name: "Reset your password" }),
  ).toBeVisible();
});

// El texto de un enlace con aspecto de botón tiene que distinguirse de su
// relleno. Axe no lo marcó la vez que ".auth-form a" lo pintó del mismo color.
test("el botón Pedir otro enlace deja leer su texto", async ({ page }) => {
  await page.goto(`${APP_URL}${PASSWORD_RESET_PATH}`);
  const link = page.getByRole("link", { name: "Ask for another link" });

  const { color, background } = await link.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });

  expect(color).not.toBe(background);
});

test("la contraseña nueva de 7 caracteres no llega al servidor", async ({
  page,
}) => {
  let calls = 0;
  await page.route(PASSWORD_RESET_ENDPOINT, (route) => {
    calls += 1;
    return route.fulfill({ status: 200, body: "{}" });
  });
  await page.goto(`${APP_URL}${STUB_RESET_PATH}`);

  await page.getByLabel("New password").fill("1234567");
  await page.getByRole("button", { name: "Save password" }).click();

  // Next inserta su propio elemento con role="alert" (el anunciador de ruta),
  // vacío, así que el aviso se busca por su texto.
  await expect(
    page.getByRole("alert").filter({ hasText: /characters/ }),
  ).toContainText("8");
  expect(calls).toBe(0);
});

test("la pantalla de contraseña nueva no cuenta su token en el Referer", async ({
  page,
}) => {
  await page.goto(`${APP_URL}${STUB_RESET_PATH}`);

  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
    "content",
    "no-referrer",
  );
});

/* ---------------------------------------------------------------------------
   La frontera de sesión vista desde un navegador de verdad (#135), sin
   credenciales de por medio: un visitante anónimo no las necesita.
   --------------------------------------------------------------------------- */

const SIGN_IN_PATH = "/entrar";
const SESSION_ENDPOINT = "/api/v1/auth/session";

test("una pantalla de la aplicación pedida sin sesión aterriza en la entrada", async ({
  page,
}) => {
  await page.goto(`${APP_URL}/calendario`);

  await expect(page).toHaveURL(new RegExp(`${SIGN_IN_PATH}$`));
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
});

test("un endpoint de la API pedido sin sesión responde 401", async ({
  request,
}) => {
  const response = await request.get(`${APP_URL}/api/v1/evaluaciones`);

  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({
    error: { code: "unauthenticated" },
  });
});

// El monitoreo lo consulta cada 5 minutos desde fuera y sin autenticarse. Su
// código depende de si el entorno tiene base de datos, así que lo que se fija
// es que la frontera no lo cierre.
test("el endpoint de salud sigue siendo público", async ({ request }) => {
  const response = await request.get(`${APP_URL}/api/v1/health`);

  expect(response.status()).not.toBe(401);
});

// #421: la pestaña, los marcadores y el acceso directo del móvil enseñan la
// marca del club. El navegador pide el icono y el manifest sin sesión, así
// que se piden con un contexto sin cookies.
test("la pantalla de entrada declara los iconos del club y se sirven sin sesión", async ({
  page,
  request,
}) => {
  await page.goto("/entrar");

  const iconLinks = page.locator('head link[rel="icon"]');
  await expect(iconLinks).toHaveCount(2);
  await expect(page.locator('head link[rel="apple-touch-icon"]')).toHaveCount(
    1,
  );
  const hrefs = [
    ...(await iconLinks.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href") ?? ""),
    )),
    (await page
      .locator('head link[rel="apple-touch-icon"]')
      .getAttribute("href")) ?? "",
  ];
  for (const href of hrefs) {
    const response = await request.get(new URL(href, APP_URL).toString());
    expect(response.status(), href).toBe(200);
    expect(response.headers()["content-type"], href).toBe("image/png");
    expect(response.headers()["cache-control"], href).toBe(
      "public, max-age=86400",
    );
  }
});

test("la página declara un manifest con el nombre del club, servido sin sesión", async ({
  page,
  request,
}) => {
  await page.goto("/entrar");

  const href = await page
    .locator('head link[rel="manifest"]')
    .getAttribute("href");
  const response = await request.get(new URL(href ?? "", APP_URL).toString());

  expect(response.status()).toBe(200);
  const manifest = (await response.json()) as {
    name?: string;
    icons?: { src: string; sizes: string }[];
  };
  expect(manifest.name).toBeTruthy();
  expect(manifest.icons?.[0]?.sizes).toBe("512x512");
  const icon = await request.get(
    new URL(manifest.icons?.[0]?.src ?? "", APP_URL).toString(),
  );
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toBe("image/png");
});

/** La pantalla de entrada con el error de credenciales. La respuesta del
 * endpoint se sustituye por un doble: comprobar el mensaje no necesita hablar
 * con Supabase, y así este caso corre también donde no hay credenciales. */
async function goToSignInWithError(
  page: import("@playwright/test").Page,
  theme: (typeof themes)[number],
): Promise<void> {
  await page.route(`**${SESSION_ENDPOINT}`, (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "unauthenticated",
          message: "El correo o la contraseña no coinciden.",
        },
      }),
    }),
  );
  await goToWithTheme(page, SIGN_IN_PATH, theme);

  await page.getByLabel("Email").fill("nerea@example.test");
  await page.getByLabel("Password").fill("no-es-esta");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(
    page.getByRole("alert").filter({ hasText: /incorrect/ }),
  ).toBeVisible();
}

for (const vp of viewports) {
  test.describe(`entrar-error @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const theme of themes) {
      test(`matches approved baseline (${theme})`, async ({ page }) => {
        await goToSignInWithError(page, theme);
        const name = `entrar-error-${vp.name}-${theme}.png`;
        await createMissingLocalBaseline(name, () =>
          page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
        );
        await expect(page).toHaveScreenshot(name, {
          ...SCREENSHOT_OPTIONS,
          fullPage: true,
          maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
        });
      });
    }
  });
}

test("entrar-error: has no accessibility violations (axe-core)", async ({
  page,
}) => {
  await goToSignInWithError(page, "light");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2),
  ).toEqual([]);
});

test("el formulario no manda nada al servidor con los campos vacíos", async ({
  page,
}) => {
  let calls = 0;
  await page.route(`**${SESSION_ENDPOINT}`, (route) => {
    calls += 1;
    return route.fulfill({ status: 200, body: "{}" });
  });
  await page.goto(`${APP_URL}${SIGN_IN_PATH}`);

  await page.getByRole("button", { name: "Sign in" }).click();

  // Next inserta su propio elemento con role="alert" (el anunciador de ruta),
  // vacío, así que el aviso se busca por su texto.
  await expect(
    page.getByRole("alert").filter({ hasText: /Enter your email/ }),
  ).toBeVisible();
  expect(calls).toBe(0);
});

/* ---------------------------------------------------------------------------
   Todo lo que hay de aquí abajo vive detrás de la frontera de sesión (#135):
   sin sesión, el servidor redirige a la pantalla de entrada y no hay cáscara
   que mirar. Cada test entra antes, con el socio que el arranque global creó
   en `seadragons-dev`.

   Sin credenciales de Supabase (un runner de CI sin secretos) no hay forma de
   abrir una sesión de verdad, y estos tests se saltan diciendo qué falta. No
   se sustituye por una sesión de mentira: una puerta falsa en los tests vale
   menos que no probar la puerta.
   --------------------------------------------------------------------------- */

const E2E_SESSION = readE2eSessionState();

// Con el sufijo de esta corrida (#254): otra suite a la vez siembra los
// mismos papeles, y un nombre fijo encontraría también sus filas.
const ADMINISTRATION_ADMIN_NAME = seededMemberName(
  E2E_SESSION,
  "admin-de-administracion",
);
const DECIDABLE_MEMBER_NAME = seededMemberName(
  E2E_SESSION,
  "socio-para-decidir",
);
const DEACTIVATED_MEMBER_NAME = seededMemberName(
  E2E_SESSION,
  "socio-para-dar-de-baja",
);

test.describe("dentro de la aplicación", () => {
  test.skip(
    E2E_SESSION.kind === "unavailable",
    E2E_SESSION.kind === "unavailable"
      ? `sin sesión de prueba: ${E2E_SESSION.reason}`
      : "",
  );

  // Las cookies de la única sesión que abrió el arranque global. Abrir una por
  // test agotaba la cuarentena de intentos de Supabase Auth a mitad de la
  // corrida, y ese límite es el que el ticket dice que no se reimplementa.
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  const DESKTOP = { width: 1440, height: 900 } as const;
  const MOBILE = { width: 375, height: 812 } as const;
  // ASS-004: the narrowest viewport the shell must support.
  const MOBILE_MIN_WIDTH = { width: 360, height: 800 } as const;

  // Matches --touch-target-min in globals.css (WCAG 2.5.5).
  const TOUCH_TARGET_MIN_PX = 44;

  // A single-line label's rendered height sits within rounding distance of the
  // element's line-height; a wrapped one is close to double. #85: the platform
  // font that resolves at runtime decides this, not a screenshot a human
  // happens to look at, so this measures geometry instead of pixels.
  const SINGLE_LINE_HEIGHT_TOLERANCE = 1.5;

  async function getTabLabelLineMetrics(
    page: import("@playwright/test").Page,
  ): Promise<Array<{ label: string; height: number; lineHeight: number }>> {
    return page.evaluate(() => {
      const tabs = document.querySelectorAll<HTMLElement>(
        ".app-tabbar-tabs a, .app-tabbar-tabs button",
      );
      return Array.from(tabs).map((tab) => {
        const lineHeight = parseFloat(getComputedStyle(tab).lineHeight);
        const labelNode = Array.from(tab.childNodes).find(
          (node) =>
            node.nodeType === Node.TEXT_NODE &&
            (node.textContent ?? "").trim().length > 0,
        );
        if (!labelNode) {
          return { label: "", height: 0, lineHeight };
        }
        const range = document.createRange();
        range.selectNodeContents(labelNode);
        return {
          label: (labelNode.textContent ?? "").trim(),
          height: range.getBoundingClientRect().height,
          lineHeight,
        };
      });
    });
  }

  // Naming the offending tab is the whole point: the first version of this
  // check reported only "28.39 is not <= 21.6", which says a label wrapped but
  // not which one, and the fonts that wrap it only exist on the CI machine.
  function expectEverySingleLine(
    metrics: Array<{ label: string; height: number; lineHeight: number }>,
  ): void {
    expect(metrics.length).toBeGreaterThan(0);
    const wrapped = metrics.filter(
      ({ height, lineHeight }) =>
        height > lineHeight * SINGLE_LINE_HEIGHT_TOLERANCE,
    );
    expect(
      wrapped.map(
        ({ label, height, lineHeight }) =>
          `${label} (${height}px, línea ${lineHeight}px)`,
      ),
      "estas etiquetas ocupan más de una línea",
    ).toEqual([]);
  }

  // The shell renders both navs and lets CSS pick one, so every assertion is
  // scoped to the nav that the viewport actually shows. E17 RF-5: each nav is
  // named in the visit's language, and the checks that a translation can break
  // (a label that wraps, a lost touch target, the active mark) run in both.
  type ShellLanguage = {
    readonly locale: Locale;
    readonly sidebarNav: string;
    readonly tabBar: string;
    readonly more: string;
    readonly overflowSection: string;
    readonly calendarInSidebar: string;
    readonly calendarInTabBar: string;
  };

  const ENGLISH_SHELL: ShellLanguage = {
    locale: "en",
    sidebarNav: "Main",
    tabBar: "Sections",
    more: "More",
    overflowSection: "Payments",
    calendarInSidebar: "Calendar",
    calendarInTabBar: "Events",
  };

  const SHELL_LANGUAGES: readonly ShellLanguage[] = [
    ENGLISH_SHELL,
    {
      locale: "es",
      sidebarNav: "Principal",
      tabBar: "Secciones",
      more: "Más",
      overflowSection: "Pagos",
      calendarInSidebar: "Calendario",
      // "Agenda" en móvil, "Calendario" en el sidebar: el test del sidebar fija
      // esa otra mitad, así que acortar la etiqueta móvil no puede colarse en
      // ambas.
      calendarInTabBar: "Agenda",
    },
  ];

  const SIDEBAR_NAV = ENGLISH_SHELL.sidebarNav;
  const TAB_BAR = ENGLISH_SHELL.tabBar;

  /** Abre la pantalla con el idioma puesto en la cookie, como tras usar el
   * interruptor, en vez de fiarse de lo que pide el navegador de la suite. */
  async function goToIn(
    page: Page,
    language: ShellLanguage,
    screenPath: string,
  ): Promise<void> {
    await page
      .context()
      .addCookies([
        { name: LOCALE_COOKIE_NAME, value: language.locale, url: APP_URL },
      ]);
    await page.goto(`${APP_URL}${screenPath}`);
    await expect(page.locator("html")).toHaveAttribute("lang", language.locale);
  }

  // The tab bar and the sidebar are thin strips next to a much larger content
  // area: a component screenshot only frames "the component, not the page"
  // if its box stays well under these fractions of the viewport it lives in.
  const MAX_TAB_BAR_HEIGHT_RATIO = 0.2;
  const MAX_SIDEBAR_WIDTH_RATIO = 0.3;

  // A correct tab bar inside a broken layout must still be caught: the full
  // page capture has to cover far more surface than the component capture
  // alone, or the two checks would be redundant instead of additive.
  const MIN_PAGE_TO_COMPONENT_AREA_RATIO = 5;

  // #77: una captura fullPage reparte el cambio de un componente pequeño
  // entre miles de píxeles de página, así que cabe holgadamente bajo
  // cualquier presupuesto pensado para la página entera. Encuadrar el propio
  // componente hace que un cambio en él ocupe la mayor parte de los píxeles
  // comparados, en vez de perderse en el conjunto. Esto se suma a las capturas
  // de página de arriba, no las sustituye.
  for (const theme of themes) {
    test(`mobile tab bar matches approved baseline (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize(MOBILE);
      await goToWithTheme(page, "/dashboard", theme);
      // La captura de la barra se lleva una fila de píxeles de lo que hay
      // detrás, y con el inicio a medio cargar ahí están sus bloques de
      // espera: la fila de arriba cambiaba de una corrida a otra (#806,
      // #810). Se captura con el inicio ya pintado.
      await expect(page.locator(".section-loading-block")).toHaveCount(0);
      const name = `tabbar-mobile-${theme}.png`;
      const tabBar = page.getByRole("navigation", { name: TAB_BAR });
      await createMissingLocalBaseline(name, () =>
        tabBar.screenshot(SCREENSHOT_OPTIONS),
      );
      await expect(tabBar).toHaveScreenshot(name, {
        ...SCREENSHOT_OPTIONS,
        maxDiffPixels: COMPONENT_MAX_DIFF_PIXELS,
      });
    });

    test(`desktop nav matches approved baseline (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize(DESKTOP);
      await goToWithTheme(page, "/dashboard", theme);
      const name = `nav-desktop-${theme}.png`;
      const sidebar = page.getByRole("navigation", { name: SIDEBAR_NAV });
      await createMissingLocalBaseline(name, () =>
        sidebar.screenshot(SCREENSHOT_OPTIONS),
      );
      await expect(sidebar).toHaveScreenshot(name, {
        ...SCREENSHOT_OPTIONS,
        maxDiffPixels: COMPONENT_MAX_DIFF_PIXELS,
      });
    });
  }

  test("the mobile tab bar component screenshot frames the component, not the page", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${APP_URL}/dashboard`);

    const box = await page
      .getByRole("navigation", { name: TAB_BAR })
      .boundingBox();

    expect(box, "the tab bar has no layout box").not.toBeNull();
    expect(box!.height).toBeLessThan(MOBILE.height * MAX_TAB_BAR_HEIGHT_RATIO);
  });

  test("the desktop nav component screenshot frames the component, not the page", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${APP_URL}/dashboard`);

    const box = await page
      .getByRole("navigation", { name: SIDEBAR_NAV })
      .boundingBox();

    expect(box, "the sidebar nav has no layout box").not.toBeNull();
    expect(box!.width).toBeLessThan(DESKTOP.width * MAX_SIDEBAR_WIDTH_RATIO);
  });

  test("the page screenshot still covers far more area than the tab bar component alone", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${APP_URL}/dashboard`);

    const tabBarBox = await page
      .getByRole("navigation", { name: TAB_BAR })
      .boundingBox();
    const pageHeight = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );

    expect(tabBarBox, "the tab bar has no layout box").not.toBeNull();
    const pageArea = MOBILE.width * pageHeight;
    const componentArea = tabBarBox!.width * tabBarBox!.height;
    expect(pageArea).toBeGreaterThan(
      componentArea * MIN_PAGE_TO_COMPONENT_AREA_RATIO,
    );
  });

  test("desktop shows the sidebar nav and not the tab bar", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${APP_URL}/dashboard`);
    await expect(
      page.getByRole("navigation", { name: SIDEBAR_NAV }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: TAB_BAR })).toBeHidden();
  });

  test("mobile pins the tab bar to the bottom edge of the viewport", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${APP_URL}/dashboard`);

    const tabBar = page.getByRole("navigation", { name: TAB_BAR });
    await expect(tabBar).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: SIDEBAR_NAV }),
    ).toBeHidden();

    const box = await tabBar.boundingBox();
    expect(box, "the tab bar has no layout box").not.toBeNull();
    // Anchored to the bottom: its lower edge sits on the fold, not below it.
    expect(box!.y + box!.height).toBeCloseTo(MOBILE.height, 0);
  });

  // #703: Chrome en el iPhone deja la barra a media altura al esconder la
  // suya; Chromium de escritorio ya la pega al fondo, así que aquí no se
  // desplaza ni reserva hueco de raya de inicio. El fallo real sólo se ve en
  // un iPhone, y eso lo comprueba una persona en la vista previa.
  test("mobile leaves the tab bar untouched where it already sits on the fold", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${APP_URL}/dashboard`);
    const tabBar = page.getByRole("navigation", { name: TAB_BAR });
    await expect(tabBar).toBeVisible();

    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );

    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      /viewport-fit=cover/,
    );
    const style = await tabBar.evaluate((bar) => ({
      transform: bar.style.transform,
      paddingBottom: getComputedStyle(bar).paddingBottom,
    }));
    expect(style).toEqual({ transform: "", paddingBottom: "0px" });
  });

  test("mobile tabs keep the 44px touch target after adding icons", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${APP_URL}/dashboard`);
    const tabBar = page.getByRole("navigation", { name: TAB_BAR });

    const tabs = await tabBar.getByRole("link").all();
    const moreButton = tabBar.getByRole("button", { name: ENGLISH_SHELL.more });

    for (const tab of [...tabs, moreButton]) {
      const box = await tab.boundingBox();
      expect(box, "tab has no layout box").not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    }
  });

  // #85: "Dashboard" wrapped to two lines only on the fonts Linux resolves,
  // invisible on Windows at the same 375px width. Measuring the label's own
  // rendered height against its line-height catches that regardless of which
  // platform's font happens to be installed on the machine running the test.
  for (const language of SHELL_LANGUAGES) {
    test(`marks the active section in the sidebar nav (${language.locale})`, async ({
      page,
    }) => {
      await page.setViewportSize(DESKTOP);
      await goToIn(page, language, "/calendario");
      const current = page
        .getByRole("navigation", { name: language.sidebarNav })
        .locator('[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText(language.calendarInSidebar);
    });

    test(`marks the active section in the mobile tab bar (${language.locale})`, async ({
      page,
    }) => {
      await page.setViewportSize(MOBILE);
      await goToIn(page, language, "/calendario");
      const current = page
        .getByRole("navigation", { name: language.tabBar })
        .locator('[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText(language.calendarInTabBar);
    });

    test(`mobile keeps the overflow sections behind the More tab (${language.locale})`, async ({
      page,
    }) => {
      await page.setViewportSize(MOBILE);
      await goToIn(page, language, "/dashboard");
      const tabBar = page.getByRole("navigation", { name: language.tabBar });
      const overflowLink = tabBar.getByRole("link", {
        name: language.overflowSection,
      });

      await expect(overflowLink).toBeHidden();
      await tabBar.getByRole("button", { name: language.more }).click();
      await expect(overflowLink).toBeVisible();
    });

    // #577: the bar lives in the layout, so nothing unmounts the menu when
    // the page underneath changes.
    test(`mobile closes the More menu after picking one of its sections (${language.locale})`, async ({
      page,
    }) => {
      await page.setViewportSize(MOBILE);
      await goToIn(page, language, "/dashboard");
      const tabBar = page.getByRole("navigation", { name: language.tabBar });
      await tabBar.getByRole("button", { name: language.more }).click();

      await tabBar
        .getByRole("link", { name: language.overflowSection })
        .click();

      await expect(page).toHaveURL(/\/pagos$/);
      await expect(page.locator("#app-tabbar-overflow")).toBeHidden();
    });

    test.describe("on a touch screen", () => {
      test.use({ hasTouch: true });

      // useDismissal listens for mousedown: a tap has to fire it too.
      test(`mobile closes the More menu with a tap outside the bar (${language.locale})`, async ({
        page,
      }) => {
        await page.setViewportSize(MOBILE);
        await goToIn(page, language, "/dashboard");
        const tabBar = page.getByRole("navigation", {
          name: language.tabBar,
        });
        await tabBar.getByRole("button", { name: language.more }).tap();
        const menu = page.locator("#app-tabbar-overflow");
        await expect(menu).toBeVisible();

        await page.getByRole("heading", { level: 1 }).tap();

        await expect(menu).toBeHidden();
        await expect(page).toHaveURL(/\/dashboard$/);
      });
    });

    test(`mobile tabs keep the 44px touch target at 360px (ASS-004 minimum, ${language.locale})`, async ({
      page,
    }) => {
      await page.setViewportSize(MOBILE_MIN_WIDTH);
      await goToIn(page, language, "/dashboard");
      const tabBar = page.getByRole("navigation", { name: language.tabBar });

      const tabs = await tabBar.getByRole("link").all();
      const moreButton = tabBar.getByRole("button", { name: language.more });

      for (const tab of [...tabs, moreButton]) {
        const box = await tab.boundingBox();
        expect(box, "tab has no layout box").not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
      }
    });

    test(`no mobile tab label wraps to a second line at 375px (${language.locale})`, async ({
      page,
    }) => {
      await page.setViewportSize(MOBILE);
      await goToIn(page, language, "/dashboard");

      expectEverySingleLine(await getTabLabelLineMetrics(page));
    });

    test(`no mobile tab label wraps to a second line at 360px (ASS-004 minimum, ${language.locale})`, async ({
      page,
    }) => {
      await page.setViewportSize(MOBILE_MIN_WIDTH);
      await goToIn(page, language, "/dashboard");

      expectEverySingleLine(await getTabLabelLineMetrics(page));
    });
  }

  test("mobile never hides content behind the fixed tab bar", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${APP_URL}/dashboard`);

    const barBox = await page
      .getByRole("navigation", { name: TAB_BAR })
      .boundingBox();
    expect(barBox, "the tab bar has no layout box").not.toBeNull();

    const mainPaddingBottom = await page.evaluate(() => {
      const main = document.querySelector("main");
      return main ? parseFloat(getComputedStyle(main).paddingBottom) : null;
    });

    expect(mainPaddingBottom).not.toBeNull();
    expect(
      mainPaddingBottom!,
      "the main area must reserve room for the fixed bar",
    ).toBeGreaterThanOrEqual(barBox!.height);
  });

  test("keyboard focus follows the visual order and stays visible", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${APP_URL}/dashboard`);

    // El socio compartido es Player: su menú no lleva Equipos, Evaluaciones
    // ni Administración (#213).
    const expectedOrder = [
      "Dashboard",
      "Directory",
      "Calendar",
      "News",
      "Payments",
    ];

    const reachedByTabbing: string[] = [];
    const outlineWidths: number[] = [];
    // The extra presses cover what precedes the nav: the notification bell
    // (#266) and the account button (#287). The rest lives in its menu.
    const headerControlCount = 2;
    for (
      let press = 0;
      press < expectedOrder.length + headerControlCount;
      press += 1
    ) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const element = document.activeElement;
        if (!(element instanceof HTMLElement)) return null;
        const style = getComputedStyle(element);
        return {
          label: element.textContent?.trim() ?? "",
          isNavLink: element.closest("nav") !== null && element.tagName === "A",
          outlineWidth:
            style.outlineStyle === "none" ? 0 : parseFloat(style.outlineWidth),
        };
      });
      if (focused?.isNavLink && expectedOrder.includes(focused.label)) {
        reachedByTabbing.push(focused.label);
        outlineWidths.push(focused.outlineWidth);
      }
    }

    expect(reachedByTabbing).toEqual(expectedOrder);
    expect(
      Math.min(...outlineWidths),
      "every nav link must paint a focus outline",
    ).toBeGreaterThan(0);
  });

  // El test de salto de línea solo falla donde la fuente es lo bastante ancha
  // para partir la etiqueta, que en el #85 resultó ser únicamente Linux: en
  // Windows "Dashboard" cabía por un pelo y el defecto era invisible. Este mide
  // el margen que le queda a cada etiqueta dentro de su pestaña, así que una
  // etiqueta al límite falla en la máquina de quien la escribe, no tres horas
  // después en CI.
  // De dónde sale el 0.85: a 360px cada pestaña deja 64px útiles. Medido en
  // Windows, "Calendario" ocupaba 56.8px (89%) y aun así se partía en Linux, lo
  // que sitúa la brecha entre fuentes en al menos 1.13x. No hay cota superior
  // medida, así que el umbral no se puede derivar del todo: 0.85 deja fuera a
  // las etiquetas que ya rozan el límite en la máquina del autor, y el test de
  // salto de línea sigue cubriendo lo que se escape. Si CI lo hace saltar por
  // una etiqueta que NO se parte, el número está flojo y toca medir en Linux,
  // no subirlo.
  const MAX_LABEL_WIDTH_RATIO = 0.85;

  for (const language of SHELL_LANGUAGES) {
    test(`every mobile tab label keeps room to spare inside its tab at 360px (${language.locale})`, async ({
      page,
    }) => {
      await page.setViewportSize(MOBILE_MIN_WIDTH);
      await goToIn(page, language, "/dashboard");

      const usage = await page.evaluate(() => {
        const tabs = document.querySelectorAll<HTMLElement>(
          ".app-tabbar-tabs a, .app-tabbar-tabs button",
        );
        return Array.from(tabs).map((tab) => {
          const style = getComputedStyle(tab);
          const usable =
            tab.getBoundingClientRect().width -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight);
          const labelNode = Array.from(tab.childNodes).find(
            (node) =>
              node.nodeType === Node.TEXT_NODE &&
              (node.textContent ?? "").trim().length > 0,
          );
          if (!labelNode) {
            return { label: "", ratio: 0 };
          }
          const range = document.createRange();
          range.selectNodeContents(labelNode);
          return {
            label: (labelNode.textContent ?? "").trim(),
            ratio: range.getBoundingClientRect().width / usable,
          };
        });
      });

      expect(usage.length).toBeGreaterThan(0);
      const tooWide = usage.filter(
        ({ ratio }) => ratio > MAX_LABEL_WIDTH_RATIO,
      );
      expect(
        tooWide.map(
          ({ label, ratio }) => `${label} (${Math.round(ratio * 100)}%)`,
        ),
        `estas etiquetas pasan del ${MAX_LABEL_WIDTH_RATIO * 100}% de su pestaña y se partirán con una fuente algo más ancha`,
      ).toEqual([]);
    });
  }

  /* -------------------------------------------------------------------------
     La navegación por rol (#213). El socio compartido es Player, que es
     también con quien se toman las capturas de arriba; el Admin es el que
     siembra el arranque para la bandeja del directorio. Committee ve lo
     mismo que Player y Coach lo mismo que Admin: los unitarios cubren los
     cuatro, aquí se fotografían los dos extremos. Desde #240 ninguno ve
     Administración, que vive dentro del directorio.
     ------------------------------------------------------------------------- */
  test.describe("navegación por rol", () => {
    const ROLE_SESSIONS = [
      { name: "player", storageState: E2E_STORAGE_STATE_PATH },
      {
        name: "admin",
        storageState: roleRequestStorageStatePath("admin-de-administracion"),
      },
    ] as const;

    const TAB_BAR_WIDTHS = [MOBILE_MIN_WIDTH, MOBILE] as const;

    async function goToDashboardIn(
      page: Page,
      language: ShellLanguage,
      theme: (typeof themes)[number],
    ): Promise<void> {
      await page
        .context()
        .addCookies([
          { name: LOCALE_COOKIE_NAME, value: language.locale, url: APP_URL },
        ]);
      await goToWithTheme(page, "/dashboard", theme);
      await expect(page.locator("html")).toHaveAttribute(
        "lang",
        language.locale,
      );
      // La barra del móvil se recorta sobre el inicio, que asoma por su borde
      // de arriba: sin esperar a que cargue, esa franja cambiaba de una
      // corrida a otra (#561).
      await waitForSectionsLoaded(page, []);
    }

    async function openMore(
      page: Page,
      language: ShellLanguage,
    ): Promise<void> {
      await page
        .getByRole("navigation", { name: language.tabBar })
        .getByRole("button", { name: language.more })
        .click();
    }

    for (const session of ROLE_SESSIONS) {
      test.describe(session.name, () => {
        test.use({ storageState: session.storageState });

        for (const language of SHELL_LANGUAGES) {
          for (const theme of themes) {
            test(`sidebar nav matches approved baseline (${language.locale}, ${theme})`, async ({
              page,
            }) => {
              await page.setViewportSize(DESKTOP);
              await goToDashboardIn(page, language, theme);
              const name = `nav-${session.name}-desktop-${language.locale}-${theme}.png`;
              const sidebar = page.getByRole("navigation", {
                name: language.sidebarNav,
              });
              await createMissingLocalBaseline(name, () =>
                sidebar.screenshot(SCREENSHOT_OPTIONS),
              );
              await expect(sidebar).toHaveScreenshot(name, {
                ...SCREENSHOT_OPTIONS,
                maxDiffPixels: COMPONENT_MAX_DIFF_PIXELS,
              });
            });

            for (const viewport of TAB_BAR_WIDTHS) {
              test(`tab bar with More open matches approved baseline (${viewport.width}px, ${language.locale}, ${theme})`, async ({
                page,
              }) => {
                await page.setViewportSize(viewport);
                await goToDashboardIn(page, language, theme);
                await openMore(page, language);
                const name = `tabbar-${session.name}-mas-${viewport.width}-${language.locale}-${theme}.png`;
                const tabBar = page.getByRole("navigation", {
                  name: language.tabBar,
                });
                await createMissingLocalBaseline(name, () =>
                  tabBar.screenshot(SCREENSHOT_OPTIONS),
                );
                await expect(tabBar).toHaveScreenshot(name, {
                  ...SCREENSHOT_OPTIONS,
                  maxDiffPixels: COMPONENT_MAX_DIFF_PIXELS,
                });
              });
            }
          }

          test(`no tab label wraps to a second line at 360px (${language.locale})`, async ({
            page,
          }) => {
            await page.setViewportSize(MOBILE_MIN_WIDTH);
            await goToIn(page, language, "/dashboard");

            expectEverySingleLine(await getTabLabelLineMetrics(page));
          });

          test(`with More open has no accessibility violations (${language.locale})`, async ({
            page,
          }) => {
            await page.setViewportSize(MOBILE);
            await goToIn(page, language, "/dashboard");
            await openMore(page, language);

            const results = await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa"])
              .analyze();
            expect(
              results.violations,
              JSON.stringify(results.violations, null, 2),
            ).toEqual([]);
          });
        }
      });
    }

    test.describe("player", () => {
      test.use({ storageState: E2E_STORAGE_STATE_PATH });

      test("the sidebar offers only what a Player can open", async ({
        page,
      }) => {
        await page.setViewportSize(DESKTOP);
        await page.goto(`${APP_URL}/dashboard`);

        const links = page
          .getByRole("navigation", { name: SIDEBAR_NAV })
          .getByRole("link");
        await expect(links).toHaveText([
          "Dashboard",
          "Directory",
          "Calendar",
          "News",
          "Payments",
        ]);
      });

      test("the tab bar keeps Directory in the Teams slot and Payments behind More", async ({
        page,
      }) => {
        await page.setViewportSize(MOBILE);
        await page.goto(`${APP_URL}/dashboard`);
        const tabBar = page.getByRole("navigation", { name: TAB_BAR });

        await expect(
          tabBar.locator(".app-tabbar-tabs").getByRole("link"),
        ).toHaveText(["Home", "Events", "People", "News"]);
        await openMore(page, ENGLISH_SHELL);
        await expect(
          tabBar.locator(".app-tabbar-overflow").getByRole("link"),
        ).toHaveText(["Payments"]);
      });
    });

    test.describe("admin", () => {
      test.use({
        storageState: roleRequestStorageStatePath("admin-de-administracion"),
      });

      test("the sidebar offers every section and no Administration", async ({
        page,
      }) => {
        await page.setViewportSize(DESKTOP);
        await page.goto(`${APP_URL}/dashboard`);

        const sidebar = page.getByRole("navigation", { name: SIDEBAR_NAV });
        await expect(sidebar.getByRole("link")).toHaveText([
          "Dashboard",
          "Directory",
          "Calendar",
          "Attendance",
          "Teams",
          "Evaluations",
          "News",
          "Payments",
          "Groups",
        ]);
        await expect(
          sidebar.getByRole("link", { name: "Groups" }),
        ).toHaveAttribute("href", "/grupos");
      });

      test("the tab bar keeps the Coach tabs and the Coach More", async ({
        page,
      }) => {
        await page.setViewportSize(MOBILE);
        await page.goto(`${APP_URL}/dashboard`);
        const tabBar = page.getByRole("navigation", { name: TAB_BAR });

        await expect(
          tabBar.locator(".app-tabbar-tabs").getByRole("link"),
        ).toHaveText(["Home", "Events", "Teams", "News"]);
        await openMore(page, ENGLISH_SHELL);
        await expect(
          tabBar.locator(".app-tabbar-overflow").getByRole("link"),
        ).toHaveText([
          "Directory",
          "Attendance",
          "Evaluations",
          "Payments",
          "Groups",
        ]);
      });
    });
  });

  /**
   * Una sesión recién abierta, sólo para este test.
   *
   * La sesión compartida la llevan a la vez todos los demás tests del bloque,
   * así que cerrarla les quitaría la suya a mitad de corrida. Cerrar sesión
   * alcanza sólo a la sesión que la cierra (ver SIGN_OUT_SCOPE), de modo que
   * con una propia estos tests no molestan a nadie.
   */
  async function openOwnSession(
    page: import("@playwright/test").Page,
    context: import("@playwright/test").BrowserContext,
  ): Promise<void> {
    await context.clearCookies();
    const response = await page.request.post(`${APP_URL}${SESSION_ENDPOINT}`, {
      data:
        E2E_SESSION.kind === "available"
          ? { email: E2E_SESSION.email, password: E2E_SESSION.password }
          : {},
    });
    expect(
      response.ok(),
      `no se pudo abrir una sesión propia: ${response.status()}`,
    ).toBe(true);
  }

  async function signOutFromAccountMenu(page: Page): Promise<void> {
    const menu = await openAccountMenu(page);
    await menu.getByRole("button", { name: "Sign out" }).click();
  }

  test("cerrar sesión desde cualquier pantalla aterriza en la entrada", async ({
    page,
    context,
  }) => {
    await openOwnSession(page, context);
    await page.setViewportSize(DESKTOP);
    await page.goto(`${APP_URL}/calendario`);

    await signOutFromAccountMenu(page);

    await expect(page).toHaveURL(new RegExp(`${SIGN_IN_PATH}$`));
  });

  test("tras cerrar sesión, la aplicación vuelve a estar cerrada", async ({
    page,
    context,
  }) => {
    await openOwnSession(page, context);
    await page.setViewportSize(DESKTOP);
    await page.goto(`${APP_URL}/dashboard`);
    await signOutFromAccountMenu(page);
    await expect(page).toHaveURL(new RegExp(`${SIGN_IN_PATH}$`));

    await page.goto(`${APP_URL}/dashboard`);

    await expect(page).toHaveURL(new RegExp(`${SIGN_IN_PATH}$`));
  });

  // Las dos pestañas comparten el tarro de cookies del contexto, que es
  // exactamente lo que comparten dos pestañas de un navegador de verdad.
  test("cerrar sesión en una pestaña deja sin sesión a la otra", async ({
    page,
    context,
  }) => {
    await openOwnSession(page, context);
    const primera = await context.newPage();
    const segunda = await context.newPage();
    await primera.goto(`${APP_URL}/dashboard`);
    await segunda.goto(`${APP_URL}/calendario`);
    await expect(segunda).toHaveURL(new RegExp("/calendario$"));

    await primera.setViewportSize(DESKTOP);
    await signOutFromAccountMenu(primera);
    await expect(primera).toHaveURL(new RegExp(`${SIGN_IN_PATH}$`));

    // La segunda no se entera hasta que pide algo al servidor, y entonces sí.
    await segunda.reload();

    await expect(segunda).toHaveURL(new RegExp(`${SIGN_IN_PATH}$`));
  });

  // La frontera recuerda 30 segundos el estado de una sesión (#434). La baja
  // la guarda un handler de este mismo servidor, que olvida lo recordado de
  // ese socio: su siguiente petición ya no entra, sin esperar a que caduque.
  test("un Admin que da de baja a un socio lo deja fuera en su siguiente petición", async ({
    browser,
  }) => {
    const member = await browser.newContext({
      storageState: roleRequestStorageStatePath("socio-para-dar-de-baja"),
    });
    const admin = await browser.newContext({
      storageState: roleRequestStorageStatePath("admin-de-administracion"),
    });
    try {
      const memberPage = await member.newPage();
      await memberPage.goto(`${APP_URL}/dashboard`);
      await expect(memberPage).toHaveURL(/\/dashboard$/);

      const listing = await admin.request.get(
        `${APP_URL}/api/v1/directory?q=${encodeURIComponent(DEACTIVATED_MEMBER_NAME)}`,
      );
      expect(listing.status()).toBe(200);
      const { data } = (await listing.json()) as {
        data: { members: { userId: string; fullName: string }[] };
      };
      const target = data.members.find(
        ({ fullName }) => fullName === DEACTIVATED_MEMBER_NAME,
      );
      if (target === undefined) {
        throw new Error(
          `${DEACTIVATED_MEMBER_NAME} no sale en el directorio del Admin`,
        );
      }
      const deactivation = await admin.request.patch(
        `${APP_URL}/api/v1/members/${target.userId}/status`,
        { data: { status: "inactive" } },
      );
      expect(deactivation.status()).toBe(200);

      await memberPage.reload();

      await expect(memberPage).toHaveURL(new RegExp(`${SIGN_IN_PATH}$`));
    } finally {
      await member.close();
      await admin.close();
    }
  });

  /* El estado de carga de las secciones (#435). La respuesta de la sección
     se retiene a mano para que el esqueleto se vea aunque el servidor local
     conteste rápido: lo que se prueba es que el toque no espera al servidor,
     porque el esqueleto ya llegó con la precarga del enlace. */
  test.describe("estado de carga al cambiar de sección", () => {
    // `next dev` no precarga ningún enlace, así que ahí el esqueleto también
    // espera al servidor. CI corre la suite contra la aplicación compilada.
    test.skip(
      !servesCompiledApp(process.env),
      "la precarga sólo existe en la aplicación compilada (CI, o CI=1 en local tras npm run build)",
    );

    const DIRECTORY_PATH = "/directorio";
    // Lo que el ticket llama "al instante": por debajo se lee como respuesta
    // directa al toque.
    const INSTANT_RESPONSE_MS = 200;
    const SLOW_SECTION_DELAY_MS = 2_000;
    // Más que cualquier test: la captura se toma con la sección aún cargando.
    const HELD_SECTION_DELAY_MS = 60_000;

    /** Retrasa la navegación a la sección, no su precarga: la precarga es
     * justo la que trae el esqueleto, y retenerla probaría otra cosa. */
    async function delaySectionNavigation(
      page: Page,
      sectionPath: string,
      delayMs: number,
    ): Promise<void> {
      await page.route(
        (url) => url.pathname === sectionPath,
        async (route) => {
          const headers = route.request().headers();
          const isNavigationPayload =
            headers.rsc === "1" &&
            headers["next-router-prefetch"] === undefined;
          if (isNavigationPayload) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
          await route.continue();
        },
      );
    }

    /** Abre el panel y espera a que Next precargue la sección: la petición
     * de precarga en la red es lo que el ticket pide ver. */
    async function openDashboardWithSectionPrefetched(
      page: Page,
      open: () => Promise<void> = async () => {
        await page.goto(`${APP_URL}/dashboard`);
      },
    ): Promise<void> {
      const prefetch = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === DIRECTORY_PATH &&
          response.request().headers()["next-router-prefetch"] !== undefined,
      );
      await open();
      await prefetch;
      // Una sección se precarga en varias peticiones, una por segmento.
      await page.waitForLoadState("networkidle");
    }

    /** El enlace del menú, no cualquier enlace a la sección: el dashboard
     * también enlaza a Directorio desde su tesela de socios activos. */
    function visibleSectionLink(page: Page, sectionPath: string): Locator {
      return page
        .getByRole("navigation")
        .locator(`a[href="${sectionPath}"]:visible`);
    }

    async function showSectionLoading(page: Page): Promise<Locator> {
      await delaySectionNavigation(page, DIRECTORY_PATH, HELD_SECTION_DELAY_MS);
      await visibleSectionLink(page, DIRECTORY_PATH).click();
      const loading = page.locator(".section-loading");
      await expect(loading).toBeVisible();
      return loading;
    }

    test.afterEach(async ({ page }) => {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    });

    test("tocar Directory enseña la carga al instante y el menú ya la marca", async ({
      page,
    }) => {
      await page.setViewportSize(DESKTOP);
      await openDashboardWithSectionPrefetched(page);
      await page.evaluate(() => {
        Object.assign(window, {
          shellBeforeNavigation: document.querySelector(".app-sidebar"),
        });
      });
      await delaySectionNavigation(page, DIRECTORY_PATH, SLOW_SECTION_DELAY_MS);

      await visibleSectionLink(page, DIRECTORY_PATH).click();

      await expect(page.locator(".section-loading")).toBeVisible({
        timeout: INSTANT_RESPONSE_MS,
      });
      await expect(visibleSectionLink(page, DIRECTORY_PATH)).toHaveAttribute(
        "aria-current",
        "page",
        { timeout: INSTANT_RESPONSE_MS },
      );
      // La marca llegó mientras la sección aún cargaba, no con la página.
      await expect(page.locator(".section-loading")).toBeVisible();
      // En escritorio la cabecera vive dentro de `.app-sidebar`: si el
      // elemento sigue siendo el mismo, ni el menú ni ella se repintaron.
      const isSameShell = await page.evaluate(
        () =>
          document.querySelector(".app-sidebar") ===
          Reflect.get(window, "shellBeforeNavigation"),
      );
      expect(isSameShell, "el menú y la cabecera se repintaron").toBe(true);
    });

    test("la carga se anuncia en inglés", async ({ page }) => {
      await openDashboardWithSectionPrefetched(page);

      const loading = await showSectionLoading(page);

      await expect(loading).toHaveAttribute("role", "status");
      await expect(loading).toHaveText("Loading");
    });

    test("la carga se anuncia en español", async ({ page }) => {
      await chooseSpanish(page);
      await openDashboardWithSectionPrefetched(page);

      const loading = await showSectionLoading(page);

      await expect(loading).toHaveText("Cargando");
    });

    test("la carga no se mueve para quien pide movimiento reducido", async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openDashboardWithSectionPrefetched(page);

      const loading = await showSectionLoading(page);

      await expect(loading.locator(".section-loading-block").first()).toHaveCSS(
        "animation-name",
        "none",
      );
    });

    test("cargando-seccion: has no accessibility violations (axe-core)", async ({
      page,
    }) => {
      await openDashboardWithSectionPrefetched(page);
      await showSectionLoading(page);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();

      expect(
        results.violations,
        JSON.stringify(results.violations, null, 2),
      ).toEqual([]);
    });

    for (const vp of viewports) {
      test.describe(`cargando-seccion @ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        for (const theme of themes) {
          test(`matches approved baseline (${theme})`, async ({ page }) => {
            await openDashboardWithSectionPrefetched(page, () =>
              goToWithTheme(page, "/dashboard", theme),
            );
            await showSectionLoading(page);
            const name = `cargando-seccion-${vp.name}-${theme}.png`;
            await createMissingLocalBaseline(name, () =>
              page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
            );
            await expect(page).toHaveScreenshot(name, {
              ...SCREENSHOT_OPTIONS,
              fullPage: true,
              maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
            });
          });
        }

        test("has no horizontal scroll", async ({ page }) => {
          await openDashboardWithSectionPrefetched(page);
          await showSectionLoading(page);

          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
        });
      });
    }
  });

  test("entrar por el formulario lleva al panel principal", async ({
    page,
    context,
  }) => {
    // Este caso empieza sin sesión a propósito: es el único que prueba el
    // formulario de verdad, contra Supabase y con la cuenta de prueba.
    await context.clearCookies();
    await page.goto(`${APP_URL}${SIGN_IN_PATH}`);

    await page
      .getByLabel("Email")
      .fill(E2E_SESSION.kind === "available" ? E2E_SESSION.email : "");
    await page
      .getByLabel("Password")
      .fill(E2E_SESSION.kind === "available" ? E2E_SESSION.password : "");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(new RegExp("/dashboard$"));
  });
});

/* ---------------------------------------------------------------------------
   Registro (#132): el segundo estado de la pantalla, el que dice que falta
   confirmar el correo. No se alcanza por URL, así que hay que enviar el
   formulario; la respuesta del endpoint se sustituye por un doble para que la
   suite no cree cuentas de verdad en Supabase ni gaste envíos de correo.
   --------------------------------------------------------------------------- */

const REGISTRATION_ENDPOINT = "**/api/v1/auth/register";
const CONFIRMATION_STUB_EMAIL = "nerea@example.test";

const RESEND_ENDPOINT = "**/api/v1/auth/confirmation-email";

type RegistrationOutcome = "confirmation_pending" | "email_unavailable";

async function goToConfirmationPending(
  page: import("@playwright/test").Page,
  theme: (typeof themes)[number],
  outcome: RegistrationOutcome = "confirmation_pending",
): Promise<void> {
  await page.route(REGISTRATION_ENDPOINT, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { outcome, email: CONFIRMATION_STUB_EMAIL },
      }),
    }),
  );
  await goToWithTheme(page, "/registro", theme);

  await page.getByLabel("Full name").fill("Nerea Silva");
  await page.getByLabel("Email").fill(CONFIRMATION_STUB_EMAIL);
  await page.getByLabel("Country").selectOption("AU");
  await page.getByLabel("Date of birth").fill("1994-03-02");
  await page.getByLabel("Password").fill("bajoelagua");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(
    page.getByRole("heading", { name: /confirm your email/i }),
  ).toBeVisible();
}

/** Las caras de la pantalla: recién registrada con el texto neutro (#147), tras
 * un reenvío que no llegó a nuestro servidor, y con el envío de correos no
 * disponible (#154). La respuesta no dice nada del envío a una dirección
 * concreta, así que no hay más variantes que fotografiar. */
const CONFIRMATION_VARIANTS = [
  {
    registration: "confirmation_pending",
    resend: "none",
    screenshotPrefix: "registro-confirmacion",
  },
  {
    registration: "confirmation_pending",
    resend: "network_error",
    screenshotPrefix: "registro-reenvio-fallido",
  },
  {
    registration: "email_unavailable",
    resend: "none",
    screenshotPrefix: "registro-envio-no-disponible",
  },
] as const;

type ConfirmationVariant = (typeof CONFIRMATION_VARIANTS)[number];

async function goToConfirmationVariant(
  page: import("@playwright/test").Page,
  theme: (typeof themes)[number],
  variant: ConfirmationVariant,
): Promise<void> {
  await goToConfirmationPending(page, theme, variant.registration);
  if (variant.resend === "none") {
    return;
  }
  await page.route(RESEND_ENDPOINT, (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Resend the email" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /another email/ }),
  ).toBeVisible();
}

for (const variant of CONFIRMATION_VARIANTS) {
  for (const vp of viewports) {
    test.describe(`${variant.screenshotPrefix} @ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const theme of themes) {
        test(`matches approved baseline (${theme})`, async ({ page }) => {
          await goToConfirmationVariant(page, theme, variant);
          const name = `${variant.screenshotPrefix}-${vp.name}-${theme}.png`;
          await createMissingLocalBaseline(name, () =>
            page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
          );
          await expect(page).toHaveScreenshot(name, {
            ...SCREENSHOT_OPTIONS,
            fullPage: true,
            maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
          });
        });
      }
    });
  }

  test(`${variant.screenshotPrefix}: has no accessibility violations (axe-core)`, async ({
    page,
  }) => {
    await goToConfirmationVariant(page, "light", variant);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations,
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);
  });
}

// Los cuatro desenlaces del enlace del correo se alcanzan por URL, así que se
// revisan con axe sin capturar una línea base por cada uno: comparten
// plantilla con la pantalla de registro, que sí la tiene.
for (const state of ["ok", "pendiente", "invalida", "error"] as const) {
  test(`registro tras el enlace (${state}): has no accessibility violations (axe-core)`, async ({
    page,
  }) => {
    await page.goto(`${APP_URL}/registro?confirmacion=${state}`);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations,
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);
  });
}

// Los dos desenlaces que dejan a alguien sin enlace válido: el caducado o ya
// usado, y el fallo del servidor, que gasta el enlace al intentarlo.
const STATES_WITHOUT_A_VALID_LINK = ["invalida", "error"] as const;

// Desde el #179 son los dos que explican cómo conseguir otro enlace, así que
// su texto ya no cabe en la línea base de la pantalla de registro: cada uno
// tiene la suya.
for (const state of STATES_WITHOUT_A_VALID_LINK) {
  for (const vp of viewports) {
    test.describe(`registro-${state} @ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const theme of themes) {
        test(`matches approved baseline (${theme})`, async ({ page }) => {
          await goToWithTheme(page, `/registro?confirmacion=${state}`, theme);
          const name = `registro-${state}-${vp.name}-${theme}.png`;
          await createMissingLocalBaseline(name, () =>
            page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
          );
          await expect(page).toHaveScreenshot(name, {
            ...SCREENSHOT_OPTIONS,
            fullPage: true,
            maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
          });
        });
      }
    });
  }
}

// Los dos desenlaces que no dejan nada que hacer sustituyen al formulario, así
// que sin un camino de vuelta son un callejón sin salida.
for (const state of STATES_WITHOUT_A_VALID_LINK) {
  test(`registro tras el enlace (${state}): ofrece volver al registro`, async ({
    page,
  }) => {
    await page.goto(`${APP_URL}/registro?confirmacion=${state}`);

    await page.getByRole("link", { name: "Back to sign-up" }).click();

    await expect(
      page.getByRole("heading", { name: "Create your account" }),
    ).toBeVisible();
  });
}

// Con el correo confirmado lo único que queda es entrar: una cuenta incompleta
// la manda a completar registro el propio inicio de sesión.
const CONFIRMED_STATE_SUMMARIES = {
  ok: /account is now active/,
  pendiente: /still needs some details[\s\S]*we'll ask you for what's missing/,
} as const;

for (const state of ["ok", "pendiente"] as const) {
  test(`registro tras el enlace (${state}): explica en qué estado quedó la cuenta`, async ({
    page,
  }) => {
    await page.goto(`${APP_URL}/registro?confirmacion=${state}`);

    await expect(page.getByRole("main")).toContainText(
      CONFIRMED_STATE_SUMMARIES[state],
    );
  });

  // Los textos se escribieron cuando todavía no se podía entrar (#132). Las
  // frases viejas eran españolas, así que se buscan en la pantalla en español.
  test(`registro tras el enlace (${state}): no promete un inicio de sesión que ya existe`, async ({
    page,
  }) => {
    await chooseSpanish(page);
    await page.goto(`${APP_URL}/registro?confirmacion=${state}`);

    await expect(page.getByRole("main")).not.toContainText(
      /esté disponible|en cuanto esa pantalla exista/,
    );
  });

  test(`registro tras el enlace (${state}): ofrece entrar`, async ({
    page,
  }) => {
    await page.goto(`${APP_URL}/registro?confirmacion=${state}`);

    await page.getByRole("link", { name: "Sign in", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
  });

  for (const theme of themes) {
    test(`registro tras el enlace (${state}): el botón Entrar deja leer su texto (${theme})`, async ({
      page,
    }) => {
      await goToWithTheme(page, `/registro?confirmacion=${state}`, theme);
      const link = page.getByRole("link", { name: "Sign in", exact: true });

      const { color, background } = await link.evaluate((element) => {
        const style = getComputedStyle(element);
        return { color: style.color, background: style.backgroundColor };
      });

      expect(color).not.toBe(background);
    });
  }
}

// #478: quien entró en el registro por error vuelve a entrar sin el botón
// atrás del navegador, por la línea de bajo el formulario o por la marca.
test("desde el registro la línea de bajo el formulario lleva a entrar", async ({
  page,
}) => {
  await page.goto(`${APP_URL}/registro`);

  await page.getByRole("link", { name: "Sign in", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
});

test("desde el registro la marca de la cabecera lleva a entrar", async ({
  page,
}) => {
  await page.goto(`${APP_URL}/registro`);

  await page.getByRole("link", { name: /: sign in$/ }).click();

  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
});

test("el formulario de registro no manda nada al servidor con la contraseña corta", async ({
  page,
}) => {
  let calls = 0;
  await page.route(REGISTRATION_ENDPOINT, (route) => {
    calls += 1;
    return route.fulfill({ status: 200, body: "{}" });
  });
  await page.goto(`${APP_URL}/registro`);

  await page.getByLabel("Full name").fill("Nerea Silva");
  await page.getByLabel("Email").fill(CONFIRMATION_STUB_EMAIL);
  await page.getByLabel("Country").selectOption("AU");
  await page.getByLabel("Date of birth").fill("1994-03-02");
  await page.getByLabel("Password").fill("1234567");
  await page.getByRole("button", { name: "Create account" }).click();

  // Next inserta su propio elemento con role="alert" (el anunciador de ruta),
  // vacío, así que el resumen de errores se busca por su texto.
  await expect(
    page.getByRole("alert").filter({ hasText: /characters/ }),
  ).toContainText("8");
  expect(calls).toBe(0);
});

/* ---------------------------------------------------------------------------
   Completar registro (#133): la pantalla de una cuenta que todavía no puede
   operar, y la puerta que la hace cumplir.

   Cada estado es un socio distinto porque el estado vive en su fila: qué le
   falta no se elige desde el navegador. Los arma el arranque global.
   --------------------------------------------------------------------------- */

const COMPLETE_REGISTRATION_PATH = "/completar-registro";

for (const name of PHOTOGRAPHED_MEMBERS) {
  test.describe(`completar-registro-${name}`, () => {
    test.skip(
      E2E_SESSION.kind === "unavailable",
      E2E_SESSION.kind === "unavailable"
        ? `sin sesión de prueba: ${E2E_SESSION.reason}`
        : "",
    );
    test.use({ storageState: incompleteStorageStatePath(name) });

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        for (const theme of themes) {
          test(`matches approved baseline (${theme})`, async ({ page }) => {
            await goToWithTheme(page, COMPLETE_REGISTRATION_PATH, theme);
            const snapshot = `completar-registro-${name}-${vp.name}-${theme}.png`;
            await createMissingLocalBaseline(snapshot, () =>
              page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
            );
            await expect(page).toHaveScreenshot(snapshot, {
              ...SCREENSHOT_OPTIONS,
              fullPage: true,
              maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
            });
          });
        }
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await page.goto(`${APP_URL}${COMPLETE_REGISTRATION_PATH}`);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        results.violations,
        JSON.stringify(results.violations, null, 2),
      ).toEqual([]);
    });

    test("en español: has no accessibility violations (axe-core)", async ({
      page,
    }) => {
      await expectNoAxeViolationsInSpanish(page, COMPLETE_REGISTRATION_PATH);
    });

    // ASS-004: 360px is the narrowest viewport the shell must support.
    test("has no horizontal scroll at 360px (ASS-004 minimum)", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(`${APP_URL}${COMPLETE_REGISTRATION_PATH}`);

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(overflow, "horizontal overflow at 360px").toBe(false);
    });
  });
}

test.describe("una cuenta incompleta en un navegador de verdad", () => {
  test.skip(
    E2E_SESSION.kind === "unavailable",
    E2E_SESSION.kind === "unavailable"
      ? `sin sesión de prueba: ${E2E_SESSION.reason}`
      : "",
  );
  test.use({ storageState: incompleteStorageStatePath("un-dato") });

  test("no llega a ninguna pantalla de la aplicación", async ({ page }) => {
    await page.goto(`${APP_URL}/calendario`);

    await expect(page).toHaveURL(new RegExp(`${COMPLETE_REGISTRATION_PATH}$`));
  });

  test("responde 403 a la API directa, que es lo que la redirección esconde", async ({
    request,
  }) => {
    const response = await request.get(`${APP_URL}/api/v1/evaluaciones`);

    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "forbidden" },
    });
  });

  test("pide sólo el dato que le falta, y ninguno de los que ya dio", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${COMPLETE_REGISTRATION_PATH}`);

    await expect(page.getByLabel("Country")).toBeVisible();
    await expect(page.getByLabel("Membership type")).toHaveCount(0);
    await expect(page.getByLabel("Date of birth")).toHaveCount(0);
    await expect(page.getByLabel("Full name")).toHaveCount(0);
  });
});

const ACCOUNT_ENDPOINT = "/api/v1/auth/account";

/** Supabase dev a veces tarda más que los 5 s por defecto de `expect` en
 * guardar (#168). El guardado sí termina, así que se le da margen. */
const ACCOUNT_CHANGE_TIMEOUT_MS = 20_000;
/** Cabe la espera de la respuesta y la de `/dashboard`, más la navegación. */
const ACCOUNT_CHANGE_TEST_TIMEOUT_MS = 60_000;

type AccountChange = {
  readonly method: "PATCH" | "POST";
  readonly endpoint: string;
  readonly submit: () => Promise<void>;
};

/** Envía un cambio de cuenta y llega al panel. Mira la respuesta antes que la
 * URL: si el guardado falla, el test dice con qué estado, no que la URL no
 * cambió. La espera se prepara antes de enviar para no perder la respuesta. */
async function submitAccountChange(
  page: Page,
  { method, endpoint, submit }: AccountChange,
): Promise<void> {
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      new URL(response.url()).pathname === endpoint,
    { timeout: ACCOUNT_CHANGE_TIMEOUT_MS },
  );
  await submit();
  const response = await saved;

  expect(
    response.ok(),
    `${method} ${endpoint} respondió ${response.status()}`,
  ).toBe(true);
  await expect(page).toHaveURL(new RegExp("/dashboard$"), {
    timeout: ACCOUNT_CHANGE_TIMEOUT_MS,
  });
}

/** Los dos tests que dejan su cuenta distinta a como la encontraron. Cada uno
 * usa un socio que no comparte con nadie: la suite corre en paralelo, y
 * activar o cerrar la sesión de una cuenta que otro test está mirando sería un
 * fallo intermitente sin dueño. */
test.describe("una cuenta incompleta que cambia de estado", () => {
  test.skip(
    E2E_SESSION.kind === "unavailable",
    E2E_SESSION.kind === "unavailable"
      ? `sin sesión de prueba: ${E2E_SESSION.reason}`
      : "",
  );

  test.describe("al guardar el último dato", () => {
    // Sin reintentos: el primer intento ya activó la cuenta, y el segundo no
    // encontraría el formulario y fallaría con un timeout que despista.
    test.describe.configure({
      retries: 0,
      timeout: ACCOUNT_CHANGE_TEST_TIMEOUT_MS,
    });
    test.use({ storageState: incompleteStorageStatePath("para-activar") });

    test("entra al panel principal sin que nadie intervenga", async ({
      page,
    }) => {
      await page.goto(`${APP_URL}${COMPLETE_REGISTRATION_PATH}`);

      await page.getByLabel("Country").selectOption("AU");
      await submitAccountChange(page, {
        method: "PATCH",
        endpoint: ACCOUNT_ENDPOINT,
        submit: () =>
          page.getByRole("button", { name: "Save and continue" }).click(),
      });

      // Y ya no vuelve a ver la pantalla, ni pidiéndola a mano.
      await page.goto(`${APP_URL}${COMPLETE_REGISTRATION_PATH}`);
      await expect(page).toHaveURL(new RegExp("/dashboard$"));
    });
  });

  test.describe("al cerrar sesión", () => {
    test.use({
      storageState: incompleteStorageStatePath("para-cerrar-sesion"),
    });

    test("la frontera la deja pasar, que es su otra salida", async ({
      request,
    }) => {
      const response = await request.delete(`${APP_URL}${SESSION_ENDPOINT}`);

      expect(response.status()).toBe(200);
    });
  });
});

/* ---------------------------------------------------------------------------
   Consentimiento del tutor (#134): el menor ve el bloque del tutor en la misma
   pantalla, la cuenta no opera hasta que se registra, y la API no deja
   marcarlo sin los datos del tutor.
   --------------------------------------------------------------------------- */

const GUARDIAN_CONSENT_ENDPOINT = "/api/v1/auth/account/guardian-consent";

test.describe("un menor sin el consentimiento de su tutor", () => {
  test.skip(
    E2E_SESSION.kind === "unavailable",
    E2E_SESSION.kind === "unavailable"
      ? `sin sesión de prueba: ${E2E_SESSION.reason}`
      : "",
  );

  test.describe("mientras espera", () => {
    test.use({
      storageState: incompleteStorageStatePath("menor-sin-consentimiento"),
    });

    test("pide el consentimiento del tutor y ningún dato que ya dio", async ({
      page,
    }) => {
      await page.goto(`${APP_URL}${COMPLETE_REGISTRATION_PATH}`);

      await expect(
        page.getByRole("heading", { name: /your guardian's consent/i }),
      ).toBeVisible();
      await expect(page.getByLabel("Guardian's name")).toBeVisible();
      await expect(page.getByLabel("Country")).toHaveCount(0);
      await expect(page.getByLabel("Date of birth")).toHaveCount(0);
    });

    test("no llega a ninguna pantalla de la aplicación", async ({ page }) => {
      await page.goto(`${APP_URL}/calendario`);

      await expect(page).toHaveURL(
        new RegExp(`${COMPLETE_REGISTRATION_PATH}$`),
      );
    });

    test("la API rechaza marcar el consentimiento sin los datos del tutor", async ({
      request,
    }) => {
      const response = await request.post(
        `${APP_URL}${GUARDIAN_CONSENT_ENDPOINT}`,
        { data: { consent: true } },
      );

      expect(response.status()).toBe(400);
    });
  });

  test.describe("al registrar el consentimiento", () => {
    // Sin reintentos: el primer intento ya registró el consentimiento, y el
    // segundo no encontraría el formulario y fallaría con un timeout que
    // despista.
    test.describe.configure({
      retries: 0,
      timeout: ACCOUNT_CHANGE_TEST_TIMEOUT_MS,
    });
    test.use({
      storageState: incompleteStorageStatePath("menor-para-consentir"),
    });

    test("entra al panel principal sin que nadie intervenga", async ({
      page,
    }) => {
      await page.goto(`${APP_URL}${COMPLETE_REGISTRATION_PATH}`);

      await page.getByLabel("Guardian's name").fill("Marta Silva");
      await page.getByLabel("Guardian's email").fill("marta@example.test");
      await page.getByRole("checkbox", { name: /I consent/i }).check();
      await submitAccountChange(page, {
        method: "POST",
        endpoint: GUARDIAN_CONSENT_ENDPOINT,
        submit: () =>
          page.getByRole("button", { name: "Record consent" }).click(),
      });
    });
  });
});

test.describe("una cuenta activa que pide completar registro", () => {
  test.skip(
    E2E_SESSION.kind === "unavailable",
    E2E_SESSION.kind === "unavailable"
      ? `sin sesión de prueba: ${E2E_SESSION.reason}`
      : "",
  );
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  test("aterriza en el panel principal", async ({ page }) => {
    await page.goto(`${APP_URL}${COMPLETE_REGISTRATION_PATH}`);

    await expect(page).toHaveURL(new RegExp("/dashboard$"));
  });
});

// AC-007 en un servidor de verdad. El socio de prueba nace Player, como toda
// cuenta (FR-008), y la frontera lee ese rol de `members` en cada petición: los
// unitarios prueban la decisión, esto prueba que la consulta real lo trae.
test.describe("un Player que pide una pantalla que su rol no alcanza", () => {
  test.skip(
    E2E_SESSION.kind === "unavailable",
    E2E_SESSION.kind === "unavailable"
      ? `sin sesión de prueba: ${E2E_SESSION.reason}`
      : "",
  );
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  // #213: la navegación ya no las ofrece, pero esconder es comodidad. Quien
  // escribe la dirección a mano se topa igual con la frontera.
  for (const restrictedPath of [
    "/asistencia",
    "/equipos",
    "/evaluaciones",
    "/evaluaciones/categorias",
    "/grupos",
  ]) {
    test(`aterriza en el panel al pedir ${restrictedPath}`, async ({
      page,
    }) => {
      await page.goto(`${APP_URL}${restrictedPath}`);

      await expect(page).toHaveURL(new RegExp("/dashboard$"));
    });
  }
});

/* ---------------------------------------------------------------------------
   Mi cuenta (#209). La cabecera se revisa contra
   docs/mockups/mobile-profile-light.png; el resto, contra design-system.md.
   El socio activo compartido es Player y no tiene solicitudes, así que es el
   del formulario. La pendiente y el envío tienen su propio socio, sembrado
   por el arranque global.
   --------------------------------------------------------------------------- */

const ACCOUNT_PATH = "/cuenta";
const ROLE_REQUESTS_ENDPOINT = "/api/v1/role-requests";
const ACCOUNT_GROUPS_ENDPOINT = "/api/v1/account/groups";
/** El mismo límite que `JUSTIFICATION_MAX_LENGTH`, más uno. */
const TOO_LONG_JUSTIFICATION = "a".repeat(501);

type AccountState = {
  readonly name: string;
  readonly storageState: string;
  /** Qué hacer antes de abrir la pantalla, como elegir el idioma. */
  readonly beforeVisit?: (page: Page) => Promise<void>;
  readonly prepare?: (page: Page) => Promise<void>;
  /** Sin ellos, los tres. Con ellos, axe también corre en el primero. */
  readonly viewports?: readonly (typeof viewports)[number][];
};

/** Lo que sólo existe en el móvil del perfil y de la ficha (#777). */
const PHONE_ONLY_VIEWPORTS = viewports.filter((vp) => vp.name === "mobile");

/** Un estado que sólo existe en unos anchos pasa axe en el primero de ellos;
 * los demás, en el ancho por defecto. */
async function useFirstStateViewport(
  page: Page,
  stateViewports: readonly (typeof viewports)[number][] | undefined,
): Promise<void> {
  const first = stateViewports?.at(0);
  if (first !== undefined) {
    await page.setViewportSize({ width: first.width, height: first.height });
  }
}

/** `/cuenta` llega entera del servidor: hasta que React la hidrata, lo que se
 * escriba o pulse en ella no lo escucha nadie (#557). Desde #774 el
 * formulario lo abre Solicitar, en la tarjeta Rol; en el móvil (#777), la
 * fila Solicitar un cambio de rol, que sólo existe ya hidratada. */
const ROLE_REQUEST_BUTTON_SELECTOR = ".profile-role-request, .profile-role-row";
const ROLE_REQUEST_BUTTON =
  /^(Request|Solicitar|Request a role change|Solicitar un cambio de rol)$/;

async function openRoleRequestForm(page: Page): Promise<void> {
  await waitForHydration(page, ROLE_REQUEST_BUTTON_SELECTOR);
  await page.getByRole("button", { name: ROLE_REQUEST_BUTTON }).click();
}

async function writeTooLongJustification(page: Page): Promise<void> {
  await openRoleRequestForm(page);
  await page
    .getByLabel("Why do you want this role? (optional)")
    .fill(TOO_LONG_JUSTIFICATION);
  await expect(page.getByText(/can be at most 500 characters/)).toBeVisible();
}

const ACCOUNT_PROFILE_ENDPOINT = "/api/v1/account/profile";
const FULL_PROFILE_STORAGE_STATE =
  roleRequestStorageStatePath("perfil-completo");
/** Las tarjetas del perfil (#772) y sus botones en los dos idiomas: las
 * capturas en español preparan la pantalla con la misma función. */
const ABOUT_CARD = /^(About|Sobre mí)$/;
const CONTACT_CARD = /^(Contact|Contacto)$/;
const AUF_CARD = /^(AUF registration|Registro AUF)$/;
const CLUB_RECORD_CARD = /^(Club record|Ficha del club)$/;
const EDIT_CARD_BUTTON = /^(Edit|Editar) /;
const SAVE_CARD_BUTTON = /^(Save|Guardar)$/;
const ABOUT_SAVED_MESSAGE = /^(About saved|Sobre mí guardado)$/;
/** El Editar de una tarjeta: React lo hidrata con la pantalla entera.
 * Pulsado antes, no abre nada. */
const PROFILE_EDIT_SELECTOR = "button.profile-card-edit";

/** Abre una tarjeta del perfil y espera a que salgan sus campos. */
async function openProfileCard(page: Page, name: RegExp): Promise<Locator> {
  await waitForHydration(page, PROFILE_EDIT_SELECTOR);
  const card = page.getByRole("region", { name });
  await card.getByRole("button", { name: EDIT_CARD_BUTTON }).click();
  await expect(card.locator("form")).toBeVisible();
  return card;
}

async function openAboutCard(page: Page): Promise<void> {
  await openProfileCard(page, ABOUT_CARD);
}

async function openContactCard(page: Page): Promise<void> {
  await openProfileCard(page, CONTACT_CARD);
}

/** En el móvil (#777), la fila del contacto de emergencia de la tarjeta Casi
 * listo abre Contacto en edición. La fila sólo existe ya hidratada. */
async function openMissingEmergencyContact(page: Page): Promise<void> {
  await page
    .getByRole("note", { name: /^(Almost there|Casi listo)/ })
    .getByRole("button", {
      name: /^(Emergency contact|Contacto de emergencia)$/,
    })
    .click();
  await expect(
    page.getByRole("region", { name: CONTACT_CARD }).locator("form"),
  ).toBeVisible();
}

/** Guarda Sobre mí tal como está. Escribe lo que ya había, así que las
 * capturas de varios tamaños pueden hacerlo a la vez sobre el mismo socio. */
async function saveProfileUnchanged(page: Page): Promise<void> {
  const card = await openProfileCard(page, ABOUT_CARD);
  await card.getByRole("button", { name: SAVE_CARD_BUTTON }).click();
  await expect(card.getByRole("status")).toHaveText(ABOUT_SAVED_MESSAGE, {
    timeout: ACCOUNT_CHANGE_TIMEOUT_MS,
  });
}

const PHOTO_PROFILE_STORAGE_STATE =
  roleRequestStorageStatePath("perfil-con-foto");
const PROFILE_PHOTO_ALT = /^(Your profile photo|Tu foto de perfil)$/;
const CHOOSE_PHOTO_LABEL = /^(Choose a photo|Elegir una foto)$/;
const PHOTO_INPUT_SELECTOR = "input.account-photo-input";
/** Un byte más de lo que admite la foto de perfil (#245). */
const TOO_LARGE_PHOTO_BYTES = 2 * 1024 * 1024 + 1;

/** La foto llega de Storage por una dirección firmada: sin esperar a que
 * termine de cargar, la captura sale con el círculo vacío. */
async function waitForProfilePhoto(page: Page): Promise<void> {
  await expect(
    page.getByRole("img", { name: PROFILE_PHOTO_ALT }),
  ).toHaveJSProperty("complete", true);
}

/** Elige una foto de más de 2 MB: la pantalla la rechaza sin subirla. El
 * aviso lo da el navegador, así que hay que esperar a que React escuche el
 * campo (#557). */
async function chooseTooLargePhoto(page: Page): Promise<void> {
  await waitForHydration(page, PHOTO_INPUT_SELECTOR);
  await page.getByLabel(CHOOSE_PHOTO_LABEL).setInputFiles({
    name: "foto-enorme.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(TOO_LARGE_PHOTO_BYTES),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: /2 MB/ }),
  ).toBeVisible();
}

/** Escribe sólo el nombre del contacto de emergencia y guarda: el
 * formulario lo para y avisa junto a los dos datos que faltan (#496). No
 * llega al servidor, así que no cambia al socio compartido. */
async function saveHalfEmergencyContact(page: Page): Promise<void> {
  const card = await openProfileCard(page, CONTACT_CARD);
  await card
    .getByLabel(/^(Contact name|Nombre del contacto)$/)
    .fill("Lucía Ruiz");
  await card.getByRole("button", { name: SAVE_CARD_BUTTON }).click();
  await expect(card.getByLabel(/^(Relationship|Relación)$/)).toHaveAttribute(
    "aria-invalid",
    "true",
  );
}

async function failProfileSaveOnNetwork(page: Page): Promise<void> {
  await page.route(`**${ACCOUNT_PROFILE_ENDPOINT}`, (route) =>
    route.abort("internetdisconnected"),
  );
  const card = await openProfileCard(page, ABOUT_CARD);
  await card.getByRole("button", { name: SAVE_CARD_BUTTON }).click();
  // Dentro de la tarjeta: el anunciador de rutas de Next también es un
  // `alert`, vacío.
  await expect(card.getByRole("alert")).toBeVisible();
}

const ACCOUNT_STATES: readonly AccountState[] = [
  { name: "cuenta-formulario", storageState: E2E_STORAGE_STATE_PATH },
  // La tarjeta Rol con la solicitud pendiente en lugar de Solicitar (#774).
  {
    name: "perfil-rol-pendiente",
    storageState: roleRequestStorageStatePath("con-solicitud-pendiente"),
  },
  {
    name: "cuenta-justificacion-larga",
    storageState: E2E_STORAGE_STATE_PATH,
    prepare: writeTooLongJustification,
  },
  // Mis grupos (#229). El socio compartido no tiene grupos, así que
  // `cuenta-formulario` es ya la captura "sin grupos" en inglés.
  {
    name: "cuenta-con-grupos",
    storageState: GROUPED_MEMBER_STORAGE_STATE_PATH,
  },
  {
    name: "cuenta-con-grupos-es",
    storageState: GROUPED_MEMBER_STORAGE_STATE_PATH,
    beforeVisit: chooseSpanish,
  },
  {
    name: "cuenta-sin-grupos-es",
    storageState: E2E_STORAGE_STATE_PATH,
    beforeVisit: chooseSpanish,
  },
  // El perfil (#241). El socio compartido ya es la ficha con los campos
  // vacíos (`cuenta-formulario`). Estos son la ficha completa, el aviso de
  // guardado y el de un error de red. Qué estados en español conservan su
  // captura lo decide tests/support/spanish-captures.ts (#255).
  { name: "perfil-completo", storageState: FULL_PROFILE_STORAGE_STATE },
  {
    name: "perfil-completo-es",
    storageState: FULL_PROFILE_STORAGE_STATE,
    beforeVisit: chooseSpanish,
  },
  // Sobre mí abierto (#772): los campos en dos columnas y la experiencia en
  // su segmento.
  {
    name: "perfil-editando-sobre-mi",
    storageState: FULL_PROFILE_STORAGE_STATE,
    prepare: openAboutCard,
  },
  {
    name: "perfil-editando-sobre-mi-es",
    storageState: FULL_PROFILE_STORAGE_STATE,
    beforeVisit: chooseSpanish,
    prepare: openAboutCard,
  },
  {
    name: "perfil-guardado",
    storageState: FULL_PROFILE_STORAGE_STATE,
    prepare: saveProfileUnchanged,
  },
  {
    name: "perfil-guardado-es",
    storageState: FULL_PROFILE_STORAGE_STATE,
    beforeVisit: chooseSpanish,
    prepare: saveProfileUnchanged,
  },
  {
    name: "perfil-error-de-red",
    storageState: FULL_PROFILE_STORAGE_STATE,
    prepare: failProfileSaveOnNetwork,
  },
  {
    name: "perfil-error-de-red-es",
    storageState: FULL_PROFILE_STORAGE_STATE,
    beforeVisit: chooseSpanish,
    prepare: failProfileSaveOnNetwork,
  },
  // La foto de perfil (#245). Sin foto son las capturas de arriba; éstas son
  // la cabecera con foto y el aviso de una foto demasiado grande.
  {
    name: "perfil-con-foto",
    storageState: PHOTO_PROFILE_STORAGE_STATE,
    prepare: waitForProfilePhoto,
  },
  {
    name: "perfil-con-foto-es",
    storageState: PHOTO_PROFILE_STORAGE_STATE,
    beforeVisit: chooseSpanish,
    prepare: waitForProfilePhoto,
  },
  {
    name: "perfil-foto-demasiado-grande",
    storageState: FULL_PROFILE_STORAGE_STATE,
    prepare: chooseTooLargePhoto,
  },
  {
    name: "perfil-foto-demasiado-grande-es",
    storageState: FULL_PROFILE_STORAGE_STATE,
    beforeVisit: chooseSpanish,
    prepare: chooseTooLargePhoto,
  },
  // El AUF del miembro (#274). Sin AUF es `perfil-completo`; éstos son el
  // pendiente de verificar y el verificado, que ya no se edita.
  {
    name: "perfil-auf-pendiente",
    storageState: roleRequestStorageStatePath("perfil-auf-pendiente"),
  },
  {
    name: "perfil-auf-pendiente-es",
    storageState: roleRequestStorageStatePath("perfil-auf-pendiente"),
    beforeVisit: chooseSpanish,
  },
  {
    name: "perfil-auf-verificado",
    storageState: roleRequestStorageStatePath("perfil-auf-verificado"),
  },
  {
    name: "perfil-auf-verificado-es",
    storageState: roleRequestStorageStatePath("perfil-auf-verificado"),
    beforeVisit: chooseSpanish,
  },
  // Una posición que el club archivó (#299): quien la tiene la sigue viendo,
  // marcada como retirada.
  {
    name: "perfil-posicion-retirada",
    storageState: roleRequestStorageStatePath("perfil-posicion-retirada"),
  },
  {
    name: "perfil-posicion-retirada-es",
    storageState: roleRequestStorageStatePath("perfil-posicion-retirada"),
    beforeVisit: chooseSpanish,
  },
  // El teléfono y el contacto de emergencia (#496). Vacío es ya
  // `perfil-completo`, que no tiene ninguno; éstos son el contacto guardado,
  // en lectura y abierto con el aviso de que el teléfono es el propio (#772),
  // el contacto a medias que la tarjeta no deja enviar, y la menor a la que
  // Contacto le propone su tutor.
  {
    name: "perfil-contacto-completo",
    storageState: roleRequestStorageStatePath("perfil-contacto-completo"),
  },
  {
    name: "perfil-contacto-completo-es",
    storageState: roleRequestStorageStatePath("perfil-contacto-completo"),
    beforeVisit: chooseSpanish,
  },
  {
    name: "perfil-editando-contacto",
    storageState: roleRequestStorageStatePath("perfil-contacto-completo"),
    prepare: openContactCard,
  },
  // El móvil (#777): el socio compartido, al que le faltan datos, abre
  // Contacto desde la tarjeta Casi listo. Los campos van apilados, de 48 px.
  {
    name: "perfil-movil-editando",
    storageState: E2E_STORAGE_STATE_PATH,
    viewports: PHONE_ONLY_VIEWPORTS,
    prepare: openMissingEmergencyContact,
  },
  {
    name: "perfil-editando-contacto-es",
    storageState: roleRequestStorageStatePath("perfil-contacto-completo"),
    beforeVisit: chooseSpanish,
    prepare: openContactCard,
  },
  {
    name: "perfil-contacto-errores",
    storageState: FULL_PROFILE_STORAGE_STATE,
    prepare: saveHalfEmergencyContact,
  },
  {
    name: "perfil-contacto-errores-es",
    storageState: FULL_PROFILE_STORAGE_STATE,
    beforeVisit: chooseSpanish,
    prepare: saveHalfEmergencyContact,
  },
  // El aviso de lo que falta (#498): `perfil-completo` no tiene ni teléfono ni
  // contacto, así que es la ficha con el aviso de los dos.
  {
    name: "perfil-aviso-contacto",
    storageState: FULL_PROFILE_STORAGE_STATE,
  },
  {
    name: "perfil-aviso-contacto-es",
    storageState: FULL_PROFILE_STORAGE_STATE,
    beforeVisit: chooseSpanish,
  },
  {
    name: "perfil-contacto-menor",
    storageState: roleRequestStorageStatePath("perfil-contacto-menor"),
    prepare: openContactCard,
  },
  {
    name: "perfil-contacto-menor-es",
    storageState: roleRequestStorageStatePath("perfil-contacto-menor"),
    beforeVisit: chooseSpanish,
    prepare: openContactCard,
  },
];

async function expectNoAxeViolations(
  page: Page,
  excludedSelector?: string,
): Promise<void> {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
  const results = await (
    excludedSelector === undefined ? builder : builder.exclude(excludedSelector)
  ).analyze();
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2),
  ).toEqual([]);
}

function skipWithoutSession(): void {
  test.skip(
    E2E_SESSION.kind === "unavailable",
    E2E_SESSION.kind === "unavailable"
      ? `sin sesión de prueba: ${E2E_SESSION.reason}`
      : "",
  );
}

/**
 * Sirve la campana vacía en la pantalla que se va a fotografiar.
 *
 * La campana está en la cabecera de todas las pantallas (#266) y su número
 * depende de los avisos que el socio de prueba haya acumulado durante la
 * corrida: cambiar un rol le crea uno (#267, #268). Sin esto, cualquier
 * captura cambia sola de una corrida a otra por esos píxeles.
 *
 * Las pruebas de la propia campana sirven la suya dentro del test, y esa gana:
 * Playwright atiende primero la ruta registrada más tarde.
 */
function quietNotificationBell(): void {
  test.beforeEach(async ({ page }) => {
    await serveNotifications(page, []);
  });
}

for (const state of ACCOUNT_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: state.storageState });

    for (const vp of state.viewports ?? viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await state.beforeVisit?.(page);
              await goToWithTheme(page, ACCOUNT_PATH, theme);
              await state.prepare?.(page);
              // El perfil usa `useIsPhone` (#777): si la página no cabe, la
              // captura de página entera lo ve un instante como móvil, lo
              // vuelve a montar y se pierde lo escrito (#675). Con la ventana
              // a su altura no pasa.
              if (state.prepare !== undefined) {
                await fitViewportToPage(page);
              }
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }

        test("has no horizontal scroll", async ({ page }) => {
          await state.beforeVisit?.(page);
          await page.goto(`${APP_URL}${ACCOUNT_PATH}`);
          await state.prepare?.(page);
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
        });
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await useFirstStateViewport(page, state.viewports);
      await state.beforeVisit?.(page);
      await page.goto(`${APP_URL}${ACCOUNT_PATH}`);
      await state.prepare?.(page);
      await expectNoAxeViolations(page);
    });

    test("en español: has no accessibility violations (axe-core)", async ({
      page,
    }) => {
      await expectNoAxeViolationsInSpanish(page, ACCOUNT_PATH);
    });
  });
}

test.describe("Mi cuenta de un Player sin solicitudes", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  test("ve su rol y, al pulsar Solicitar, el formulario con Coach y Committee", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);

    await expect(page.getByText("Player", { exact: true })).toBeVisible();
    await openRoleRequestForm(page);
    await expect(page.getByRole("radio", { name: "Coach" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Committee" })).toBeVisible();
  });

  test("en español, la pantalla sale en español", async ({ page }) => {
    await chooseSpanish(page);
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);

    await expect(page.getByText("Jugador", { exact: true })).toBeVisible();
    await openRoleRequestForm(page);
    await expect(page.getByRole("radio", { name: "Comité" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Enviar solicitud" }),
    ).toBeVisible();
  });

  test("llega desde Mi perfil, en el menú de la cuenta, y el menú se cierra", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}/calendario`);
    const menu = await openAccountMenu(page);

    await menu.getByRole("link", { name: "My profile" }).click();

    await expect(page).toHaveURL(new RegExp(`${ACCOUNT_PATH}$`));
    await expect(accountMenu(page)).toHaveCount(0);
  });

  test("el endpoint rechaza con 400 una petición de Admin", async ({
    request,
  }) => {
    const response = await request.post(`${APP_URL}${ROLE_REQUESTS_ENDPOINT}`, {
      data: { requestedRole: "Admin" },
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "validation_error" },
    });
  });

  // La cabecera del móvil (#209, #266, #287). Con la campana y el botón de
  // la cuenta como únicos controles, todo vuelve a caber en una sola fila:
  // a 360 y 375 el nombre se lee entero, nada lo tapa y nada se sale.
  for (const width of [360, 375]) {
    test(`la cabecera cae en una sola fila sin tapar el nombre a ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${APP_URL}${ACCOUNT_PATH}`);

      const brandLocator = page.locator(".app-brand");
      const brand = await brandLocator.boundingBox();
      const controlBoxes = await Promise.all(
        [
          page.getByRole("button", { name: /^Notifications/ }),
          page.getByRole("button", { name: ACCOUNT_BUTTON_NAME }),
        ].map((control) => control.boundingBox()),
      );
      const boxes = controlBoxes.flatMap((box) => (box === null ? [] : [box]));
      if (brand === null || boxes.length !== controlBoxes.length) {
        throw new Error("la cabecera no dibujó el nombre o algún control");
      }

      const brandMiddle = brand.y + brand.height / 2;
      for (const box of boxes) {
        expect(
          brandMiddle > box.y && brandMiddle < box.y + box.height,
          "un control no está en la fila del nombre",
        ).toBe(true);
      }
      const firstControlLeft = Math.min(...boxes.map((box) => box.x));
      expect(
        brand.x + brand.width,
        "el nombre del club queda tapado por los controles",
      ).toBeLessThanOrEqual(firstControlLeft);
      const isBrandTruncated = await brandLocator.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      );
      expect(isBrandTruncated, "el nombre del club no se lee entero").toBe(
        false,
      );
      const lastControlRight = Math.max(
        ...boxes.map((box) => box.x + box.width),
      );
      expect(
        lastControlRight,
        "un control se sale de la pantalla",
      ).toBeLessThanOrEqual(width);
    });
  }

  // #292: el nombre sale de la base y admite hasta 60 caracteres. Se pone en
  // la página y no en la base compartida de desarrollo: cambiarlo allí lo
  // vería cualquier otra corrida a la vez. Lo que se prueba es que el CSS lo
  // aguanta con el logo apaisado al lado, el que más lo empuja: dos líneas
  // como mucho, sin tapar los controles ni salirse, los tres botones
  // separados, sin scroll horizontal ni a 320px, y el texto entero en el
  // árbol aunque se vea recortado. El `title` que pone la cáscara lo prueba
  // `tests/unit/app-shell.test.tsx`.
  const LONGEST_CLUB_NAME =
    "Asociación Deportiva de Rugby Subacuático del Sur · Tasmania";
  /** El hueco entre los botones de la cabecera del móvil (`--space-2`). */
  const HEADER_BUTTON_GAP_PX = 8;
  for (const width of [320, 360, 375]) {
    test(`un nombre de 60 caracteres junto al logo cabe en dos líneas a ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await serveClubLogos(page);
      await page.goto(`${APP_URL}${ACCOUNT_PATH}`);
      await showLogoOnServedPage(page, PHOTOGRAPHED_LOGO);
      const brandLocator = page.locator(".app-brand");
      const lineHeight = await brandLocator.evaluate((element) =>
        parseFloat(getComputedStyle(element).lineHeight),
      );
      await brandLocator.evaluate((element, name) => {
        element.textContent = name;
      }, LONGEST_CLUB_NAME);

      const header = page.locator(".app-sidebar-header");
      const brand = await brandLocator.boundingBox();
      const controls = await Promise.all(
        [
          header.getByRole("button", { name: "Search", exact: true }),
          header.getByRole("button", { name: /^Notifications/ }),
          header.getByRole("button", { name: ACCOUNT_BUTTON_NAME }),
        ].map((control) => control.boundingBox()),
      );
      const [search, bell, account] = controls;
      if (brand === null || !search || !bell || !account) {
        throw new Error("la cabecera no dibujó el nombre o algún control");
      }
      const boxes = [search, bell, account];

      expect(brand.height, "el nombre pasa de dos líneas").toBeLessThanOrEqual(
        2 * lineHeight + SUBPIXEL_TOLERANCE_PX,
      );
      const brandMiddle = brand.y + brand.height / 2;
      for (const box of boxes) {
        expect(
          brandMiddle > box.y && brandMiddle < box.y + box.height,
          "un control no está en la fila del nombre",
        ).toBe(true);
      }
      for (const [previous, next] of [
        [search, bell],
        [bell, account],
      ] as const) {
        expect(
          next.x - (previous.x + previous.width),
          "dos botones de la cabecera van pegados",
        ).toBeGreaterThanOrEqual(HEADER_BUTTON_GAP_PX - SUBPIXEL_TOLERANCE_PX);
      }
      expect(
        brand.x + brand.width,
        "el nombre del club tapa los controles",
      ).toBeLessThanOrEqual(search.x);
      expect(
        account.x + account.width,
        "un control se sale de la pantalla",
      ).toBeLessThanOrEqual(width);
      const hasHorizontalScroll = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(hasHorizontalScroll, "aparece scroll horizontal").toBe(false);
      await expect(brandLocator).toHaveText(LONGEST_CLUB_NAME);
    });
  }
});

/* ---------------------------------------------------------------------------
   Notas privadas en el perfil (#324, RF-5 del PRD de E9). El perfil se pinta
   en el servidor con los datos de verdad, así que esto va con las sesiones
   sembradas: un Player ve el aviso y ninguna nota, y la API tampoco le da la
   suya. Las capturas del perfil de un Player (`perfil-*`) ya lo enseñan.
   --------------------------------------------------------------------------- */

const STAFF_ONLY_NOTICE =
  "Your coaches keep evaluations private this season. Ask them if you'd like feedback.";

test.describe("notas privadas en el perfil de un Player", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  test("ve el aviso y ninguna nota, ni la suya", async ({ page }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);

    const section = page.getByRole("region", { name: "Evaluation" });
    await expect(section.getByText(STAFF_ONLY_NOTICE)).toBeVisible();
    await expect(page.getByText("Overall score")).toHaveCount(0);
    await expect(page.getByRole("list", { name: RATINGS_LIST })).toHaveCount(0);
  });

  test("en español, el aviso sale en español", async ({ page }) => {
    await chooseSpanish(page);
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);

    await expect(
      page
        .getByRole("region", { name: "Evaluación" })
        .getByText(
          "Tus coaches mantienen las evaluaciones en privado esta temporada. Pregúntales si quieres saber cómo vas.",
        ),
    ).toBeVisible();
  });

  test("la API le responde 403 cuando pide su propia evaluación", async ({
    request,
  }) => {
    if (E2E_SESSION.kind !== "available") {
      throw new Error("Sin sesión sembrada, este test no debería correr.");
    }
    // Todas las identidades del arranque, y entre ellas la de esta sesión.
    for (const userId of E2E_SESSION.userIds) {
      const response = await request.get(
        `${APP_URL}/api/v1/evaluations/${userId}`,
      );
      expect(response.status(), userId).toBe(403);
    }
  });
});

test.describe("Mi cuenta con grupos", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: GROUPED_MEMBER_STORAGE_STATE_PATH });

  test("ve sus grupos en orden alfabético", async ({ page }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);

    const section = page.getByRole("region", { name: "Groups" });
    await expect(section.getByRole("listitem")).toHaveText(
      [...GROUPED_MEMBER_GROUP_NAMES].sort(),
    );
  });

  test("en español, la sección sale en español", async ({ page }) => {
    await chooseSpanish(page);
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);

    await expect(page.getByRole("region", { name: "Grupos" })).toBeVisible();
  });

  test("el endpoint devuelve sólo sus grupos, con id y nombre", async ({
    request,
  }) => {
    const response = await request.get(`${APP_URL}${ACCOUNT_GROUPS_ENDPOINT}`);

    expect(response.status()).toBe(200);
    const { data } = (await response.json()) as {
      data: { groups: { id: string; name: string }[] };
    };
    expect(data.groups.map((group) => group.name)).toEqual(
      [...GROUPED_MEMBER_GROUP_NAMES].sort(),
    );
    for (const group of data.groups) {
      expect(Object.keys(group).sort()).toEqual(["id", "name"]);
    }
  });
});

test.describe("Mi cuenta sin grupos", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  test("dice que no pertenece a ninguno", async ({ page }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);

    const section = page.getByRole("region", { name: "Groups" });
    await expect(section.getByText("No groups")).toBeVisible();
    await expect(section.getByRole("listitem")).toHaveCount(0);
  });

  test("el endpoint devuelve una lista vacía", async ({ request }) => {
    const response = await request.get(`${APP_URL}${ACCOUNT_GROUPS_ENDPOINT}`);

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ data: { groups: [] } });
  });
});

// #840: con el teclado abierto la barra flotaba entre la página y el teclado.
// Chromium de escritorio no saca teclado: lo que se prueba es que el foco en
// un campo la esconde y salir de él la devuelve.
test.describe("la barra de pestañas mientras se escribe en el perfil", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: FULL_PROFILE_STORAGE_STATE,
    viewport: { width: 375, height: 812 },
  });

  test("se esconde con el foco en un campo y vuelve al salir", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);
    const tabBar = page.getByRole("navigation", { name: "Sections" });
    const about = await openProfileCard(page, ABOUT_CARD);
    const fullName = about.getByLabel("Full name");

    await fullName.focus();
    await expect(tabBar).toBeHidden();

    await fullName.blur();
    await expect(tabBar).toBeVisible();
  });
});

test.describe("un socio que edita su perfil", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: roleRequestStorageStatePath("perfil-para-editar") });
  // Sin reintentos: el primer intento ya dejó la ficha cambiada, y un segundo
  // taparía por qué falló.
  test.describe.configure({
    retries: 0,
    timeout: ACCOUNT_CHANGE_TEST_TIMEOUT_MS,
  });

  test("guarda la ficha, la cabecera y el directorio enseñan lo nuevo, y un campo vaciado queda sin valor", async ({
    page,
  }) => {
    const newName = `Perfil Editado ${Date.now()}`;
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);
    const about = await openProfileCard(page, ABOUT_CARD);
    await about.getByLabel("Full name").fill(newName);
    await about.getByLabel("Position").selectOption({ label: "Forward" });
    await about.getByRole("radio", { name: "Advanced" }).check();
    await about.getByLabel("Gender").selectOption("non_binary");

    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(ACCOUNT_PROFILE_ENDPOINT) &&
        response.request().method() === "PATCH",
      { timeout: ACCOUNT_CHANGE_TIMEOUT_MS },
    );
    await about.getByRole("button", { name: "Save" }).click();
    expect((await saved).status()).toBe(200);
    await expect(about.getByRole("status")).toHaveText("About saved");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(newName);

    await page.reload();
    await expect(about.locator("dd").first()).toHaveText(newName);
    await expect(about).toContainText("Forward");

    const directory = await page.request.get(
      `${APP_URL}/api/v1/directory?q=${encodeURIComponent(newName)}`,
    );
    expect(directory.status()).toBe(200);
    expect(await directory.json()).toMatchObject({
      data: {
        members: [
          {
            fullName: newName,
            position: { names: { en: "Forward", es: "Ataque" } },
            experienceLevel: "Advanced",
          },
        ],
      },
    });

    await openProfileCard(page, ABOUT_CARD);
    await about.getByLabel("Position").selectOption("");
    await about.getByRole("button", { name: "Save" }).click();
    await expect(about.getByRole("status")).toHaveText("About saved");
    const afterClearing = await page.request.get(
      `${APP_URL}/api/v1/directory?q=${encodeURIComponent(newName)}`,
    );
    expect(await afterClearing.json()).toMatchObject({
      data: { members: [{ fullName: newName, position: null }] },
    });
  });

  // El AUF ya no es reservado (#274): lo prueba el bloque de la socia con el
  // AUF verificado, que es el único caso en que se niega.
  test("el endpoint le niega cambiar su rol, sus grupos o su estado", async ({
    request,
  }) => {
    const response = await request.patch(
      `${APP_URL}${ACCOUNT_PROFILE_ENDPOINT}`,
      {
        data: {
          fullName: "Intento de Admin",
          country: "AU",
          positionId: null,
          experienceLevel: null,
          gender: null,
          phone: null,
          emergencyContact: null,
          role: "Admin",
          groups: [],
          status: "active",
        },
      },
    );

    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "forbidden", reason: "reserved_fields" },
    });
  });
});

test.describe("una socia con el AUF verificado", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: roleRequestStorageStatePath("perfil-auf-verificado"),
  });

  test("la pantalla no le ofrece cambiarlo", async ({ page }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);

    const aufCard = page.getByRole("region", { name: AUF_CARD });
    await expect(aufCard.getByText("AUF-2026-0275")).toBeVisible();
    await expect(aufCard.getByText(/^Verified by the club\./)).toBeVisible();
    await expect(
      aufCard.getByRole("button", { name: EDIT_CARD_BUTTON }),
    ).toHaveCount(0);
  });

  test("el endpoint le niega cambiarlo", async ({ request }) => {
    const response = await request.patch(
      `${APP_URL}${ACCOUNT_PROFILE_ENDPOINT}`,
      {
        data: {
          fullName: "Vera Verificada",
          country: "AU",
          positionId: null,
          experienceLevel: null,
          gender: null,
          phone: null,
          emergencyContact: null,
          aufNumber: "AUF-OTRO",
          aufExpiry: "2030-06-30",
        },
      },
    );

    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "forbidden", reason: "auf_verified" },
    });
  });
});

const ACCOUNT_PROFILE_PHOTO_ENDPOINT = "/api/v1/account/profile/photo";
const PHOTO_MEMBER_NAME = seededMemberName(E2E_SESSION, "perfil-para-foto");

test.describe("una socia que sube su foto de perfil", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: roleRequestStorageStatePath("perfil-para-foto") });
  // Sin reintentos: el primer intento ya dejó la foto cambiada, y un segundo
  // taparía por qué falló.
  test.describe.configure({
    retries: 0,
    timeout: ACCOUNT_CHANGE_TEST_TIMEOUT_MS,
  });

  test("la ve en su perfil y en su fila del directorio, y al quitarla vuelven sus iniciales", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);
    const uploaded = page.waitForResponse(
      (response) =>
        response.url().endsWith(ACCOUNT_PROFILE_PHOTO_ENDPOINT) &&
        response.request().method() === "PUT",
      { timeout: ACCOUNT_CHANGE_TIMEOUT_MS },
    );
    await waitForHydration(page, PHOTO_INPUT_SELECTOR);
    await page
      .getByLabel("Choose a photo")
      .setInputFiles(PROFILE_PHOTO_FIXTURE_PATH);
    expect((await uploaded).status()).toBe(200);
    await expect(page.getByRole("status")).toHaveText("Photo updated.");
    await waitForProfilePhoto(page);

    await page.reload();
    await waitForProfilePhoto(page);

    const directory = await page.request.get(
      `${APP_URL}/api/v1/directory?q=${encodeURIComponent(PHOTO_MEMBER_NAME)}`,
    );
    const listing = await directory.json();
    const photoUrl: unknown = listing.data.members[0]?.photoUrl;
    expect(typeof photoUrl).toBe("string");
    // La dirección no dice nada de la socia: ni su correo ni su nombre.
    expect(String(photoUrl)).not.toMatch(/example\.test|Socia/);
    const served = await page.request.get(String(photoUrl));
    expect(served.status()).toBe(200);

    await page.getByRole("button", { name: "Remove photo" }).click();
    await expect(page.getByRole("status")).toHaveText("Photo removed.");
    await expect(
      page.getByRole("img", { name: PROFILE_PHOTO_ALT }),
    ).toHaveCount(0);
    const afterRemoval = await page.request.get(
      `${APP_URL}/api/v1/directory?q=${encodeURIComponent(PHOTO_MEMBER_NAME)}`,
    );
    expect(await afterRemoval.json()).toMatchObject({
      data: { members: [{ fullName: PHOTO_MEMBER_NAME, photoUrl: null }] },
    });
  });

  test("el endpoint rechaza un formato que no es imagen y dice cuáles valen", async ({
    request,
  }) => {
    const response = await request.put(
      `${APP_URL}${ACCOUNT_PROFILE_PHOTO_ENDPOINT}`,
      {
        headers: { "content-type": "image/png" },
        data: Buffer.from("esto no es una imagen"),
      },
    );

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { reason: "photo_type_unsupported" },
    });
  });
});

test.describe("Mi cuenta con una solicitud pendiente", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: roleRequestStorageStatePath("con-solicitud-pendiente"),
  });

  test("ve el rol pedido, la fecha y el estado, sin formulario", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);

    await expect(
      page.getByRole("heading", { name: "Request pending" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "You asked to be Coach on 17 September 2026 at 6:30 pm. An Admin hasn't answered yet.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send request" }),
    ).toHaveCount(0);
  });

  test("otra petición directa recibe 409", async ({ request }) => {
    const response = await request.post(`${APP_URL}${ROLE_REQUESTS_ENDPOINT}`, {
      data: { requestedRole: "Committee" },
    });

    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "conflict" },
    });
  });
});

test.describe("un socio que pide un rol desde Mi cuenta", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: roleRequestStorageStatePath("para-pedir-rol") });
  // Sin reintentos: el primer intento deja la solicitud guardada, así que un
  // segundo encontraría la pendiente en vez del formulario y taparía por qué
  // falló el primero.
  test.describe.configure({
    retries: 0,
    timeout: ACCOUNT_CHANGE_TEST_TIMEOUT_MS,
  });

  test("envía la solicitud, ve la pendiente sin recargar y sigue ahí al volver", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);
    await openRoleRequestForm(page);
    await page.getByRole("radio", { name: "Coach" }).check();
    await page
      .getByLabel("Why do you want this role? (optional)")
      .fill("I coach the juniors on Thursdays.");

    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith(ROLE_REQUESTS_ENDPOINT) &&
        response.request().method() === "POST",
      { timeout: ACCOUNT_CHANGE_TIMEOUT_MS },
    );
    await page.getByRole("button", { name: "Send request" }).click();
    expect((await created).status()).toBe(201);
    await expect(
      page.getByRole("heading", { name: "Request pending" }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Request pending" }),
    ).toBeVisible();
  });
});
/* ---------------------------------------------------------------------------
   La sesión del Admin sembrado, que usan Grupos y el directorio. La pantalla
   de administración que la estrenó (#212) se mudó al directorio en #240, y
   sus pruebas con ella: están en la sección del directorio, más abajo.
   --------------------------------------------------------------------------- */

const ADMIN_STORAGE_STATE = roleRequestStorageStatePath(
  "admin-de-administracion",
);

/* ---------------------------------------------------------------------------
   La sección Grupos (#228). Sin mockup propio: se revisa contra
   design-system.md, y la fila de socio del panel contra
   docs/mockups/directory-light.png, como el directorio.

   Las capturas leen datos fijos, servidos por `page.route`: la lista enseña
   TODOS los grupos del club, así que en el club compartido de la suite una
   captura cambiaría con cada grupo que cualquier otro test creara. Lo que los
   endpoints de verdad responden se prueba aparte, con la sesión del Admin
   sembrado.
   --------------------------------------------------------------------------- */

test.describe("la evaluación en el perfil de un Admin", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("ve la sección de su evaluación, sin el aviso", async ({ page }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);

    await expect(
      page.getByRole("region", { name: "Evaluation" }),
    ).toBeVisible();
    await expect(page.getByText(STAFF_ONLY_NOTICE)).toHaveCount(0);
  });
});

const GROUPS_SCREEN_PATH = "/grupos";
const GROUPS_ENDPOINT = "/api/v1/groups";

/** Justo el tope de `GROUP_NAME_MAX_LENGTH`, para el caso de contenido largo
 * de design-system.md: en la lista se corta con puntos suspensivos. */
const LONG_GROUP_NAME =
  "Juveniles que entrenan los jueves por la tarde en la piscina";

const STUBBED_GROUP_MEMBERS = [
  {
    id: "aaaaaaaa-0000-4000-8000-00000000000a",
    fullName: "Ana Admin",
    isPendingActivation: false,
    positionName: "Forward",
    photoUrl: null,
  },
  {
    id: "bbbbbbbb-0000-4000-8000-00000000000b",
    fullName: "Nerea Ruiz",
    isPendingActivation: true,
    positionName: "Goalkeeper",
    photoUrl: null,
  },
  {
    id: "cccccccc-0000-4000-8000-00000000000c",
    fullName: "Tomás Errekondo Aranburu",
    isPendingActivation: false,
    positionName: null,
    photoUrl: null,
  },
];

const STUBBED_GROUP_CANDIDATES = [
  {
    id: "dddddddd-0000-4000-8000-00000000000d",
    fullName: "Bea Nadal",
    isPendingActivation: false,
    positionName: "Centre",
    photoUrl: null,
    groupCount: 1,
  },
  {
    id: "eeeeeeee-0000-4000-8000-00000000000e",
    fullName: "Iker Salazar",
    isPendingActivation: false,
    positionName: "Back",
    photoUrl: null,
    groupCount: 0,
  },
  {
    id: "ffffffff-0000-4000-8000-00000000000f",
    fullName: "Lucía Ferrer",
    isPendingActivation: false,
    positionName: null,
    photoUrl: null,
    groupCount: 2,
  },
  {
    id: "abababab-0000-4000-8000-0000000000ab",
    fullName: "Marta Quintana Olabarrieta",
    isPendingActivation: false,
    positionName: "Forward",
    photoUrl: null,
    groupCount: 3,
  },
];

/** La vista previa: los activos del grupo en orden de nombre, sin foto. */
const STUBBED_PREVIEW = STUBBED_GROUP_MEMBERS.filter(
  (member) => !member.isPendingActivation,
).map(({ id, fullName }) => ({ id, fullName, photoUrl: null }));

const STUBBED_GROUPS = [
  {
    id: "11111111-0000-4000-8000-000000000001",
    name: "Senior Squad",
    memberCount: 2,
    usage: { events: 2, posts: 1 },
    previewMembers: STUBBED_PREVIEW,
  },
  {
    id: "22222222-0000-4000-8000-000000000002",
    name: LONG_GROUP_NAME,
    memberCount: 0,
    usage: { events: 0, posts: 0 },
    previewMembers: [],
  },
  {
    id: "33333333-0000-4000-8000-000000000003",
    name: "Sunday social",
    memberCount: 18,
    usage: { events: 1, posts: 0 },
    previewMembers: STUBBED_PREVIEW,
  },
];

const OPENED_GROUP_NAME = "Senior Squad";
const AUDIENCE_HEADING = "AUDIENCE OF";

/** "Audiencia de" (#830). Las fechas son fijas: la pantalla las pinta tal
 * cual llegan, sin compararlas con hoy. */
const STUBBED_AUDIENCE_EVENT = {
  kind: "event",
  id: "e0000000-0000-4000-8000-000000000001",
  title: "Island Cup",
  startsOn: "2026-10-24",
  startTime: "09:00",
};

const STUBBED_AUDIENCE_SERIES = {
  kind: "series",
  id: "e0000000-0000-4000-8000-000000000002",
  title: "Wednesday training at the Melbourne Sports and Aquatic Centre",
  weekdays: [3],
  startTime: "18:00",
  nextSession: {
    id: "e0000000-0000-4000-8000-000000000003",
    startsOn: "2026-10-28",
  },
};

const STUBBED_AUDIENCE_POST = {
  id: "f0000000-0000-4000-8000-000000000001",
  title: "Island Cup travel plan",
  publishedAt: "2026-10-12T01:00:00Z",
};

type StubbedAudience = {
  readonly events: {
    readonly items: readonly unknown[];
    readonly total: number;
  };
  readonly posts: {
    readonly items: readonly unknown[];
    readonly total: number;
  };
};

/** La que corresponde al uso de "Senior Squad" en la lista: 2 eventos y 1
 * noticia. */
const STUBBED_AUDIENCE: StubbedAudience = {
  events: {
    items: [STUBBED_AUDIENCE_SERIES, STUBBED_AUDIENCE_EVENT],
    total: 2,
  },
  posts: { items: [STUBBED_AUDIENCE_POST], total: 1 },
};

/** Más de cinco de cada uno: salen cinco y "+ {n} más". */
const STUBBED_LARGE_AUDIENCE: StubbedAudience = {
  events: {
    items: Array.from({ length: 5 }, (_, index) => ({
      ...STUBBED_AUDIENCE_EVENT,
      id: `e0000000-0000-4000-8000-00000000010${index}`,
      title: `Island Cup match ${index + 1}`,
    })),
    total: 8,
  },
  posts: {
    items: Array.from({ length: 5 }, (_, index) => ({
      ...STUBBED_AUDIENCE_POST,
      id: `f0000000-0000-4000-8000-00000000010${index}`,
      title: `Island Cup update ${index + 1}`,
    })),
    total: 6,
  },
};

const STUBBED_EMPTY_AUDIENCE: StubbedAudience = {
  events: { items: [], total: 0 },
  posts: { items: [], total: 0 },
};

/** Las lecturas de la sección, con datos fijos. Registradas antes de
 * navegar, para que la pantalla no llegue a ver las de verdad. */
async function stubGroupsReads(
  page: Page,
  options: {
    readonly withGroups: boolean;
    readonly audience?: StubbedAudience;
  },
): Promise<void> {
  await page.route(
    (url) => url.pathname === GROUPS_ENDPOINT,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { groups: options.withGroups ? STUBBED_GROUPS : [] },
        }),
      }),
  );
  await page.route(
    (url) => /^\/api\/v1\/groups\/[^/]+\/members$/.test(url.pathname),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { members: STUBBED_GROUP_MEMBERS } }),
      }),
  );
  await page.route(
    (url) => /^\/api\/v1\/groups\/[^/]+\/candidates$/.test(url.pathname),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { candidates: STUBBED_GROUP_CANDIDATES },
        }),
      }),
  );
  await page.route(
    (url) => /^\/api\/v1\/groups\/[^/]+\/audience$/.test(url.pathname),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: options.audience ?? STUBBED_AUDIENCE,
        }),
      }),
  );
}

const NEW_GROUP_FIELD = /^(New group name|Nombre del grupo nuevo)$/;
const GROUP_SEARCH = /^(Search in this group|Buscar en este grupo)$/;

/** La pantalla pide su lista al montarse, así que hasta que llega sólo enseña
 * que está cargando. Sin esperarla, una captura sale del estado de carga y la
 * comparación de un instante después, de la pantalla ya llena. */
async function waitForGroups(page: Page, withGroups: boolean): Promise<void> {
  await expect(
    page.getByRole("textbox", { name: NEW_GROUP_FIELD }),
  ).toBeVisible();
  if (withGroups) {
    await expect(
      page.getByRole("button", { name: OPENED_GROUP_NAME, exact: true }),
    ).toBeVisible();
  }
}

const AUDIENCE_LOADING =
  /^(Loading where this group is used…|Cargando dónde se usa este grupo…)$/;

/** Elige el grupo con miembros y espera a que su lista y su audiencia hayan
 * llegado. */
async function selectGroup(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: OPENED_GROUP_NAME, exact: true })
    .click();
  await expect(
    page.getByRole("searchbox", { name: GROUP_SEARCH }),
  ).toBeVisible();
  await expect(page.getByText(AUDIENCE_LOADING)).toHaveCount(0);
  // El puntero se queda encima de la fila y su hover taparía el elegido.
  await page.mouse.move(0, 0);
}

async function askToDeleteGroup(page: Page): Promise<void> {
  await selectGroup(page);
  await page
    .getByRole("button", { name: `Delete ${OPENED_GROUP_NAME}` })
    .click();
  await expect(page.getByText(/will lose this audience/)).toBeVisible();
}

async function startRenamingGroup(page: Page): Promise<void> {
  await selectGroup(page);
  await page
    .getByRole("button", { name: `Rename ${OPENED_GROUP_NAME}` })
    .click();
  await expect(
    page.getByRole("textbox", { name: `New name for ${OPENED_GROUP_NAME}` }),
  ).toBeFocused();
}

type GroupsViewport = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
};

const OPEN_PICKER_BUTTON = /^(Add members|Añadir miembros)$/;
const PICKER_LABEL = `Add members to ${OPENED_GROUP_NAME}`;

/** Los tres que marca la captura del selector: el mockup enseña tres. */
const CHOSEN_CANDIDATES = STUBBED_GROUP_CANDIDATES.slice(0, 3);

async function openMemberPicker(page: Page): Promise<void> {
  await selectGroup(page);
  await page.getByRole("button", { name: OPEN_PICKER_BUTTON }).click();
  await expect(page.getByRole("group", { name: PICKER_LABEL })).toBeVisible();
}

async function chooseThreeCandidates(page: Page): Promise<void> {
  await openMemberPicker(page);
  for (const candidate of CHOSEN_CANDIDATES) {
    await page.getByRole("checkbox", { name: candidate.fullName }).check();
  }
  await expect(page.getByText("3 selected")).toBeVisible();
  await page.mouse.move(0, 0);
}

type GroupsState = {
  readonly name: string;
  readonly withGroups: boolean;
  readonly audience?: StubbedAudience;
  /** Los de `GROUPS_VIEWPORTS` si no se dicen. */
  readonly viewports?: readonly GroupsViewport[];
  readonly beforeVisit?: (page: Page) => Promise<void>;
  readonly prepare?: (page: Page) => Promise<void>;
};

const ENGLISH_GROUPS_HEADING = "Club groups";
const SPANISH_GROUPS_HEADING = "Grupos del club";

/** El escritorio de #828 (RF-2 de E32). Por debajo de 1024px va el flujo del
 * móvil, que es otro ticket (D13): ahí sólo se comprueba que no hay scroll
 * horizontal. */
const GROUPS_DESKTOP_1024: GroupsViewport = {
  name: "desktop-1024",
  width: 1024,
  height: 900,
};
const GROUPS_DESKTOP: GroupsViewport = {
  name: "desktop",
  width: 1440,
  height: 900,
};

const GROUPS_VIEWPORTS: readonly GroupsViewport[] = [
  GROUPS_DESKTOP_1024,
  GROUPS_DESKTOP,
];

/** "Audiencia de" pasa al lado de los miembros desde 1280px (#830, D13): sus
 * estados se fotografían también justo ahí. */
const GROUPS_AUDIENCE_VIEWPORTS: readonly GroupsViewport[] = [
  GROUPS_DESKTOP_1024,
  { name: "desktop-1280", width: 1280, height: 900 },
  GROUPS_DESKTOP,
];

const GROUPS_NARROW_WIDTHS = [375, 768] as const;

const GROUPS_STATES: readonly GroupsState[] = [
  { name: "grupos-lista", withGroups: true },
  { name: "grupos-lista-es", withGroups: true, beforeVisit: chooseSpanish },
  { name: "grupos-sin-grupos", withGroups: false },
  {
    name: "grupos-sin-grupos-es",
    withGroups: false,
    beforeVisit: chooseSpanish,
  },
  { name: "grupos-panel", withGroups: true, prepare: selectGroup },
  {
    name: "grupos-panel-es",
    withGroups: true,
    beforeVisit: chooseSpanish,
    prepare: selectGroup,
  },
  { name: "grupos-borrar-aviso", withGroups: true, prepare: askToDeleteGroup },
  {
    name: "grupos-renombrando",
    withGroups: true,
    prepare: startRenamingGroup,
  },
  {
    name: "grupos-audiencia",
    withGroups: true,
    audience: STUBBED_LARGE_AUDIENCE,
    viewports: GROUPS_AUDIENCE_VIEWPORTS,
    prepare: selectGroup,
  },
  {
    name: "grupos-audiencia-vacia",
    withGroups: true,
    audience: STUBBED_EMPTY_AUDIENCE,
    viewports: GROUPS_AUDIENCE_VIEWPORTS,
    prepare: selectGroup,
  },
  { name: "grupos-anadir", withGroups: true, prepare: chooseThreeCandidates },
];

async function goToGroups(
  page: Page,
  state: GroupsState,
  theme?: (typeof themes)[number],
): Promise<void> {
  await stubGroupsReads(page, state);
  await state.beforeVisit?.(page);
  if (theme === undefined) {
    await page.goto(`${APP_URL}${GROUPS_SCREEN_PATH}`);
  } else {
    await goToWithTheme(page, GROUPS_SCREEN_PATH, theme);
  }
  await waitForGroups(page, state.withGroups);
  await state.prepare?.(page);
}

for (const state of GROUPS_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of state.viewports ?? GROUPS_VIEWPORTS) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToGroups(page, state, theme);
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }

        test("has no horizontal scroll", async ({ page }) => {
          await goToGroups(page, state);
          expect(
            await hasHorizontalScroll(page),
            `horizontal overflow at ${vp.width}px`,
          ).toBe(false);
        });
      });
    }

    for (const width of GROUPS_NARROW_WIDTHS) {
      test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 812 });
        await goToGroups(page, state);
        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    }

    for (const theme of themes) {
      test(`has no accessibility violations (axe-core, ${theme})`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await goToGroups(page, state, theme);
        await expectNoAxeViolations(page);
      });
    }
  });
}

test.describe("la sección Grupos en escritorio", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: ADMIN_STORAGE_STATE,
    viewport: { width: 1440, height: 900 },
  });

  test("la lista y el panel van lado a lado, con la lista de 340px", async ({
    page,
  }) => {
    await goToGroups(page, { name: "grupos-panel", withGroups: true });
    await selectGroup(page);

    const list = page.getByRole("region", { name: ENGLISH_GROUPS_HEADING });
    const panel = page.getByRole("region", { name: OPENED_GROUP_NAME });
    const listBox = await list.boundingBox();
    const panelBox = await panel.boundingBox();

    expect(listBox?.width).toBe(340);
    expect(panelBox?.x).toBeGreaterThan((listBox?.x ?? 0) + 340);
    expect(Math.round(panelBox?.y ?? 0)).toBe(Math.round(listBox?.y ?? 0));
  });

  test("cada fila de grupo mide al menos 54px y cada miembro 48px", async ({
    page,
  }) => {
    await goToGroups(page, { name: "grupos-panel", withGroups: true });
    await selectGroup(page);

    const row = page.getByRole("button", {
      name: OPENED_GROUP_NAME,
      exact: true,
    });
    const member = page
      .getByRole("region", { name: OPENED_GROUP_NAME })
      .getByRole("listitem")
      .first();
    expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(54);
    expect((await member.boundingBox())?.height).toBeGreaterThanOrEqual(48);
  });

  test("los botones de icono de la cabecera miden 38px y el × 32px", async ({
    page,
  }) => {
    await goToGroups(page, { name: "grupos-panel", withGroups: true });
    await selectGroup(page);

    const rename = await page
      .getByRole("button", { name: `Rename ${OPENED_GROUP_NAME}` })
      .boundingBox();
    const remove = await page
      .getByRole("button", {
        name: `Remove Ana Admin from ${OPENED_GROUP_NAME}`,
      })
      .boundingBox();
    expect(rename?.width).toBe(38);
    expect(rename?.height).toBe(38);
    expect(remove?.width).toBe(32);
    expect(remove?.height).toBe(32);
  });

  test("Escribir a todos y Abrir en el directorio miden 38px como los demás", async ({
    page,
  }) => {
    await goToGroups(page, { name: "grupos-panel", withGroups: true });
    await selectGroup(page);

    const writeAll = await page
      .getByRole("button", { name: `Email everyone in ${OPENED_GROUP_NAME}` })
      .boundingBox();
    const directory = await page
      .getByRole("link", { name: `Open ${OPENED_GROUP_NAME} in the directory` })
      .boundingBox();
    expect(writeAll?.width).toBe(38);
    expect(writeAll?.height).toBe(38);
    expect(directory?.width).toBe(38);
    expect(directory?.height).toBe(38);
  });

  test("cada fila de la audiencia mide al menos 44px", async ({ page }) => {
    await goToGroups(page, { name: "grupos-panel", withGroups: true });
    await selectGroup(page);

    const rows = page
      .getByRole("region", { name: AUDIENCE_HEADING })
      .getByRole("link");
    for (const row of await rows.all()) {
      expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
  });
});

/** El cuerpo del panel (#830, D13): desde 1280px, miembros `1fr` y
 * "Audiencia de" de 260px lado a lado; por debajo, la audiencia encima. */
test.describe("el cuerpo del panel de un grupo", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  async function measureBody(
    page: Page,
  ): Promise<{ readonly audience: Box; readonly members: Box }> {
    await goToGroups(page, { name: "grupos-panel", withGroups: true });
    await selectGroup(page);
    const panel = page.getByRole("region", { name: OPENED_GROUP_NAME });
    const audience = await panel
      .getByRole("region", { name: AUDIENCE_HEADING })
      .boundingBox();
    const members = await panel
      .getByRole("searchbox", { name: GROUP_SEARCH })
      .boundingBox();
    if (audience === null || members === null) {
      throw new Error("El panel no pintó la audiencia o los miembros.");
    }
    return { audience, members };
  }

  test("a 1280px la audiencia mide 260px y va a la derecha de los miembros", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    const { audience, members } = await measureBody(page);

    expect(audience.width).toBe(260);
    expect(audience.x).toBeGreaterThan(members.x + members.width);
  });

  test("a 1024px la audiencia va encima de los miembros", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });

    const { audience, members } = await measureBody(page);

    expect(audience.y + audience.height).toBeLessThanOrEqual(members.y);
  });
});

test.describe("el selector de añadir miembros en escritorio", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: ADMIN_STORAGE_STATE,
    viewport: { width: 1440, height: 900 },
  });

  test("va en línea, con el borde de acento y radio 10, como el botón que lo abre", async ({
    page,
  }) => {
    await goToGroups(page, { name: "grupos-anadir", withGroups: true });
    await openMemberPicker(page);

    const picker = page.getByRole("group", { name: PICKER_LABEL });
    const toggle = page.getByRole("button", { name: OPEN_PICKER_BUTTON });
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--color-accent")
        .trim(),
    );
    const pickerBorder = await picker.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.borderTopColor, radius: style.borderTopLeftRadius };
    });
    const toggleBorder = await toggle.evaluate(
      (element) => getComputedStyle(element).borderTopColor,
    );
    const toggleBackground = await toggle.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    const activeTint = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.background = "var(--color-segment-selected)";
      document.body.append(probe);
      const rgb = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return rgb;
    });
    const accentAsRgb = await page.evaluate((color) => {
      const probe = document.createElement("span");
      probe.style.color = color;
      document.body.append(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      return rgb;
    }, accent);

    expect(pickerBorder.radius).toBe("10px");
    expect(pickerBorder.color).toBe(accentAsRgb);
    expect(toggleBorder).toBe(accentAsRgb);
    expect(toggleBackground).toBe(activeTint);
  });

  test("cada fila mide al menos 42px, con el avatar de 28px", async ({
    page,
  }) => {
    await goToGroups(page, { name: "grupos-anadir", withGroups: true });
    await openMemberPicker(page);

    const picker = page.getByRole("group", { name: PICKER_LABEL });
    const row = picker.getByRole("listitem").first();
    const avatar = row.locator(".groups-picker-avatar");
    expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(42);
    expect((await avatar.boundingBox())?.width).toBe(28);
    expect((await avatar.boundingBox())?.height).toBe(28);
  });

  test("la lista no pasa de 220px y se desplaza dentro", async ({ page }) => {
    await goToGroups(page, { name: "grupos-anadir", withGroups: true });
    await openMemberPicker(page);

    const list = page
      .getByRole("group", { name: PICKER_LABEL })
      .getByRole("list");
    expect((await list.boundingBox())?.height).toBeLessThanOrEqual(220);
    expect(
      await list.evaluate((element) => getComputedStyle(element).overflowY),
    ).toBe("auto");
  });
});

/* ---------------------------------------------------------------------------
   La exportación a CSV del directorio (#500): el Admin sembrado descarga la
   lista desde la pantalla, en el navegador de verdad y contra el endpoint de
   verdad. Las columnas y el escape los prueba el dominio; aquí, que el
   archivo llega como descarga, con su nombre y legible por Excel.
   --------------------------------------------------------------------------- */

test.describe("la exportación del directorio de un Admin", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("descarga un CSV con BOM, cabeceras en su idioma y una fila por socio", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}/directorio`);
    const memberRows = page.locator("table.directory-table tbody tr");
    await expect(memberRows.first()).toBeVisible();
    const listedCount = await memberRows.count();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export CSV" }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(
      /^[a-z0-9-]+-directory-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const downloadedPath = await download.path();
    const csv = readFileSync(downloadedPath, "utf8");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toMatch(/^Name,Country,Level,AUF number,/);
    // La cabecera, una fila por socio de la tabla y la línea vacía del final.
    expect(lines).toHaveLength(listedCount + 2);
  });
});

test.describe("la sección Grupos con los datos de verdad", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("un Admin abre la sección desde la barra lateral", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${APP_URL}/dashboard`);

    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Groups" })
      .click();

    await expect(page).toHaveURL(new RegExp(`${GROUPS_SCREEN_PATH}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: "Groups" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: ENGLISH_GROUPS_HEADING }),
    ).toBeVisible();
  });

  test("en español, la sección sale en español", async ({ page }) => {
    await chooseSpanish(page);
    await page.goto(`${APP_URL}${GROUPS_SCREEN_PATH}`);

    await expect(
      page.getByRole("heading", { level: 1, name: "Grupos" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: SPANISH_GROUPS_HEADING }),
    ).toBeVisible();
  });

  test("la lista responde 200 a un Admin", async ({ request }) => {
    const groups = await request.get(`${APP_URL}${GROUPS_ENDPOINT}`);

    expect(groups.status()).toBe(200);
  });
});

test.describe("un Player frente a la sección Grupos", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  test("no la ve en la barra lateral", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${APP_URL}/dashboard`);

    await expect(
      page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Groups" }),
    ).toHaveCount(0);
  });

  test("aterriza en el panel al pedirla", async ({ page }) => {
    await page.goto(`${APP_URL}${GROUPS_SCREEN_PATH}`);

    await expect(page).toHaveURL(new RegExp("/dashboard$"));
  });

  test("la lista de grupos le responde 403", async ({ request }) => {
    const groups = await request.get(`${APP_URL}${GROUPS_ENDPOINT}`);

    expect(groups.status()).toBe(403);
  });
});
/* ---------------------------------------------------------------------------
   El directorio del club (#239). Mockup: docs/mockups/directory-light.png y
   directory-dark.png, del que quedan fuera las columnas de OVR y asistencia
   (son de E9 y E8) y el botón de alta, que llega en su propio ticket.

   A un Admin el directorio le enseña además la bandeja de solicitudes de rol
   y el control de rol de cada fila (#240), mudados desde la pantalla de
   administración de #212. La bandeja no sale en el mockup: se revisa contra
   design-system.md, con el aspecto que ya tenía en Administración.

   Las capturas leen datos fijos, servidos por `page.route`: el directorio
   enseña a TODO el club, así que una captura cambiaría con cada socio que
   cualquier otro test sembrara. Lo que el endpoint de verdad responde se
   prueba aparte, con las sesiones sembradas.
   --------------------------------------------------------------------------- */

const DIRECTORY_SCREEN_PATH = "/directorio";
const DIRECTORY_ENDPOINT = "/api/v1/directory";

/** Un nombre de los que rompen una fila estrecha, para el criterio de los
 * 375px y el caso de contenido largo de design-system.md. */
const LONG_MEMBER_NAME = "Tomás Errekondo Aranburu de la Hoz";

/** Sin país, sin nivel y sin posición: los tres huecos que la fila rellena
 * con un guion. */
/** Quien no tiene sesiones elegibles: el directorio y la ficha escriben
 * "Sin datos" (#396, AC-017b). */
const STUBBED_ATTENDANCE = { kind: "no_data" } as const;

const MEMBER_WITHOUT_DATA = {
  userId: "44444444-0000-4000-8000-000000000004",
  fullName: LONG_MEMBER_NAME,
  country: null,
  experienceLevel: null,
  role: "Player",
  position: null,
  status: "active",
  invitedOn: null,
  photoUrl: null,
  attendance: STUBBED_ATTENDANCE,
} as const;

/** Una dirección que no existe: la captura la sirve con la foto fija, igual
 * que Storage serviría una dirección firmada. */
const STUBBED_PHOTO_URL = "https://fotos.test/member-photos/mateo.png";
/** La fila que sale con foto en las capturas que la piden (#245). */
const MEMBER_WITH_PHOTO_ID = "22222222-0000-4000-8000-000000000002";

/** Las posiciones como las sirve el directorio desde #299: con sus nombres
 * del club, y la pantalla elige el del idioma en que se lee. */
const STUBBED_POSITIONS = {
  Goalkeeper: {
    id: "90000000-0000-4000-8000-000000000001",
    names: { en: "Goalkeeper", es: "Portería" },
  },
  Defender: {
    id: "90000000-0000-4000-8000-000000000002",
    names: { en: "Defender", es: "Defensa" },
  },
  Forward: {
    id: "90000000-0000-4000-8000-000000000003",
    names: { en: "Forward", es: "Ataque" },
  },
} as const;

const STUBBED_DIRECTORY_MEMBERS = [
  {
    userId: "11111111-0000-4000-8000-000000000001",
    fullName: "Ana Admin",
    country: "AU",
    experienceLevel: "Advanced",
    role: "Admin",
    position: STUBBED_POSITIONS.Defender,
    status: "active",
    invitedOn: null,
    photoUrl: null,
    attendance: { kind: "rate", percent: 92, sessions: 23 },
  },
  {
    userId: "22222222-0000-4000-8000-000000000002",
    fullName: "Mateo Restrepo",
    country: "CO",
    experienceLevel: "Advanced",
    role: "Coach",
    position: STUBBED_POSITIONS.Forward,
    status: "active",
    invitedOn: null,
    photoUrl: null,
    attendance: { kind: "rate", percent: 88, sessions: 22 },
  },
  {
    userId: "33333333-0000-4000-8000-000000000003",
    fullName: "Nerea Ruiz",
    country: "ES",
    experienceLevel: "Beginner",
    role: "Player",
    position: STUBBED_POSITIONS.Goalkeeper,
    status: "active",
    invitedOn: null,
    photoUrl: null,
    attendance: { kind: "rate", percent: 64, sessions: 16 },
  },
  MEMBER_WITHOUT_DATA,
  {
    userId: "55555555-0000-4000-8000-000000000005",
    fullName: "Zoe Zapata",
    country: "AU",
    experienceLevel: "Intermediate",
    role: "Committee",
    position: STUBBED_POSITIONS.Defender,
    status: "inactive",
    invitedOn: null,
    photoUrl: null,
    attendance: STUBBED_ATTENDANCE,
  },
] as const;

/** La única fila con el registro federativo vencido, que es la que la captura
 * del Admin tiene que enseñar señalada (BR-008). Está verificado: vencido y
 * verificado se marcan a la vez (#274). */
const EXPIRED_AUF_MEMBER_ID = "11111111-0000-4000-8000-000000000001";
/** La única fila con un AUF que escribió el socio y nadie ha verificado
 * (#274): así la captura del Admin enseña las tres marcas. */
const UNVERIFIED_AUF_MEMBER_ID = "33333333-0000-4000-8000-000000000003";
/** El AUF que vence en los próximos 30 días: un punto de aviso (#549). */
const EXPIRING_AUF_MEMBER_ID = "22222222-0000-4000-8000-000000000002";
/** Sin número de AUF: el otro punto de aviso (#549). Son el nombre más largo
 * y el socio invitado, que todavía no lo ha dado. */
const MEMBERS_WITHOUT_AUF: ReadonlySet<string> = new Set([
  "44444444-0000-4000-8000-000000000004",
  "77777777-0000-4000-8000-000000000007",
]);

/** El vencimiento que corresponde a cada caso de la lista fija. */
function aufExpiryOf(auf: {
  readonly hasAuf: boolean;
  readonly isAufExpired: boolean;
  readonly isAufExpiring: boolean;
}): string | null {
  if (!auf.hasAuf) {
    return null;
  }
  if (auf.isAufExpired) {
    return "2020-01-31";
  }
  return auf.isAufExpiring ? "2026-10-20" : "2030-06-30";
}

/** Un socio invitado que todavía no ha entrado (#549): la píldora de borde
 * discontinuo y la línea con el día de la invitación. Sólo va en las listas
 * que lo piden, para no cambiar el resto de las capturas. */
const INVITED_MEMBER = {
  userId: "77777777-0000-4000-8000-000000000007",
  fullName: "Alex Kim",
  country: "AU",
  experienceLevel: null,
  role: "Player",
  position: null,
  status: "incomplete",
  invitedOn: "2026-10-05",
  photoUrl: null,
  attendance: STUBBED_ATTENDANCE,
} as const;

/** Quien no tiene evaluación en las listas fijas (#324): los dos nombres más
 * largos, para que la marca se mida en las tarjetas más estrechas. */
const UNEVALUATED_MEMBER_IDS: ReadonlySet<string> = new Set([
  "44444444-0000-4000-8000-000000000004",
  "66666666-0000-4000-8000-000000000006",
]);

type StubbedContact = {
  readonly email: string;
  readonly phone: string | null;
  readonly emergencyContact: {
    readonly name: string;
    readonly phone: string;
    readonly relationship: string;
  } | null;
};

/** El contacto de cada socio de la lista fija (#499). Hay de todo: con los
 * tres datos, sin teléfono propio, sin contacto de emergencia y, en el nombre
 * más largo, sin ninguno de los dos y con el correo más largo. */
const STUBBED_CONTACTS: Readonly<Record<string, StubbedContact>> = {
  "11111111-0000-4000-8000-000000000001": {
    email: "ana.admin@seadragons.test",
    phone: "0412 345 678",
    emergencyContact: {
      name: "Luis Admin",
      phone: "0499 111 222",
      relationship: "Partner",
    },
  },
  "22222222-0000-4000-8000-000000000002": {
    email: "mateo.restrepo@seadragons.test",
    phone: "+57 300 123 4567",
    emergencyContact: {
      name: "Rosa Restrepo",
      phone: "+57 300 765 4321",
      relationship: "Mother",
    },
  },
  "33333333-0000-4000-8000-000000000003": {
    email: "nerea.ruiz@seadragons.test",
    phone: null,
    emergencyContact: {
      name: "Iñaki Ruiz",
      phone: "0488 222 333",
      relationship: "Father",
    },
  },
  "44444444-0000-4000-8000-000000000004": {
    email: "tomas.errekondo.aranburu@seadragons.test",
    phone: null,
    emergencyContact: null,
  },
  "55555555-0000-4000-8000-000000000005": {
    email: "zoe.zapata@seadragons.test",
    phone: "0400 000 111",
    emergencyContact: null,
  },
};

/** Un socio que un describe añade a la lista sin contacto propio sale sin
 * teléfono ni contacto de emergencia. */
function stubbedContactOf(member: {
  readonly userId: string;
  readonly fullName?: string;
}): StubbedContact {
  return (
    STUBBED_CONTACTS[member.userId] ?? {
      email: `${member.userId.slice(0, 8)}@seadragons.test`,
      phone: null,
      emergencyContact: null,
    }
  );
}

/** La vista del Coach: la de todos, más si tiene evaluación (#324) y el
 * contacto de emergencia (#499). */
function asCoachMember(member: {
  readonly userId: string;
}): Record<string, unknown> {
  return {
    ...member,
    isEvaluated: !UNEVALUATED_MEMBER_IDS.has(member.userId),
    emergencyContact: stubbedContactOf(member).emergencyContact,
  };
}

function asAdminMember(member: {
  readonly userId: string;
}): Record<string, unknown> {
  const isAufExpired = member.userId === EXPIRED_AUF_MEMBER_ID;
  const isAufExpiring = member.userId === EXPIRING_AUF_MEMBER_ID;
  const hasAuf = !MEMBERS_WITHOUT_AUF.has(member.userId);
  return {
    ...asCoachMember(member),
    ...stubbedContactOf(member),
    aufNumber: hasAuf ? `AUF-${member.userId.slice(0, 2)}` : null,
    aufExpiry: aufExpiryOf({ hasAuf, isAufExpired, isAufExpiring }),
    isAufVerified: hasAuf && member.userId !== UNVERIFIED_AUF_MEMBER_ID,
    isAufExpired,
    isAufExpiring,
    // La fila del AUF vencido carga además la membresía atrasada (#453): con
    // los dos puntos de peligro (#549) es la de más marcas.
    membershipStatus: isAufExpired ? "past_due" : "active",
  };
}

function normalizeName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Un socio de la lista fija, con el nombre y el id abiertos para que un
 * describe pueda añadir los suyos. */
type StubbedMember = Omit<
  (typeof STUBBED_DIRECTORY_MEMBERS)[number],
  "userId" | "fullName" | "status" | "invitedOn"
> & {
  readonly userId: string;
  readonly fullName: string;
  readonly status: "incomplete" | "active" | "inactive";
  readonly invitedOn: string | null;
};

/** Cómo sirve el endpoint la lista a cada rol: sólo un Admin recibe la suya,
 * y un Coach la de todos con la marca de evaluación (#324). */
function listingKindOf(options: {
  readonly asAdmin: boolean;
  readonly asCoach?: boolean;
}): "admin" | "coach" | "member" {
  if (options.asAdmin) {
    return "admin";
  }
  return options.asCoach === true ? "coach" : "member";
}

const LISTING_MEMBER_VIEWS = {
  admin: asAdminMember,
  coach: asCoachMember,
  member: (member: { readonly userId: string }): Record<string, unknown> => ({
    ...member,
  }),
} as const;

/** Los filtros de #497 que el servidor deja usar a cada vista. */
const STUBBED_AVAILABLE_FILTERS = {
  admin: [
    "position",
    "group",
    "auf",
    "membership",
    "withoutPhone",
    "withoutEmergencyContact",
  ],
  coach: ["position", "group"],
  member: ["position"],
} as const;

/** Las opciones de los filtros: las posiciones del club y sus grupos, fijas
 * para que la captura no dependa de lo que otro test haya sembrado. */
const CLUB_POSITIONS_ENDPOINT = "/api/v1/club/positions";
const DIRECTORY_GROUPS_ENDPOINT = "/api/v1/groups";
const STUBBED_DIRECTORY_GROUPS = [
  {
    id: "77777777-0000-4000-8000-000000000001",
    name: "Senior Squad",
    memberCount: 3,
  },
  {
    id: "77777777-0000-4000-8000-000000000002",
    name: "Junior Squad",
    memberCount: 1,
  },
] as const;

async function stubFilterChoices(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === CLUB_POSITIONS_ENDPOINT,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { positions: Object.values(STUBBED_POSITIONS) },
        }),
      }),
  );
  await page.route(
    (url) => url.pathname === DIRECTORY_GROUPS_ENDPOINT,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { groups: STUBBED_DIRECTORY_GROUPS } }),
      }),
  );
}

/** El porcentaje por el que se ordena, o null para quien no tiene datos. */
function stubbedPercent(member: StubbedMember): number | null {
  return member.attendance.kind === "rate" ? member.attendance.percent : null;
}

/** El orden por asistencia (#396) como lo hace el servidor (#394): por
 * porcentaje, y los sin datos al final en los dos sentidos. */
function sortedByAttendance(
  members: readonly StubbedMember[],
  direction: string | null,
): readonly StubbedMember[] {
  const sign = direction === "desc" ? -1 : 1;
  return [...members].sort((first, second) => {
    const firstPercent = stubbedPercent(first);
    const secondPercent = stubbedPercent(second);
    if (firstPercent === null || secondPercent === null) {
      return Number(firstPercent === null) - Number(secondPercent === null);
    }
    return sign * (firstPercent - secondPercent);
  });
}

/** Lo que el endpoint de #238 hace con la consulta, reducido a lo que estas
 * capturas necesitan distinguir. El orden lo decide el servidor: la lista
 * sale en el orden en que está escrita, que ya es el alfabético, salvo que
 * se pida por asistencia, que es lo que cambia la captura de ese orden. */
function stubbedListing(
  searchParams: URLSearchParams,
  options: {
    readonly asAdmin: boolean;
    readonly asCoach?: boolean;
    readonly withPhoto: boolean;
    readonly members: readonly StubbedMember[];
  },
): Record<string, unknown> {
  const kind = listingKindOf(options);
  const search = searchParams.get("q");
  const role = searchParams.get("role");
  const includeInactive = searchParams.get("includeInactive") === "true";
  const position = searchParams.get("position");
  // Nadie de la lista fija está en un grupo: filtrar por uno es la manera de
  // llegar a "sin resultados" desde los filtros de #497.
  const isGroupFiltered = searchParams.has("group");
  const isWithoutPhone = searchParams.get("withoutPhone") === "true";
  const members = options.members.filter(
    (member) =>
      !isGroupFiltered &&
      (!isWithoutPhone || stubbedContactOf(member).phone === null) &&
      (role === null || member.role === role) &&
      (includeInactive || member.status !== "inactive") &&
      (position === null || (member.position?.id ?? "none") === position) &&
      (search === null ||
        normalizeName(member.fullName).includes(normalizeName(search))),
  );
  const ordered =
    searchParams.get("sort") === "attendance"
      ? sortedByAttendance(members, searchParams.get("direction"))
      : members;
  const listed = ordered.map((member) =>
    options.withPhoto && member.userId === MEMBER_WITH_PHOTO_ID
      ? { ...member, photoUrl: STUBBED_PHOTO_URL }
      : member,
  );
  return {
    kind,
    members: listed.map(LISTING_MEMBER_VIEWS[kind]),
    availableFilters: STUBBED_AVAILABLE_FILTERS[kind],
    total: options.members.filter(
      (member) => includeInactive || member.status !== "inactive",
    ).length,
    ...(kind === "admin"
      ? { summary: stubbedClubSummary(options.members) }
      : {}),
  };
}

/** El resumen del club (#551) como lo cuenta el servidor: de todo el club
 * activo, sin la búsqueda ni los filtros, con las mismas marcas que
 * `asAdminMember`. */
function stubbedClubSummary(
  members: readonly StubbedMember[],
): Record<string, unknown> {
  const active = members.filter((member) => member.status !== "inactive");
  const renewals = [EXPIRED_AUF_MEMBER_ID, EXPIRING_AUF_MEMBER_ID].flatMap(
    (userId) =>
      active
        .filter((member) => member.userId === userId)
        .map((member) => ({
          userId,
          fullName: member.fullName,
          aufStatus: userId === EXPIRED_AUF_MEMBER_ID ? "expired" : "expiring",
        })),
  );
  const countOf = (isCounted: (member: StubbedMember) => boolean): number =>
    active.filter(isCounted).length;
  return {
    aufRenewals: renewals,
    attention: {
      aufMissing: countOf((member) => MEMBERS_WITHOUT_AUF.has(member.userId)),
      aufRenewal: renewals.length,
      withoutEmergencyContact: countOf(
        (member) => stubbedContactOf(member).emergencyContact === null,
      ),
      membershipPastDue: countOf(
        (member) => member.userId === EXPIRED_AUF_MEMBER_ID,
      ),
    },
  };
}

const MEMBERS_ENDPOINT = "/api/v1/members";
const PENDING_REQUESTS_ENDPOINT = "/api/v1/role-requests";

/** Tres veces el largo de una nota normal, para el caso de contenido largo de
 * design-system.md y el criterio de los 375px. */
const LONG_JUSTIFICATION =
  "Llevo tres temporadas entrenando al grupo de juveniles los jueves y también los sábados por la mañana cuando hay torneo, y me gustaría poder cargar las alineaciones y las asistencias sin pedírselo cada vez a alguien del comité.";

/** Dos solicitudes de miembros de la lista: una con la nota más larga y otra
 * sin nota y con el nombre más largo. */
const STUBBED_REQUESTS = [
  {
    id: "11111111-0000-4000-8000-0000000000aa",
    userId: "33333333-0000-4000-8000-000000000003",
    fullName: "Nerea Ruiz",
    currentRole: "Player",
    requestedRole: "Coach",
    justification: LONG_JUSTIFICATION,
    createdAt: "2026-09-17T08:30:00.000Z",
  },
  {
    id: "22222222-0000-4000-8000-0000000000bb",
    userId: MEMBER_WITHOUT_DATA.userId,
    fullName: LONG_MEMBER_NAME,
    currentRole: "Player",
    requestedRole: "Committee",
    justification: null,
    createdAt: "2026-09-18T02:00:00.000Z",
  },
] as const;

/** La bandeja con datos fijos: en el club compartido de la suite cambiaría
 * con cada solicitud que otro test sembrara. */
async function stubPendingRequests(
  page: Page,
  withRequests: boolean,
): Promise<void> {
  await page.route(
    (url) => url.pathname === PENDING_REQUESTS_ENDPOINT,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { requests: withRequests ? STUBBED_REQUESTS : [] },
        }),
      }),
  );
}

/** La foto de la fila que la lleva, servida con la foto fija. */
async function stubDirectoryPhoto(page: Page): Promise<void> {
  await page.route(STUBBED_PHOTO_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: readFileSync(PROFILE_PHOTO_FIXTURE_PATH),
    }),
  );
}

async function stubDirectoryReads(
  page: Page,
  options: {
    readonly asAdmin: boolean;
    readonly asCoach?: boolean;
    readonly withRequests?: boolean;
    readonly withPhoto?: boolean;
    readonly members?: readonly StubbedMember[];
  },
): Promise<void> {
  if (options.asAdmin) {
    await stubPendingRequests(page, options.withRequests ?? false);
  }
  const withPhoto = options.withPhoto ?? false;
  if (withPhoto) {
    await stubDirectoryPhoto(page);
  }
  await stubFilterChoices(page);
  await page.route(
    (url) => url.pathname === DIRECTORY_ENDPOINT,
    (route, request) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: stubbedListing(new URL(request.url()).searchParams, {
            asAdmin: options.asAdmin,
            asCoach: options.asCoach,
            withPhoto,
            members: options.members ?? STUBBED_DIRECTORY_MEMBERS,
          }),
        }),
      }),
  );
}

const ENGLISH_DIRECTORY_HEADING = "Club members";
const SPANISH_DIRECTORY_HEADING = "Miembros del club";

/** Lo que dice la cabecera, en los dos idiomas, cuando ya sabe cuántas
 * solicitudes hay; el aviso del móvil (#553) dice lo mismo. */
const REQUESTS_SETTLED =
  /No pending requests|role requests? waiting|No hay solicitudes pendientes|solicitud(es)? de rol esperando/;

/** La pantalla pide su lista al montarse, y la de un Admin después sus
 * solicitudes. Sin esperarlas, la captura sale sin la línea de la cabecera
 * o sin el aviso del móvil. */
async function waitForDirectory(
  page: Page,
  heading: string,
  asAdmin = false,
): Promise<void> {
  await expect(page.getByRole("region", { name: heading })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  if (asAdmin) {
    // En el móvil la línea de la cabecera está escondida, así que basta con
    // que esté en la página.
    await expect(page.getByText(REQUESTS_SETTLED).first()).toBeAttached();
  }
}

/** Intenta degradar a una Admin y espera a que la pantalla explique que no se
 * puede. Lo que responde la base se finge, porque cuántos Admin tiene el club
 * de pruebas depende de qué otros tests estén corriendo. El aviso se busca
 * por su texto: el anunciador de rutas del dev server de Next también lleva
 * `role="alert"`. Desde #549 el rol se cambia en la ficha, no en la fila,
 * y desde #775 se abre con Cambiar rol en el ⋯ de la cabecera. */
function refuseLastAdminChange(name: string) {
  return async (page: Page): Promise<void> => {
    await page.route(
      (url) => /^\/api\/v1\/members\/[^/]+\/role$/.test(url.pathname),
      (route) =>
        route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "business_rule",
              message: "Es el último Admin del club.",
              reason: "last_admin",
            },
          }),
        }),
    );
    await chooseRecordAction(page, ENGLISH_RECORD_MENU, "Change role");
    await page
      .getByRole("combobox", { name: `Role for ${name}` })
      .selectOption("Player");
    await page
      .getByRole("button", { name: `Save the role for ${name}` })
      .click();
    await expect(page.getByText(/last Admin/)).toBeVisible();
  };
}

/** Escribe en la búsqueda y espera al desenlace: la tabla recortada, o la
 * frase de que nadie coincide. */
function searchFor(term: string, emptyText: RegExp | null) {
  return async (page: Page): Promise<void> => {
    await page.getByRole("searchbox").fill(term);
    if (emptyText === null) {
      await expect(
        page.getByRole("row", { name: "Mateo Restrepo" }),
      ).toBeVisible();
      await expect(page.getByRole("row", { name: "Ana Admin" })).toHaveCount(0);
    } else {
      await expect(page.getByText(emptyText)).toBeVisible();
    }
  };
}

/** La casilla de los dados de baja vive en Filtros desde #548: se marca y
 * se cierra, para que la captura enseñe la lista con su ficha. */
function includeFormerMembers(labels: FilterLabels, label: string) {
  return async (page: Page): Promise<void> => {
    const container = await filterContainer(page, labels);
    await container.getByRole("checkbox", { name: label }).check();
    await closeFilters(page, labels);
    await expect(page.getByRole("row", { name: "Zoe Zapata" })).toBeVisible();
  };
}

/** Abre la hoja del orden del móvil (#553), toca un campo y espera a que
 * se cierre. */
async function chooseSortInSheet(
  page: Page,
  labels: { readonly sortGroup: string; readonly sortButton: RegExp },
  field: string,
): Promise<void> {
  await page.getByRole("button", { name: labels.sortButton }).click();
  const sheet = page.getByRole("dialog", { name: labels.sortGroup });
  await sheet.getByRole("button", { name: new RegExp(`^${field}`) }).click();
  await expect(sheet).toHaveCount(0);
}

/** Pide el orden por asistencia de menor a mayor y espera a que llegue:
 * desde la cabecera en la tabla y desde el control en la lista de tarjetas,
 * según el ancho. Ascendente para que la captura se distinga del orden
 * alfabético, y con quien no tiene datos al final (AC-010). */
function sortByAttendance(labels: {
  readonly column: string;
  readonly sortGroup: string;
  readonly sortButton: RegExp;
}) {
  return async (page: Page): Promise<void> => {
    const header = page.getByRole("columnheader", { name: labels.column });
    if (await header.isVisible()) {
      // La asistencia empieza de mayor a menor (#549): el segundo clic la
      // pone de menor a mayor.
      await header.getByRole("button").click();
      await expect(header).toHaveAttribute("aria-sort", "descending");
      await header.getByRole("button").click();
      await expect(header).toHaveAttribute("aria-sort", "ascending");
    } else {
      // La hoja del móvil (#553): la asistencia empieza de mayor a menor, y
      // tocarla otra vez la pone de menor a mayor.
      await chooseSortInSheet(page, labels, labels.column);
      await chooseSortInSheet(page, labels, labels.column);
    }
    await expect(page.locator("tbody tr").first()).toHaveAccessibleName(
      "Nerea Ruiz",
    );
    await expect(page.locator("tbody tr").last()).toHaveAccessibleName(
      LONG_MEMBER_NAME,
    );
  };
}

/** La foto de la fila es decorativa (el nombre va al lado), así que se busca
 * por su dirección y no por su nombre accesible. */
async function waitForDirectoryPhoto(page: Page): Promise<void> {
  await expect(
    page.locator(`img[src="${STUBBED_PHOTO_URL}"]`),
  ).toHaveJSProperty("complete", true);
}

/* La foto grande (#355): pulsar la miniatura de una fila la abre en un
   diálogo. Las dos fotos fijas pasan por la misma reducción que una subida
   de verdad, así que el diálogo recibe lo que recibiría en producción: una
   WebP de 1024 px por el lado mayor. */

const LARGE_PHOTO_ENDPOINT = `${DIRECTORY_ENDPOINT}/${MEMBER_WITH_PHOTO_ID}/photo`;
const STUBBED_LARGE_PHOTO_URL =
  "https://fotos.test/member-photos/mateo-large.webp";
const PHOTO_FIXTURES_DIRECTORY = path.dirname(PROFILE_PHOTO_FIXTURE_PATH);
const LARGE_PHOTO_FIXTURES = {
  landscape: path.join(PHOTO_FIXTURES_DIRECTORY, "foto-apaisada-3000x2000.jpg"),
  portrait: path.join(PHOTO_FIXTURES_DIRECTORY, "foto-vertical-2000x3000.jpg"),
} as const;
type LargePhotoShape = keyof typeof LARGE_PHOTO_FIXTURES;
const OPEN_PHOTO_BUTTON =
  /^(Open the photo of|Abrir la foto de) Mateo Restrepo$/;
const LARGE_PHOTO_NAME = /^(Photo of|Foto de) Mateo Restrepo$/;

async function largeVersionOf(shape: LargePhotoShape): Promise<Buffer> {
  const shrunk = await shrinkProfilePhoto(
    readFileSync(LARGE_PHOTO_FIXTURES[shape]),
  );
  if (shrunk.kind !== "shrunk") {
    throw new Error(`La foto fija ${shape} no se pudo reducir.`);
  }
  return Buffer.from(shrunk.large.bytes);
}

/** El endpoint de #353 y la foto que firma. Con `failed`, el endpoint cae. */
async function stubLargePhoto(
  page: Page,
  shape: LargePhotoShape | "failed",
): Promise<void> {
  if (shape === "failed") {
    await page.route(
      (url) => url.pathname === LARGE_PHOTO_ENDPOINT,
      (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "internal_error", message: "x" },
          }),
        }),
    );
    return;
  }
  const photo = await largeVersionOf(shape);
  await page.route(STUBBED_LARGE_PHOTO_URL, (route) =>
    route.fulfill({ status: 200, contentType: "image/webp", body: photo }),
  );
  await page.route(
    (url) => url.pathname === LARGE_PHOTO_ENDPOINT,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { photoUrl: STUBBED_LARGE_PHOTO_URL } }),
      }),
  );
}

function photoDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Mateo Restrepo" });
}

/** Abre la foto de la fila y espera a que el diálogo termine: la grande
 * pintada entera, o el aviso de que no cargó. */
function openLargePhoto(shape: LargePhotoShape | "failed") {
  return async (page: Page): Promise<void> => {
    await waitForDirectoryPhoto(page);
    await stubLargePhoto(page, shape);
    await page.getByRole("button", { name: OPEN_PHOTO_BUTTON }).click();
    const dialog = photoDialog(page);
    await expect(dialog).toBeVisible();
    if (shape === "failed") {
      await expect(dialog.getByRole("alert")).toBeVisible();
      return;
    }
    await expect(
      dialog.getByRole("img", { name: LARGE_PHOTO_NAME }),
    ).toHaveJSProperty("complete", true);
    await expect(dialog.getByRole("status")).toHaveCount(0);
  };
}

/* Los filtros de #497, detrás del botón "Filtros" (#548): desde 768px abre
   un popover anclado al botón; por debajo, una hoja que sube desde abajo.
   Los dos se llaman "Filtros". */

type FilterLabels = {
  readonly toggle: string;
  readonly sheet: string;
  readonly position: string;
  readonly forward: string;
  readonly auf: string;
  readonly expired: string;
  readonly group: string;
  readonly senior: string;
};

const ENGLISH_FILTER_LABELS: FilterLabels = {
  toggle: "Filters",
  sheet: "Filters",
  position: "Position",
  forward: "Forward",
  auf: "AUF",
  expired: "Expired",
  group: "Group",
  senior: "Senior Squad",
};

const SPANISH_FILTER_LABELS: FilterLabels = {
  toggle: "Filtros",
  sheet: "Filtros",
  position: "Posición",
  forward: "Ataque",
  auf: "AUF",
  expired: "Vencido",
  group: "Grupo",
  senior: "Senior Squad",
};

function filterToggle(page: Page, labels: FilterLabels): Locator {
  return page.getByRole("button", {
    name: new RegExp(`^${labels.toggle}`),
  });
}

/** Abre los filtros: el popover o la hoja, según el ancho. */
async function filterContainer(
  page: Page,
  labels: FilterLabels,
): Promise<Locator> {
  await filterToggle(page, labels).click();
  const filters = page.getByRole("dialog", { name: labels.sheet });
  await expect(filters).toBeVisible();
  return filters;
}

/** Escape cierra el popover y la hoja por igual. */
async function closeFilters(page: Page, labels: FilterLabels): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: labels.sheet })).toHaveCount(0);
}

/** Elige una posición y el AUF vencido. Con `keepOpen`, el popover o la
 * hoja se quedan abiertos para la captura; si no, se cierran y quedan las
 * fichas y el botón con cuántos filtros hay activos. */
function chooseFilters(labels: FilterLabels, keepOpen: boolean) {
  return async (page: Page): Promise<void> => {
    const container = await filterContainer(page, labels);
    await container
      .getByRole("combobox", { name: labels.position })
      .selectOption({ label: labels.forward });
    await container
      .getByRole("combobox", { name: labels.auf })
      .selectOption({ label: labels.expired });
    await expect(page.getByRole("row", { name: "Ana Admin" })).toHaveCount(0);
    await expect(
      page.getByRole("row", { name: "Mateo Restrepo" }),
    ).toBeVisible();
    if (!keepOpen) {
      await closeFilters(page, labels);
    }
  };
}

/** Un grupo en el que no está nadie de la lista: el estado vacío con el
 * botón de quitar los filtros. */
function filterToNobody(labels: FilterLabels, emptyText: RegExp) {
  return async (page: Page): Promise<void> => {
    const container = await filterContainer(page, labels);
    await container
      .getByRole("combobox", { name: labels.group })
      .selectOption({ label: labels.senior });
    await closeFilters(page, labels);
    await expect(page.getByText(emptyText)).toBeVisible();
  };
}

/** Un rol y después un grupo en el que no está nadie: el estado vacío de
 * #549, con el rol y el filtro en su frase. */
function filterRoleToNobody(
  labels: FilterLabels,
  options: { readonly role: string; readonly emptyText: RegExp },
) {
  return async (page: Page): Promise<void> => {
    // El radio va escondido bajo su etiqueta, que es lo que se pulsa.
    await page
      .getByRole("radio", { name: options.role })
      .check({ force: true });
    await filterToNobody(labels, options.emptyText)(page);
  };
}

/** La lista fija con el socio invitado delante, como sale por nombre. */
const WITH_INVITED_MEMBER: readonly StubbedMember[] = [
  INVITED_MEMBER,
  ...STUBBED_DIRECTORY_MEMBERS,
];

/* El contacto de cada socio (#499): la casilla "Sin teléfono" de quien ve
   todo el contacto. La lista ya no lo enseña (#571): vive en la ficha. */

type ContactLabels = {
  readonly withoutPhone: string;
  readonly filters: FilterLabels;
};

const ENGLISH_CONTACT_LABELS: ContactLabels = {
  withoutPhone: "No phone",
  filters: ENGLISH_FILTER_LABELS,
};

const SPANISH_CONTACT_LABELS: ContactLabels = {
  withoutPhone: "Sin teléfono",
  filters: SPANISH_FILTER_LABELS,
};

/** La fila de Nerea ya pintada: la lista de un Coach, que ya no lleva el
 * contacto (#571), está entera. */
async function waitForNereaRow(page: Page): Promise<void> {
  await expect(page.getByRole("row", { name: "Nerea Ruiz" })).toBeVisible();
}

/** Marca "Sin teléfono": quedan Nerea, con contacto de emergencia, y el
 * nombre más largo, sin ninguno. Se cierra la hoja del móvil para que la
 * captura enseñe la lista. */
function filterWithoutPhone(labels: ContactLabels) {
  return async (page: Page): Promise<void> => {
    const container = await filterContainer(page, labels.filters);
    await container
      .getByRole("checkbox", { name: labels.withoutPhone })
      .check();
    await closeFilters(page, labels.filters);
    await expect(page.getByRole("row", { name: "Ana Admin" })).toHaveCount(0);
    // La fila de Nerea, y no su contacto: en el móvil, el de un Admin se
    // queda en la ficha (#553). La fila y su contacto se pintan juntos.
    await expect(page.getByRole("row", { name: "Nerea Ruiz" })).toBeVisible();
  };
}

type DirectoryState = {
  readonly name: string;
  /** Un Admin recibe la lista marcada como suya, y con ella el control de los
   * dados de baja y la marca del AUF vencido. */
  readonly asAdmin: boolean;
  /** Un Coach recibe la lista con la marca de sin evaluar (#324). */
  readonly asCoach?: boolean;
  /** Sólo cuenta para un Admin, que es a quien se le carga la bandeja. */
  readonly withRequests?: boolean;
  /** Una de las filas sale con foto en vez de iniciales (#245). */
  readonly withPhoto?: boolean;
  /** La lista que sirve el endpoint, si no es la fija. */
  readonly members?: readonly StubbedMember[];
  /** Termina con un diálogo modal abierto (#355). Se fotografía lo que se ve
   * en la ventana: a página entera la capa modal, que es fija, sale partida a
   * media altura. */
  readonly endsInModal?: boolean;
  readonly listHeading: string;
  readonly beforeVisit?: (page: Page) => Promise<void>;
  readonly prepare?: (page: Page) => Promise<void>;
};

/* El correo del directorio (#501): el formulario, el diálogo que confirma,
   el envío que no cabe y el que falla a medias. Las respuestas del endpoint
   son de mentira: lo que hace de verdad lo prueban el dominio y la ruta. */
const DIRECTORY_EMAILS_ENDPOINT = "/api/v1/directory/emails";

type EmailLabels = {
  readonly open: string;
  /** En el móvil el correo se abre desde el "⋯" (#553). */
  readonly more: string;
  readonly moreEmail: RegExp;
  readonly subject: string;
  readonly message: string;
  readonly send: string;
  readonly dialog: string;
  readonly confirm: string;
  readonly remaining: RegExp;
};

const ENGLISH_EMAIL_LABELS: EmailLabels = {
  open: "Write an email",
  more: "More actions",
  moreEmail: /^Email these members/,
  subject: "Subject",
  message: "Message",
  send: "Send",
  dialog: "Send the email?",
  confirm: "Send now",
  remaining: /emails? left today/,
};

const SPANISH_EMAIL_LABELS: EmailLabels = {
  open: "Escribir correo",
  more: "Más acciones",
  moreEmail: /^Escribir a estos miembros/,
  subject: "Asunto",
  message: "Mensaje",
  send: "Enviar",
  dialog: "¿Mandar el correo?",
  confirm: "Mandar",
  remaining: /correos? del directorio/,
};

type EmailAnswer = {
  /** Lo que responde cada lectura del cupo, en orden; la última se repite. */
  readonly quota: readonly number[];
  readonly send: { readonly status: number; readonly body: unknown };
};

const EMAIL_SENT_TO_ALL: EmailAnswer = {
  quota: [38],
  send: {
    status: 200,
    body: { data: { sentCount: 3, failed: [], remaining: 35 } },
  },
};

const EMAIL_DOES_NOT_FIT: EmailAnswer = {
  quota: [38, 1],
  send: {
    status: 409,
    body: {
      error: {
        code: "conflict",
        message: "No caben.",
        reason: "directory_email_quota_exceeded",
      },
    },
  },
};

const EMAIL_PARTLY_SENT: EmailAnswer = {
  quota: [38],
  send: {
    status: 200,
    body: {
      data: {
        sentCount: 1,
        failed: [
          {
            userId: "33333333-0000-4000-8000-000000000003",
            fullName: "Nerea Ruiz",
          },
          {
            userId: "44444444-0000-4000-8000-000000000004",
            fullName: LONG_MEMBER_NAME,
          },
        ],
        remaining: 37,
      },
    },
  },
};

function stubDirectoryEmails(answer: EmailAnswer) {
  return async (page: Page): Promise<void> => {
    const quotas = [...answer.quota];
    await page.route(
      (url) => url.pathname === DIRECTORY_EMAILS_ENDPOINT,
      (route, request) => {
        if (request.method() === "POST") {
          return route.fulfill({
            status: answer.send.status,
            contentType: "application/json",
            body: JSON.stringify(answer.send.body),
          });
        }
        const remaining = quotas.length > 1 ? quotas.shift() : quotas[0];
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { limit: 50, remaining } }),
        });
      },
    );
  };
}

/** Pone las respuestas del correo y, si toca, el idioma. */
function beforeEmailVisit(answer: EmailAnswer, isSpanish: boolean) {
  return async (page: Page): Promise<void> => {
    await stubDirectoryEmails(answer)(page);
    if (isSpanish) {
      await chooseSpanish(page);
    }
  };
}

/** Abre el formulario: con el botón de la cabecera de escritorio, o desde
 * la hoja del "⋯" en el móvil (#553). */
async function openEmailForm(page: Page, labels: EmailLabels): Promise<void> {
  const headerButton = page.getByRole("button", { name: labels.open });
  if (await headerButton.isVisible()) {
    await headerButton.click();
    return;
  }
  await page.getByRole("button", { name: labels.more }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: labels.moreEmail })
    .click();
}

/** Abre el formulario y escribe un correo de varias líneas. */
function writeEmail(labels: EmailLabels) {
  return async (page: Page): Promise<void> => {
    await openEmailForm(page, labels);
    await page
      .getByRole("textbox", { name: labels.subject })
      .fill("Saturday training moves to 8am");
    await page
      .getByRole("textbox", { name: labels.message })
      .fill("Hi all,\n\nThis Saturday we start at 8am sharp.\nBring fins.");
  };
}

/** Escribe, pulsa enviar y espera a que el diálogo diga cuántos quedan. */
function confirmEmail(labels: EmailLabels) {
  return async (page: Page): Promise<void> => {
    await writeEmail(labels)(page);
    await page.getByRole("button", { name: labels.send, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: labels.dialog });
    await expect(dialog.getByText(labels.remaining)).toBeVisible();
  };
}

/** Confirma el envío y espera lo que diga la pantalla después. */
function sendEmail(labels: EmailLabels, outcome: RegExp) {
  return async (page: Page): Promise<void> => {
    await confirmEmail(labels)(page);
    await page
      .getByRole("dialog", { name: labels.dialog })
      .getByRole("button", { name: labels.confirm, exact: true })
      .click();
    await expect(page.getByText(outcome)).toBeVisible();
    await expect(page.getByRole("dialog", { name: labels.dialog })).toHaveCount(
      0,
    );
  };
}

function emailStates(spanish: boolean): readonly DirectoryState[] {
  const suffix = spanish ? "-es" : "";
  const labels = spanish ? SPANISH_EMAIL_LABELS : ENGLISH_EMAIL_LABELS;
  const listHeading = spanish
    ? SPANISH_DIRECTORY_HEADING
    : ENGLISH_DIRECTORY_HEADING;
  return [
    {
      name: `correo-formulario${suffix}`,
      asAdmin: true,
      listHeading,
      beforeVisit: beforeEmailVisit(EMAIL_SENT_TO_ALL, spanish),
      prepare: writeEmail(labels),
    },
    {
      name: `correo-confirmacion${suffix}`,
      asAdmin: true,
      endsInModal: true,
      listHeading,
      beforeVisit: beforeEmailVisit(EMAIL_SENT_TO_ALL, spanish),
      prepare: confirmEmail(labels),
    },
    {
      name: `correo-no-cabe${suffix}`,
      asAdmin: true,
      listHeading,
      beforeVisit: beforeEmailVisit(EMAIL_DOES_NOT_FIT, spanish),
      prepare: sendEmail(labels, spanish ? /No caben/ : /It doesn't fit/),
    },
    {
      name: `correo-resultado-parcial${suffix}`,
      asAdmin: true,
      listHeading,
      beforeVisit: beforeEmailVisit(EMAIL_PARTLY_SENT, spanish),
      prepare: sendEmail(labels, spanish ? /No llegó a/ : /It didn't reach/),
    },
  ];
}

const DIRECTORY_STATES: readonly DirectoryState[] = [
  {
    name: "directorio-con-miembros",
    asAdmin: false,
    listHeading: ENGLISH_DIRECTORY_HEADING,
  },
  {
    name: "directorio-con-foto",
    asAdmin: false,
    withPhoto: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: waitForDirectoryPhoto,
  },
  {
    name: "directorio-con-foto-es",
    asAdmin: false,
    withPhoto: true,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
    prepare: waitForDirectoryPhoto,
  },
  {
    name: "directorio-foto-grande-apaisada",
    asAdmin: false,
    withPhoto: true,
    endsInModal: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: openLargePhoto("landscape"),
  },
  {
    name: "directorio-foto-grande-vertical",
    asAdmin: false,
    withPhoto: true,
    endsInModal: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: openLargePhoto("portrait"),
  },
  {
    name: "directorio-foto-grande-error",
    asAdmin: false,
    withPhoto: true,
    endsInModal: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: openLargePhoto("failed"),
  },
  {
    name: "directorio-foto-grande-apaisada-es",
    asAdmin: false,
    withPhoto: true,
    endsInModal: true,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
    prepare: openLargePhoto("landscape"),
  },
  {
    name: "directorio-con-miembros-es",
    asAdmin: false,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
  },
  {
    name: "directorio-filtrado",
    asAdmin: false,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: searchFor("re", null),
  },
  {
    name: "directorio-sin-resultados",
    asAdmin: false,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: searchFor("zzz", /No members match these filters/),
  },
  {
    name: "directorio-sin-resultados-es",
    asAdmin: false,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
    prepare: searchFor("zzz", /Ningún miembro coincide/),
  },
  {
    name: "directorio-con-inactivos",
    asAdmin: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: includeFormerMembers(
      ENGLISH_FILTER_LABELS,
      "Include deactivated accounts",
    ),
  },
  {
    name: "directorio-con-inactivos-es",
    asAdmin: true,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
    prepare: includeFormerMembers(
      SPANISH_FILTER_LABELS,
      "Incluir las cuentas desactivadas",
    ),
  },
  {
    name: "directorio-admin-con-solicitudes",
    asAdmin: true,
    withRequests: true,
    members: WITH_INVITED_MEMBER,
    listHeading: ENGLISH_DIRECTORY_HEADING,
  },
  {
    name: "directorio-admin-con-solicitudes-es",
    asAdmin: true,
    withRequests: true,
    members: WITH_INVITED_MEMBER,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
  },
  // El estado vacío del handoff de E21 (#549): con un rol y un filtro, la
  // frase dice los dos.
  {
    name: "directorio-vacio",
    asAdmin: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: filterRoleToNobody(ENGLISH_FILTER_LABELS, {
      role: "Committee",
      emptyText: /No members match these filters/,
    }),
  },
  {
    name: "directorio-vacio-es",
    asAdmin: true,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
    prepare: filterRoleToNobody(SPANISH_FILTER_LABELS, {
      role: "Comité",
      emptyText: /Ningún miembro coincide/,
    }),
  },
  {
    name: "directorio-admin-sin-solicitudes",
    asAdmin: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
  },
  {
    name: "directorio-coach-sin-evaluar",
    asAdmin: false,
    asCoach: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
  },
  {
    name: "directorio-coach-sin-evaluar-es",
    asAdmin: false,
    asCoach: true,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
  },
  {
    name: "directorio-orden-asistencia",
    asAdmin: false,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: sortByAttendance({
      column: "Attendance",
      sortGroup: "Sort by",
      sortButton: /^Sort:/,
    }),
  },
  {
    name: "directorio-orden-asistencia-es",
    asAdmin: false,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
    prepare: sortByAttendance({
      column: "Asistencia",
      sortGroup: "Ordenar por",
      sortButton: /^Orden:/,
    }),
  },
  {
    name: "directorio-filtros-abiertos",
    asAdmin: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: chooseFilters(ENGLISH_FILTER_LABELS, false),
  },
  {
    name: "directorio-filtros-abiertos-es",
    asAdmin: true,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
    prepare: chooseFilters(SPANISH_FILTER_LABELS, false),
  },
  {
    name: "directorio-filtros-popover",
    asAdmin: true,
    endsInModal: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: chooseFilters(ENGLISH_FILTER_LABELS, true),
  },
  {
    name: "directorio-filtros-popover-es",
    asAdmin: true,
    endsInModal: true,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
    prepare: chooseFilters(SPANISH_FILTER_LABELS, true),
  },
  {
    name: "directorio-filtros-movil",
    asAdmin: true,
    endsInModal: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: chooseFilters(ENGLISH_FILTER_LABELS, true),
  },
  {
    name: "directorio-filtros-movil-es",
    asAdmin: true,
    endsInModal: true,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
    prepare: chooseFilters(SPANISH_FILTER_LABELS, true),
  },
  {
    name: "directorio-filtrado-sin-resultados",
    asAdmin: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: filterToNobody(
      ENGLISH_FILTER_LABELS,
      /No members match these filters/,
    ),
  },
  {
    name: "directorio-contacto-admin",
    asAdmin: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: filterWithoutPhone(ENGLISH_CONTACT_LABELS),
  },
  {
    name: "directorio-contacto-admin-es",
    asAdmin: true,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
    prepare: filterWithoutPhone(SPANISH_CONTACT_LABELS),
  },
  {
    name: "directorio-contacto-coach",
    asAdmin: false,
    asCoach: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: waitForNereaRow,
  },
  {
    name: "directorio-contacto-coach-es",
    asAdmin: false,
    asCoach: true,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
    prepare: waitForNereaRow,
  },
  {
    name: "directorio-filtrado-sin-resultados-es",
    asAdmin: true,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
    prepare: filterToNobody(SPANISH_FILTER_LABELS, /Ningún miembro coincide/),
  },
  ...emailStates(false),
  ...emailStates(true),
];

async function goToDirectory(
  page: Page,
  state: DirectoryState,
  theme?: (typeof themes)[number],
): Promise<void> {
  await stubDirectoryReads(page, state);
  await state.beforeVisit?.(page);
  if (theme === undefined) {
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);
  } else {
    await goToWithTheme(page, DIRECTORY_SCREEN_PATH, theme);
  }
  await waitForDirectory(page, state.listHeading, state.asAdmin);
  await state.prepare?.(page);
}

for (const state of DIRECTORY_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToDirectory(page, state, theme);
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              const fullPage = state.endsInModal !== true;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }

        test("has no horizontal scroll", async ({ page }) => {
          await goToDirectory(page, state);
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
        });
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await goToDirectory(page, state);
      await expectNoAxeViolations(page);
    });
  });
}

/* En la lista de tarjetas no hay cabeceras que den nombre a la cifra: la
   etiqueta que escribe la hoja de estilos entra en el nombre accesible de la
   celda, y un lector de pantalla oye "Attendance 92%", no un número suelto
   (#396). jsdom no aplica la hoja de estilos, así que sólo se ve aquí. */
test.describe("la asistencia en la lista de tarjetas", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: ADMIN_STORAGE_STATE,
    viewport: { width: 375, height: 812 },
  });

  const state: DirectoryState = {
    name: "directorio-con-miembros",
    asAdmin: false,
    listHeading: ENGLISH_DIRECTORY_HEADING,
  };

  test("cada cifra se oye con su nombre, con datos y sin datos", async ({
    page,
  }) => {
    await goToDirectory(page, state);

    await expect(
      page.getByRole("row", { name: "Ana Admin" }).getByRole("cell").last(),
    ).toHaveAccessibleName(/^Attendance\s*92%$/);
    await expect(
      page
        .getByRole("row", { name: LONG_MEMBER_NAME })
        .getByRole("cell")
        .last(),
    ).toHaveAccessibleName(/^Attendance\s*No data$/);
  });
});

/* El nombre se lleva el ancho de la fila (#575): a 768px el menú lateral
   deja a la tabla unos 500px, y el rol, la posición y la asistencia miden lo
   justo para lo suyo. El nombre nunca se recorta ni se abrevia: si no cabe,
   baja entero a otra línea. */

/** Las líneas que ocupa el texto de un elemento, contadas por la altura a la
 * que empieza cada trozo de texto y no por el alto de su caja, que en una
 * píldora o una celda lleva además el borde y el aire. */
async function renderedLineCount(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const lineTops = new Set<number>();
    for (
      let node = walker.nextNode();
      node !== null;
      node = walker.nextNode()
    ) {
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0) {
          lineTops.add(Math.round(rect.top));
        }
      }
    }
    return lineTops.size;
  });
}

/** El alto de la fila de Nerea, una Player, a 1440px antes de #575. */
const DESKTOP_PLAYER_ROW_HEIGHT = 57.75;
const ROW_HEIGHT_TOLERANCE = 2;
/** "Su borde superior a ±4 px del de Filters" (#575). */
const TOOLBAR_ALIGNMENT_TOLERANCE = 4;

test.describe("el nombre se lleva el ancho de la fila del directorio", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  const state: DirectoryState = {
    name: "directorio-nombre-entero",
    asAdmin: true,
    withRequests: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
  };

  // Zoe, la única Committee de la lista fija, de alta: el rol más largo
  // tiene que estar en la lista sin pedir los dados de baja.
  const withActiveCommittee: DirectoryState = {
    ...state,
    members: STUBBED_DIRECTORY_MEMBERS.map((member) =>
      member.fullName === "Zoe Zapata"
        ? { ...member, status: "active" as const }
        : member,
    ),
  };

  /** El nombre visible de una fila, que a un Admin le enlaza su ficha. */
  function memberNameIn(page: Page, name: string): Locator {
    return page
      .getByRole("row", { name })
      .getByRole("link", { name: `Open ${name}'s record` });
  }

  test("a 768 px un nombre corto cabe en una línea", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await goToDirectory(page, state);

    expect(await renderedLineCount(memberNameIn(page, "Mateo Restrepo"))).toBe(
      1,
    );
  });

  test("a 768 px un nombre largo se lee entero en dos líneas como mucho", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await goToDirectory(page, state);
    const name = memberNameIn(page, LONG_MEMBER_NAME);

    expect(await renderedLineCount(name)).toBeLessThanOrEqual(2);
    await expect(name).toHaveText(LONG_MEMBER_NAME);
    expect(await wordsSplitAcrossLines(page)).toEqual([]);
    const clipping = await name.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        overflows: element.scrollWidth > element.clientWidth,
        textOverflow: style.textOverflow,
        lineClamp: style.webkitLineClamp,
      };
    });
    expect(clipping).toEqual({
      overflows: false,
      textOverflow: "clip",
      lineClamp: "none",
    });
  });

  for (const width of [375, 768, 1024, 1440]) {
    test(`la píldora de sin evaluar no se parte (${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1024 });
      await goToDirectory(page, state);
      const mark = page
        .getByRole("row", { name: LONG_MEMBER_NAME })
        .getByRole("link", { name: /^Not evaluated/ });

      expect(await renderedLineCount(mark)).toBe(1);
    });
  }

  test("rol, posición y asistencia no se parten a 768 px", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await goToDirectory(page, withActiveCommittee);
    const cells = [
      page
        .getByRole("row", { name: "Zoe Zapata" })
        .getByRole("cell", { name: "Committee" }),
      page
        .getByRole("row", { name: "Nerea Ruiz" })
        .getByRole("cell", { name: "Goalkeeper" }),
      page
        .getByRole("row", { name: LONG_MEMBER_NAME })
        .getByRole("cell", { name: "No data" }),
    ];

    for (const cell of cells) {
      expect(await renderedLineCount(cell)).toBe(1);
    }
  });

  for (const width of [768, 1024, 1440]) {
    test(`el botón del panel comparte línea con Filters (${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await goToDirectory(page, state);

      const filters = await filterToggle(
        page,
        ENGLISH_FILTER_LABELS,
      ).boundingBox();
      const panel = await page
        .getByRole("button", { name: /^Side panel/ })
        .boundingBox();
      expect(
        Math.abs((panel?.y ?? Infinity) - (filters?.y ?? 0)),
      ).toBeLessThanOrEqual(TOOLBAR_ALIGNMENT_TOLERANCE);
    });
  }

  for (const width of [375, 768, 1440]) {
    test(`la segunda línea de la última fila no se recorta (${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1024 });
      await goToDirectory(page, state);
      // Desde 768px es el país y el nivel; en el móvil, el rol y la
      // posición.
      const secondLine = page
        .getByRole("row")
        .last()
        .locator(width >= 768 ? ".directory-meta" : ".directory-position-cell");

      const line = await secondLine.boundingBox();
      const card = await page.locator(".directory-card").boundingBox();
      expect((line?.y ?? Infinity) + (line?.height ?? 0)).toBeLessThanOrEqual(
        (card?.y ?? 0) + (card?.height ?? 0),
      );
    });
  }

  test("a 1440 px la fila de un Player mantiene su alto", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToDirectory(page, state);

    const row = await page
      .getByRole("row", { name: "Nerea Ruiz" })
      .boundingBox();
    expect(
      Math.abs((row?.height ?? 0) - DESKTOP_PLAYER_ROW_HEIGHT),
    ).toBeLessThanOrEqual(ROW_HEIGHT_TOLERANCE);
    expect(await renderedLineCount(memberNameIn(page, "Mateo Restrepo"))).toBe(
      1,
    );
  });
});

/* La hoja de filtros del móvil (#497) con el teclado: el foco entra al
   abrirla, no sale mientras está abierta, y Escape la cierra devolviéndolo al
   botón. Y cada control mide al menos 44 px. */
test.describe("la hoja de filtros del directorio en el móvil", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: ADMIN_STORAGE_STATE,
    viewport: { width: 375, height: 812 },
  });

  const state: DirectoryState = {
    name: "directorio-filtros-movil",
    asAdmin: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
  };

  test("se recorre con el teclado y Escape devuelve el foco al botón", async ({
    page,
  }) => {
    await goToDirectory(page, state);
    const toggle = filterToggle(page, ENGLISH_FILTER_LABELS);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await toggle.focus();
    await page.keyboard.press("Enter");

    const sheet = page.getByRole("dialog", { name: "Filters" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("combobox").first()).toBeFocused();
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press("Tab");
      expect(
        await sheet.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(true);
    }

    await page.keyboard.press("Escape");

    await expect(sheet).toHaveCount(0);
    await expect(toggle).toBeFocused();
  });

  test("el botón y cada control de la hoja miden al menos 44 px", async ({
    page,
  }) => {
    await goToDirectory(page, state);
    const toggle = filterToggle(page, ENGLISH_FILTER_LABELS);
    expect((await toggle.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    await toggle.click();

    const sheet = page.getByRole("dialog", { name: "Filters" });
    const controls = sheet.locator("select, button");
    await expect(controls).toHaveCount(5);
    for (const control of await controls.all()) {
      expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("los filtros elegidos siguen ahí al recargar", async ({ page }) => {
    await goToDirectory(page, state);
    await chooseFilters(ENGLISH_FILTER_LABELS, false)(page);
    await expect(page).toHaveURL(/auf=expired/);

    await page.reload();

    await expect(
      page.getByRole("button", { name: "Filters: 2 active" }),
    ).toBeVisible();
    await expect(page.getByRole("row", { name: "Ana Admin" })).toHaveCount(0);
  });
});

/* El popover de Filtros en escritorio (#548): el foco entra al abrirlo,
   Escape lo cierra devolviéndolo al botón, y a 768px, el ancho más justo,
   cabe entero en la ventana. Tampoco se mete bajo el menú lateral: cuando
   Filtros queda a la izquierda de la línea (#575), el popover se corre a la
   derecha hasta el borde de la barra. */
test.describe("el popover de filtros del directorio en escritorio", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  const state: DirectoryState = {
    name: "directorio-filtros-popover",
    asAdmin: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
  };

  for (const width of [768, 1440]) {
    test(`a ${width}px cabe en la ventana y Escape devuelve el foco`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await goToDirectory(page, state);
      const toggle = filterToggle(page, ENGLISH_FILTER_LABELS);

      await toggle.focus();
      await page.keyboard.press("Enter");

      const popover = page.getByRole("dialog", { name: "Filters" });
      await expect(popover).toBeVisible();
      await expect(popover.getByRole("combobox").first()).toBeFocused();
      const box = await popover.boundingBox();
      const toolbar = await page.locator(".directory-toolbar").boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(toolbar?.x ?? Infinity);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);

      await page.keyboard.press("Escape");

      await expect(popover).toHaveCount(0);
      await expect(toggle).toBeFocused();
    });
  }
});

/* El panel lateral con la ficha rápida del socio (#550) y, sin nadie
   elegido, el resumen del club (#551, mockup
   docs/mockups/directory-admin-overview-with-requests-dark.png). Mockups:
   docs/mockups/directory-admin-member-selected-role-confirm-dark.png y
   directory-admin-invited-member-dark.png; el tema claro y el Coach se
   revisan contra design-system.md. Sólo existe desde 768px: por debajo, la
   ficha que sube llega en su propio ticket. Entre 768 y 1199px se abre por
   encima de la lista, así que se fotografía la ventana y no la página. */
const PANEL_VIEWPORTS = viewports.filter((vp) => vp.width >= 768);

/** Pulsa la fila y espera a que su ficha esté en el panel. */
function selectMember(name: string) {
  return async (page: Page): Promise<void> => {
    await page.getByRole("row", { name }).click();
    await expect(
      page.getByRole("region", { name: `Details of ${name}` }),
    ).toBeVisible();
  };
}

/** Elige otro rol en la ficha y espera a la franja que lo confirma. */
function pickRoleInPanel(name: string, role: string, strip: string) {
  return async (page: Page): Promise<void> => {
    await selectMember(name)(page);
    const card = page.getByRole("region", { name: `Details of ${name}` });
    // El radio va escondido bajo su segmento, que es lo que se pulsa.
    await card
      .getByRole("group", { name: "Role" })
      .getByRole("radio", { name: role })
      .check({ force: true });
    await expect(card.getByText(strip)).toBeVisible();
  };
}

/** Abre el panel sin nadie elegido y espera al resumen del club (#551). El
 * botón cuenta las solicitudes en su nombre cuando las hay. */
async function openClubOverview(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Side panel/ }).click();
  await expect(
    page
      .getByRole("region", { name: "Side panel" })
      .getByRole("heading", { name: "Club overview" }),
  ).toBeVisible();
}

const PANEL_STATES: readonly DirectoryState[] = [
  {
    name: "directorio-resumen",
    asAdmin: true,
    withRequests: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: openClubOverview,
  },
  {
    name: "directorio-resumen-sin-solicitudes",
    asAdmin: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: openClubOverview,
  },
  {
    name: "directorio-ficha-rapida",
    asAdmin: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: selectMember("Nerea Ruiz"),
  },
  {
    name: "directorio-ficha-cambio-rol",
    asAdmin: true,
    withRequests: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: pickRoleInPanel("Nerea Ruiz", "Committee", "Player → Committee"),
  },
  {
    name: "directorio-ficha-invitado",
    asAdmin: true,
    members: WITH_INVITED_MEMBER,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: selectMember("Alex Kim"),
  },
  {
    name: "directorio-ficha-rapida-coach",
    asAdmin: false,
    asCoach: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: selectMember("Nerea Ruiz"),
  },
];

/* La selección múltiple del directorio (#552). Mockup:
   docs/mockups/directory-admin-bulk-selection-confirm-dark.png; el tema
   claro se revisa contra design-system.md. Como el panel, sólo existe desde
   768px. El cambio en bloque no llega a guardarse: la franja es lo último. */

/** Marca las filas y espera a la barra que las cuenta. */
function checkMembers(names: readonly string[]) {
  return async (page: Page): Promise<void> => {
    for (const name of names) {
      await page.getByRole("checkbox", { name: `Select ${name}` }).check();
    }
    await expect(
      page.getByRole("group", { name: `${names.length} selected` }),
    ).toBeVisible();
  };
}

/** Marca las filas, elige un rol en "Change role" y espera a la franja. */
function pickBulkRole(names: readonly string[], role: string) {
  return async (page: Page): Promise<void> => {
    await checkMembers(names)(page);
    const bar = page.getByRole("group", { name: `${names.length} selected` });
    await bar.getByRole("button", { name: "Change role" }).click();
    await bar.getByRole("button", { name: role, exact: true }).click();
    await expect(
      page.getByText(`Change ${names.length} members to ${role}?`),
    ).toBeVisible();
  };
}

const BULK_STATES: readonly DirectoryState[] = [
  {
    name: "directorio-seleccion",
    asAdmin: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: checkMembers(["Mateo Restrepo", "Nerea Ruiz"]),
  },
  {
    name: "directorio-seleccion-cambio-rol",
    asAdmin: true,
    withRequests: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: pickBulkRole(
      ["Ana Admin", "Mateo Restrepo", "Nerea Ruiz"],
      "Coach",
    ),
  },
];

for (const state of [...PANEL_STATES, ...BULK_STATES]) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of PANEL_VIEWPORTS) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        for (const theme of themes) {
          test(`matches approved baseline (${theme})`, async ({ page }) => {
            await goToDirectory(page, state, theme);
            const snapshot = `${state.name}-${vp.name}-${theme}.png`;
            await createMissingLocalBaseline(snapshot, () =>
              page.screenshot(SCREENSHOT_OPTIONS),
            );
            await expect(page).toHaveScreenshot(snapshot, {
              ...SCREENSHOT_OPTIONS,
              maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
            });
          });

          test(`has no accessibility violations (${theme})`, async ({
            page,
          }) => {
            await goToDirectory(page, state, theme);
            await expectNoAxeViolations(page);
          });
        }

        test("has no horizontal scroll", async ({ page }) => {
          await goToDirectory(page, state);
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
        });
      });
    }
  });
}

/* Con el teclado: Enter sobre la fila abre su ficha, Esc la cierra y el foco
   vuelve a la fila. */
test.describe("el panel lateral del directorio con el teclado", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: ADMIN_STORAGE_STATE,
    viewport: { width: 1440, height: 900 },
  });

  test("Enter abre la ficha y Esc la cierra devolviendo el foco", async ({
    page,
  }) => {
    await goToDirectory(page, {
      name: "directorio-ficha-teclado",
      asAdmin: true,
      listHeading: ENGLISH_DIRECTORY_HEADING,
    });
    const row = page.getByRole("row", { name: "Nerea Ruiz" });

    await row.focus();
    await page.keyboard.press("Enter");
    const card = page.getByRole("region", { name: "Details of Nerea Ruiz" });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Close the panel" }).focus();
    await page.keyboard.press("Escape");

    await expect(card).toHaveCount(0);
    await expect(row).toBeFocused();
  });
});

/* Entre 768 y 1199px el panel se abre encima de la lista, nunca de la
   barra: su botón tiene que seguir pulsándose para cerrarlo. Playwright no
   pulsa un botón que otro elemento tapa. */
test.describe("el botón del panel lateral a 768px", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: ADMIN_STORAGE_STATE,
    viewport: { width: 768, height: 1024 },
  });

  test("sigue a la vista y cierra el panel abierto", async ({ page }) => {
    await goToDirectory(page, {
      name: "directorio-ficha-boton",
      asAdmin: true,
      listHeading: ENGLISH_DIRECTORY_HEADING,
      prepare: selectMember("Nerea Ruiz"),
    });

    await page.getByRole("button", { name: "Side panel" }).click();

    await expect(
      page.getByRole("region", { name: "Details of Nerea Ruiz" }),
    ).toHaveCount(0);
  });
});

/* Los filtros de #497 piden axe en cada ancho y en los dos temas, no sólo en
   el ancho por defecto: la barra y la hoja son controles distintos. El
   contacto de #499 también: la columna de la tabla y la tarjeta del móvil
   son marcados distintos. Y el correo de #501: el formulario, el diálogo y
   el resultado se piden en los dos temas. */
test.describe("los filtros del directorio con axe en cada ancho y tema", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  const filterStates = DIRECTORY_STATES.filter((state) =>
    /^(directorio-(filtros|filtrado-sin|contacto)|correo-)/.test(state.name),
  );

  for (const vp of viewports) {
    test.describe(`@ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const state of filterStates) {
        for (const theme of themes) {
          test(`${state.name} (${theme}) no tiene violaciones`, async ({
            page,
          }) => {
            await goToDirectory(page, state, theme);
            await expectNoAxeViolations(page);
          });
        }
      }
    });
  }
});

/* El directorio en el móvil (#553, RF-7 del PRD de E21; mockups
   docs/mockups/mobile-directory-admin-*-dark.png): la lista con el aviso de
   solicitudes, la hoja del orden, la del "⋯" y la pantalla de solicitudes.
   Sólo a 375px: desde 768px nada de esto se ve. */

const MOBILE_DIRECTORY_VIEWPORT = { width: 375, height: 812 } as const;

async function openSortSheet(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Sort:/ }).click();
  await expect(page.getByRole("dialog", { name: "Sort by" })).toBeVisible();
}

async function openMoreSheet(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(
    page.getByRole("dialog", { name: /members? in this view$/ }),
  ).toBeVisible();
}

async function openRequestsScreen(page: Page): Promise<void> {
  await page.getByRole("button", { name: /role requests? waiting/ }).click();
  await expect(
    page.getByRole("heading", { name: "Role requests" }),
  ).toBeFocused();
}

/** Toca la fila y espera a que su ficha haya subido (#554). */
function openMemberSheet(name: string) {
  return async (page: Page): Promise<void> => {
    await page.getByRole("row", { name }).click();
    await expect(page.getByRole("dialog", { name })).toBeVisible();
  };
}

/** Desliza la fila con el ratón: los eventos de puntero son los mismos que
 * los del dedo. Espera a que la fila haya terminado de correrse. */
function swipeRowLeft(name: string) {
  return async (page: Page): Promise<void> => {
    const row = page.getByRole("row", { name });
    const box = await row.boundingBox();
    if (box === null) {
      throw new Error(`La fila de ${name} no está en la pantalla`);
    }
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width - 40, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 140, y, { steps: 5 });
    await page.mouse.up();
    await expect(
      row.getByRole("group", { name: `Actions for ${name}` }),
    ).toBeVisible();
    await row.evaluate((element) =>
      Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      ),
    );
  };
}

const MOBILE_DIRECTORY_STATES: readonly DirectoryState[] = [
  {
    name: "directorio-movil",
    asAdmin: true,
    withRequests: true,
    members: WITH_INVITED_MEMBER,
    listHeading: ENGLISH_DIRECTORY_HEADING,
  },
  {
    name: "directorio-movil-orden",
    asAdmin: true,
    withRequests: true,
    endsInModal: true,
    members: WITH_INVITED_MEMBER,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: openSortSheet,
  },
  {
    name: "directorio-movil-menu",
    asAdmin: true,
    withRequests: true,
    endsInModal: true,
    members: WITH_INVITED_MEMBER,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: openMoreSheet,
  },
  {
    name: "directorio-movil-solicitudes",
    asAdmin: true,
    withRequests: true,
    members: WITH_INVITED_MEMBER,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: openRequestsScreen,
  },
  {
    name: "directorio-movil-ficha",
    asAdmin: true,
    withRequests: true,
    endsInModal: true,
    members: WITH_INVITED_MEMBER,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: openMemberSheet("Alex Kim"),
  },
  {
    name: "directorio-movil-deslizar",
    asAdmin: true,
    withRequests: true,
    members: WITH_INVITED_MEMBER,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: swipeRowLeft("Nerea Ruiz"),
  },
];

/* La fila del móvil con y sin foto (#578): el nombre empieza en la misma x
   en todas, y el foco de la fila no se pinta sobre el avatar. */

const MOBILE_PHOTO_STATE: DirectoryState = {
  ...MOBILE_DIRECTORY_STATES[0]!,
  name: "directorio-movil-con-foto",
  withPhoto: true,
  prepare: waitForDirectoryPhoto,
};
const ROW_WITH_PHOTO = "Mateo Restrepo";
const ROW_WITH_INITIALS = "Nerea Ruiz";
const MOBILE_AVATAR_SIZE_PX = 40;
/** WCAG 1.4.11: un indicador de foco frente a lo que tiene alrededor. */
const FOCUS_INDICATOR_MIN_CONTRAST = 3;

type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** El avatar de la fila: la foto o las iniciales. */
function rowAvatar(page: Page, name: string): Locator {
  return page.getByRole("row", { name }).locator(".directory-avatar").first();
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error("El elemento no está en la pantalla");
  }
  return box;
}

/** El marco que el foco pinta en la fila: el `outline` de la fila o el borde
 * de su `::after`, el que esté. Con su grosor, su color y el fondo sobre el
 * que se pinta. */
type FocusRing = {
  readonly outer: Box;
  readonly thickness: number;
  readonly color: string;
  readonly background: string;
};

async function focusRingsOf(row: Locator): Promise<readonly FocusRing[]> {
  return row.evaluate((element) => {
    function px(value: string): number {
      return Number.parseFloat(value) || 0;
    }
    function backgroundBehind(node: Element | null): string {
      for (let current = node; current !== null;) {
        const color = getComputedStyle(current).backgroundColor;
        if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
          return color;
        }
        current = current.parentElement;
      }
      return "rgb(255, 255, 255)";
    }
    const box = element.getBoundingClientRect();
    const background = backgroundBehind(element);
    const rings: FocusRing[] = [];
    const style = getComputedStyle(element);
    if (style.outlineStyle !== "none" && px(style.outlineWidth) > 0) {
      const reach = px(style.outlineOffset) + px(style.outlineWidth);
      rings.push({
        outer: {
          x: box.x - reach,
          y: box.y - reach,
          width: box.width + 2 * reach,
          height: box.height + 2 * reach,
        },
        thickness: px(style.outlineWidth),
        color: style.outlineColor,
        background,
      });
    }
    const after = getComputedStyle(element, "::after");
    if (
      after.content !== "none" &&
      after.borderLeftStyle !== "none" &&
      px(after.borderLeftWidth) > 0
    ) {
      const left = box.x + px(after.left);
      const top = box.y + px(after.top);
      rings.push({
        outer: {
          x: left,
          y: top,
          width: box.right - px(after.right) - left,
          height: box.bottom - px(after.bottom) - top,
        },
        thickness: px(after.borderLeftWidth),
        color: after.borderLeftColor,
        background,
      });
    }
    return rings;
  });
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Si el anillo pasa por la caja: la toca por fuera y no la deja entera en
 * su hueco. */
function ringCrosses(ring: FocusRing, box: Box): boolean {
  const hole: Box = {
    x: ring.outer.x + ring.thickness,
    y: ring.outer.y + ring.thickness,
    width: ring.outer.width - 2 * ring.thickness,
    height: ring.outer.height - 2 * ring.thickness,
  };
  return overlaps(ring.outer, box) && !contains(hole, box);
}

function hexOfComputedColor(color: string): string {
  const channels = color.match(/\d+(\.\d+)?/g);
  if (channels === null || channels.length < 3) {
    throw new Error(`Color que no se sabe leer: ${color}`);
  }
  return `#${channels
    .slice(0, 3)
    .map((channel) => Math.round(Number(channel)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Lo que avanza el dedo entre un `touchMove` y el siguiente: pasos cortos,
 * para que el gesto pase por varios `pointermove`. */
const SWIPE_STEP_PX = 10;

/** Un dedo que se apoya en el centro de `target` y se desliza en vertical
 * por pasos: positivo baja, negativo sube.
 *
 * Son toques sueltos (`Input.dispatchTouchEvent`) y no
 * `Input.synthesizeScrollGesture`: con este, Chromium sin ventana manda los
 * `pointermove` pero nunca desplaza nada, ni la hoja ni la página (#579).
 * Los toques sueltos no pueden pedir que no haya inercia al soltar, así que
 * quien mida un desplazamiento no debe esperar una cifra exacta. */
async function swipeWithFinger(
  page: Page,
  target: Locator,
  distanceY: number,
): Promise<void> {
  const box = await target.boundingBox();
  if (box === null) {
    throw new Error("Lo que se iba a deslizar no está en la pantalla");
  }
  const x = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const stepCount = Math.ceil(Math.abs(distanceY) / SWIPE_STEP_PX);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: startY }],
    });
    for (let step = 1; step <= stepCount; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: startY + (distanceY * step) / stepCount }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await cdp.detach();
  }
}

/** Abre la ficha de la fila y la cierra con Escape: el foco vuelve a ella. */
async function openAndCloseMemberSheet(
  page: Page,
  name: string,
): Promise<void> {
  await openMemberSheet(name)(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name })).toHaveCount(0);
  await expect(page.getByRole("row", { name })).toBeFocused();
}

test.describe("el directorio en el móvil (#553)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: ADMIN_STORAGE_STATE,
    viewport: MOBILE_DIRECTORY_VIEWPORT,
  });

  for (const state of MOBILE_DIRECTORY_STATES) {
    test.describe(state.name, () => {
      for (const theme of themes) {
        test(`matches approved baseline (${theme})`, async ({ page }) => {
          await goToDirectory(page, state, theme);
          const snapshot = `${state.name}-mobile-${theme}.png`;
          const fullPage = state.endsInModal !== true;
          await createMissingLocalBaseline(snapshot, () =>
            page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage }),
          );
          await expect(page).toHaveScreenshot(snapshot, {
            ...SCREENSHOT_OPTIONS,
            fullPage,
            maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
          });
        });

        test(`has no accessibility violations (${theme})`, async ({ page }) => {
          await goToDirectory(page, state, theme);
          await expectNoAxeViolations(page);
        });
      }

      // La fila de los chips del rol se desplaza dentro de sí misma: la
      // página no.
      test("has no horizontal scroll", async ({ page }) => {
        await goToDirectory(page, state);
        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    });
  }

  // La selección múltiple es del escritorio (#552): en el móvil no sale
  // ninguna casilla en las filas.
  test("las filas no llevan casilla de selección", async ({ page }) => {
    await goToDirectory(page, MOBILE_DIRECTORY_STATES[0]!);

    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });

  test("la cabecera lleva el ⋯ e Invitar de 44 × 44, y el aviso mide al menos 48px", async ({
    page,
  }) => {
    await goToDirectory(page, MOBILE_DIRECTORY_STATES[0]!);

    for (const name of ["More actions", "Invite member"]) {
      const control = page.getByRole(
        name === "More actions" ? "button" : "link",
        { name },
      );
      const box = await control.boundingBox();
      expect(box?.width, name).toBe(44);
      expect(box?.height, name).toBe(44);
    }
    const banner = page.getByRole("button", { name: /role requests? waiting/ });
    expect((await banner.boundingBox())?.height).toBeGreaterThanOrEqual(48);
    await expect(
      page.getByRole("button", { name: "Write an email" }),
    ).toBeHidden();
  });

  test("los chips del rol se desplazan en su fila y el elegido filtra", async ({
    page,
  }) => {
    await goToDirectory(page, MOBILE_DIRECTORY_STATES[0]!);
    const chips = page.getByRole("group", { name: "Filter by role" });
    const isScrollable = await chips
      .locator(".directory-role-options")
      .evaluate((row) => getComputedStyle(row).overflowX === "auto");
    expect(isScrollable).toBe(true);

    await chips.getByText("Coach", { exact: true }).click();

    await expect(
      page.getByRole("row", { name: "Mateo Restrepo" }),
    ).toBeVisible();
    await expect(page.getByRole("row", { name: "Ana Admin" })).toHaveCount(0);
  });

  test("el ⋯ se cierra con Escape y devuelve el foco", async ({ page }) => {
    await goToDirectory(page, MOBILE_DIRECTORY_STATES[0]!);
    const more = page.getByRole("button", { name: "More actions" });
    await more.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: /in this view$/ });
    await expect(sheet).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(sheet).toHaveCount(0);
    await expect(more).toBeFocused();
  });

  // El navegador avisa del cierre de la hoja más tarde que jsdom: el foco
  // tiene que acabar en el formulario, no en el "⋯".
  test("escribir desde el ⋯ deja el foco en el formulario del correo", async ({
    page,
  }) => {
    await goToDirectory(page, {
      ...MOBILE_DIRECTORY_STATES[0]!,
      prepare: openMoreSheet,
    });

    await page
      .getByRole("dialog", { name: /in this view$/ })
      .getByRole("button", { name: /^Email these members/ })
      .click();

    await expect(
      page.getByRole("heading", { name: "Email members" }),
    ).toBeFocused();
  });

  test("la pantalla de solicitudes vuelve a la lista con la flecha", async ({
    page,
  }) => {
    await goToDirectory(page, {
      ...MOBILE_DIRECTORY_STATES[0]!,
      prepare: openRequestsScreen,
    });
    for (const name of [/^Approve the request/, /^Reject the request/]) {
      const box = await page
        .getByRole("button", { name })
        .first()
        .boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    await page.getByRole("button", { name: "Back to the directory" }).click();

    await expect(
      page.getByRole("button", { name: /role requests? waiting/ }),
    ).toBeFocused();
  });

  test("a un Coach no le sale el ⋯ ni el aviso (D4)", async ({ page }) => {
    await goToDirectory(page, {
      name: "directorio-movil-coach",
      asAdmin: false,
      asCoach: true,
      listHeading: ENGLISH_DIRECTORY_HEADING,
    });

    await expect(
      page.getByRole("button", { name: "More actions" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /role requests? waiting/ }),
    ).toHaveCount(0);
  });

  // La ficha que sube y las acciones al deslizar (#554, "2b", puntos 1 y 3).
  test("la ficha mide lo del diseño y Esc devuelve el foco a la fila", async ({
    page,
  }) => {
    await goToDirectory(page, {
      ...MOBILE_DIRECTORY_STATES[0]!,
      prepare: openMemberSheet("Nerea Ruiz"),
    });
    const sheet = page.getByRole("dialog", { name: "Nerea Ruiz" });
    // La fila esconde el país y el nivel; la ficha los enseña.
    await expect(sheet.getByText(/ · /).first()).toBeVisible();
    const contact = sheet.getByRole("group", { name: "Contact" });
    for (const button of await contact.getByRole("link").all()) {
      const box = await button.boundingBox();
      expect(box?.width).toBe(48);
      expect(box?.height).toBe(48);
    }
    const open = sheet.getByRole("link", { name: "Open full record" });
    expect((await open.boundingBox())?.height).toBe(46);
    const segment = sheet
      .getByRole("group", { name: "Role" })
      .locator(".directory-role")
      .first();
    expect((await segment.boundingBox())?.height).toBe(42);

    await page.keyboard.press("Escape");

    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole("row", { name: "Nerea Ruiz" })).toBeFocused();
  });

  test("tocar fuera de la ficha la cierra", async ({ page }) => {
    await goToDirectory(page, {
      ...MOBILE_DIRECTORY_STATES[0]!,
      prepare: openMemberSheet("Nerea Ruiz"),
    });

    await page.mouse.click(180, 40);

    await expect(page.getByRole("dialog", { name: "Nerea Ruiz" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("row", { name: "Nerea Ruiz" })).toBeFocused();
  });

  // El foco sin contorno al abrirla con el dedo y el arrastre desde arriba
  // (#579). Los gestos son de un dedo de verdad: Chromium los sintetiza por
  // su propia tubería de entrada, así que el `touch-action` cuenta.
  test.describe("con el dedo", () => {
    test.use({ hasTouch: true });

    test("la ficha abierta con el dedo no muestra contorno de foco en el asa", async ({
      page,
    }) => {
      await goToDirectory(page, MOBILE_DIRECTORY_STATES[0]!);

      await page.getByRole("row", { name: "Nerea Ruiz" }).tap();

      const sheet = page.getByRole("dialog", { name: "Nerea Ruiz" });
      await expect(sheet).toBeVisible();
      await expect(
        sheet.getByRole("button", { name: "Close the sheet" }),
      ).not.toBeFocused();
      const focusOutline = await page.evaluate(() =>
        document.activeElement === null
          ? "sin foco"
          : getComputedStyle(document.activeElement).outlineStyle,
      );
      expect(focusOutline).toBe("none");
    });

    test("arrastrar la ficha hacia abajo desde la cabecera la cierra", async ({
      page,
    }) => {
      await goToDirectory(page, {
        ...MOBILE_DIRECTORY_STATES[0]!,
        prepare: openMemberSheet("Nerea Ruiz"),
      });
      const sheet = page.getByRole("dialog", { name: "Nerea Ruiz" });

      await swipeWithFinger(
        page,
        sheet.getByRole("heading", { name: "Nerea Ruiz" }),
        240,
      );

      await expect(sheet).toHaveCount(0);
      await expect(page.getByRole("row", { name: "Nerea Ruiz" })).toBeFocused();
    });

    // El cambio está en `BottomSheet`, así que las otras tres hojas lo
    // heredan: se abren sin contorno y se cierran arrastrando su título.
    const OTHER_SHEETS = [
      {
        name: "filtros",
        opener: (page: Page) => filterToggle(page, ENGLISH_FILTER_LABELS),
        dialog: "Filters",
      },
      {
        name: "orden",
        opener: (page: Page) => page.getByRole("button", { name: /^Sort:/ }),
        dialog: "Sort by",
      },
      {
        name: "⋯",
        opener: (page: Page) =>
          page.getByRole("button", { name: "More actions" }),
        dialog: /members? in this view$/,
      },
    ] as const;

    for (const other of OTHER_SHEETS) {
      test(`la hoja de ${other.name} se abre sin contorno y se cierra arrastrando su título`, async ({
        page,
      }) => {
        await goToDirectory(page, MOBILE_DIRECTORY_STATES[0]!);

        await other.opener(page).tap();

        const sheet = page.getByRole("dialog", { name: other.dialog });
        await expect(sheet).toBeVisible();
        const focusOutline = await page.evaluate(() =>
          document.activeElement === null
            ? "sin foco"
            : getComputedStyle(document.activeElement).outlineStyle,
        );
        expect(focusOutline).toBe("none");

        await swipeWithFinger(page, sheet.getByRole("heading").first(), 240);

        await expect(sheet).toHaveCount(0);
      });
    }

    test("arrastrar dentro del contenido hace scroll y no cierra", async ({
      page,
    }) => {
      // Más baja que el móvil de siempre, para que la ficha no quepa entera.
      await page.setViewportSize({ width: 375, height: 520 });
      await goToDirectory(page, {
        ...MOBILE_DIRECTORY_STATES[0]!,
        prepare: openMemberSheet("Nerea Ruiz"),
      });
      const sheet = page.getByRole("dialog", { name: "Nerea Ruiz" });

      await swipeWithFinger(
        page,
        sheet.getByRole("group", { name: "Contact" }),
        -160,
      );

      await expect(sheet).toBeVisible();
      expect(
        await sheet.evaluate((dialog) => dialog.scrollTop),
      ).toBeGreaterThan(0);
    });
  });

  test("las filas dejan el desplazamiento vertical al navegador", async ({
    page,
  }) => {
    await goToDirectory(page, MOBILE_DIRECTORY_STATES[0]!);

    const touchAction = await page
      .getByRole("row", { name: "Nerea Ruiz" })
      .evaluate((row) => getComputedStyle(row).touchAction);

    expect(touchAction).toBe("pan-y");
  });

  test("las acciones de la fila miden 60px y tocar fuera las cierra", async ({
    page,
  }) => {
    await goToDirectory(page, {
      ...MOBILE_DIRECTORY_STATES[0]!,
      prepare: swipeRowLeft("Nerea Ruiz"),
    });
    const row = page.getByRole("row", { name: "Nerea Ruiz" });
    const actions = row.getByRole("group", { name: "Actions for Nerea Ruiz" });
    const email = actions.getByRole("link", { name: "Email Nerea Ruiz" });
    expect((await email.boundingBox())?.width).toBe(60);
    await expect(email).toBeInViewport();

    await page.getByRole("heading", { name: "Directory" }).click();

    await expect(actions).toHaveCount(0);
  });

  test("los nombres empiezan en la misma x con foto y sin foto", async ({
    page,
  }) => {
    await goToDirectory(page, MOBILE_PHOTO_STATE);

    const names = page.locator("tbody tr .directory-name");
    const lefts = await names.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().left),
    );

    expect(lefts.length).toBeGreaterThan(1);
    for (const left of lefts) {
      expect(left).toBeCloseTo(lefts[0]!, 0);
    }
  });

  test("el avatar con foto mide y se coloca como el de iniciales", async ({
    page,
  }) => {
    await goToDirectory(page, MOBILE_PHOTO_STATE);
    const photoRow = await boxOf(
      page.getByRole("row", { name: ROW_WITH_PHOTO }),
    );
    const initialsRow = await boxOf(
      page.getByRole("row", { name: ROW_WITH_INITIALS }),
    );

    const photo = await boxOf(rowAvatar(page, ROW_WITH_PHOTO));
    const initials = await boxOf(rowAvatar(page, ROW_WITH_INITIALS));

    expect(photo.width).toBe(MOBILE_AVATAR_SIZE_PX);
    expect(photo.height).toBe(MOBILE_AVATAR_SIZE_PX);
    expect(initials.width).toBe(MOBILE_AVATAR_SIZE_PX);
    expect(initials.height).toBe(MOBILE_AVATAR_SIZE_PX);
    expect(photo.x - photoRow.x).toBeCloseTo(initials.x - initialsRow.x, 0);
    expect(photo.y - photoRow.y).toBeCloseTo(initials.y - initialsRow.y, 0);
  });

  test("el foco de la fila no tapa el avatar", async ({ page }) => {
    await goToDirectory(page, MOBILE_PHOTO_STATE);

    for (const name of [ROW_WITH_PHOTO, ROW_WITH_INITIALS]) {
      await openAndCloseMemberSheet(page, name);
      const rings = await focusRingsOf(page.getByRole("row", { name }));
      const avatar = await boxOf(rowAvatar(page, name));

      expect(rings.length, name).toBeGreaterThan(0);
      for (const ring of rings) {
        expect(ringCrosses(ring, avatar), name).toBe(false);
      }
    }
  });

  test("la fila enfocada con Tab tiene un foco visible", async ({ page }) => {
    await goToDirectory(page, MOBILE_PHOTO_STATE);
    const row = page.getByRole("row", { name: ROW_WITH_INITIALS });
    // La fila de antes es la de la foto: su botón es lo último enfocable.
    await page.getByRole("button", { name: OPEN_PHOTO_BUTTON }).focus();

    await page.keyboard.press("Tab");

    await expect(row).toBeFocused();
    const [ring] = await focusRingsOf(row);
    expect(ring).toBeDefined();
    expect(ring!.thickness).toBeGreaterThanOrEqual(2);
    expect(
      contrastRatio(
        hexOfComputedColor(ring!.color),
        hexOfComputedColor(ring!.background),
      ),
    ).toBeGreaterThanOrEqual(FOCUS_INDICATOR_MIN_CONTRAST);
  });

  test("tocar la foto de la fila abre la foto en grande", async ({ page }) => {
    await goToDirectory(page, {
      ...MOBILE_PHOTO_STATE,
      prepare: openLargePhoto("landscape"),
    });

    await expect(
      photoDialog(page).getByRole("img", { name: LARGE_PHOTO_NAME }),
    ).toBeVisible();
  });
});

/** Cómo queda la foto grande en la pantalla, medido en el navegador. */
type RenderedPhoto = {
  readonly width: number;
  readonly height: number;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly centerX: number;
  readonly centerY: number;
};

async function measureLargePhoto(page: Page): Promise<RenderedPhoto> {
  return photoDialog(page)
    .getByRole("img", { name: LARGE_PHOTO_NAME })
    .evaluate((element) => {
      const image = element as HTMLImageElement;
      const box = image.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        centerX: box.left + box.width / 2,
        centerY: box.top + box.height / 2,
      };
    });
}

/** Ancho entre alto, con la tolerancia de un píxel de redondeo. */
function expectSameProportion(photo: RenderedPhoto): void {
  expect(photo.width / photo.height).toBeCloseTo(
    photo.naturalWidth / photo.naturalHeight,
    1,
  );
}

/** Un medio píxel de redondeo al centrar. */
const CENTERING_TOLERANCE_PX = 1;

test.describe("la foto grande en el directorio (#355)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  const photoState: DirectoryState = {
    name: "directorio-con-foto",
    asAdmin: false,
    withPhoto: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
  };

  for (const shape of ["landscape", "portrait"] as const) {
    test.describe(`móvil, ${shape}`, () => {
      test.use({ viewport: { width: 375, height: 812 } });

      test("ocupa el ancho de la pantalla sin deformarse", async ({ page }) => {
        await goToDirectory(page, {
          ...photoState,
          prepare: openLargePhoto(shape),
        });

        const photo = await measureLargePhoto(page);

        expect(photo.width).toBeCloseTo(375, 0);
        expectSameProportion(photo);
        expect(photo.height).toBeLessThanOrEqual(812);
      });
    });

    test.describe(`escritorio, ${shape}`, () => {
      test.use({ viewport: { width: 1440, height: 900 } });

      test("sale a su tamaño sin pasar de la ventana, centrada y sin deformarse", async ({
        page,
      }) => {
        await goToDirectory(page, {
          ...photoState,
          prepare: openLargePhoto(shape),
        });

        const photo = await measureLargePhoto(page);

        expectSameProportion(photo);
        expect(photo.width).toBeLessThanOrEqual(photo.naturalWidth);
        expect(photo.height).toBeLessThanOrEqual(900);
        expect(Math.abs(photo.centerX - 1440 / 2)).toBeLessThanOrEqual(
          CENTERING_TOLERANCE_PX,
        );
        if (shape === "landscape") {
          // 1024 x 683 cabe entera en 1440 x 900: se ve a su tamaño.
          expect(photo.width).toBe(photo.naturalWidth);
        }
      });
    });
  }

  test.describe("con el teclado", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("se abre con Enter, el foco no sale del diálogo y Escape lo devuelve a la foto", async ({
      page,
    }) => {
      await goToDirectory(page, photoState);
      await waitForDirectoryPhoto(page);
      await stubLargePhoto(page, "landscape");
      const trigger = page.getByRole("button", { name: OPEN_PHOTO_BUTTON });
      await trigger.focus();

      await page.keyboard.press("Enter");
      const dialog = photoDialog(page);
      await expect(dialog).toBeVisible();
      for (let press = 0; press < 3; press += 1) {
        await page.keyboard.press("Tab");
        const isFocusBehind = await dialog.evaluate(
          (element) =>
            document.activeElement !== null &&
            document.activeElement !== document.body &&
            !element.contains(document.activeElement),
        );
        expect(isFocusBehind, `Tab número ${press + 1}`).toBe(false);
      }
      await page.keyboard.press("Escape");

      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    });

    test("un clic en el fondo lo cierra y devuelve el foco a la foto", async ({
      page,
    }) => {
      await goToDirectory(page, {
        ...photoState,
        prepare: openLargePhoto("landscape"),
      });

      await page.mouse.click(8, 8);

      await expect(photoDialog(page)).toBeHidden();
      await expect(
        page.getByRole("button", { name: OPEN_PHOTO_BUTTON }),
      ).toBeFocused();
    });

    test("el botón de cerrar lo cierra y devuelve el foco a la foto", async ({
      page,
    }) => {
      await goToDirectory(page, {
        ...photoState,
        prepare: openLargePhoto("failed"),
      });

      await photoDialog(page)
        .getByRole("button", { name: "Close the photo" })
        .click();

      await expect(photoDialog(page)).toBeHidden();
      await expect(
        page.getByRole("button", { name: OPEN_PHOTO_BUTTON }),
      ).toBeFocused();
    });
  });
});

/* ---------------------------------------------------------------------------
   El directorio en pantalla estrecha (#283, rehecho en #553). Por debajo de
   768px la tabla pierde sus cabeceras y cada socio es una fila compacta:
   avatar, nombre, "Rol · Posición" y la asistencia. Todo esto vive en la
   hoja de estilos, así que sólo un navegador lo puede probar: lo que se oye
   de cada fila, que ninguna palabra se parta, y que el orden sobreviva al
   cambio de ancho.
   --------------------------------------------------------------------------- */

/** Más de 40 caracteres, el caso de nombre larguísimo del criterio. */
const VERY_LONG_MEMBER_NAME =
  "María de los Ángeles Errekondo Aranburu de la Hoz";

const NARROW_DIRECTORY_MEMBERS: readonly StubbedMember[] = [
  ...STUBBED_DIRECTORY_MEMBERS,
  {
    ...MEMBER_WITHOUT_DATA,
    userId: "66666666-0000-4000-8000-000000000006",
    fullName: VERY_LONG_MEMBER_NAME,
  },
];

const NARROW_VIEWPORT = { width: 375, height: 812 } as const;
const TABLE_VIEWPORT = { width: 768, height: 1024 } as const;

/** Lo que mide una línea de nombre en la tarjeta: más alto, se partió. */
const SINGLE_LINE_NAME_HEIGHT = 24;

async function goToNarrowDirectory(
  page: Page,
  options: { readonly asAdmin: boolean; readonly asCoach?: boolean },
): Promise<void> {
  await stubDirectoryReads(page, {
    asAdmin: options.asAdmin,
    asCoach: options.asCoach,
    members: NARROW_DIRECTORY_MEMBERS,
  });
  await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);
  await waitForDirectory(page, ENGLISH_DIRECTORY_HEADING, options.asAdmin);
}

/** Las palabras de la lista que el navegador pintó en más de una línea. Una
 * palabra entera ocupa una sola línea, así que sus rectángulos comparten la
 * misma altura; una partida tiene rectángulos en dos. */
async function wordsSplitAcrossLines(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const body = document.querySelector("tbody");
    if (body === null) {
      throw new Error("No hay lista de socios en la pantalla.");
    }
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const split: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      for (const word of text.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, word.index);
        range.setEnd(node, word.index + word[0].length);
        const lines = new Set(
          Array.from(range.getClientRects())
            .filter((rect) => rect.width > 0)
            .map((rect) => Math.round(rect.top)),
        );
        if (lines.size > 1) {
          split.push(word[0]);
        }
      }
    }
    return split;
  });
}

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
}

const ENGLISH_SORT_LABELS = {
  sortGroup: "Sort by",
  sortButton: /^Sort:/,
} as const;

function sortButton(page: Page): Locator {
  return page.getByRole("button", { name: ENGLISH_SORT_LABELS.sortButton });
}

test.describe("el directorio en pantalla estrecha (#283)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE, viewport: NARROW_VIEWPORT });

  test("cada socio es una fila con su nombre, el rol y la posición en una línea, y sin cabeceras", async ({
    page,
  }) => {
    await goToNarrowDirectory(page, { asAdmin: false });

    const row = page.getByRole("row", { name: "Mateo Restrepo" });
    await expect(page.getByRole("columnheader")).toHaveCount(0);
    await expect(row.getByText("MR")).toBeVisible();
    // El país y el nivel se quedan para la ficha (#553).
    await expect(row.getByRole("rowheader")).toHaveAccessibleName(
      "Mateo Restrepo",
    );
    await expect(
      row.getByRole("cell", { name: "Coach", exact: true }),
    ).toBeVisible();
    await expect(row.getByRole("cell", { name: /Forward$/ })).toBeVisible();
    const role = await row.getByText("Coach", { exact: true }).boundingBox();
    const position = await row.getByText("Forward").boundingBox();
    expect(Math.round(role?.y ?? 0)).toBe(Math.round(position?.y ?? -1));
  });

  test("una posición que falta sale con su guion", async ({ page }) => {
    await goToNarrowDirectory(page, { asAdmin: false });

    const row = page.getByRole("row", { name: LONG_MEMBER_NAME });
    await expect(row.getByRole("cell", { name: /–$/ })).toBeVisible();
  });

  test("ninguna palabra queda partida, tampoco las marcas", async ({
    page,
  }) => {
    await goToNarrowDirectory(page, { asAdmin: true });
    await includeFormerMembers(
      ENGLISH_FILTER_LABELS,
      "Include deactivated accounts",
    )(page);
    await expect(page.getByText("Deactivated", { exact: true })).toBeVisible();
    // Desde #549 el AUF de la fila es un punto, sin palabras que partir.
    await expect(page.getByRole("img", { name: "AUF expired" })).toBeVisible();

    expect(await wordsSplitAcrossLines(page)).toEqual([]);
  });

  test("la marca de sin evaluar cabe entera y no parte ninguna palabra (#324)", async ({
    page,
  }) => {
    await goToNarrowDirectory(page, { asAdmin: false, asCoach: true });
    const card = page.getByRole("row", { name: VERY_LONG_MEMBER_NAME });
    const mark = card.getByRole("link", { name: /^Not evaluated/ });
    await expect(mark).toBeVisible();

    const markBox = await mark.boundingBox();
    const cardBox = await card.boundingBox();
    if (markBox === null || cardBox === null) {
      throw new Error("La marca de sin evaluar no se pintó.");
    }
    expect(markBox.x + markBox.width).toBeLessThanOrEqual(
      cardBox.x + cardBox.width,
    );
    expect(await wordsSplitAcrossLines(page)).toEqual([]);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test("un nombre larguísimo se parte entre palabras sin desbordar la tarjeta", async ({
    page,
  }) => {
    await goToNarrowDirectory(page, { asAdmin: false });

    const card = page.getByRole("row", { name: VERY_LONG_MEMBER_NAME });
    const cardBox = await card.boundingBox();
    const nameBox = await card.getByText(VERY_LONG_MEMBER_NAME).boundingBox();
    if (cardBox === null || nameBox === null) {
      throw new Error("La tarjeta del nombre larguísimo no se pintó.");
    }
    expect(nameBox.height).toBeGreaterThan(SINGLE_LINE_NAME_HEIGHT);
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(
      cardBox.x + cardBox.width,
    );
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(
      NARROW_VIEWPORT.width,
    );
    expect(await wordsSplitAcrossLines(page)).toEqual([]);
  });

  test("se ordena desde una hoja con controles que se tocan", async ({
    page,
  }) => {
    await goToNarrowDirectory(page, { asAdmin: false });
    expect(
      (await sortButton(page).boundingBox())?.height,
    ).toBeGreaterThanOrEqual(44);
    await sortButton(page).click();
    const sheet = page.getByRole("dialog", { name: "Sort by" });
    for (const option of await sheet.getByRole("button").all()) {
      expect((await option.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }

    const requested = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === DIRECTORY_ENDPOINT &&
        new URL(request.url()).searchParams.get("sort") === "role",
    );
    await sheet.getByRole("button", { name: "Role" }).click();
    await requested;

    await expect(sortButton(page)).toHaveAccessibleName(
      "Sort: Role, ascending",
    );
  });

  test("la hoja del orden se cierra con Escape y devuelve el foco al botón", async ({
    page,
  }) => {
    await goToNarrowDirectory(page, { asAdmin: false });
    await sortButton(page).focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Sort by" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button").first()).toBeFocused();

    await page.keyboard.press("Escape");

    await expect(sheet).toHaveCount(0);
    await expect(sortButton(page)).toBeFocused();
  });

  test("el orden elegido se conserva al cambiar de ancho, en los dos sentidos", async ({
    page,
  }) => {
    await goToNarrowDirectory(page, { asAdmin: false });
    await chooseSortInSheet(page, ENGLISH_SORT_LABELS, "Position");
    await chooseSortInSheet(page, ENGLISH_SORT_LABELS, "Position");

    await page.setViewportSize(TABLE_VIEWPORT);

    await expect(sortButton(page)).toBeHidden();
    await expect(
      page.getByRole("columnheader", { name: "Position" }),
    ).toHaveAttribute("aria-sort", "descending");

    await page
      .getByRole("columnheader", { name: "Role" })
      .getByRole("button")
      .click();
    await expect(
      page.getByRole("columnheader", { name: "Role" }),
    ).toHaveAttribute("aria-sort", "ascending");
    await page.setViewportSize(NARROW_VIEWPORT);

    await expect(sortButton(page)).toHaveAccessibleName(
      "Sort: Role, ascending",
    );
  });

  // #549: la fila ya no cambia el rol, ni en la tabla ni en la tarjeta. El
  // cambio y el rechazo del último Admin están en la ficha
  // (`ficha-rol-ultimo-admin`).
  test("la fila de un Admin enseña el rol sin selector ni botón Guardar", async ({
    page,
  }) => {
    await goToNarrowDirectory(page, { asAdmin: true });

    const row = page.getByRole("row", { name: "Ana Admin" });
    await expect(row.getByText("Admin", { exact: true })).toBeVisible();
    await expect(row.getByRole("combobox")).toHaveCount(0);
    await expect(row.getByRole("button", { name: /Save/ })).toHaveCount(0);
  });

  test("a 768px sigue siendo la tabla, con sus cabeceras y sin etiquetas", async ({
    page,
  }) => {
    await page.setViewportSize(TABLE_VIEWPORT);
    await goToNarrowDirectory(page, { asAdmin: false });

    await expect(page.getByRole("columnheader")).toHaveCount(4);
    await expect(sortButton(page)).toBeHidden();
    await expect(
      page
        .getByRole("row", { name: "Mateo Restrepo" })
        .getByRole("cell", { name: "Coach", exact: true }),
    ).toBeVisible();
  });

  test("la marca de sin evaluar lleva a la evaluación de esa persona (#324)", async ({
    page,
  }) => {
    await goToNarrowDirectory(page, { asAdmin: false, asCoach: true });

    await page
      .getByRole("row", { name: LONG_MEMBER_NAME })
      .getByRole("link", {
        name: `Not evaluated: evaluate ${LONG_MEMBER_NAME}`,
      })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/evaluaciones\\?miembro=${MEMBER_WITHOUT_DATA.userId}$`),
    );
  });

  for (const width of [320, 375, 768]) {
    for (const asAdmin of [false, true]) {
      test(`no hay scroll horizontal a ${width}px (${asAdmin ? "Admin" : "socio"})`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: NARROW_VIEWPORT.height });
        await goToNarrowDirectory(page, { asAdmin });

        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    }
  }

  for (const viewport of viewports) {
    for (const asAdmin of [false, true]) {
      test(`axe no encuentra violaciones a ${viewport.width}px (${asAdmin ? "Admin" : "socio"})`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        await goToNarrowDirectory(page, { asAdmin });

        await expectNoAxeViolations(page);
      });
    }
  }
});

test.describe("el directorio con los datos de verdad", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("un Admin lo abre desde la barra lateral", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${APP_URL}/dashboard`);

    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Directory" })
      .click();

    await expect(page).toHaveURL(new RegExp(`${DIRECTORY_SCREEN_PATH}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: "Directory" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: ENGLISH_DIRECTORY_HEADING }),
    ).toBeVisible();
  });

  test("en español, la pantalla sale en español", async ({ page }) => {
    await chooseSpanish(page);
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);

    await expect(
      page.getByRole("heading", { level: 1, name: "Directorio" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: SPANISH_DIRECTORY_HEADING }),
    ).toBeVisible();
  });

  test("un Admin encuentra el control de los dados de baja", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);
    // Desde #548 la casilla vive en Filtros.
    const filters = await filterContainer(page, ENGLISH_FILTER_LABELS);

    await expect(
      filters.getByRole("checkbox", { name: "Include deactivated accounts" }),
    ).toBeVisible();
  });

  // Desde #549 la fila enseña el rol como texto: se cambia en la ficha.
  test("un Admin ve la línea de las solicitudes y su propio rol en su fila", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);

    await expect(page.getByText(REQUESTS_SETTLED).first()).toBeVisible();
    await expect(
      page
        .getByRole("row", { name: ADMINISTRATION_ADMIN_NAME })
        .getByRole("cell", { name: "Admin", exact: true }),
    ).toBeVisible();
  });

  test("en español, la línea de las solicitudes sale en español", async ({
    page,
  }) => {
    await chooseSpanish(page);
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);

    await expect(
      page
        .getByText(
          /No hay solicitudes pendientes|solicitud(es)? de rol esperando/,
        )
        .first(),
    ).toBeVisible();
  });

  test("la ruta vieja de administración lo lleva al directorio", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}/administracion`);

    await expect(page).toHaveURL(new RegExp(`${DIRECTORY_SCREEN_PATH}$`));
    await expect(page.getByText(REQUESTS_SETTLED).first()).toBeVisible();
  });

  test("las lecturas de E3 le siguen respondiendo 200", async ({ request }) => {
    const members = await request.get(`${APP_URL}${MEMBERS_ENDPOINT}`);
    const pending = await request.get(
      `${APP_URL}${PENDING_REQUESTS_ENDPOINT}?status=pending`,
    );

    expect(members.status()).toBe(200);
    expect(pending.status()).toBe(200);
  });
});

/* El contacto de los socios (#499) con los datos de verdad: a un Player no le
   llega nada de nadie, ni en la pantalla ni en la API. En el club sembrado
   hay al menos una socia con teléfono y contacto de emergencia (la del
   perfil con contacto), así que si se colara, se vería. */
test.describe("el contacto en el directorio con los datos de verdad", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: FULL_PROFILE_STORAGE_STATE });

  test("un Player no ve ningún dato de contacto en la pantalla", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);
    await waitForDirectory(page, ENGLISH_DIRECTORY_HEADING);

    await expect(
      page.getByRole("columnheader", { name: "Contact" }),
    ).toHaveCount(0);
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  });

  test("a un Player la API no le trae el correo, el teléfono ni el contacto de emergencia", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);
    const response = await page.request.get(`${APP_URL}${DIRECTORY_ENDPOINT}`);

    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      data: { kind: string; members: readonly Record<string, unknown>[] };
    };
    expect(body.data.kind).toBe("member");
    expect(body.data.members.length).toBeGreaterThan(0);
    for (const member of body.data.members) {
      expect(member).not.toHaveProperty("email");
      expect(member).not.toHaveProperty("phone");
      expect(member).not.toHaveProperty("emergencyContact");
    }
  });

  test("a un Player la API le niega el filtro sin teléfono", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);
    const response = await page.request.get(
      `${APP_URL}${DIRECTORY_ENDPOINT}?withoutPhone=true`,
    );

    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "directory_filter_forbidden" },
    });
  });
});

/* En el móvil, cada teléfono y cada correo del contacto se pulsa con el dedo
   (#499): miden al menos 44 px de alto. Desde #571 la fila no lleva el
   contacto: el del Coach sale al deslizarla (#554). */
test.describe("los enlaces del contacto en el móvil", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: ADMIN_STORAGE_STATE,
    viewport: MOBILE_DIRECTORY_VIEWPORT,
  });

  const coachState: DirectoryState = {
    name: "directorio-contacto-coach-movil",
    asAdmin: false,
    asCoach: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: waitForNereaRow,
  };

  test("la fila de un Coach no enseña enlaces tel: ni mailto:", async ({
    page,
  }) => {
    await goToDirectory(page, coachState);

    // Las acciones al deslizar ya están en la fila, cerradas y fuera de la
    // vista: el árbol de accesibilidad no las cuenta hasta que se abren.
    const hrefs = await Promise.all(
      (
        await page
          .getByRole("row", { name: "Nerea Ruiz" })
          .getByRole("link")
          .all()
      ).map((link) => link.getAttribute("href")),
    );
    expect(hrefs.filter((href) => /^(tel|mailto):/.test(href ?? ""))).toEqual(
      [],
    );
    await expect(
      page.getByRole("row", { name: "Nerea Ruiz" }).getByText(/Emergency/),
    ).toHaveCount(0);
  });

  test("cada enlace tel: y mailto: mide al menos 44 px", async ({ page }) => {
    await goToDirectory(page, {
      ...coachState,
      prepare: swipeRowLeft("Nerea Ruiz"),
    });

    const links = page
      .getByRole("group", { name: "Actions for Nerea Ruiz" })
      .locator('a[href^="tel:"], a[href^="mailto:"]')
      .filter({ visible: true });
    expect(await links.count()).toBeGreaterThan(0);
    for (const link of await links.all()) {
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
  });
});

/* Desde 768 px la lista es la tabla compacta para todos (#571, RF-3): sin
   columna de contacto ni tarjetas, y la fila de quien ve el contacto mide lo
   mismo que la de un Player. El 1024 es donde antes salían las tarjetas. */
const COMPACT_LIST_WIDTHS = [768, 1024, 1440] as const;

/** Lo que una fila puede medir de más o de menos que la de un Player. */
const ROW_HEIGHT_TOLERANCE_PX = 2;

const COMPACT_LIST_VIEWERS = [
  { name: "Admin", asAdmin: true, asCoach: false, columnCount: 5 },
  { name: "Coach", asAdmin: false, asCoach: true, columnCount: 4 },
] as const;

async function rowHeightOf(page: Page, name: string): Promise<number> {
  const box = await page.getByRole("row", { name }).boundingBox();
  if (box === null) {
    throw new Error(`La fila de ${name} no está en la pantalla`);
  }
  return box.height;
}

test.describe("la lista compacta desde 768 px (#571)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  for (const width of COMPACT_LIST_WIDTHS) {
    test.describe(`@ ${width}px`, () => {
      test.use({ viewport: { width, height: 900 } });

      for (const viewer of COMPACT_LIST_VIEWERS) {
        test(`a un ${viewer.name} le enseña el encabezado compacto, sin contacto, y filas como las de un Player`, async ({
          page,
        }) => {
          await goToDirectory(page, {
            name: "directorio-compacto-player",
            asAdmin: false,
            listHeading: ENGLISH_DIRECTORY_HEADING,
            prepare: waitForNereaRow,
          });
          const playerRowHeight = await rowHeightOf(page, "Nerea Ruiz");

          await goToDirectory(page, {
            name: `directorio-compacto-${viewer.name}`,
            asAdmin: viewer.asAdmin,
            asCoach: viewer.asCoach,
            listHeading: ENGLISH_DIRECTORY_HEADING,
            prepare: waitForNereaRow,
          });

          await expect(page.getByRole("columnheader")).toHaveCount(
            viewer.columnCount,
          );
          await expect(
            page.getByRole("columnheader", { name: "Contact" }),
          ).toHaveCount(0);
          await expect(
            page
              .getByRole("table")
              .locator('a[href^="tel:"], a[href^="mailto:"]')
              .filter({ visible: true }),
          ).toHaveCount(0);
          expect(
            Math.abs((await rowHeightOf(page, "Nerea Ruiz")) - playerRowHeight),
          ).toBeLessThanOrEqual(ROW_HEIGHT_TOLERANCE_PX);
        });
      }
    });
  }

  test("a 1024 px el Admin marca a todos desde la casilla del encabezado", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await goToDirectory(page, {
      name: "directorio-compacto-seleccion",
      asAdmin: true,
      listHeading: ENGLISH_DIRECTORY_HEADING,
      prepare: waitForNereaRow,
    });
    const selectAll = page.getByRole("checkbox", { name: "Select all" });
    await expect(selectAll).toBeVisible();

    await selectAll.check();

    const rowChecks = page.getByRole("checkbox", { name: /^Select (?!all)/ });
    expect(await rowChecks.count()).toBeGreaterThan(0);
    for (const check of await rowChecks.all()) {
      await expect(check).toBeChecked();
    }
    await expect(
      page.getByRole("group", { name: `${await rowChecks.count()} selected` }),
    ).toBeVisible();
  });
});

test.describe("un Admin que decide una solicitud desde el directorio", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });
  // Sin reintentos: el primer intento ya aprueba la solicitud, y el segundo
  // encontraría la bandeja sin ella y taparía por qué falló el primero.
  test.describe.configure({
    retries: 0,
    timeout: ACCOUNT_CHANGE_TEST_TIMEOUT_MS,
  });

  test("aprobar desde el resumen del panel la saca y deja al miembro con su rol nuevo", async ({
    page,
  }) => {
    // Las solicitudes se piden aparte, después de la lista. Con la suite entera en
    // paralelo en CI esa respuesta pasaba a veces de los 5 s por defecto de
    // `expect`, y el test fallaba sin que hubiera nada roto: se espera a que
    // llegue antes de buscar el botón.
    const trayLoaded = page.waitForResponse(
      (response) =>
        response.url().includes(PENDING_REQUESTS_ENDPOINT) &&
        response.request().method() === "GET",
      { timeout: ACCOUNT_CHANGE_TIMEOUT_MS },
    );
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);
    expect((await trayLoaded).status()).toBe(200);
    // La píldora de la cabecera abre el panel en el resumen, donde se deciden.
    await page
      .getByRole("button", { name: /^\d+ role requests? waiting$/ })
      .click();
    const approve = page.getByRole("button", {
      name: `Approve the request from ${DECIDABLE_MEMBER_NAME}`,
    });
    await expect(approve).toBeVisible({ timeout: ACCOUNT_CHANGE_TIMEOUT_MS });

    const decided = page.waitForResponse(
      (response) =>
        response.url().includes(PENDING_REQUESTS_ENDPOINT) &&
        response.request().method() === "POST",
      { timeout: ACCOUNT_CHANGE_TIMEOUT_MS },
    );
    await approve.click();
    expect((await decided).status()).toBe(200);

    await expect(approve).toHaveCount(0);
    await expect(
      page
        .getByRole("row", { name: DECIDABLE_MEMBER_NAME })
        .getByRole("cell", { name: "Committee", exact: true }),
    ).toBeVisible();
  });
});

test.describe("un Player frente al directorio", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  test("lo alcanza, porque el club puede verse a sí mismo", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);

    await expect(page).toHaveURL(new RegExp(`${DIRECTORY_SCREEN_PATH}$`));
    await expect(
      page.getByRole("heading", { name: ENGLISH_DIRECTORY_HEADING }),
    ).toBeVisible();
  });

  test("no le ofrece el control de los dados de baja", async ({ page }) => {
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);
    await expect(
      page.getByRole("heading", { name: ENGLISH_DIRECTORY_HEADING }),
    ).toBeVisible();

    await expect(
      page.getByRole("checkbox", { name: "Include deactivated accounts" }),
    ).toHaveCount(0);
  });

  test("la lista le responde 200", async ({ request }) => {
    const directory = await request.get(`${APP_URL}${DIRECTORY_ENDPOINT}`);

    expect(directory.status()).toBe(200);
  });

  test("no le enseña las solicitudes ni el control de rol", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);
    await expect(page.getByRole("table")).toBeVisible();

    await expect(page.getByText(REQUESTS_SETTLED)).toHaveCount(0);
    // La búsqueda global de la barra (#427) también es un combobox: el que
    // no puede estar es el del rol de una fila.
    await expect(page.getByRole("combobox", { name: /^Role for/ })).toHaveCount(
      0,
    );
  });

  test("la ruta vieja de administración lo lleva al directorio", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}/administracion`);

    await expect(page).toHaveURL(new RegExp(`${DIRECTORY_SCREEN_PATH}$`));
  });

  test("las lecturas de E3 le siguen respondiendo 403", async ({ request }) => {
    const members = await request.get(`${APP_URL}${MEMBERS_ENDPOINT}`);
    const pending = await request.get(
      `${APP_URL}${PENDING_REQUESTS_ENDPOINT}?status=pending`,
    );

    expect(members.status()).toBe(403);
    expect(pending.status()).toBe(403);
  });
});
/* ---------------------------------------------------------------------------
   La ficha reservada al Admin (#242, RF-4 del PRD de E5): el AUF y los grupos
   de un miembro, abierta desde su fila del directorio. Sin mockup: se revisa
   contra design-system.md, con el aspecto del directorio (directory-light.png).

   Las capturas leen datos fijos, servidos por `page.route`, por lo mismo que
   las del directorio: los grupos y el AUF de verdad cambian con cada test que
   siembre. Lo que la frontera y el endpoint de verdad responden se prueba
   aparte, con las sesiones sembradas.
   --------------------------------------------------------------------------- */

const RECORD_MEMBER_ID = MEMBER_WITHOUT_DATA.userId;
const MEMBER_RECORD_SCREEN_PATH = `${DIRECTORY_SCREEN_PATH}/${RECORD_MEMBER_ID}`;
const MEMBER_RECORD_ENDPOINT = `/api/v1/members/${RECORD_MEMBER_ID}/record`;
const MEMBER_RECORD_EVALUATION_ENDPOINT = `/api/v1/evaluations/${RECORD_MEMBER_ID}`;
/** Las categorías de la evaluación en la columna derecha (#774). */
const MEMBER_RECORD_RATINGS = /^(Categories|Categorías)$/;

/** Tres categorías bastan para ver la sección (#324): la pantalla entera de
 * Evaluaciones ya tiene sus propias capturas con las diez. */
const STUBBED_RECORD_EVALUATION = {
  status: "evaluated",
  memberId: RECORD_MEMBER_ID,
  updatedAt: "2026-09-27T01:02:03.123456+00:00",
  overallRating: 7.7,
  ratings: [
    ["Fitness", 8],
    ["Speed", 7],
    ["Teamwork", 8],
  ].map(([name, rating], index) => ({
    categoryId: `ca7e0000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name,
    rating,
    isRetired: false,
  })),
  isCurrent: true,
} as const;
const CLUB_GROUPS_ENDPOINT = "/api/v1/groups";

const STUBBED_CLUB_GROUPS = [
  {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    name: "Juveniles de los jueves y sábados por la mañana",
    memberCount: 12,
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    name: "Masters Squad",
    memberCount: 8,
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000003",
    name: "Senior Squad",
    memberCount: 21,
  },
] as const;

/** Lo que la ficha del Admin trae desde #770: la vista y los datos de la
 * cabecera de E30. El plan y su renovación los pinta la tarjeta Membresía
 * (#774). */
const STUBBED_RECORD_ADMIN_VIEW = {
  view: "admin",
  positionName: null,
  experienceLevel: null,
  country: null,
  email: "socia.de.prueba@example.test",
  membershipPlan: "Full",
  membershipRenewsOn: "2027-06-30",
} as const;

type StubbedSession = {
  readonly eventId: string;
  readonly startsOn: string;
  readonly status: "present" | "late" | "absent";
};

/** Las últimas 10 de la tarjeta Asistencia (#774): ocho a tiempo, una tarde
 * y una ausencia, de la más vieja a la más nueva. */
const STUBBED_LAST_SESSIONS: readonly StubbedSession[] = (
  [
    "present",
    "present",
    "late",
    "present",
    "absent",
    "present",
    "present",
    "present",
    "present",
    "present",
  ] as const
).map((status, index) => ({
  eventId: `e5e5e5e5-0000-4000-8000-${String(index).padStart(12, "0")}`,
  startsOn: `2026-08-${String(index * 3 + 1).padStart(2, "0")}`,
  status,
}));

type StubbedMemberRecord = {
  readonly userId: string;
  readonly fullName: string;
  readonly role: "Player" | "Coach" | "Committee" | "Admin";
  readonly joinedOn: string;
  readonly accountStatus: "incomplete" | "active" | "inactive";
  readonly aufNumber: string;
  readonly aufExpiry: string;
  readonly isAufVerified: boolean;
  readonly dateOfBirth: string;
  readonly registeredAt: string;
  readonly hasGuardianConsent: boolean;
  readonly membershipStatus: "active" | "past_due" | "waived" | null;
  readonly membershipWaiver: {
    readonly reason: string;
    readonly until: string | null;
  } | null;
  readonly phone: string | null;
  readonly emergencyContact: StubbedContact["emergencyContact"];
  readonly photoUrl: string | null;
  readonly isAufExpired: boolean;
  readonly groups: readonly { readonly id: string; readonly name: string }[];
  /** La de la temporada (#774), o null sin sesiones esta temporada. */
  readonly attendance: {
    readonly percent: number;
    readonly attended: number;
    readonly sessions: number;
    readonly last10: readonly StubbedSession[];
  } | null;
};

/** El nombre más largo de la lista, para el caso de contenido largo. Sin
 * foto: la cabecera lleva sus iniciales (#354). */
const CURRENT_RECORD: StubbedMemberRecord = {
  userId: RECORD_MEMBER_ID,
  fullName: LONG_MEMBER_NAME,
  role: "Player",
  joinedOn: "2024-03-06",
  accountStatus: "active",
  aufNumber: "AUF-2026-0042",
  aufExpiry: "2030-06-30",
  isAufVerified: true,
  dateOfBirth: "1990-05-10",
  registeredAt: "2024-03-06T01:00:00.000Z",
  hasGuardianConsent: false,
  membershipStatus: "active",
  membershipWaiver: null,
  phone: "0412 345 678",
  emergencyContact: {
    name: "Miren Aranburu Etxeberria",
    phone: "+61 499 111 222",
    relationship: "Mother",
  },
  photoUrl: null,
  isAufExpired: false,
  attendance: {
    percent: 90,
    attended: 18,
    sessions: 20,
    last10: STUBBED_LAST_SESSIONS,
  },
  groups: [STUBBED_CLUB_GROUPS[0], STUBBED_CLUB_GROUPS[2]].map(
    ({ id, name }) => ({ id, name }),
  ),
};

/** Con foto, que la cabecera pone junto al nombre largo (#354). La sirve
 * la misma foto fija que el directorio. */
const PHOTO_RECORD: StubbedMemberRecord = {
  ...CURRENT_RECORD,
  photoUrl: STUBBED_PHOTO_URL,
};

/** Quien todavía no activó su cuenta: la ficha ofrece reenviar la
 * invitación (#243). */
const PENDING_RECORD: StubbedMemberRecord = {
  ...CURRENT_RECORD,
  accountStatus: "incomplete",
  // Quien no entró nunca no tiene sesiones: la ficha lo dice, sin un 0.
  attendance: null,
};

/** Quien tiene la cuenta desactivada: la ficha ofrece reactivarla (#273). */
const DEACTIVATED_RECORD: StubbedMemberRecord = {
  ...CURRENT_RECORD,
  accountStatus: "inactive",
};

const EXPIRED_RECORD: StubbedMemberRecord = {
  ...CURRENT_RECORD,
  aufExpiry: "2025-01-31",
  isAufExpired: true,
};

/** Quien está exento de cuota (#457): la ficha enseña el motivo y el fin, y
 * ofrece retirar la exención. El motivo es largo a propósito. */
const WAIVED_RECORD: StubbedMemberRecord = {
  ...CURRENT_RECORD,
  membershipStatus: "waived",
  membershipWaiver: {
    reason:
      "Head coach of the juniors on Thursdays and Saturdays, and helps run the club's come-and-try sessions",
    until: "2027-02-28T13:00:00.000Z",
  },
};

/** El AUF que escribió el miembro: la ficha lo marca y ofrece verificarlo
 * (#274). */
const UNVERIFIED_AUF_RECORD: StubbedMemberRecord = {
  ...CURRENT_RECORD,
  isAufVerified: false,
};

type StubbedSaveRejection = {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly reason: string;
  };
};

const EXPIRY_BEFORE_JOINING_ERROR: StubbedSaveRejection = {
  error: {
    code: "validation_error",
    message: "El vencimiento es anterior al ingreso.",
    reason: "auf_expiry_before_joined",
  },
};

const BIRTH_IN_FUTURE_ERROR: StubbedSaveRejection = {
  error: {
    code: "validation_error",
    message: "La fecha de nacimiento es futura.",
    reason: "date_of_birth_in_future",
  },
};

/** 9 años el día del registro del miembro: guardarla le pediría el
 * consentimiento de su tutor (#272). */
const MINOR_BIRTH = "2015-01-01";

async function stubMemberRecordReads(
  page: Page,
  record: StubbedMemberRecord,
  saveRejection: StubbedSaveRejection = EXPIRY_BEFORE_JOINING_ERROR,
): Promise<void> {
  if (record.photoUrl !== null) {
    await stubDirectoryPhoto(page);
  }
  await page.route(
    (url) => url.pathname === CLUB_GROUPS_ENDPOINT,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { groups: STUBBED_CLUB_GROUPS } }),
      }),
  );
  await page.route(
    (url) => url.pathname === MEMBER_RECORD_EVALUATION_ENDPOINT,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: STUBBED_RECORD_EVALUATION }),
      }),
  );
  // Guardar sólo se prueba en la captura del aviso, así que el PATCH fingido
  // siempre lo rechaza.
  await page.route(
    (url) => url.pathname === MEMBER_RECORD_ENDPOINT,
    (route, request) =>
      request.method() === "PATCH"
        ? route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify(saveRejection),
          })
        : route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: { ...STUBBED_RECORD_ADMIN_VIEW, ...record },
            }),
          }),
  );
}

/** Abre con su Editar una tarjeta de la ficha (#772, #773) y la devuelve. */
async function openRecordCard(page: Page, name: RegExp): Promise<Locator> {
  const card = page.getByRole("region", { name });
  await card.getByRole("button", { name: EDIT_CARD_BUTTON }).click();
  return card;
}

/** Abre Registro AUF (#773), pone un vencimiento anterior al ingreso y
 * guarda: el servidor fingido lo rechaza, y el aviso sale junto al campo. */
function submitExpiryBeforeJoining(issueText: RegExp) {
  return async (page: Page): Promise<void> => {
    const card = await openRecordCard(page, AUF_CARD);
    await page.locator("#ficha-auf-vencimiento").fill("2024-01-15");
    await card.getByRole("button", { name: SAVE_CARD_BUTTON }).click();
    await expect(page.getByText(issueText)).toBeVisible();
  };
}

/** Abre Ficha del club (#773), pone una fecha de nacimiento futura y guarda:
 * el servidor fingido la rechaza, y el aviso sale junto al campo. */
function submitBirthInFuture(issueText: RegExp) {
  return async (page: Page): Promise<void> => {
    const card = await openRecordCard(page, CLUB_RECORD_CARD);
    await page.locator("#ficha-nacimiento").fill("2999-01-01");
    await card.getByRole("button", { name: SAVE_CARD_BUTTON }).click();
    await expect(page.getByText(issueText)).toBeVisible();
  };
}

/** Abre Ficha del club (#773) y pone la fecha de un menor sin guardar: la
 * ficha avisa de que el miembro tendrá que dar el consentimiento de su
 * tutor. */
function typeMinorBirth(noticeText: RegExp) {
  return async (page: Page): Promise<void> => {
    await openRecordCard(page, CLUB_RECORD_CARD);
    await page.locator("#ficha-nacimiento").fill(MINOR_BIRTH);
    await expect(page.getByText(noticeText)).toBeVisible();
  };
}

/** Abre Contacto (#772) y pone en el contacto de emergencia el teléfono del
 * propio socio, sin guardar: la ficha avisa de que debería ser otra persona
 * (#499). */
function typeOwnPhoneAsEmergency(warning: RegExp) {
  return async (page: Page): Promise<void> => {
    await page
      .getByRole("region", { name: CONTACT_CARD })
      .getByRole("button", { name: EDIT_CARD_BUTTON })
      .click();
    await page.locator("#ficha-emergencia-telefono").fill("0412-345-678");
    await expect(page.getByText(warning)).toBeVisible();
  };
}

const ENGLISH_RECORD_MENU = "More actions";
const SPANISH_RECORD_MENU = "Más acciones";

/** Abre el ⋯ de la cabecera de la ficha (#775) y elige una opción. */
async function chooseRecordAction(
  page: Page,
  menuLabel: string,
  action: string,
): Promise<void> {
  await page.getByRole("button", { name: menuLabel }).click();
  await page.getByRole("button", { name: action, exact: true }).click();
}

/** Deja abierto el ⋯ de la cabecera (#775), esperando a su última opción. */
function openRecordMenu(menuLabel: string, lastAction: string) {
  return async (page: Page): Promise<void> => {
    await page.getByRole("button", { name: menuLabel }).click();
    await expect(
      page.getByRole("button", { name: lastAction, exact: true }),
    ).toBeVisible();
  };
}

/** Elige desactivar en el ⋯ y deja a la vista la franja que lo confirma
 * (#775), sin confirmar. */
function askToDeactivate(labels: {
  readonly menu: string;
  readonly action: string;
  readonly prompt: RegExp;
}) {
  return async (page: Page): Promise<void> => {
    await chooseRecordAction(page, labels.menu, labels.action);
    await expect(page.getByText(labels.prompt)).toBeVisible();
  };
}

/** Deja abierta la hoja del ⋯ en el móvil (#777), con su última opción a
 * la vista. */
function openRecordSheet(menuLabel: string, lastAction: string) {
  return async (page: Page): Promise<void> => {
    await page
      .getByRole("navigation")
      .getByRole("button", { name: menuLabel })
      .click();
    await expect(
      page
        .getByRole("dialog", { name: menuLabel })
        .getByRole("button", { name: lastAction, exact: true }),
    ).toBeVisible();
  };
}

/** Abre el diálogo de la exención (#457) desde el ⋯ (#775) y lo deja
 * escrito, sin confirmar. */
function fillWaiverDialog(labels: {
  readonly menu: string;
  readonly open: string;
  readonly reason: string;
  readonly until: RegExp;
  readonly text: string;
}) {
  return async (page: Page): Promise<void> => {
    await chooseRecordAction(page, labels.menu, labels.open);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(labels.reason).fill(labels.text);
    await dialog.getByLabel(labels.until).fill("2027-03-01");
    await expect(dialog).toBeVisible();
  };
}

type MemberRecordState = {
  readonly name: string;
  readonly record: StubbedMemberRecord;
  readonly saveRejection?: StubbedSaveRejection;
  readonly beforeVisit?: (page: Page) => Promise<void>;
  readonly prepare?: (page: Page) => Promise<void>;
  /** Sin ellos, los tres. Con ellos, axe también corre en el primero. */
  readonly viewports?: readonly (typeof viewports)[number][];
};

/** Lo que dibujó el handoff de escritorio (#775): la tableta y el
 * escritorio. */
const RECORD_DESKTOP_VIEWPORTS = viewports.filter((vp) => vp.name !== "mobile");

const MEMBER_RECORD_STATES: readonly MemberRecordState[] = [
  {
    name: "ficha-auf-vigente",
    record: CURRENT_RECORD,
  },
  // #549: el cambio de rol se mudó de la fila del directorio a la ficha, y
  // con él el rechazo del último Admin.
  {
    name: "ficha-rol-ultimo-admin",
    record: { ...CURRENT_RECORD, role: "Admin" },
    prepare: refuseLastAdminChange(LONG_MEMBER_NAME),
  },
  {
    name: "ficha-auf-vigente-es",
    record: CURRENT_RECORD,
    beforeVisit: chooseSpanish,
  },
  {
    name: "ficha-con-foto",
    record: PHOTO_RECORD,
  },
  {
    name: "ficha-con-foto-es",
    record: PHOTO_RECORD,
    beforeVisit: chooseSpanish,
  },
  {
    name: "ficha-auf-vencido",
    record: EXPIRED_RECORD,
  },
  {
    name: "ficha-auf-vencido-es",
    record: EXPIRED_RECORD,
    beforeVisit: chooseSpanish,
  },
  {
    name: "ficha-auf-sin-verificar",
    record: UNVERIFIED_AUF_RECORD,
  },
  {
    name: "ficha-auf-sin-verificar-es",
    record: UNVERIFIED_AUF_RECORD,
    beforeVisit: chooseSpanish,
  },
  {
    name: "ficha-invitacion-pendiente",
    record: PENDING_RECORD,
  },
  {
    name: "ficha-invitacion-pendiente-es",
    record: PENDING_RECORD,
    beforeVisit: chooseSpanish,
  },
  {
    name: "ficha-cuenta-desactivada",
    record: DEACTIVATED_RECORD,
  },
  {
    name: "ficha-cuenta-desactivada-es",
    record: DEACTIVATED_RECORD,
    beforeVisit: chooseSpanish,
  },
  {
    name: "ficha-exenta",
    record: WAIVED_RECORD,
  },
  {
    name: "ficha-exenta-es",
    record: WAIVED_RECORD,
    beforeVisit: chooseSpanish,
  },
  {
    name: "ficha-eximir-confirmacion",
    record: CURRENT_RECORD,
    prepare: fillWaiverDialog({
      menu: ENGLISH_RECORD_MENU,
      open: "Waive membership fee",
      reason: "Reason",
      until: /End date/,
      text: "Head coach of the juniors",
    }),
  },
  {
    name: "ficha-eximir-confirmacion-es",
    record: CURRENT_RECORD,
    beforeVisit: chooseSpanish,
    prepare: fillWaiverDialog({
      menu: SPANISH_RECORD_MENU,
      open: "Eximir de la cuota",
      reason: "Motivo",
      until: /Fecha de fin/,
      text: "Entrenadora de los juveniles",
    }),
  },
  // #775: el ⋯ abierto y la franja que confirma la baja.
  {
    name: "ficha-menu-abierto",
    record: CURRENT_RECORD,
    viewports: RECORD_DESKTOP_VIEWPORTS,
    prepare: openRecordMenu(ENGLISH_RECORD_MENU, "Deactivate member"),
  },
  // #777: en el móvil, el ⋯ de la barra sube una hoja inferior.
  {
    name: "ficha-movil-menu",
    record: CURRENT_RECORD,
    viewports: PHONE_ONLY_VIEWPORTS,
    prepare: openRecordSheet(ENGLISH_RECORD_MENU, "Deactivate member"),
  },
  {
    name: "ficha-desactivar-confirmacion",
    record: CURRENT_RECORD,
    viewports: RECORD_DESKTOP_VIEWPORTS,
    prepare: askToDeactivate({
      menu: ENGLISH_RECORD_MENU,
      action: "Deactivate member",
      prompt: /won't be able to sign in/,
    }),
  },
  {
    name: "ficha-aviso-validacion",
    record: CURRENT_RECORD,
    prepare: submitExpiryBeforeJoining(/can't be before the date they joined/),
  },
  {
    name: "ficha-aviso-validacion-es",
    record: CURRENT_RECORD,
    beforeVisit: chooseSpanish,
    prepare: submitExpiryBeforeJoining(
      /no puede ser anterior a su fecha de ingreso/,
    ),
  },
  {
    name: "ficha-nacimiento-aviso-validacion",
    record: CURRENT_RECORD,
    saveRejection: BIRTH_IN_FUTURE_ERROR,
    prepare: submitBirthInFuture(/Date of birth can't be in the future/),
  },
  {
    name: "ficha-nacimiento-aviso-validacion-es",
    record: CURRENT_RECORD,
    saveRejection: BIRTH_IN_FUTURE_ERROR,
    beforeVisit: chooseSpanish,
    prepare: submitBirthInFuture(
      /La fecha de nacimiento no puede estar en el futuro/,
    ),
  },
  {
    name: "ficha-nacimiento-aviso-tutor",
    record: CURRENT_RECORD,
    prepare: typeMinorBirth(/will have to give a guardian's details/),
  },
  {
    name: "ficha-nacimiento-aviso-tutor-es",
    record: CURRENT_RECORD,
    beforeVisit: chooseSpanish,
    prepare: typeMinorBirth(/tendrá que dar los datos y el consentimiento/),
  },
  {
    name: "ficha-contacto",
    record: CURRENT_RECORD,
    prepare: typeOwnPhoneAsEmergency(/should be someone else/),
  },
  {
    name: "ficha-contacto-es",
    record: CURRENT_RECORD,
    beforeVisit: chooseSpanish,
    prepare: typeOwnPhoneAsEmergency(/debería ser otra persona/),
  },
];

async function goToMemberRecord(
  page: Page,
  state: MemberRecordState,
  theme?: (typeof themes)[number],
): Promise<void> {
  await stubMemberRecordReads(page, state.record, state.saveRejection);
  await state.beforeVisit?.(page);
  if (theme === undefined) {
    await page.goto(`${APP_URL}${MEMBER_RECORD_SCREEN_PATH}`);
  } else {
    await goToWithTheme(page, MEMBER_RECORD_SCREEN_PATH, theme);
  }
  await expect(
    page.getByRole("heading", { level: 1, name: LONG_MEMBER_NAME }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: AUF_CARD })).toBeVisible();
  await expect(
    page.getByRole("list", { name: MEMBER_RECORD_RATINGS }),
  ).toBeVisible();
  if (state.record.photoUrl !== null) {
    await expect(
      page.locator(`img[src="${state.record.photoUrl}"]`),
    ).toHaveJSProperty("complete", true);
  }
  await state.prepare?.(page);
}

/** Las capturas de la ficha con algo abierto en escritorio, que se cierra si
 * la página entera no cabe en la ventana (#675). */
const OPEN_RECORD_STATES: ReadonlySet<string> = new Set([
  "ficha-menu-abierto",
  "ficha-desactivar-confirmacion",
  // Guardar deja la página a media altura: sin alargar la ventana, la barra
  // de pestañas y la de la ficha salen en medio de la captura, según dónde
  // quedó el scroll (#840).
  "ficha-nacimiento-aviso-validacion",
]);

for (const state of MEMBER_RECORD_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of state.viewports ?? viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToMemberRecord(page, state, theme);
              // La ficha usa `useIsPhone` (#777): si no cabe, la captura de
              // página entera la ve un instante como móvil y cierra el ⋯
              // abierto (#675). Con la ventana a su altura no pasa.
              if (OPEN_RECORD_STATES.has(state.name)) {
                await fitViewportToPage(page);
              }
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }

        test("has no horizontal scroll", async ({ page }) => {
          await goToMemberRecord(page, state);
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
        });
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await useFirstStateViewport(page, state.viewports);
      await goToMemberRecord(page, state);
      await expectNoAxeViolations(page);
    });
  });
}

/* La sección de contacto de la ficha (#499) con axe en cada ancho y tema. */
test.describe("el contacto de la ficha con axe en cada ancho y tema", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  const contactStates = MEMBER_RECORD_STATES.filter((state) =>
    state.name.startsWith("ficha-contacto"),
  );

  for (const vp of viewports) {
    test.describe(`@ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const state of contactStates) {
        for (const theme of themes) {
          test(`${state.name} (${theme}) no tiene violaciones`, async ({
            page,
          }) => {
            await goToMemberRecord(page, state, theme);
            await expectNoAxeViolations(page);
          });
        }
      }
    });
  }
});

/* El ⋯ de la ficha abierto y la franja de desactivar (#775) con axe en la
   tableta y el escritorio, en claro y en oscuro. */
test.describe("el menú ⋯ de la ficha con axe en cada ancho y tema", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  const menuStates = MEMBER_RECORD_STATES.filter(
    (state) =>
      state.name === "ficha-menu-abierto" ||
      state.name === "ficha-desactivar-confirmacion",
  );

  for (const vp of RECORD_DESKTOP_VIEWPORTS) {
    test.describe(`@ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const state of menuStates) {
        for (const theme of themes) {
          test(`${state.name} (${theme}) no tiene violaciones`, async ({
            page,
          }) => {
            await goToMemberRecord(page, state, theme);
            await expectNoAxeViolations(page);
          });
        }
      }
    });
  }
});

test.describe("la ficha con una foto que no carga", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("pone las iniciales en su lugar y la ficha sigue funcionando", async ({
    page,
  }) => {
    await stubMemberRecordReads(page, PHOTO_RECORD);
    // Registrada después: Playwright prueba primero la última ruta.
    await page.route(STUBBED_PHOTO_URL, (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await page.goto(`${APP_URL}${MEMBER_RECORD_SCREEN_PATH}`);

    const header = page.locator(".profile-hero-photo");
    await expect(header.locator("img")).toHaveCount(0);
    await expect(header.locator('[aria-hidden="true"]')).toHaveText(
      memberInitials(LONG_MEMBER_NAME),
    );
    await expect(
      page.getByRole("region", { name: AUF_CARD }).getByText("AUF-2026-0042"),
    ).toBeVisible();
  });
});

/* ---------------------------------------------------------------------------
   La ficha en lectura del Committee y del Coach (#776, D1 y D3 del PRD de
   E30). Mockup del Committee:
   docs/design/design_handoff_profile/screenshots/04-desktop-committee.png,
   sin la ficha AUF que dibuja (manda D1). El Coach no está dibujado: se
   revisa contra design-system.md con la del Committee de referencia.

   La vista la finge `page.route`, como las de la ficha del Admin. La sesión
   es la del Committee sembrado también para la del Coach: la frontera deja
   pasar a los dos, y sembrar un Coach sólo para esto costaría una identidad
   de Auth más (#415). Lo que la pantalla pinta lo decide la vista.
   --------------------------------------------------------------------------- */

/** Declarado aquí y no reutilizando el de la configuración del club, que
 * está más abajo: `test.use` lo lee al recorrer el archivo. */
const RECORD_READER_STORAGE_STATE = roleRequestStorageStatePath(
  "committee-de-configuracion",
);

const GROUPS_CARD = /^(Groups|Grupos)$/;

/** Lo que las dos vistas en lectura traen (#770): ni AUF, ni fechas, ni
 * nada de la cuenta. */
const STAFF_RECORD_SHARED = {
  userId: RECORD_MEMBER_ID,
  fullName: LONG_MEMBER_NAME,
  photoUrl: null,
  role: "Player",
  positionName: { en: "Goalkeeper", es: "Portero" },
  experienceLevel: "Intermediate",
  country: "AU",
  emergencyContact: CURRENT_RECORD.emergencyContact,
  membershipPlan: "Full",
  membershipStatus: "active",
  membershipRenewsOn: "2027-06-30",
  groups: CURRENT_RECORD.groups,
  attendance: CURRENT_RECORD.attendance,
} as const;

type StaffRecordState = {
  readonly name: string;
  readonly reading: Readonly<Record<string, unknown>>;
  /** Sin ellos, la tableta y el escritorio. */
  readonly viewports?: readonly (typeof viewports)[number][];
};

const COMMITTEE_READING = {
  ...STAFF_RECORD_SHARED,
  view: "committee",
  email: "socia.de.prueba@example.test",
  phone: CURRENT_RECORD.phone,
} as const;

const STAFF_RECORD_STATES: readonly StaffRecordState[] = [
  { name: "ficha-committee", reading: COMMITTEE_READING },
  {
    name: "ficha-coach",
    reading: { ...STAFF_RECORD_SHARED, view: "coach" },
  },
  {
    name: "ficha-coach-sin-emergencia",
    reading: { ...STAFF_RECORD_SHARED, view: "coach", emergencyContact: null },
  },
  // El móvil (#777, docs/design/design_handoff_profile/screenshots/07): la
  // barra sin ⋯, los botones de contacto a lo ancho y la ficha sin AUF.
  {
    name: "ficha-movil-committee",
    reading: COMMITTEE_READING,
    viewports: PHONE_ONLY_VIEWPORTS,
  },
  {
    name: "ficha-movil-coach",
    reading: { ...STAFF_RECORD_SHARED, view: "coach" },
    viewports: PHONE_ONLY_VIEWPORTS,
  },
];

async function goToStaffRecord(
  page: Page,
  state: StaffRecordState,
  theme?: (typeof themes)[number],
): Promise<void> {
  await page.route(
    (url) => url.pathname === MEMBER_RECORD_ENDPOINT,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: state.reading }),
      }),
  );
  if (theme === undefined) {
    await page.goto(`${APP_URL}${MEMBER_RECORD_SCREEN_PATH}`);
  } else {
    await goToWithTheme(page, MEMBER_RECORD_SCREEN_PATH, theme);
  }
  await expect(
    page.getByRole("heading", { level: 1, name: LONG_MEMBER_NAME }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: GROUPS_CARD })).toBeVisible();
  await waitForAccountInitials(page);
}

for (const state of STAFF_RECORD_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: RECORD_READER_STORAGE_STATE });
    for (const vp of state.viewports ?? RECORD_DESKTOP_VIEWPORTS) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });
        for (const theme of themes) {
          test(`matches approved baseline (${theme})`, async ({ page }) => {
            await goToStaffRecord(page, state, theme);
            const snapshot = `${state.name}-${vp.name}-${theme}.png`;
            await createMissingLocalBaseline(snapshot, () =>
              page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
            );
            await expect(page).toHaveScreenshot(snapshot, {
              ...SCREENSHOT_OPTIONS,
              fullPage: true,
              maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
            });
          });
          test(`has no accessibility violations (${theme})`, async ({
            page,
          }) => {
            await goToStaffRecord(page, state, theme);
            await expectNoAxeViolations(page);
          });
        }
        test("has no horizontal scroll", async ({ page }) => {
          await goToStaffRecord(page, state);
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
        });
      });
    }
  });
}

/* ---------------------------------------------------------------------------
   El perfil y la ficha en el móvil (#777, RF-7 y D14 del PRD de E30), de
   docs/design/design_handoff_profile/screenshots/05, 06 y 07. Los estados
   nuevos de arriba se fotografían a 375; aquí, axe en claro y en oscuro, las
   medidas del ticket y que ninguna vista se salga por el lado a 320 px.
   --------------------------------------------------------------------------- */

const NARROWEST_PHONE = { width: 320, height: 640 } as const;
const PHONE_VIEWPORT = { width: 375, height: 812 } as const;

/** Alto y ancho pintados, redondeados al píxel. Espera a que se vea:
 * `boundingBox` no espera, y justo después de `goto` el perfil puede no
 * haberse pintado todavía (en CI la foto salía sin caja). */
async function sizeOf(
  locator: Locator,
): Promise<{ width: number; height: number }> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error("El elemento no se pinta.");
  }
  return { width: Math.round(box.width), height: Math.round(box.height) };
}

function memberRecordState(name: string): MemberRecordState {
  const state = MEMBER_RECORD_STATES.find((each) => each.name === name);
  if (state === undefined) {
    throw new Error(`Falta el estado ${name}.`);
  }
  return state;
}

function staffRecordState(name: string): StaffRecordState {
  const state = STAFF_RECORD_STATES.find((each) => each.name === name);
  if (state === undefined) {
    throw new Error(`Falta el estado ${name}.`);
  }
  return state;
}

const PHONE_BAR = /^(My profile|Mi perfil|Member|Miembro)$/;

test.describe("el perfil propio en el móvil (#777)", () => {
  skipWithoutSession();
  quietNotificationBell();
  // El socio compartido, al que le faltan datos y no tiene solicitudes.
  test.use({ storageState: E2E_STORAGE_STATE_PATH, viewport: PHONE_VIEWPORT });

  for (const theme of themes) {
    test(`perfil-movil-editando (${theme}) no tiene violaciones`, async ({
      page,
    }) => {
      await goToWithTheme(page, ACCOUNT_PATH, theme);
      await openMissingEmergencyContact(page);
      await expectNoAxeViolations(page);
    });
  }

  test("la barra mide 52 px, con Volver de 44 px y el título", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);
    const bar = page.getByRole("navigation", { name: PHONE_BAR });

    expect((await sizeOf(bar)).height).toBe(52);
    expect(await sizeOf(bar.getByRole("button", { name: "Back" }))).toEqual({
      width: 44,
      height: 44,
    });
    await expect(bar.getByText("My profile")).toBeVisible();
  });

  test("la cabecera va centrada, con la foto de 96 px, la cámara de 40 y el nombre de 22", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);
    // Dentro de `main`, el `<header>` de la cabecera no es un `banner`.
    const header = page.locator(".profile-hero");

    expect(await sizeOf(header.locator(".profile-hero-photo"))).toEqual({
      width: 96,
      height: 96,
    });
    expect(
      await sizeOf(header.getByRole("button", { name: "Add photo" })),
    ).toEqual({ width: 40, height: 40 });
    await expect(header.locator("h1")).toHaveCSS("font-size", "22px");
    await expect(header.locator("h1")).toHaveCSS("text-align", "center");
  });

  test("lo que falta: una fila de 44 px por dato, y la de rol al final de 56", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);
    const missing = page.getByRole("note", { name: /^Almost there · / });
    const rows = missing.getByRole("button");

    await expect(rows.first()).toBeVisible();
    for (const row of await rows.all()) {
      expect((await sizeOf(row)).height).toBe(44);
    }
    expect(
      (
        await sizeOf(
          page.getByRole("button", { name: "Request a role change" }),
        )
      ).height,
    ).toBe(56);
  });

  test("Sobre mí y Contacto: Editar de 44 px, filas de 46 y de 58 px", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);
    const about = page.getByRole("region", { name: ABOUT_CARD });
    const contact = page.getByRole("region", { name: CONTACT_CARD });

    expect(
      (await sizeOf(about.getByRole("button", { name: EDIT_CARD_BUTTON })))
        .height,
    ).toBe(44);
    for (const row of await about.locator(".profile-detail").all()) {
      expect((await sizeOf(row)).height).toBeGreaterThanOrEqual(46);
    }
    for (const row of await contact.locator(".profile-contact-half").all()) {
      expect((await sizeOf(row)).height).toBeGreaterThanOrEqual(58);
    }
    expect(
      (await sizeOf(page.locator(".profile-auf-cells"))).height,
    ).toBeGreaterThanOrEqual(58);
  });

  test("editando: campos de 48 px con texto de 16, y Cancelar y Guardar de 48", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);
    await openAboutCard(page);
    const about = page.getByRole("region", { name: ABOUT_CARD });
    const name = about.getByLabel("Full name");

    expect((await sizeOf(name)).height).toBe(48);
    await expect(name).toHaveCSS("font-size", "16px");
    expect(
      (await sizeOf(about.locator(".segmented-choice-option span").first()))
        .height,
    ).toBe(40);
    for (const label of ["Cancel", "Save"]) {
      expect(
        (await sizeOf(about.getByRole("button", { name: label }))).height,
      ).toBe(48);
    }
  });

  test("Asistencia y Membresía van lado a lado", async ({ page }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);
    const membership = await page
      .getByRole("region", { name: /^(Membership|Membresía)$/ })
      .boundingBox();
    const attendance = await page
      .getByRole("region", { name: /^(Attendance|Asistencia)$/ })
      .boundingBox();

    expect(membership?.y).toBe(attendance?.y);
    expect(membership?.x).not.toBe(attendance?.x);
  });

  test("a 320 px no tiene scroll horizontal, tampoco editando", async ({
    page,
  }) => {
    await page.setViewportSize(NARROWEST_PHONE);
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);
    await expectNoHorizontalScroll(page);

    await openMissingEmergencyContact(page);

    await expectNoHorizontalScroll(page);
  });
});

test.describe("la ficha del Admin en el móvil (#777)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE, viewport: PHONE_VIEWPORT });

  for (const theme of themes) {
    test(`ficha-movil-menu (${theme}) no tiene violaciones`, async ({
      page,
    }) => {
      await goToMemberRecord(
        page,
        memberRecordState("ficha-movil-menu"),
        theme,
      );
      await expectNoAxeViolations(page);
    });
  }

  test("la barra lleva el ⋯ de 44 px y la cabecera, tres botones iguales de 48", async ({
    page,
  }) => {
    await goToMemberRecord(page, memberRecordState("ficha-auf-vigente"));
    const bar = page.getByRole("navigation", { name: PHONE_BAR });
    const contact = page.getByRole("group", { name: /^Contact / });
    const buttons = await contact.locator(".directory-contact-action").all();

    expect(
      await sizeOf(bar.getByRole("button", { name: ENGLISH_RECORD_MENU })),
    ).toEqual({ width: 44, height: 44 });
    expect(buttons).toHaveLength(3);
    const sizes = await Promise.all(buttons.map((button) => sizeOf(button)));
    for (const size of sizes) {
      expect(size).toEqual(sizes[0]);
      expect(size.height).toBe(48);
    }
  });

  test("Verificar AUF va a lo ancho, de 46 px", async ({ page }) => {
    await goToMemberRecord(page, memberRecordState("ficha-auf-sin-verificar"));
    const verify = page.getByRole("button", { name: "Verify AUF" });
    const strip = page.getByRole("note").filter({ has: verify });

    const button = await sizeOf(verify);
    const card = await sizeOf(strip);
    expect(button.height).toBe(46);
    // El relleno de 12 px y el borde de 1 a cada lado.
    expect(button.width).toBe(card.width - 26);
  });

  test("Grupos en fichas de 30 px y Abrir la evaluación de al menos 44", async ({
    page,
  }) => {
    await goToMemberRecord(page, memberRecordState("ficha-auf-vigente"));
    const groups = page.getByRole("region", { name: /^(Groups|Grupos)$/ });

    // El nombre largo del stub se parte en dos líneas; el de una mide 30.
    const heights = await Promise.all(
      (await groups.locator(".profile-group-chips li").all()).map(
        async (chip) => (await sizeOf(chip)).height,
      ),
    );
    expect(Math.min(...heights)).toBe(30);
    expect(
      (
        await sizeOf(
          page
            .getByRole("region", { name: /^(Evaluation|Evaluación)$/ })
            .getByRole("link"),
        )
      ).height,
    ).toBeGreaterThanOrEqual(44);
  });

  test("la hoja del ⋯: radio 20, asa, fondo atenuado y filas de 52 px", async ({
    page,
  }) => {
    const state = memberRecordState("ficha-movil-menu");
    await goToMemberRecord(page, state);
    const sheet = page.getByRole("dialog", { name: ENGLISH_RECORD_MENU });

    await expect(sheet).toHaveCSS("border-top-left-radius", "20px");
    await expect(
      sheet.getByRole("button", { name: "Close actions" }),
    ).toBeVisible();
    const backdrop = await sheet.evaluate(
      (element) => getComputedStyle(element, "::backdrop").backgroundColor,
    );
    expect(backdrop).not.toBe("rgba(0, 0, 0, 0)");
    for (const name of [
      "Change role",
      "Waive membership fee",
      "Deactivate member",
    ]) {
      expect(
        (await sizeOf(sheet.getByRole("button", { name, exact: true }))).height,
      ).toBe(52);
    }
  });

  for (const name of ["ficha-auf-sin-verificar", "ficha-movil-menu"]) {
    test(`${name} a 320 px no tiene scroll horizontal`, async ({ page }) => {
      await page.setViewportSize(NARROWEST_PHONE);
      await goToMemberRecord(page, memberRecordState(name));

      await expectNoHorizontalScroll(page);
    });
  }
});

test.describe("la ficha del Committee y del Coach a 320 px (#777)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: RECORD_READER_STORAGE_STATE,
    viewport: NARROWEST_PHONE,
  });

  for (const name of ["ficha-movil-committee", "ficha-movil-coach"]) {
    test(`${name} no tiene scroll horizontal`, async ({ page }) => {
      await goToStaffRecord(page, staffRecordState(name));

      await expect(
        page
          .getByRole("navigation", { name: PHONE_BAR })
          .getByRole("button", { name: ENGLISH_RECORD_MENU }),
      ).toHaveCount(0);
      await expectNoHorizontalScroll(page);
    });
  }
});

function openOwnRecordLink(page: Page) {
  return page.getByRole("link", {
    name: `Open ${ADMINISTRATION_ADMIN_NAME}'s record`,
  });
}

test.describe("un Admin frente a la ficha con los datos de verdad", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });
  // Sin reintentos: el primer intento ya guarda, y el segundo partiría de lo
  // que dejó el primero y taparía por qué falló.
  test.describe.configure({
    retries: 0,
    timeout: ACCOUNT_CHANGE_TEST_TIMEOUT_MS,
  });

  test("la abre desde el directorio, guarda el AUF y el directorio lo enseña", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);
    await openOwnRecordLink(page).click();
    // Es la primera petición de la corrida a los endpoints reales de la ficha
    // y de los grupos (las capturas los fingen): el dev server los compila
    // aquí, y bajo carga paralela pasa de los 5 s por defecto.
    await expect(
      page.getByRole("heading", { level: 1, name: ADMINISTRATION_ADMIN_NAME }),
    ).toBeVisible({ timeout: ACCOUNT_CHANGE_TIMEOUT_MS });

    const aufNumber = `AUF-E2E-${Date.now()}`;
    const aufCard = await openRecordCard(page, AUF_CARD);
    await aufCard.getByLabel("AUF number").fill(aufNumber);
    await aufCard.getByLabel("Expiry date").fill("2099-12-31");
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("/record") &&
        response.request().method() === "PATCH",
      { timeout: ACCOUNT_CHANGE_TIMEOUT_MS },
    );
    await aufCard.getByRole("button", { name: SAVE_CARD_BUTTON }).click();
    expect((await saved).status()).toBe(200);
    await expect(aufCard.getByText("AUF saved")).toBeVisible();

    // Desde #549 la fila no escribe el AUF: con número y un vencimiento
    // lejano, su fila ya no lleva ningún punto del AUF.
    await page
      .getByRole("main")
      .getByRole("link", { name: "Directory", exact: true })
      .click();
    const ownRow = page.getByRole("row", { name: ADMINISTRATION_ADMIN_NAME });
    await expect(ownRow).toBeVisible();
    await expect(ownRow.getByRole("img", { name: /AUF/ })).toHaveCount(0);

    // Deja la fila como estaba: sin número, que borra también el vencimiento.
    await openOwnRecordLink(page).click();
    // Se espera a la ficha: en el directorio, los puntos "No AUF number"
    // (#549) también responden a esa etiqueta.
    await expect(
      page.getByRole("heading", { level: 1, name: ADMINISTRATION_ADMIN_NAME }),
    ).toBeVisible({ timeout: ACCOUNT_CHANGE_TIMEOUT_MS });
    const resetCard = await openRecordCard(page, AUF_CARD);
    await resetCard.getByLabel("AUF number").fill("");
    await resetCard.getByRole("button", { name: SAVE_CARD_BUTTON }).click();
    await expect(resetCard.getByText("AUF saved")).toBeVisible();
    await expect(resetCard.getByText("Not added yet")).toBeVisible();
  });
});

test.describe("un Player frente a la ficha reservada al Admin", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  test("abrirla a mano lo manda al panel", async ({ page }) => {
    await page.goto(`${APP_URL}${MEMBER_RECORD_SCREEN_PATH}`);

    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("el endpoint le responde 403, para leer y para guardar", async ({
    request,
  }) => {
    const read = await request.get(`${APP_URL}${MEMBER_RECORD_ENDPOINT}`);
    const write = await request.patch(`${APP_URL}${MEMBER_RECORD_ENDPOINT}`, {
      data: { aufNumber: "AUF-1", aufExpiry: null, groupIds: [] },
    });

    expect(read.status()).toBe(403);
    expect(write.status()).toBe(403);
  });

  test("su directorio no enlaza ninguna ficha", async ({ page }) => {
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);
    await expect(page.getByRole("table")).toBeVisible();

    await expect(page.getByRole("link", { name: /record$/ })).toHaveCount(0);
  });
});
/* ---------------------------------------------------------------------------
   El alta de un miembro por un Admin (#243, RF-5 del PRD de E5), abierta desde
   la cabecera del directorio. El botón está en el mockup del directorio; el
   formulario no, así que se revisa contra design-system.md.

   Las capturas leen datos fijos, servidos por `page.route`: los grupos de
   verdad cambian con cada test que siembre, y un alta de verdad mandaría una
   invitación. Lo que la frontera y el endpoint de verdad responden se prueba
   aparte, con un correo que ya tiene cuenta, que no crea nada ni manda nada.
   --------------------------------------------------------------------------- */

const NEW_MEMBER_SCREEN_PATH = `${DIRECTORY_SCREEN_PATH}/nuevo`;
const NEW_MEMBER_ID = "cccccccc-0000-4000-8000-000000000243";

const EMAIL_TAKEN_ERROR = {
  error: {
    code: "conflict",
    message: "Ese correo ya tiene una cuenta.",
    reason: "email_taken",
  },
};

type NewMemberCopy = {
  readonly title: string;
  readonly submit: string;
  readonly fullName: string;
  readonly email: string;
  readonly country: string;
  readonly position: string;
  /** El nombre de Forward en ese idioma: el desplegable lleva los del club
   * (#299), y la opción se elige por lo que dice. */
  readonly forward: string;
  readonly experienceLevel: string;
  readonly gender: string;
  readonly aufNumber: string;
  readonly aufExpiry: string;
  readonly emailTaken: string;
  readonly invitationSent: RegExp;
};

const ENGLISH_NEW_MEMBER: NewMemberCopy = {
  title: "Invite member",
  submit: "Invite member",
  fullName: "Full name",
  email: "Email",
  country: "Country",
  position: "Position",
  forward: "Forward",
  experienceLevel: "Experience level",
  gender: "Gender",
  aufNumber: "AUF number",
  aufExpiry: "AUF expiry date",
  emailTaken: "That email already has an account in the club.",
  invitationSent: /We sent the invitation to/,
};

const SPANISH_NEW_MEMBER: NewMemberCopy = {
  title: "Invitar miembro",
  submit: "Invitar miembro",
  fullName: "Nombre completo",
  email: "Correo",
  country: "País",
  position: "Posición",
  forward: "Ataque",
  experienceLevel: "Nivel de experiencia",
  gender: "Género",
  aufNumber: "Número de AUF",
  aufExpiry: "Vencimiento del AUF",
  emailTaken: "Ese correo ya tiene una cuenta en el club.",
  invitationSent: /Le mandamos la invitación a/,
};

type NewMemberAnswer = "sent" | "email_taken";

async function stubNewMemberApi(
  page: Page,
  answer: NewMemberAnswer,
): Promise<void> {
  await page.route(
    (url) => url.pathname === CLUB_GROUPS_ENDPOINT,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { groups: STUBBED_CLUB_GROUPS } }),
      }),
  );
  await page.route(
    (url) => url.pathname === MEMBERS_ENDPOINT,
    (route, request) => {
      if (request.method() !== "POST") {
        return route.fallback();
      }
      return answer === "email_taken"
        ? route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify(EMAIL_TAKEN_ERROR),
          })
        : route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                member: {
                  userId: NEW_MEMBER_ID,
                  fullName: LONG_MEMBER_NAME,
                  email: "nerea.silva@example.com",
                },
                invitation: "sent",
              },
            }),
          });
    },
  );
}

type NewMemberEntry = {
  readonly fullName: string;
  readonly email: string;
  /** Los grupos de verdad cambian con cada test que siembre: el caso real no
   * elige ninguno. */
  readonly groupName: string | null;
};

const STUBBED_ENTRY: NewMemberEntry = {
  fullName: LONG_MEMBER_NAME,
  email: "nerea.silva@example.com",
  groupName: STUBBED_CLUB_GROUPS[2].name,
};

async function fillNewMemberForm(
  page: Page,
  copy: NewMemberCopy,
  entry: NewMemberEntry,
): Promise<void> {
  await page.getByLabel(copy.fullName).fill(entry.fullName);
  await page.getByLabel(copy.email).fill(entry.email);
  await page.getByLabel(copy.country).selectOption("AU");
  await page.getByLabel(copy.position).selectOption({ label: copy.forward });
  await page.getByLabel(copy.experienceLevel).selectOption("Intermediate");
  await page.getByLabel(copy.gender).selectOption("female");
  await page.getByLabel(copy.aufNumber).fill("AUF-2026-0243");
  await page.getByLabel(copy.aufExpiry).fill("2099-06-30");
  if (entry.groupName !== null) {
    await page.getByRole("checkbox", { name: entry.groupName }).check();
  }
}

function fillNewMember(copy: NewMemberCopy) {
  return (page: Page): Promise<void> =>
    fillNewMemberForm(page, copy, STUBBED_ENTRY);
}

function submitNewMember(copy: NewMemberCopy, expected: string | RegExp) {
  return async (page: Page): Promise<void> => {
    await fillNewMemberForm(page, copy, STUBBED_ENTRY);
    await page.getByRole("button", { name: copy.submit }).click();
    await expect(page.getByText(expected)).toBeVisible();
  };
}

type NewMemberState = {
  readonly name: string;
  readonly copy: NewMemberCopy;
  readonly answer: NewMemberAnswer;
  readonly beforeVisit?: (page: Page) => Promise<void>;
  readonly prepare?: (page: Page) => Promise<void>;
};

const NEW_MEMBER_STATES: readonly NewMemberState[] = [
  { name: "alta-vacia", copy: ENGLISH_NEW_MEMBER, answer: "sent" },
  {
    name: "alta-vacia-es",
    copy: SPANISH_NEW_MEMBER,
    answer: "sent",
    beforeVisit: chooseSpanish,
  },
  {
    name: "alta-con-datos",
    copy: ENGLISH_NEW_MEMBER,
    answer: "sent",
    prepare: fillNewMember(ENGLISH_NEW_MEMBER),
  },
  {
    name: "alta-correo-repetido",
    copy: ENGLISH_NEW_MEMBER,
    answer: "email_taken",
    prepare: submitNewMember(ENGLISH_NEW_MEMBER, ENGLISH_NEW_MEMBER.emailTaken),
  },
  {
    name: "alta-correo-repetido-es",
    copy: SPANISH_NEW_MEMBER,
    answer: "email_taken",
    beforeVisit: chooseSpanish,
    prepare: submitNewMember(SPANISH_NEW_MEMBER, SPANISH_NEW_MEMBER.emailTaken),
  },
  {
    name: "alta-invitacion-enviada",
    copy: ENGLISH_NEW_MEMBER,
    answer: "sent",
    prepare: submitNewMember(
      ENGLISH_NEW_MEMBER,
      ENGLISH_NEW_MEMBER.invitationSent,
    ),
  },
  {
    name: "alta-invitacion-enviada-es",
    copy: SPANISH_NEW_MEMBER,
    answer: "sent",
    beforeVisit: chooseSpanish,
    prepare: submitNewMember(
      SPANISH_NEW_MEMBER,
      SPANISH_NEW_MEMBER.invitationSent,
    ),
  },
];

async function goToNewMember(
  page: Page,
  state: NewMemberState,
  theme?: (typeof themes)[number],
): Promise<void> {
  await stubNewMemberApi(page, state.answer);
  await state.beforeVisit?.(page);
  if (theme === undefined) {
    await page.goto(`${APP_URL}${NEW_MEMBER_SCREEN_PATH}`);
  } else {
    await goToWithTheme(page, NEW_MEMBER_SCREEN_PATH, theme);
  }
  await expect(
    page.getByRole("heading", { level: 1, name: state.copy.title }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: STUBBED_CLUB_GROUPS[2].name }),
  ).toBeVisible();
  await state.prepare?.(page);
}

for (const state of NEW_MEMBER_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToNewMember(page, state, theme);
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }

        test("has no horizontal scroll", async ({ page }) => {
          await goToNewMember(page, state);
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
        });
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await goToNewMember(page, state);
      await expectNoAxeViolations(page);
    });
  });
}

test.describe("un Admin frente al alta con los datos de verdad", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("la abre desde el directorio y un correo con cuenta se rechaza junto a su campo", async ({
    page,
    request,
  }) => {
    // Un correo que ya tiene cuenta en el club: el del propio Admin. Así el
    // alta de verdad responde 409 sin crear nada ni mandar ningún correo.
    const members = await request.get(`${APP_URL}${MEMBERS_ENDPOINT}`);
    expect(members.status()).toBe(200);
    const { data } = (await members.json()) as {
      data: { members: { fullName: string; email: string }[] };
    };
    const adminEmail = data.members.find(
      (member) => member.fullName === ADMINISTRATION_ADMIN_NAME,
    )?.email;
    if (adminEmail === undefined) {
      throw new Error("El Admin sembrado no aparece en la lista de socios.");
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);
    await page.getByRole("link", { name: "Invite member" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: ENGLISH_NEW_MEMBER.title }),
    ).toBeVisible();

    await fillNewMemberForm(page, ENGLISH_NEW_MEMBER, {
      fullName: "Alta repetida",
      email: adminEmail,
      groupName: null,
    });
    const answered = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === MEMBERS_ENDPOINT &&
        response.request().method() === "POST",
      { timeout: ACCOUNT_CHANGE_TIMEOUT_MS },
    );
    await page.getByRole("button", { name: ENGLISH_NEW_MEMBER.submit }).click();

    expect((await answered).status()).toBe(409);
    await expect(
      page.getByLabel(ENGLISH_NEW_MEMBER.email),
    ).toHaveAccessibleDescription(ENGLISH_NEW_MEMBER.emailTaken);
  });
});

test.describe("un Player frente al alta de un miembro", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  test("abrirla a mano lo manda al panel", async ({ page }) => {
    await page.goto(`${APP_URL}${NEW_MEMBER_SCREEN_PATH}`);

    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("el alta y el reenvío le responden 403", async ({ request }) => {
    const created = await request.post(`${APP_URL}${MEMBERS_ENDPOINT}`, {
      data: {},
    });
    const resent = await request.post(
      `${APP_URL}${MEMBERS_ENDPOINT}/${NEW_MEMBER_ID}/invitation`,
    );

    expect(created.status()).toBe(403);
    expect(resent.status()).toBe(403);
  });

  test("su directorio no ofrece dar de alta", async ({ page }) => {
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);
    await expect(page.getByRole("table")).toBeVisible();

    await expect(page.getByRole("link", { name: "Invite member" })).toHaveCount(
      0,
    );
  });
});
/* ---------------------------------------------------------------------------
   La campana de avisos (#266). Sin captura en docs/mockups/: se sigue el
   prototipo y se revisa contra design-system.md. Las capturas responden a la
   campana con una API de mentira (`page.route`), porque el número y la lista
   tienen que ser los mismos en cada corrida; una prueba aparte habla con la
   API de verdad.
   --------------------------------------------------------------------------- */

const NOTIFICATIONS_ENDPOINT = "/api/v1/notifications";
const UNREAD_COUNT_ENDPOINT = `${NOTIFICATIONS_ENDPOINT}/unread-count`;
const READ_ALL_ENDPOINT = `${NOTIFICATIONS_ENDPOINT}/read-all`;
const NOTIFICATIONS_SCREEN_PATH = "/dashboard";
const HOUR_MS = 60 * 60 * 1000;
const BELL_NAME = /^(Notifications|Avisos)/;
const NOTIFICATIONS_REGION_NAME = /^(Notifications|Avisos)$/;

type FakeNotification = {
  readonly id: string;
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly isRead: boolean;
};

/** A media hora de un cambio de unidad: el tiempo relativo que sale en la
 * captura no se mueve aunque la corrida tarde. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - (hours + 0.5) * HOUR_MS).toISOString();
}

/** Los avisos se miran sobre el inicio, que se fotografía con la hora fijada
 * (#561): su tiempo relativo se cuenta desde esa hora, no desde ahora. */
function hoursBeforeHome(hours: number): string {
  return new Date(HOME_NOW.getTime() - (hours + 0.5) * HOUR_MS).toISOString();
}

function fakeNotificationId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const SAMPLE_NOTIFICATIONS: readonly FakeNotification[] = [
  {
    id: fakeNotificationId(1),
    type: "role_request_received",
    data: { requesterName: "Nerea Ruiz", requestedRole: "Coach" },
    createdAt: hoursBeforeHome(2),
    isRead: false,
  },
  {
    id: fakeNotificationId(2),
    type: "role_changed",
    data: { newRole: "Committee" },
    createdAt: hoursBeforeHome(5),
    isRead: false,
  },
  {
    id: fakeNotificationId(3),
    type: "role_request_rejected",
    data: { requestedRole: "Coach" },
    createdAt: hoursBeforeHome(26),
    isRead: false,
  },
  {
    id: fakeNotificationId(4),
    type: "role_changed",
    data: { newRole: "Player" },
    createdAt: hoursBeforeHome(24 * 9),
    isRead: true,
  },
];

function unreadOnly(count: number): readonly FakeNotification[] {
  return Array.from({ length: count }, (_, index) => ({
    id: fakeNotificationId(index + 1),
    type: "role_changed",
    data: { newRole: "Coach" },
    createdAt: hoursBeforeHome(index + 1),
    isRead: false,
  }));
}

/** La API de avisos de mentira, con el mismo contrato que la de #265. */
async function serveNotifications(
  page: Page,
  notifications: readonly FakeNotification[],
): Promise<void> {
  let stored = [...notifications];
  await page.route(`**${UNREAD_COUNT_ENDPOINT}`, (route) =>
    route.fulfill({
      json: {
        data: { unreadCount: stored.filter((n) => !n.isRead).length },
      },
    }),
  );
  await page.route(`**${NOTIFICATIONS_ENDPOINT}`, (route) =>
    route.fulfill({ json: { data: { notifications: stored } } }),
  );
  await page.route(`**${READ_ALL_ENDPOINT}`, (route) => {
    stored = stored.map((n) => ({ ...n, isRead: true }));
    return route.fulfill({ status: 204 });
  });
  await page.route(`**${NOTIFICATIONS_ENDPOINT}/*/read`, (route) => {
    const readId = new URL(route.request().url()).pathname.split("/").at(-2);
    stored = stored.map((n) => (n.id === readId ? { ...n, isRead: true } : n));
    return route.fulfill({ status: 204 });
  });
}

function notificationsRegion(page: Page): Locator {
  return page.getByRole("region", { name: NOTIFICATIONS_REGION_NAME });
}

async function openNotifications(page: Page): Promise<void> {
  await page.getByRole("button", { name: BELL_NAME }).click();
  await expect(notificationsRegion(page)).toBeVisible();
  await expect(notificationsRegion(page).getByRole("status")).toHaveCount(0);
}

type BellState = {
  readonly name: string;
  readonly notifications: readonly FakeNotification[];
  /** El texto del número, o null si la campana va sin él. */
  readonly badge: string | null;
};

const BELL_STATES: readonly BellState[] = [
  { name: "campana-con-numero", notifications: unreadOnly(3), badge: "3" },
  { name: "campana-9-mas", notifications: unreadOnly(12), badge: "9+" },
  { name: "campana-sin-numero", notifications: [], badge: null },
];

for (const state of BELL_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    test.use({ storageState: E2E_STORAGE_STATE_PATH });

    for (const vp of viewports) {
      for (const theme of themes) {
        test(`@ ${vp.name}: matches approved baseline (${theme})`, async ({
          page,
        }) => {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await serveNotifications(page, state.notifications);
          await goToWithTheme(page, NOTIFICATIONS_SCREEN_PATH, theme);
          const bell = page.getByRole("button", { name: BELL_NAME });
          if (state.badge === null) {
            await expect(bell).toHaveAccessibleName(
              "Notifications, none unread",
            );
          } else {
            await expect(bell).toHaveText(state.badge);
          }
          // En escritorio la campana vive en la barra de arriba (#717).
          const header = page.locator(
            vp.name === "mobile"
              ? ".app-sidebar-header"
              : ".app-topbar-actions",
          );
          const snapshot = `${state.name}-${vp.name}-${theme}.png`;
          await createMissingLocalBaseline(snapshot, () =>
            header.screenshot(SCREENSHOT_OPTIONS),
          );
          await expect(header).toHaveScreenshot(snapshot, {
            ...SCREENSHOT_OPTIONS,
            maxDiffPixels: COMPONENT_MAX_DIFF_PIXELS,
          });
        });
      }
    }
  });
}

type NotificationListCapture = {
  readonly name: string;
  readonly notifications: readonly FakeNotification[];
  readonly beforeVisit?: (page: Page) => Promise<void>;
};

// El español conserva su captura con avisos: "Marcar todo como leído" es
// bastante más largo que "Mark all read" y es el que puede partir la fila.
const NOTIFICATION_LIST_CAPTURES: readonly NotificationListCapture[] = [
  { name: "avisos-con-avisos", notifications: SAMPLE_NOTIFICATIONS },
  {
    name: "avisos-con-avisos-es",
    notifications: SAMPLE_NOTIFICATIONS,
    beforeVisit: chooseSpanish,
  },
  { name: "avisos-vacia", notifications: [] },
];

for (const capture of NOTIFICATION_LIST_CAPTURES) {
  test.describe(capture.name, () => {
    skipWithoutSession();
    test.use({ storageState: E2E_STORAGE_STATE_PATH });

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        for (const theme of themes) {
          test(`matches approved baseline (${theme})`, async ({ page }) => {
            await capture.beforeVisit?.(page);
            await serveNotifications(page, capture.notifications);
            await goToWithTheme(page, NOTIFICATIONS_SCREEN_PATH, theme);
            await openNotifications(page);
            // El ratón se queda donde estaba la campana, que en el móvil es
            // encima de "Mark all read": la captura saldría con su hover.
            await page.mouse.move(0, 0);
            // Sin fullPage: en el móvil la lista es una pantalla fija encima
            // de la página, y lo que hay debajo no forma parte de la captura.
            const snapshot = `${capture.name}-${vp.name}-${theme}.png`;
            await createMissingLocalBaseline(snapshot, () =>
              page.screenshot(SCREENSHOT_OPTIONS),
            );
            await expect(page).toHaveScreenshot(snapshot, {
              ...SCREENSHOT_OPTIONS,
              maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
            });
          });
        }

        test("has no horizontal scroll with the list open", async ({
          page,
        }) => {
          await capture.beforeVisit?.(page);
          await serveNotifications(page, capture.notifications);
          await fixClockOnHome(page, NOTIFICATIONS_SCREEN_PATH);
          await page.goto(`${APP_URL}${NOTIFICATIONS_SCREEN_PATH}`);
          await openNotifications(page);
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
        });

        test("has no accessibility violations with the list open (axe-core)", async ({
          page,
        }) => {
          await capture.beforeVisit?.(page);
          await serveNotifications(page, capture.notifications);
          await fixClockOnHome(page, NOTIFICATIONS_SCREEN_PATH);
          await page.goto(`${APP_URL}${NOTIFICATIONS_SCREEN_PATH}`);
          await openNotifications(page);
          await expectNoAxeViolations(page);
        });
      });
    }
  });
}

test.describe("la campana de avisos", () => {
  skipWithoutSession();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  test("en escritorio abre un panel bajo la campana y Escape lo cierra", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await serveNotifications(page, SAMPLE_NOTIFICATIONS);
    await page.goto(`${APP_URL}${NOTIFICATIONS_SCREEN_PATH}`);

    await openNotifications(page);
    const panel = await notificationsRegion(page).boundingBox();
    expect(panel?.width, "el panel ocupa toda la pantalla").toBeLessThan(1440);
    await expect(page.getByRole("button", { name: "Back" })).toBeHidden();
    await page.keyboard.press("Escape");

    await expect(notificationsRegion(page)).toHaveCount(0);
  });

  // La campana y el botón de la cuenta (#287) van en una sola fila, dentro de
  // la barra de arriba desde #717.
  for (const width of [768, 1440]) {
    test(`los controles de la cabecera caben en una fila de la barra de arriba a ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${APP_URL}${NOTIFICATIONS_SCREEN_PATH}`);

      const topbar = await page.locator(".app-topbar").boundingBox();
      const bell = await page
        .getByRole("button", { name: BELL_NAME })
        .boundingBox();
      const account = await page
        .getByRole("button", { name: ACCOUNT_BUTTON_NAME })
        .boundingBox();
      if (topbar === null || bell === null || account === null) {
        throw new Error("la barra de arriba no dibujó sus controles");
      }

      // El botón de la cuenta (38px) es más bajo que la campana (44px): los
      // dos van centrados en la misma fila.
      expect(
        Math.round(account.y + account.height / 2),
        "los controles se parten en dos filas",
      ).toBe(Math.round(bell.y + bell.height / 2));
      expect(account.x + account.width).toBeLessThanOrEqual(
        topbar.x + topbar.width,
      );
    });
  }

  test("en escritorio se cierra al pulsar fuera del panel", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await serveNotifications(page, SAMPLE_NOTIFICATIONS);
    await page.goto(`${APP_URL}${NOTIFICATIONS_SCREEN_PATH}`);
    await openNotifications(page);

    await page.getByRole("main").click({ position: { x: 900, y: 600 } });

    await expect(notificationsRegion(page)).toHaveCount(0);
  });

  for (const width of [360, 375]) {
    test(`en el móvil la lista ocupa la pantalla y se vuelve con la flecha a ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await serveNotifications(page, SAMPLE_NOTIFICATIONS);
      await page.goto(`${APP_URL}${NOTIFICATIONS_SCREEN_PATH}`);

      await openNotifications(page);
      const panel = await notificationsRegion(page).boundingBox();
      expect(panel).toEqual({ x: 0, y: 0, width, height: 800 });
      await page.getByRole("button", { name: "Back" }).click();

      await expect(notificationsRegion(page)).toHaveCount(0);
    });
  }

  test("en el móvil el teclado no se pasea por la pantalla tapada", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await serveNotifications(page, SAMPLE_NOTIFICATIONS);
    await page.goto(`${APP_URL}${NOTIFICATIONS_SCREEN_PATH}`);
    await openNotifications(page);
    const region = notificationsRegion(page);
    const controlsInList =
      (await region.getByRole("button").count()) +
      (await region.getByRole("link").count());

    for (let press = 0; press <= controlsInList; press += 1) {
      await page.keyboard.press("Tab");
    }

    const isFocusInsideList = await page.evaluate(
      () => document.activeElement?.closest(".notification-panel") !== null,
    );
    const isListOpen = (await notificationsRegion(page).count()) > 0;
    expect(
      isListOpen && !isFocusInsideList,
      "el foco salió de la lista y la lista sigue tapando la pantalla",
    ).toBe(false);
  });

  test("marcar todo deja la campana sin número", async ({ page }) => {
    await serveNotifications(page, SAMPLE_NOTIFICATIONS);
    await page.goto(`${APP_URL}${NOTIFICATIONS_SCREEN_PATH}`);
    await expect(page.getByRole("button", { name: BELL_NAME })).toHaveText("3");
    await openNotifications(page);

    await page.getByRole("button", { name: "Mark all read" }).click();

    await expect(
      page.getByRole("button", { name: "Notifications, none unread" }),
    ).toHaveText("");
  });

  test("dice que no pudo cargar la lista cuando falla la red", async ({
    page,
  }) => {
    await serveNotifications(page, SAMPLE_NOTIFICATIONS);
    await page.route(`**${NOTIFICATIONS_ENDPOINT}`, (route) =>
      route.abort("internetdisconnected"),
    );
    await page.goto(`${APP_URL}${NOTIFICATIONS_SCREEN_PATH}`);

    await page.getByRole("button", { name: BELL_NAME }).click();

    await expect(
      page.getByText("We couldn't load your notifications."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  // #338: cada aviso es un enlace a la pantalla donde se actúa sobre él.
  test("en escritorio abrir un aviso lleva a su pantalla y cierra el panel", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await serveNotifications(page, SAMPLE_NOTIFICATIONS);
    await page.goto(`${APP_URL}${NOTIFICATIONS_SCREEN_PATH}`);
    await expect(page.getByRole("button", { name: BELL_NAME })).toHaveText("3");
    await openNotifications(page);
    await expect(
      notificationsRegion(page).getByRole("link", { name: /Nerea Ruiz/ }),
    ).toHaveAttribute("href", DIRECTORY_SCREEN_PATH);

    await notificationsRegion(page)
      .getByRole("link", { name: /Committee/ })
      .first()
      .click();

    await expect(page).toHaveURL(new RegExp(`${ACCOUNT_PATH}$`));
    await expect(notificationsRegion(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: BELL_NAME })).toHaveText("2");
  });

  test("en el móvil abrir un aviso navega y volver regresa a donde se abrió", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await serveNotifications(page, SAMPLE_NOTIFICATIONS);
    await page.goto(`${APP_URL}${NOTIFICATIONS_SCREEN_PATH}`);
    await openNotifications(page);

    await notificationsRegion(page)
      .getByRole("link", { name: /Committee/ })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`${ACCOUNT_PATH}$`));
    await page.goBack();

    await expect(page).toHaveURL(new RegExp(`${NOTIFICATIONS_SCREEN_PATH}$`));
  });

  // Sin API de mentira: la campana lee por los endpoints de #265.
  test("lee la lista de la API de verdad", async ({ page }) => {
    await page.goto(`${APP_URL}${NOTIFICATIONS_SCREEN_PATH}`);
    const listed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === NOTIFICATIONS_ENDPOINT &&
        response.request().method() === "GET",
    );

    await page.getByRole("button", { name: BELL_NAME }).click();

    expect((await listed).status()).toBe(200);
    await expect(notificationsRegion(page)).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(
      0,
    );
  });
});

/* ---------------------------------------------------------------------------
   El menú de la cuenta (#287). Sin mockup: se revisa contra design-system.md,
   con la lista de avisos (#266) como referencia de cómo se abre. La campana va
   vacía en todas las pruebas para que su número no mueva las capturas.
   --------------------------------------------------------------------------- */

const ACCOUNT_MENU_SCREENS: readonly Screen[] = [
  { name: "panel", path: "/dashboard" },
  { name: "directorio", path: DIRECTORY_SCREEN_PATH },
];

type MenuLanguage = {
  readonly suffix: string;
  readonly beforeVisit?: (page: Page) => Promise<void>;
};

const MENU_LANGUAGES: readonly MenuLanguage[] = [
  { suffix: "en" },
  { suffix: "es", beforeVisit: chooseSpanish },
];

test.describe("menú de la cuenta", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  for (const language of MENU_LANGUAGES) {
    for (const vp of viewports) {
      test.describe(`${language.suffix} @ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        for (const theme of themes) {
          test(`abierto: matches approved baseline (${theme})`, async ({
            page,
          }) => {
            await language.beforeVisit?.(page);
            await goToWithTheme(page, "/dashboard", theme);
            await openAccountMenu(page);
            // El ratón se queda sobre el botón de la cuenta, que en el móvil
            // es una fila del menú: la captura saldría con su hover.
            await page.mouse.move(0, 0);
            // Sin fullPage: en el móvil el menú es una pantalla fija encima
            // de la página, y lo que hay debajo no forma parte de la captura.
            const snapshot = `menu-cuenta-${language.suffix}-${vp.name}-${theme}.png`;
            await createMissingLocalBaseline(snapshot, () =>
              page.screenshot(SCREENSHOT_OPTIONS),
            );
            await expect(page).toHaveScreenshot(snapshot, {
              ...SCREENSHOT_OPTIONS,
              maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
            });
          });
        }
      });
    }
  }

  for (const menuScreen of ACCOUNT_MENU_SCREENS) {
    for (const vp of viewports) {
      test(`${menuScreen.name} @ ${vp.name}: no accessibility violations with the menu open (axe-core)`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`${APP_URL}${menuScreen.path}`);
        await openAccountMenu(page);

        await expectNoAxeViolations(page);
      });

      test(`${menuScreen.name} @ ${vp.name}: has no horizontal scroll with the menu open`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`${APP_URL}${menuScreen.path}`);
        await openAccountMenu(page);

        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        );
        expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
      });
    }
  }

  test("el menú en español: has no accessibility violations (axe-core)", async ({
    page,
  }) => {
    await chooseSpanish(page);
    await page.goto(`${APP_URL}/dashboard`);
    await openAccountMenu(page);

    await expectNoAxeViolations(page);
  });

  test("el botón de la cuenta dice si el menú está abierto o cerrado", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}/dashboard`);
    const button = page.getByRole("button", { name: ACCOUNT_BUTTON_NAME });
    await expect(button).toHaveAttribute("aria-expanded", "false");

    await openAccountMenu(page);

    await expect(button).toHaveAttribute("aria-expanded", "true");
  });

  test("ofrece Mi perfil, Apariencia, Idioma y Cerrar sesión, en ese orden", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}/dashboard`);

    const menu = await openAccountMenu(page);

    // El grupo de radios no lleva su nombre dentro: va en la etiqueta de
    // encima, que es lo que se compara.
    await expect(
      menu.locator("a, .segmented-choice-label, .account-menu-signout button"),
    ).toHaveText([/My profile/, /Appearance/, /Language/, /Sign out/]);
  });

  test("en escritorio es un desplegable que se cierra con Escape y devuelve el foco", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${APP_URL}/dashboard`);

    const menu = await openAccountMenu(page);
    const box = await menu.boundingBox();
    expect(box?.width, "el menú ocupa toda la pantalla").toBeLessThan(1440);
    await expect(
      menu.getByRole("button", { name: BACK_BUTTON_NAME }),
    ).toBeHidden();
    await page.keyboard.press("Escape");

    await expect(accountMenu(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: ACCOUNT_BUTTON_NAME }),
    ).toBeFocused();
  });

  test("en escritorio se cierra al pulsar fuera y devuelve el foco", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${APP_URL}/dashboard`);
    await openAccountMenu(page);

    await page.getByRole("main").click({ position: { x: 900, y: 600 } });

    await expect(accountMenu(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: ACCOUNT_BUTTON_NAME }),
    ).toBeFocused();
  });

  for (const width of [360, 375]) {
    test(`en el móvil ocupa la pantalla y se vuelve con la flecha a ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${APP_URL}/dashboard`);

      const menu = await openAccountMenu(page);
      expect(await menu.boundingBox()).toEqual({
        x: 0,
        y: 0,
        width,
        height: 800,
      });
      await menu.getByRole("button", { name: BACK_BUTTON_NAME }).click();

      await expect(accountMenu(page)).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: ACCOUNT_BUTTON_NAME }),
      ).toBeFocused();
    });
  }

  test("el teclado recorre la cabecera en orden: campana y luego cuenta", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${APP_URL}/dashboard`);
    const bell = page.getByRole("button", { name: BELL_NAME });

    await bell.focus();
    await page.keyboard.press("Tab");

    await expect(
      page.getByRole("button", { name: ACCOUNT_BUTTON_NAME }),
    ).toBeFocused();
    const isBrandBeforeBell = await page
      .locator(".app-brand")
      .evaluate(
        (brand, bellElement) =>
          bellElement !== null &&
          (brand.compareDocumentPosition(bellElement) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
            0,
        await bell.elementHandle(),
      );
    expect(isBrandBeforeBell, "el nombre va antes que la campana").toBe(true);
  });

  test("con el menú abierto el teclado no se pasea por lo que queda detrás", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`${APP_URL}/dashboard`);
    const menu = await openAccountMenu(page);
    // Cada grupo de radios es una sola parada del tabulador.
    const controlsInMenu =
      (await menu.getByRole("button").count()) +
      (await menu.getByRole("link").count()) +
      (await menu.getByRole("radiogroup").count());

    // Una pulsación más que controles tiene el menú: la última lo recorre
    // entero y sale. En ningún momento puede quedar el menú abierto con el
    // foco en lo que tapa; al salir, el foco vuelve al botón de la cuenta.
    for (let press = 0; press <= controlsInMenu; press += 1) {
      await page.keyboard.press("Tab");
      const isFocusInsideMenu = await page.evaluate(
        () => document.activeElement?.closest(".account-menu") !== null,
      );
      const isMenuOpen = (await accountMenu(page).count()) > 0;
      expect(
        isMenuOpen && !isFocusInsideMenu,
        "el foco salió a lo que queda detrás y el menú sigue tapándolo",
      ).toBe(false);
      if (!isMenuOpen) {
        await expect(
          page.getByRole("button", { name: ACCOUNT_BUTTON_NAME }),
        ).toBeFocused();
        return;
      }
    }
    throw new Error("el foco no llegó a salir del menú");
  });

  test("el tema cambia al momento, el menú sigue abierto y se conserva al recargar", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}/dashboard`);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "light");
    const menu = await openAccountMenu(page);

    await menu.getByRole("radio", { name: "Dark" }).click();

    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(accountMenu(page)).toBeVisible();
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    const reopened = await openAccountMenu(page);
    await expect(reopened.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  test("el idioma cambia toda la aplicación, el propio menú incluido, y se conserva al recargar", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}/dashboard`);
    const menu = await openAccountMenu(page);

    await menu.getByRole("radio", { name: "Español" }).click();

    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(accountMenu(page)).toBeVisible();
    await expect(
      accountMenu(page).getByRole("link", { name: "Mi perfil" }),
    ).toBeVisible();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    const reopened = await openAccountMenu(page);
    await expect(
      reopened.getByRole("radio", { name: "Español" }),
    ).toBeChecked();
  });
});
/* ---------------------------------------------------------------------------
   La configuración del club (#296, RF-6 del PRD de E18a), abierta desde el
   menú de la cuenta del Admin. Sin mockup: se revisa contra design-system.md,
   con la ficha del miembro como referencia de formulario.

   Las capturas leen datos fijos, servidos por `page.route`: guardar de verdad
   cambiaría el nombre que sale en la cabecera de todas las demás capturas de
   la corrida. Lo que la frontera y el endpoint de verdad responden se prueba
   aparte, con un guardado que no cambia nada.
   --------------------------------------------------------------------------- */

const CLUB_SETTINGS_SCREEN_PATH = "/club";
const CLUB_SETTINGS_ENDPOINT = "/api/v1/club/settings";

/** El máximo que admite `clubs_name_length`, para el caso de contenido
 * largo. */
const STUBBED_CLUB_SETTINGS = {
  name: "Asociación Deportiva de Rugby Subacuático del Sur · Tasmania",
  initials: "AD",
  accentColor: "#1c6ea4",
  logoUrl: null,
  seasonStartsOn: null,
} as const;

/** Un inicio de temporada elegido en General (#744). */
const CHOSEN_SEASON_START = "2026-03-02";

/** Guardar cambios, en la barra de cambios sin guardar (#719). */
const ENGLISH_SAVE_SETTINGS = "Save changes";
const SPANISH_SAVE_SETTINGS = "Guardar cambios";

/** Un nombre distinto del guardado: sin un cambio no hay barra con la que
 * guardar (#719). */
const EDITED_CLUB_NAME = "Victoria Seadragons Underwater Rugby";

type ClubSettingsSave =
  "rejects_as_conflict" | "hangs" | "drops_connection" | "accepts";

/** Lo que el servidor fingido responde a cada guardado que rechaza. */
const REJECTED_CLUB_SETTINGS_SAVES = {
  rejects_as_conflict: {
    status: 409,
    error: {
      code: "conflict",
      message: "Otro Admin cambió la configuración.",
      reason: "club_settings_changed",
    },
  },
} as const;

async function stubClubSettings(
  page: Page,
  save: ClubSettingsSave = "hangs",
): Promise<void> {
  await page.route(
    (url) => url.pathname === CLUB_SETTINGS_ENDPOINT,
    async (route, request) => {
      if (request.method() !== "PATCH") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: STUBBED_CLUB_SETTINGS }),
        });
        return;
      }
      if (save === "drops_connection") {
        await route.abort("internetdisconnected");
        return;
      }
      if (save === "accepts") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: { ...STUBBED_CLUB_SETTINGS, name: EDITED_CLUB_NAME },
          }),
        });
        return;
      }
      if (save === "rejects_as_conflict") {
        const { status, error } = REJECTED_CLUB_SETTINGS_SAVES[save];
        await route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ error }),
        });
      }
      // "hangs": sin respuesta, la pantalla se queda guardando.
    },
  );
}

function clubNameField(page: Page): Locator {
  return page.getByLabel(/^(Club name|Nombre del club)$/);
}

/** Borra el nombre: la pantalla lo rechaza junto al campo y la barra no deja
 * guardar (#719). */
function submitEmptyName(saveLabel: string, issueText: RegExp) {
  return async (page: Page): Promise<void> => {
    await clubNameField(page).fill("");
    await expect(page.getByText(issueText)).toBeVisible();
    await expect(page.getByRole("button", { name: saveLabel })).toBeDisabled();
  };
}

/** Un sugerido distinto del guardado (#720): el que se elige en la captura
 * de General. Sale marcado, en el campo y en la vista previa. */
const CHOSEN_SUGGESTED_ACCENT = "#8C7AE6";

/** Un gris medio: ni el blanco ni el texto oscuro llegan a AA encima. */
const UNREADABLE_CLUB_ACCENT = "#777777";

function clubAccentField(page: Page): Locator {
  return page.getByRole("textbox", {
    name: /^(Accent colour|Color de acento)$/,
  });
}

/** Elige un sugerido con el teclado, como un radio, y espera a la barra. */
function chooseSuggestedAccent(saveLabel: string) {
  return async (page: Page): Promise<void> => {
    const swatch = page.getByRole("radio", { name: CHOSEN_SUGGESTED_ACCENT });
    await swatch.check();
    await expect(clubAccentField(page)).toHaveValue(CHOSEN_SUGGESTED_ACCENT);
    await expect(page.getByRole("button", { name: saveLabel })).toBeEnabled();
  };
}

/** Elige el inicio de la temporada (#744): sale la barra para guardarlo. */
function chooseSeasonStart(saveLabel: string) {
  return async (page: Page): Promise<void> => {
    const field = page.getByLabel(/^(Season start|Inicio de temporada)$/);
    await field.fill(CHOSEN_SEASON_START);
    await expect(field).toHaveValue(CHOSEN_SEASON_START);
    await expect(page.getByRole("button", { name: saveLabel })).toBeEnabled();
  };
}

/** Escribe un color sin texto legible encima: lo rechaza la pantalla, antes
 * que el servidor, y la barra no deja guardar. */
function typeUnreadableAccent(saveLabel: string, issueText: RegExp) {
  return async (page: Page): Promise<void> => {
    await clubAccentField(page).fill(UNREADABLE_CLUB_ACCENT);
    await expect(page.getByText(issueText)).toBeVisible();
    await expect(page.getByRole("button", { name: saveLabel })).toBeDisabled();
  };
}

/** Cambia el nombre, guarda y espera a lo que conteste el servidor fingido. */
function submitAndExpect(saveLabel: string, outcome: RegExp) {
  return async (page: Page): Promise<void> => {
    await clubNameField(page).fill(EDITED_CLUB_NAME);
    await page.getByRole("button", { name: saveLabel }).click();
    await expect(page.getByText(outcome)).toBeVisible();
  };
}

/** Quita el pack de 50 sesiones del borrador: sale la barra (#719). */
async function removeLargestSessionPack(page: Page): Promise<void> {
  await sessionPacksSection(page)
    .getByRole("button", { name: "Remove the 50 sessions pack" })
    .click();
  await expect(
    page.getByRole("button", { name: ENGLISH_SAVE_SETTINGS }),
  ).toBeEnabled();
}

/** Guarda un cambio y espera a "✓ Guardado" (#719). */
async function saveAndExpectSavedNotice(page: Page): Promise<void> {
  await clubNameField(page).fill(EDITED_CLUB_NAME);
  await page.getByRole("button", { name: ENGLISH_SAVE_SETTINGS }).click();
  await expect(page.getByRole("status").getByText("Saved")).toBeVisible();
}

/** Cuánto adelanta pauseClock el reloj. Entre leer la hora y pausarlo el
 * reloj sigue andando, y en CI cargado pasa más de 1 ms: pausar en el pasado
 * falla ("Cannot fast-forward to the past"). Queda muy por debajo de los
 * 2,5 s de "✓ Guardado". */
const CLOCK_PAUSE_MARGIN_MS = 200;

/** Para el reloj que instaló la visita: "✓ Guardado" se va a los 2,5 s, a
 * veces antes de la captura. Sólo para la captura: axe también necesita los
 * temporizadores. */
async function pauseClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + CLOCK_PAUSE_MARGIN_MS);
}

/* Las posiciones del club (#300) viven en la misma pantalla. También se sirven
   fijas: archivar o crear una de verdad cambiaría el desplegable del perfil
   y el directorio en las capturas de los demás. */
const CLUB_POSITIONS_ADMIN_ENDPOINT = `${CLUB_SETTINGS_ENDPOINT}/positions`;

type StubbedPosition = {
  readonly id: string;
  readonly names: { readonly en: string | null; readonly es: string | null };
  readonly isArchived: boolean;
  /** La función en el auto-balance (#404); `null` es "ninguna". */
  readonly coverage: "goalkeeper" | "defender" | "forward" | null;
};

/** Lo que responde el endpoint fingido a cualquier escritura: crear, y
 * desde #724 también guardar desde la hoja del móvil. */
type PositionCreate = "hangs" | "rejects_name_taken" | "rejects_as_conflict";

const STUBBED_ACTIVE_POSITIONS: readonly StubbedPosition[] = [
  {
    id: "90000000-0000-4000-8000-000000000001",
    names: { en: "Goalkeeper", es: "Portería" },
    isArchived: false,
    coverage: "goalkeeper",
  },
  {
    id: "90000000-0000-4000-8000-000000000002",
    names: { en: "Defender", es: "Defensa" },
    isArchived: false,
    coverage: "defender",
  },
  {
    id: "90000000-0000-4000-8000-000000000003",
    names: { en: "Forward", es: "Ataque" },
    isArchived: false,
    coverage: "forward",
  },
];

/** Una archivada sin nombre en español ni función y otra con nombres cerca
 * del máximo que admite la base (40 caracteres), para el caso de contenido
 * largo. La segunda comparte función con Defender (#404). */
const STUBBED_POSITIONS_WITH_ARCHIVED: readonly StubbedPosition[] = [
  ...STUBBED_ACTIVE_POSITIONS,
  {
    id: "90000000-0000-4000-8000-000000000004",
    names: { en: "Utility", es: null },
    isArchived: true,
    coverage: null,
  },
  {
    id: "90000000-0000-4000-8000-000000000005",
    names: {
      en: "Second-line support behind the basket",
      es: "Apoyo de segunda línea tras la cesta",
    },
    isArchived: true,
    coverage: "defender",
  },
];

const REJECTED_POSITION_NAME = {
  code: "validation_error",
  message: "Ya hay una posición con ese nombre.",
  reason: "name_es_taken",
} as const;

/** Otro Admin cambió las posiciones mientras tanto (#724). */
const POSITIONS_CHANGED = {
  code: "conflict",
  message: "Las posiciones cambiaron.",
  reason: "club_positions_changed",
} as const;

async function stubClubPositions(
  page: Page,
  stub: {
    readonly positions: readonly StubbedPosition[];
    readonly create: PositionCreate;
  },
): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith(CLUB_POSITIONS_ADMIN_ENDPOINT),
    async (route, request) => {
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { positions: stub.positions } }),
        });
        return;
      }
      if (stub.create === "rejects_name_taken") {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: REJECTED_POSITION_NAME }),
        });
      }
      if (stub.create === "rejects_as_conflict") {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: POSITIONS_CHANGED }),
        });
      }
      // "hangs": sin respuesta, la sección se queda guardando.
    },
  );
}

function positionsSection(page: Page): Locator {
  return page.getByRole("region", { name: /^(Positions|Posiciones)$/ });
}

/* #301: los textos de la pantalla de entrar que escribe el club. El endpoint
   se finge, como el de las posiciones: guardarlos de verdad cambiaría la
   pantalla de entrar que fotografían las demás pruebas. Guardar se queda
   colgado: los estados de aquí no esperan respuesta. */
const CLUB_SIGN_IN_TEXTS_ENDPOINT = `${CLUB_SETTINGS_ENDPOINT}/sign-in-texts`;

type StubbedSignInTexts = {
  readonly [Locale in "en" | "es"]: {
    readonly tagline: string | null;
    readonly welcome: string | null;
  };
};

const NO_STUBBED_SIGN_IN_TEXTS: StubbedSignInTexts = {
  en: { tagline: null, welcome: null },
  es: { tagline: null, welcome: null },
};

const SHORT_SIGN_IN_TEXTS: StubbedSignInTexts = {
  en: {
    tagline: "Hold your breath, not your team back.",
    welcome:
      "Sessions every Tuesday and Thursday at the Hobart Aquatic Centre.",
  },
  es: {
    tagline: "Aguanta la respiración, no al equipo.",
    welcome: "Entrenamos martes y jueves en el Hobart Aquatic Centre.",
  },
};

/** Repite `text` hasta `length` caracteres justos. */
function padToLength(text: string, length: number): string {
  return text.repeat(Math.ceil(length / text.length)).slice(0, length);
}

/** Justo en los límites de la base: 140 el lema y 320 el párrafo, con una
 * dirección sin espacios que no puede partirse por una palabra. */
const LONG_SIGN_IN_TEXTS: StubbedSignInTexts = {
  en: {
    tagline: padToLength("Underwater rugby for every body in Tasmania. ", 140),
    welcome: padToLength(
      "Read more at www.hobartorcasunderwaterrugbyclubtasmania.org.au before your first session. ",
      320,
    ),
  },
  es: {
    tagline: padToLength(
      "Rugby subacuático para todo el mundo en Tasmania. ",
      140,
    ),
    welcome: padToLength(
      "Lee más en www.hobartorcasunderwaterrugbyclubtasmania.org.au antes de tu primera sesión. ",
      320,
    ),
  },
};

async function stubSignInTexts(
  page: Page,
  texts: StubbedSignInTexts,
): Promise<void> {
  await page.route(
    (url) => url.pathname === CLUB_SIGN_IN_TEXTS_ENDPOINT,
    async (route, request) => {
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: texts }),
        });
      }
      // PUT: sin respuesta, la sección se queda guardando.
    },
  );
}

function signInTextsSection(page: Page): Locator {
  return page.getByRole("region", {
    name: /^(Sign-in screen|Pantalla de entrar)$/,
  });
}

const CLUB_SESSION_PACKS_ENDPOINT = "/api/v1/club/session-packs";

/** Lo que diría Stripe de una sesión Casual (#469): el precio de verdad lo
 * pone Stripe, y fingirlo deja la captura igual pase lo que pase allí. */
const STUBBED_SESSION_PRICE = { amountCents: 1500, currency: "AUD" } as const;

/** Los packs de inicio y uno grande, para ver un precio de cuatro cifras. */
const STUBBED_SESSION_PACKS: readonly number[] = [5, 10, 50];

async function stubSessionPacks(
  page: Page,
  sizes: readonly number[] = STUBBED_SESSION_PACKS,
): Promise<void> {
  await page.route(
    (url) => url.pathname === CLUB_SESSION_PACKS_ENDPOINT,
    async (route, request) => {
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              packs: sizes.map((sessions) => ({
                sessions,
                price: {
                  ...STUBBED_SESSION_PRICE,
                  amountCents: STUBBED_SESSION_PRICE.amountCents * sessions,
                },
              })),
              sessionPrice: STUBBED_SESSION_PRICE,
            },
          }),
        });
      }
      // PUT: sin respuesta, la sección se queda guardando.
    },
  );
}

function sessionPacksSection(page: Page): Locator {
  return page.getByRole("region", {
    name: /^(Session packs|Packs de sesiones)$/,
  });
}

/** Un titular en español de 141 caracteres: la pantalla lo rechaza junto al
 * campo y la barra no deja guardar (#719). Antes se elige el español en el
 * control de la sección (#721). */
function writeTooLongTagline(labels: {
  readonly language: string;
  readonly field: string;
  readonly submit: string;
  readonly issue: RegExp;
}) {
  return async (page: Page): Promise<void> => {
    const section = signInTextsSection(page);
    await section.getByRole("radio", { name: labels.language }).check();
    await section.getByLabel(labels.field).fill("a".repeat(141));
    await expect(section.getByText(labels.issue)).toBeVisible();
    await expect(
      page.getByRole("button", { name: labels.submit }),
    ).toBeDisabled();
  };
}

/** Da de alta una posición cuyo nombre en español ya usa otra: el servidor
 * fingido la rechaza y el aviso sale junto a ese campo. Añadir está
 * desactivado sin nombre, así que se escribe antes de pulsarlo (#723). */
function addPositionWithTakenName(labels: {
  readonly english: string;
  readonly spanish: string;
  readonly submit: string;
  readonly issue: RegExp;
}) {
  return async (page: Page): Promise<void> => {
    const section = positionsSection(page);
    await section.getByLabel(labels.english).fill("Centre");
    await section.getByLabel(labels.spanish).fill("Defensa");
    await section
      .getByRole("button", { name: labels.submit, exact: true })
      .click();
    await expect(section.getByText(labels.issue)).toBeVisible();
  };
}

/** Abre el renombrado de una posición en su fila de la tabla (#723). */
function openPositionRename(renameLabel: string) {
  return async (page: Page): Promise<void> => {
    const section = positionsSection(page);
    await section.getByRole("button", { name: renameLabel }).click();
    await expect(
      section.getByRole("form", { name: renameLabel }),
    ).toBeVisible();
  };
}

/** Despliega las archivadas, que salen plegadas bajo la tabla (#723). */
async function openArchivedPositions(page: Page): Promise<void> {
  const section = positionsSection(page);
  await section
    .getByRole("button", { name: /^(Archived|Archivadas) · / })
    .click();
  await expect(section.getByRole("list").last()).toBeVisible();
}

/** Los pasos en que el puntero va del asa al destino: dnd-kit busca el
 * destino en cada movimiento y el ratón empieza a arrastrar pasados 4 px. */
const DRAG_STEP_COUNT = 10;

async function centreOf(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  if (box === null) {
    throw new Error("Lo que se iba a arrastrar no está en la pantalla");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Suelta lo que se tenía cogido. */
type ReleaseDrag = () => Promise<void>;

/** Coge el asa con el ratón y la deja encima de `target`, sin soltarla. */
async function holdWithMouseOver(
  page: Page,
  handle: Locator,
  target: Locator,
): Promise<ReleaseDrag> {
  const from = await centreOf(handle);
  const to = await centreOf(target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: DRAG_STEP_COUNT });
  return () => page.mouse.up();
}

/** Mantiene el dedo en el asa hasta que la fila se levanta y lo lleva
 * encima de `target`, sin soltarlo. Toques sueltos de CDP, como en
 * `swipeWithFinger`: `page.touchscreen` sólo sabe dar toques cortos. El
 * dedo se levanta por la misma sesión que lo apoyó. */
async function holdWithFingerOver(
  page: Page,
  handle: Locator,
  target: Locator,
): Promise<ReleaseDrag> {
  const from = await centreOf(handle);
  const to = await centreOf(target);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [from],
  });
  await expect(page.locator(".sortable-row-lifted")).toHaveCount(1);
  for (let step = 1; step <= DRAG_STEP_COUNT; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: from.x, y: from.y + ((to.y - from.y) * step) / DRAG_STEP_COUNT },
      ],
    });
  }
  return async () => {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  };
}

/** Deja la última fila de la lista a medio arrastrar sobre la primera: la
 * captura sale con la línea de destino arriba (#725). */
function holdLastRowOverFirst(
  section: (page: Page) => Locator,
): (page: Page) => Promise<void> {
  return async (page: Page): Promise<void> => {
    const rows = section(page).getByRole("list").first().getByRole("listitem");
    const handle = rows.last().getByRole("button", { name: /^Reorder / });
    // En el móvil se arrastra con el dedo; en lo demás, con el ratón.
    const hold = isPhoneViewport(page) ? holdWithFingerOver : holdWithMouseOver;
    await hold(page, handle, rows.first());
    await expect(page.locator(".sortable-row-drop-before")).toHaveCount(1);
  };
}

type ClubSettingsState = {
  readonly name: string;
  readonly save?: ClubSettingsSave;
  /** Lo que sirve el endpoint fingido de los textos de entrada (#301). */
  readonly signInTexts?: StubbedSignInTexts;
  /** Los packs que sirve el endpoint fingido (#722). Sin ellos, los de
   * siempre. */
  readonly sessionPacks?: readonly number[];
  /** El catálogo que sirve el endpoint fingido de las posiciones (#300). */
  readonly positions?: readonly StubbedPosition[];
  readonly createPosition?: PositionCreate;
  readonly beforeVisit?: (page: Page) => Promise<void>;
  readonly prepare?: (page: Page) => Promise<void>;
  /** Un arrastre que se deja a medias (#725). Va después de apartar el
   * puntero: apartarlo lo soltaría fuera de la lista. */
  readonly hold?: (page: Page) => Promise<void>;
  /** La sección que abre (#718). Sin ella, General: en el móvil hace falta
   * nombrarla, porque sin `tab` sale la lista. */
  readonly tab?: ClubSettingsSection;
  /** Sin ellos, los tres. */
  readonly viewports?: readonly (typeof viewports)[number][];
  /** Lo último antes de la captura, que no hace falta para axe. Lo fijo
   * abajo pide `fitViewportToPage`: si la página no cabe, la captura entera
   * lo deja a media página. */
  readonly beforeCapture?: (page: Page) => Promise<void>;
};

/** Los estados de una sección, abiertos en su pestaña (#718). */
function inClubSection(
  tab: ClubSettingsSection,
  states: readonly ClubSettingsState[],
): readonly ClubSettingsState[] {
  return states.map((state) => ({ ...state, tab }));
}

/** La dirección de la configuración con su sección. */
function clubSettingsPath(tab: ClubSettingsSection): string {
  return `${CLUB_SETTINGS_SCREEN_PATH}?tab=${tab}`;
}

const CLUB_SETTINGS_STATES: readonly ClubSettingsState[] = [
  // La pestaña General (#720, 03-desktop-general.png del handoff de E26):
  // un sugerido elegido, con la vista previa y la barra.
  {
    name: "club-general",
    prepare: chooseSuggestedAccent(ENGLISH_SAVE_SETTINGS),
    beforeCapture: fitViewportToPage,
  },
  {
    name: "club-general-es",
    beforeVisit: chooseSpanish,
    prepare: chooseSuggestedAccent(SPANISH_SAVE_SETTINGS),
    beforeCapture: fitViewportToPage,
  },
  { name: "club-general-sin-logo" },
  // #744: General con un inicio de temporada elegido, en los dos idiomas.
  {
    name: "club-general-temporada",
    prepare: chooseSeasonStart(ENGLISH_SAVE_SETTINGS),
    beforeCapture: fitViewportToPage,
  },
  {
    name: "club-general-temporada-es",
    beforeVisit: chooseSpanish,
    prepare: chooseSeasonStart(SPANISH_SAVE_SETTINGS),
    beforeCapture: fitViewportToPage,
  },
  {
    name: "club-general-color-rechazado",
    prepare: typeUnreadableAccent(
      ENGLISH_SAVE_SETTINGS,
      /No text colour reaches the minimum contrast/,
    ),
    beforeCapture: fitViewportToPage,
  },
  {
    name: "club-general-color-rechazado-es",
    beforeVisit: chooseSpanish,
    prepare: typeUnreadableAccent(
      SPANISH_SAVE_SETTINGS,
      /Ningún color de texto llega al contraste mínimo/,
    ),
    beforeCapture: fitViewportToPage,
  },
  {
    name: "club-aviso-validacion",
    prepare: submitEmptyName(ENGLISH_SAVE_SETTINGS, /The club needs a name/),
  },
  {
    name: "club-aviso-validacion-es",
    beforeVisit: chooseSpanish,
    prepare: submitEmptyName(
      SPANISH_SAVE_SETTINGS,
      /El club necesita un nombre/,
    ),
  },
  {
    name: "club-guardando",
    save: "hangs",
    prepare: submitAndExpect(ENGLISH_SAVE_SETTINGS, /^Saving…$/),
  },
  {
    name: "club-error-de-red",
    save: "drops_connection",
    prepare: submitAndExpect(ENGLISH_SAVE_SETTINGS, /reach the server/),
  },
  {
    name: "club-error-de-red-es",
    save: "drops_connection",
    beforeVisit: chooseSpanish,
    prepare: submitAndExpect(
      SPANISH_SAVE_SETTINGS,
      /No pudimos hablar con el servidor/,
    ),
  },
  {
    name: "club-conflicto",
    save: "rejects_as_conflict",
    prepare: submitAndExpect(
      ENGLISH_SAVE_SETTINGS,
      /Another Admin changed the settings/,
    ),
  },
  // La barra de cambios sin guardar (#719, 02-desktop-packs-unsaved.png y
  // 10-mobile-packs-unsaved.png del handoff de E26).
  {
    name: "club-cambios-sin-guardar",
    tab: "packs",
    prepare: removeLargestSessionPack,
    beforeCapture: fitViewportToPage,
  },
  {
    name: "club-guardado",
    save: "accepts",
    viewports: viewports.filter((vp) => vp.name === "desktop"),
    beforeVisit: (page) => page.clock.install(),
    prepare: saveAndExpectSavedNotice,
    beforeCapture: async (page) => {
      await pauseClock(page);
      await fitViewportToPage(page);
    },
  },
];

/** El título de cada sección que carga por su lado (#469). General no
 * tiene: se espera a su campo del nombre. */
const CLUB_SECTION_HEADINGS = {
  "sign-in": "clubSettings.signInTexts.title",
  positions: "clubSettings.positions.title",
  packs: "clubSettings.sessionPacks.title",
} as const;

/** Desde 768px el botón de la cuenta (#717) pinta las iniciales cuando
 * llega el perfil, y General carga antes: sin esperar, la captura salía a
 * veces con el círculo vacío. En el móvil el botón es un icono. */
async function waitForAccountInitials(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 0) < SIDEBAR_MIN_VIEWPORT_PX) {
    return;
  }
  // Las del Admin sembrado salen del id de la corrida: pueden llevar cifras.
  await expect(
    page.getByRole("button", { name: ACCOUNT_BUTTON_NAME }),
  ).toHaveText(/\S/);
}

/** Sin esperar a que la sección cargue, la captura salía con ella en
 * "Loading…", según la corrida (#561). Desde #718 sólo se pinta la sección
 * abierta. */
async function waitForClubSettingsSection(
  page: Page,
  tab: ClubSettingsSection,
): Promise<void> {
  if (tab === "general") {
    await expect(clubNameField(page)).toHaveValue(STUBBED_CLUB_SETTINGS.name);
    await waitForSectionsLoaded(page, []);
    await waitForAccountInitials(page);
    return;
  }
  const lang = await page.locator("html").getAttribute("lang");
  if (!isLocale(lang)) {
    throw new Error(`La configuración del club no declara su idioma: ${lang}`);
  }
  const translate = createTranslator(lang);
  await waitForSectionsLoaded(page, [translate(CLUB_SECTION_HEADINGS[tab])]);
}

/** Las secciones de la configuración servidas con datos fijos. */
async function stubClubSettingsSections(
  page: Page,
  state: ClubSettingsState,
): Promise<void> {
  await stubClubSettings(page, state.save);
  await stubClubPositions(page, {
    positions: state.positions ?? STUBBED_ACTIVE_POSITIONS,
    create: state.createPosition ?? "hangs",
  });
  await stubSignInTexts(page, state.signInTexts ?? NO_STUBBED_SIGN_IN_TEXTS);
  await stubSessionPacks(page, state.sessionPacks);
}

async function goToClubSettings(
  page: Page,
  state: ClubSettingsState,
  theme?: (typeof themes)[number],
): Promise<void> {
  const tab = state.tab ?? "general";
  await stubClubSettingsSections(page, state);
  await state.beforeVisit?.(page);
  if (theme === undefined) {
    await page.goto(`${APP_URL}${clubSettingsPath(tab)}`);
  } else {
    await goToWithTheme(page, clubSettingsPath(tab), theme);
  }
  await waitForClubSettingsSection(page, tab);
  await state.prepare?.(page);
  // El puntero se queda sobre el botón pulsado: la captura saldría con su
  // hover.
  await page.mouse.move(0, 0);
  await state.hold?.(page);
}

for (const state of CLUB_SETTINGS_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of state.viewports ?? viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToClubSettings(page, state, theme);
              await state.beforeCapture?.(page);
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }

        test("has no horizontal scroll", async ({ page }) => {
          await goToClubSettings(page, state);
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
        });
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await goToClubSettings(page, state);
      await expectNoAxeViolations(page);
    });
  });
}

/* ---------------------------------------------------------------------------
   El menú de la cuenta rehecho (#716, RF-9 del PRD de E26), abierto sobre
   la configuración del club, donde marca "Estás aquí". Mockups:
   docs/design/design_handoff_club_settings/screenshots/05-desktop-account-menu.png
   (escritorio) y 06-mobile-account.png (la pantalla Cuenta del móvil).
   --------------------------------------------------------------------------- */

const CLUB_COMMITTEE_STORAGE_STATE = roleRequestStorageStatePath(
  "committee-de-configuracion",
);

/** El Committee y no el Admin: el Admin sembrado lleva en el nombre el id de
 * la corrida, y el nombre sale arriba del menú. El Committee también ve la
 * configuración del club (#469), abierta en Packs, que es lo único suyo. */
const ACCOUNT_MENU_ON_CLUB: ClubSettingsState = {
  name: "cuenta-menu",
  tab: "packs",
};

/** El nombre de la captura: el móvil es la pantalla Cuenta, y el resto el
 * desplegable, a 768 y a 1440. */
function accountMenuSnapshotName(vp: (typeof viewports)[number]): string {
  return vp.name === "mobile"
    ? "cuenta-menu-movil"
    : `cuenta-menu-escritorio-${vp.name}`;
}

async function openAccountMenuOnClub(
  page: Page,
  theme?: (typeof themes)[number],
): Promise<Locator> {
  await goToClubSettings(page, ACCOUNT_MENU_ON_CLUB, theme);
  const menu = await openAccountMenu(page);
  await page.mouse.move(0, 0);
  return menu;
}

test.describe("menú de la cuenta sobre la configuración del club (#716)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: CLUB_COMMITTEE_STORAGE_STATE });

  for (const vp of viewports) {
    test.describe(`@ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const theme of themes) {
        test(`matches approved baseline (${theme})`, async ({ page }) => {
          await openAccountMenuOnClub(page, theme);
          const snapshot = `${accountMenuSnapshotName(vp)}-${theme}.png`;
          await createMissingLocalBaseline(snapshot, () =>
            page.screenshot(SCREENSHOT_OPTIONS),
          );
          await expect(page).toHaveScreenshot(snapshot, {
            ...SCREENSHOT_OPTIONS,
            maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
          });
        });

        test(`has no accessibility violations (axe-core, ${theme})`, async ({
          page,
        }) => {
          await openAccountMenuOnClub(page, theme);

          await expectNoAxeViolations(page);
        });
      }

      test("marca la configuración del club como la pantalla actual", async ({
        page,
      }) => {
        const menu = await openAccountMenuOnClub(page);

        await expect(
          menu.getByRole("link", { name: /^Club settings/ }),
        ).toHaveAttribute("aria-current", "page");
        await expect(menu.getByText("You're here")).toBeVisible();
      });
    });
  }

  test.describe("@ mobile: objetivos táctiles", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("cada control del menú mide al menos 44 px", async ({ page }) => {
      const menu = await openAccountMenuOnClub(page);
      const controls = menu.locator("a, button, input");
      const TOUCH_TARGET_MIN_PX = 44;

      for (const control of await controls.all()) {
        const box = await control.boundingBox();
        const name = await control.evaluate(
          (element) => element.textContent ?? element.getAttribute("value"),
        );
        expect(box, `${name} no tiene caja`).not.toBeNull();
        expect(box!.height, `${name} es bajo`).toBeGreaterThanOrEqual(
          TOUCH_TARGET_MIN_PX,
        );
        expect(box!.width, `${name} es estrecho`).toBeGreaterThanOrEqual(
          TOUCH_TARGET_MIN_PX,
        );
      }
    });
  });

  // Con Sistema elegido el menú marca Sistema, no el tema que pinta.
  for (const scheme of themes) {
    test(`con Sistema elegido sigue al sistema: matches approved baseline (${scheme})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      const menu = await openAccountMenuOnClub(page);
      await menu.getByRole("radio", { name: "System" }).click();
      await page.mouse.move(0, 0);

      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
      await expect(menu.getByRole("radio", { name: "System" })).toBeChecked();
      const snapshot = `cuenta-menu-sistema-${scheme}.png`;
      await createMissingLocalBaseline(snapshot, () =>
        page.screenshot(SCREENSHOT_OPTIONS),
      );
      await expect(page).toHaveScreenshot(snapshot, {
        ...SCREENSHOT_OPTIONS,
        maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
      });
      await expectNoAxeViolations(page);
    });
  }
});

/* ---------------------------------------------------------------------------
   La campana y la cuenta en la barra de arriba de escritorio (#717, RF-10 del
   PRD de E26). Mockups:
   docs/design/design_handoff_club_settings/screenshots/01-desktop-positions.png
   y 05-desktop-account-menu.png. Con el Committee, que tiene nombre fijo: sus
   iniciales salen en el botón.
   --------------------------------------------------------------------------- */

const DESKTOP_HEADER_VIEWPORTS = viewports.filter((vp) => vp.name !== "mobile");
/** El círculo del botón de la cuenta del handoff. */
const ACCOUNT_BUTTON_SIZE_PX = 38;
/** Lo que separa el desplegable de la cuenta de su botón. */
const ACCOUNT_MENU_GAP_PX = 6;
const HEADER_TOLERANCE_PX = 1;

type DesktopHeaderBoxes = {
  readonly topbar: DOMRect;
  readonly search: DOMRect;
  readonly bell: DOMRect;
  readonly account: DOMRect;
};

async function readDesktopHeaderBoxes(page: Page): Promise<DesktopHeaderBoxes> {
  const boxOf = async (locator: Locator): Promise<DOMRect> =>
    locator.evaluate((element) => element.getBoundingClientRect().toJSON());
  return {
    topbar: await boxOf(page.locator(".app-topbar")),
    search: await boxOf(page.getByRole("search")),
    bell: await boxOf(page.getByRole("button", { name: BELL_NAME })),
    account: await boxOf(
      page.getByRole("button", { name: ACCOUNT_BUTTON_NAME }),
    ),
  };
}

/** Lo que vale un color del tema, ya resuelto como lo da `getComputedStyle`. */
async function resolveThemeColor(page: Page, token: string): Promise<string> {
  return page.evaluate((variable) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${variable})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

test.describe("la cabecera de escritorio (#717)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: CLUB_COMMITTEE_STORAGE_STATE });

  test.describe("@ desktop", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    for (const theme of themes) {
      test(`cabecera-menu-abierto: matches approved baseline (${theme})`, async ({
        page,
      }) => {
        await goToWithTheme(page, "/dashboard", theme);
        await openAccountMenu(page);
        await page.mouse.move(0, 0);

        const snapshot = `cabecera-menu-abierto-${theme}.png`;
        await createMissingLocalBaseline(snapshot, () =>
          page.screenshot(SCREENSHOT_OPTIONS),
        );
        await expect(page).toHaveScreenshot(snapshot, {
          ...SCREENSHOT_OPTIONS,
          maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
        });
      });

      test(`cabecera-menu-abierto: has no accessibility violations (axe-core, ${theme})`, async ({
        page,
      }) => {
        await goToWithTheme(page, "/dashboard", theme);
        await openAccountMenu(page);

        await expectNoAxeViolations(page);
      });
    }
  });

  for (const vp of DESKTOP_HEADER_VIEWPORTS) {
    test.describe(`@ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      test("la campana y la cuenta van a la derecha de la barra, tras el buscador", async ({
        page,
      }) => {
        await page.goto(`${APP_URL}/dashboard`);

        const boxes = await readDesktopHeaderBoxes(page);
        expect(boxes.search.right).toBeLessThan(boxes.bell.left);
        expect(boxes.bell.right).toBeLessThanOrEqual(boxes.account.left);
        for (const control of [boxes.bell, boxes.account]) {
          expect(control.top).toBeGreaterThanOrEqual(boxes.topbar.top);
          expect(control.bottom).toBeLessThanOrEqual(boxes.topbar.bottom);
        }
        const rightGap = boxes.topbar.right - boxes.account.right;
        expect(rightGap).toBeLessThan(boxes.topbar.width / 10);
        await expect(
          page.locator(".app-sidebar-header").getByRole("button"),
        ).toHaveCount(0);
      });

      test("el botón de la cuenta es un círculo de 38 px con las iniciales", async ({
        page,
      }) => {
        await page.goto(`${APP_URL}/dashboard`);
        const button = page.getByRole("button", { name: ACCOUNT_BUTTON_NAME });

        const box = await button.boundingBox();
        expect(box?.width).toBe(ACCOUNT_BUTTON_SIZE_PX);
        expect(box?.height).toBe(ACCOUNT_BUTTON_SIZE_PX);
        await expect(button).toHaveCSS("border-radius", "50%");
        await expect(button).toHaveText(/^[A-Z]{1,2}$/);
      });

      test("abierto, el botón lleva el fondo de lo elegido y un anillo de acento", async ({
        page,
      }) => {
        await page.goto(`${APP_URL}/dashboard`);
        const button = page.getByRole("button", { name: ACCOUNT_BUTTON_NAME });

        await openAccountMenu(page);

        await expect(button).toHaveAttribute("aria-expanded", "true");
        await expect(button).toHaveCSS(
          "background-color",
          await resolveThemeColor(page, "--color-segment-selected"),
        );
        await expect(button).toHaveCSS(
          "box-shadow",
          `${await resolveThemeColor(page, "--color-accent")} 0px 0px 0px 2px`,
        );
      });

      test("el menú cuelga del borde derecho del botón, 6 px por debajo", async ({
        page,
      }) => {
        await page.goto(`${APP_URL}/dashboard`);
        const button = page.getByRole("button", { name: ACCOUNT_BUTTON_NAME });

        const menu = await openAccountMenu(page);

        const buttonBox = await button.boundingBox();
        const menuBox = await menu.boundingBox();
        if (buttonBox === null || menuBox === null) {
          throw new Error("el botón o el menú no tienen caja");
        }
        expect(
          Math.abs(menuBox.x + menuBox.width - (buttonBox.x + buttonBox.width)),
        ).toBeLessThanOrEqual(HEADER_TOLERANCE_PX);
        expect(
          Math.abs(menuBox.y - (buttonBox.y + buttonBox.height)),
        ).toBeCloseTo(ACCOUNT_MENU_GAP_PX, 0);
      });

      test("la lista de avisos se ve entera dentro de la ventana", async ({
        page,
      }) => {
        await page.goto(`${APP_URL}/dashboard`);

        await openNotifications(page);

        const panel = await notificationsRegion(page).boundingBox();
        if (panel === null) {
          throw new Error("la lista de avisos no tiene caja");
        }
        expect(panel.x).toBeGreaterThanOrEqual(0);
        expect(panel.y).toBeGreaterThanOrEqual(0);
        expect(panel.x + panel.width).toBeLessThanOrEqual(vp.width);
        expect(panel.y + panel.height).toBeLessThanOrEqual(vp.height);
        await expectNoHorizontalScroll(page);
      });
    });
  }
});

/* ---------------------------------------------------------------------------
   Las secciones de la configuración (#718, RF-1 del PRD de E26): la barra de
   pestañas en escritorio (docs/design/design_handoff_club_settings,
   01-desktop-positions.png), la lista y la pantalla de una sección en el
   móvil (07-mobile-settings-list.png) y el Committee, que sólo ve Packs.
   --------------------------------------------------------------------------- */

const CLUB_SECTIONS_MOBILE = viewports.filter((vp) => vp.name === "mobile");
const CLUB_SECTIONS_WIDE = viewports.filter((vp) => vp.name !== "mobile");
const CLUB_SECTIONS_COMMITTEE = viewports.filter((vp) => vp.name !== "tablet");
/** El alto mínimo de una fila de la lista del móvil (#3a del handoff). */
const CLUB_LIST_ROW_MIN_HEIGHT_PX = 68;

/** Las cuatro filas de la lista del móvil, con su resumen ya llegado. */
async function waitForClubSettingsList(page: Page): Promise<void> {
  const summaries = page.locator(".club-settings-list-summary");
  await expect(summaries).toHaveCount(4);
  for (const summary of await summaries.all()) {
    await expect(summary).not.toBeEmpty();
  }
}

type ClubSectionsScreen = {
  readonly name: string;
  readonly path: string;
  readonly storageState: string;
  readonly viewports: readonly (typeof viewports)[number][];
  readonly waitUntilReady: (page: Page) => Promise<void>;
};

const CLUB_SECTIONS_SCREENS: readonly ClubSectionsScreen[] = [
  {
    name: "club-pestanas-general",
    path: CLUB_SETTINGS_SCREEN_PATH,
    storageState: ADMIN_STORAGE_STATE,
    viewports: CLUB_SECTIONS_WIDE,
    waitUntilReady: (page) => waitForClubSettingsSection(page, "general"),
  },
  {
    name: "club-lista-movil",
    path: CLUB_SETTINGS_SCREEN_PATH,
    storageState: ADMIN_STORAGE_STATE,
    viewports: CLUB_SECTIONS_MOBILE,
    waitUntilReady: waitForClubSettingsList,
  },
  {
    name: "club-seccion-movil",
    path: clubSettingsPath("positions"),
    storageState: ADMIN_STORAGE_STATE,
    viewports: CLUB_SECTIONS_MOBILE,
    waitUntilReady: (page) => waitForClubSettingsSection(page, "positions"),
  },
  {
    // Con `?tab=general` a propósito: el Committee ve Packs igual (D9).
    name: "club-committee",
    path: clubSettingsPath("general"),
    storageState: CLUB_COMMITTEE_STORAGE_STATE,
    viewports: CLUB_SECTIONS_COMMITTEE,
    waitUntilReady: (page) => waitForClubSettingsSection(page, "packs"),
  },
];

async function goToClubSectionsScreen(
  page: Page,
  screen: ClubSectionsScreen,
  theme?: (typeof themes)[number],
): Promise<void> {
  await stubClubSettingsSections(page, { name: screen.name });
  if (theme === undefined) {
    await page.goto(`${APP_URL}${screen.path}`);
  } else {
    await goToWithTheme(page, screen.path, theme);
  }
  await screen.waitUntilReady(page);
  await page.mouse.move(0, 0);
}

for (const screen of CLUB_SECTIONS_SCREENS) {
  test.describe(screen.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: screen.storageState });

    for (const vp of screen.viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        for (const theme of themes) {
          test(`matches approved baseline (${theme})`, async ({ page }) => {
            await goToClubSectionsScreen(page, screen, theme);
            const snapshot = `${screen.name}-${vp.name}-${theme}.png`;
            await createMissingLocalBaseline(snapshot, () =>
              page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
            );
            await expect(page).toHaveScreenshot(snapshot, {
              ...SCREENSHOT_OPTIONS,
              fullPage: true,
              maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
            });
          });
        }

        test("has no horizontal scroll", async ({ page }) => {
          await goToClubSectionsScreen(page, screen);
          await expectNoHorizontalScroll(page);
        });

        test("has no accessibility violations (axe-core)", async ({ page }) => {
          await goToClubSectionsScreen(page, screen);
          await expectNoAxeViolations(page);
        });
      });
    }
  });
}

test.describe("las pestañas de la configuración en el navegador", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: ADMIN_STORAGE_STATE,
    viewport: { width: 1440, height: 900 },
  });

  test.beforeEach(async ({ page }) => {
    await stubClubSettingsSections(page, { name: "club-pestanas" });
    await page.goto(`${APP_URL}${CLUB_SETTINGS_SCREEN_PATH}`);
    await waitForClubSettingsSection(page, "general");
  });

  test("recargar deja la pestaña y volver atrás abre la de antes", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Positions" }).click();
    await expect(page).toHaveURL(/\/club\?tab=positions$/);

    await page.reload();

    await expect(page.getByRole("tab", { name: "Positions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.goBack();
    await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("el título mide 28px y la pestaña abierta lleva un subrayado de 2px", async ({
    page,
  }) => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveCSS(
      "font-size",
      "28px",
    );
    await expect(page.getByRole("tab", { name: "General" })).toHaveCSS(
      "border-bottom-width",
      "2px",
    );
  });
});

test.describe("la lista de la configuración en el móvil", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: ADMIN_STORAGE_STATE,
    viewport: { width: 375, height: 812 },
  });

  test("cada fila mide al menos 68px y abre su sección", async ({ page }) => {
    await stubClubSettingsSections(page, { name: "club-lista-filas" });
    await page.goto(`${APP_URL}${CLUB_SETTINGS_SCREEN_PATH}`);
    await waitForClubSettingsList(page);

    for (const row of await page.locator(".club-settings-list-row").all()) {
      const box = await row.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(CLUB_LIST_ROW_MIN_HEIGHT_PX);
    }
    await page.getByRole("button", { name: /^Positions/ }).click();

    await expect(page).toHaveURL(/\/club\?tab=positions$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Positions" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/club$/);
    await waitForClubSettingsList(page);
  });
});

/* La tabla es de 768px para arriba; por debajo, la lista del móvil (#724),
   con sus propios estados. Las archivadas se ven igual en los tres. */
const TABLE_VIEWPORTS = viewports.filter((vp) => vp.name !== "mobile");
const PHONE_VIEWPORTS = viewports.filter((vp) => vp.name === "mobile");

/** La fila que se arrastra con el ratón se queda en su sitio al 45 %,
 * apagada a propósito (el handoff de E26): axe la daría por falta de
 * contraste. Sólo existe mientras dura el arrastre (#725). */
const DRAGGED_ROW_SELECTOR = ".sortable-row-dragging";

/** Arrastrando se fotografía con el dedo en el móvil y con el ratón en el
 * escritorio (#725). */
const DRAG_CAPTURE_VIEWPORTS = [viewports[0], viewports[2]] as const;

const CLUB_POSITIONS_STATES = inClubSection("positions", [
  { name: "club-posiciones", viewports: TABLE_VIEWPORTS },
  {
    name: "club-posiciones-es",
    viewports: TABLE_VIEWPORTS,
    beforeVisit: chooseSpanish,
  },
  { name: "club-posiciones-movil", viewports: PHONE_VIEWPORTS },
  {
    name: "club-posiciones-movil-es",
    viewports: PHONE_VIEWPORTS,
    beforeVisit: chooseSpanish,
  },
  {
    name: "club-posiciones-renombrando",
    viewports: TABLE_VIEWPORTS,
    prepare: openPositionRename("Rename Defender"),
  },
  {
    name: "club-posiciones-renombrando-es",
    viewports: TABLE_VIEWPORTS,
    beforeVisit: chooseSpanish,
    prepare: openPositionRename("Renombrar Defensa"),
  },
  {
    name: "club-posiciones-archivadas",
    positions: STUBBED_POSITIONS_WITH_ARCHIVED,
    prepare: openArchivedPositions,
  },
  {
    name: "club-posiciones-archivadas-es",
    positions: STUBBED_POSITIONS_WITH_ARCHIVED,
    beforeVisit: chooseSpanish,
    prepare: openArchivedPositions,
  },
  {
    name: "club-posiciones-nombre-repetido",
    viewports: TABLE_VIEWPORTS,
    createPosition: "rejects_name_taken",
    prepare: addPositionWithTakenName({
      english: "Name in English",
      spanish: "Name in Spanish",
      submit: "Add",
      issue: /Another position already has this name/,
    }),
  },
  {
    name: "club-posiciones-nombre-repetido-es",
    viewports: TABLE_VIEWPORTS,
    createPosition: "rejects_name_taken",
    beforeVisit: chooseSpanish,
    prepare: addPositionWithTakenName({
      english: "Nombre en inglés",
      spanish: "Nombre en español",
      submit: "Añadir",
      issue: /Otra posición ya se llama así/,
    }),
  },
  {
    name: "club-posiciones-arrastrando",
    hold: holdLastRowOverFirst(positionsSection),
    viewports: DRAG_CAPTURE_VIEWPORTS,
  },
]);

/* La sección se fotografía sola: el resto de la pantalla ya tiene sus
   capturas arriba, y así un cambio de las posiciones no las mueve. La barra
   de pestañas del móvil va fija abajo y taparía parte de la sección en una
   captura de elemento: ahí se esconde. Va en la página y no en la opción
   `style`, que `toHaveScreenshot` no aplica. */
const HIDDEN_TAB_BAR_STYLE = ".app-tabbar { display: none !important; }";

for (const state of CLUB_POSITIONS_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of state.viewports ?? viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToClubSettings(page, state, theme);
              const section = positionsSection(page);
              await expect(section.getByRole("list").first()).toBeVisible();
              await page.addStyleTag({ content: HIDDEN_TAB_BAR_STYLE });
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                section.screenshot(SCREENSHOT_OPTIONS),
              );
              await expect(section).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }

        test("has no horizontal scroll", async ({ page }) => {
          await goToClubSettings(page, state);
          await expect(
            positionsSection(page).getByRole("list").first(),
          ).toBeVisible();
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
        });
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await goToClubSettings(page, state);
      await expect(
        positionsSection(page).getByRole("list").first(),
      ).toBeVisible();
      await expectNoAxeViolations(page, DRAGGED_ROW_SELECTOR);
    });
  });
}

/* La hoja de una posición en el móvil (#724, 09-mobile-position-sheet.png
   del handoff de E26). Es un `<dialog>` modal sobre la lista oscurecida: se
   fotografía la pantalla, no la sección, porque la hoja no cabe en la caja
   de la sección. */
function positionSheet(page: Page): Locator {
  return page.getByRole("dialog", { name: "Forward" });
}

async function openForwardSheet(page: Page): Promise<void> {
  await positionsSection(page)
    .getByRole("button", { name: "Forward", exact: true })
    .click();
  await expect(positionSheet(page)).toBeVisible();
}

/** Cambia el rol y guarda: el servidor fingido dice que otro Admin cambió
 * las posiciones, y la hoja lo enseña sin cerrarse. */
async function saveForwardSheetAgainstConflict(page: Page): Promise<void> {
  await openForwardSheet(page);
  const sheet = positionSheet(page);
  await sheet.locator("label", { hasText: /^Defender$/ }).click();
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    sheet.getByRole("button", { name: "Load the latest positions" }),
  ).toBeVisible();
}

const CLUB_POSITION_SHEET_STATES = inClubSection("positions", [
  { name: "club-posiciones-hoja", prepare: openForwardSheet },
  {
    name: "club-posiciones-hoja-error",
    createPosition: "rejects_as_conflict",
    prepare: saveForwardSheetAgainstConflict,
  },
]);

for (const state of CLUB_POSITION_SHEET_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of PHONE_VIEWPORTS) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        for (const theme of themes) {
          test(`matches approved baseline (${theme})`, async ({ page }) => {
            await goToClubSettings(page, state, theme);
            const snapshot = `${state.name}-${vp.name}-${theme}.png`;
            await createMissingLocalBaseline(snapshot, () =>
              page.screenshot(SCREENSHOT_OPTIONS),
            );
            await expect(page).toHaveScreenshot(snapshot, {
              ...SCREENSHOT_OPTIONS,
              maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
            });
          });
        }

        test("has no horizontal scroll", async ({ page }) => {
          await goToClubSettings(page, state);
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
        });

        test("has no accessibility violations (axe-core)", async ({ page }) => {
          await goToClubSettings(page, state);
          await expectNoAxeViolations(page);
        });
      });
    }
  });
}

const CLUB_SIGN_IN_TEXTS_STATES = inClubSection("sign-in", [
  { name: "club-textos-entrada", signInTexts: SHORT_SIGN_IN_TEXTS },
  {
    name: "club-textos-entrada-es",
    signInTexts: SHORT_SIGN_IN_TEXTS,
    beforeVisit: chooseSpanish,
  },
  {
    name: "club-textos-entrada-demasiado-largo",
    prepare: writeTooLongTagline({
      language: "Spanish",
      field: "Headline",
      submit: ENGLISH_SAVE_SETTINGS,
      issue: /The headline can have at most 140 characters/,
    }),
  },
  {
    name: "club-textos-entrada-demasiado-largo-es",
    beforeVisit: chooseSpanish,
    prepare: writeTooLongTagline({
      language: "Español",
      field: "Titular",
      submit: SPANISH_SAVE_SETTINGS,
      issue: /El titular puede tener como mucho 140 caracteres/,
    }),
  },
]);

async function goToSignInTextsSection(
  page: Page,
  state: ClubSettingsState,
  theme?: (typeof themes)[number],
): Promise<Locator> {
  await goToClubSettings(page, state, theme);
  const section = signInTextsSection(page);
  await expect(section.getByRole("textbox").first()).toBeVisible();
  return section;
}

/* Como las posiciones, la sección se fotografía sola, sin la barra de
   pestañas del móvil encima. */
for (const state of CLUB_SIGN_IN_TEXTS_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              const section = await goToSignInTextsSection(page, state, theme);
              await page.addStyleTag({ content: HIDDEN_TAB_BAR_STYLE });
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                section.screenshot(SCREENSHOT_OPTIONS),
              );
              await expect(section).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }

        test("has no horizontal scroll", async ({ page }) => {
          await goToSignInTextsSection(page, state);
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
        });
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await goToSignInTextsSection(page, state);
      await expectNoAxeViolations(page);
    });
  });
}

/** Escribe un pack de 60 sesiones y lo intenta añadir: la fila dice el
 * límite (#722, D2). */
async function addOutOfRangeSessionPack(page: Page): Promise<void> {
  const section = sessionPacksSection(page);
  await section.getByLabel("Sessions in the new pack").fill("60");
  await section.getByRole("button", { name: "Add", exact: true }).click();
  await expect(section.getByText("Between 1 and 50.")).toBeVisible();
}

const CLUB_SESSION_PACKS_STATES = inClubSection("packs", [
  { name: "club-packs" },
  { name: "club-packs-es", beforeVisit: chooseSpanish },
  { name: "club-packs-vacio", sessionPacks: [] },
  { name: "club-packs-error-al-anadir", prepare: addOutOfRangeSessionPack },
  {
    name: "club-packs-arrastrando",
    hold: holdLastRowOverFirst(sessionPacksSection),
    viewports: DRAG_CAPTURE_VIEWPORTS,
  },
]);

/* #469: como las posiciones, la sección se fotografía sola, sin la barra de
   pestañas del móvil encima. `goToClubSettings` ya esperó a su lista. */
for (const state of CLUB_SESSION_PACKS_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of state.viewports ?? viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToClubSettings(page, state, theme);
              const section = sessionPacksSection(page);
              await page.addStyleTag({ content: HIDDEN_TAB_BAR_STYLE });
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                section.screenshot(SCREENSHOT_OPTIONS),
              );
              await expect(section).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }

        test("has no horizontal scroll", async ({ page }) => {
          await goToClubSettings(page, state);
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
        });
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await goToClubSettings(page, state);
      await expectNoAxeViolations(page, DRAGGED_ROW_SELECTOR);
    });
  });
}

/* #722: las medidas del móvil (10-mobile-packs-unsaved.png del handoff de
   E26), medidas en el navegador y no sólo escritas en la hoja. */
const PACK_ROW_HEIGHT_PX = 60;
const PACK_ADD_FIELD_HEIGHT_PX = 48;
/** --touch-target-min en globals.css. */
const PACK_CONTROL_SIZE_PX = 44;

test.describe("club-packs en el móvil", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: ADMIN_STORAGE_STATE,
    viewport: { width: viewports[0].width, height: viewports[0].height },
  });

  test("filas de 60 px, asa y borrar de 44 px y campo de 48 px", async ({
    page,
  }) => {
    await goToClubSettings(page, { name: "club-packs", tab: "packs" });
    const section = sessionPacksSection(page);
    const firstRow = section.getByRole("listitem").first();

    expect(await heightOf(firstRow)).toBeGreaterThanOrEqual(PACK_ROW_HEIGHT_PX);
    for (const control of [
      firstRow.getByRole("button", { name: /^Reorder the/ }),
      firstRow.getByRole("button", { name: /^Remove the/ }),
    ]) {
      const box = await control.boundingBox();
      expect(box?.width).toBe(PACK_CONTROL_SIZE_PX);
      expect(box?.height).toBe(PACK_CONTROL_SIZE_PX);
    }
    expect(await heightOf(section.getByLabel("Sessions in the new pack"))).toBe(
      PACK_ADD_FIELD_HEIGHT_PX,
    );
    await expect(
      section.getByRole("button", { name: "Add", exact: true }),
    ).toHaveText("Add");
  });
});

/** Seis activas, para arrastrar la sexta al primer puesto (#725). */
const SIX_STUBBED_POSITIONS: readonly StubbedPosition[] = [
  ...STUBBED_ACTIVE_POSITIONS,
  ...(
    [
      ["Centre", "Centro"],
      ["Wing", "Ala"],
      ["Sweeper", "Libero"],
    ] as const
  ).map(([en, es], index): StubbedPosition => ({
    id: `90000000-0000-4000-8000-00000000001${index}`,
    names: { en, es },
    isArchived: false,
    coverage: null,
  })),
];

/** El orden que manda soltar una posición, y la lista en ese orden de
 * vuelta, como haría el servidor. Se registra después de las demás rutas
 * fingidas, así que gana a la suya. */
async function answerPositionsReorder(page: Page): Promise<string[][]> {
  const sentOrders: string[][] = [];
  await page.route(
    (url) => url.pathname === `${CLUB_POSITIONS_ADMIN_ENDPOINT}/order`,
    async (route, request) => {
      const { positionIds } = request.postDataJSON() as {
        positionIds: string[];
      };
      sentOrders.push(positionIds);
      const byId = new Map(SIX_STUBBED_POSITIONS.map((p) => [p.id, p]));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { positions: positionIds.map((id) => byId.get(id)) },
        }),
      });
    },
  );
  return sentOrders;
}

function positionRows(page: Page): Locator {
  return positionsSection(page).getByRole("list").first().getByRole("listitem");
}

/** Una ventana en la que la lista de seis no cabe entera. */
const SHORT_WINDOW_HEIGHT_PX = 480;

/** La sexta: el id que le da `SIX_STUBBED_POSITIONS`. */
const SWEEPER_ID = "90000000-0000-4000-8000-000000000012";

const SWEEPER_FIRST_ORDER = [
  SWEEPER_ID,
  ...SIX_STUBBED_POSITIONS.map(({ id }) => id).filter(
    (id) => id !== SWEEPER_ID,
  ),
];

test.describe("arrastrar posiciones (#725)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  async function openSixPositions(page: Page): Promise<string[][]> {
    await goToClubSettings(page, {
      name: "club-posiciones",
      tab: "positions",
      positions: SIX_STUBBED_POSITIONS,
    });
    return answerPositionsReorder(page);
  }

  test.describe("con el ratón @ desktop", () => {
    test.use({
      viewport: { width: viewports[2].width, height: viewports[2].height },
    });

    test("soltar la sexta en el primer puesto guarda el orden nuevo", async ({
      page,
    }) => {
      const sentOrders = await openSixPositions(page);
      const handle = positionRows(page)
        .nth(5)
        .getByRole("button", { name: /^Reorder Sweeper/ });

      const release = await holdWithMouseOver(
        page,
        handle,
        positionRows(page).first(),
      );
      await release();

      await expect(
        positionsSection(page).getByRole("button", {
          name: "Reorder Sweeper, position 1 of 6",
        }),
      ).toBeFocused();
      expect(sentOrders).toEqual([SWEEPER_FIRST_ORDER]);
    });
  });

  test.describe("con el ratón en una ventana baja", () => {
    test.use({
      viewport: { width: viewports[2].width, height: SHORT_WINDOW_HEIGHT_PX },
    });

    test("arrastrar cerca del borde de abajo hace scroll solo", async ({
      page,
    }) => {
      await openSixPositions(page);
      const handle = positionRows(page)
        .first()
        .getByRole("button", { name: /^Reorder Goalkeeper/ });
      await handle.scrollIntoViewIfNeeded();
      const scrollBefore = await page.evaluate(() => window.scrollY);
      const from = await centreOf(handle);

      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x, SHORT_WINDOW_HEIGHT_PX - 2, {
        steps: DRAG_STEP_COUNT,
      });

      await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBeGreaterThan(scrollBefore);
      await page.mouse.up();
    });
  });

  test.describe("con el dedo @ mobile", () => {
    test.use({
      hasTouch: true,
      viewport: { width: viewports[0].width, height: viewports[0].height },
    });

    test("mantener el asa y arrastrar guarda el orden nuevo", async ({
      page,
    }) => {
      const sentOrders = await openSixPositions(page);
      const handle = positionRows(page)
        .nth(5)
        .getByRole("button", { name: /^Reorder Sweeper/ });

      const release = await holdWithFingerOver(
        page,
        handle,
        positionRows(page).first(),
      );
      await release();

      await expect.poll(() => sentOrders).toEqual([SWEEPER_FIRST_ORDER]);
    });

    test("mover el dedo antes de 150 ms no arrastra", async ({ page }) => {
      const sentOrders = await openSixPositions(page);
      const handle = positionRows(page)
        .nth(5)
        .getByRole("button", { name: /^Reorder Sweeper/ });

      const from = await centreOf(handle);
      const to = await centreOf(positionRows(page).first());
      const cdp = await page.context().newCDPSession(page);

      // Sin esperar los 150 ms: el dedo pasa de la tolerancia antes y el
      // gesto no es un arrastre. Sin el retraso, esto reordenaría.
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [from],
      });
      for (let step = 1; step <= DRAG_STEP_COUNT; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            {
              x: from.x,
              y: from.y + ((to.y - from.y) * step) / DRAG_STEP_COUNT,
            },
          ],
        });
      }
      await expect(page.locator(".sortable-row-lifted")).toHaveCount(0);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await cdp.detach();

      expect(sentOrders).toEqual([]);
    });
  });
});

/* #301: la pantalla de entrar con los textos del club. Se ponen sobre la
   página ya servida, como el logo y el acento: guardarlos en la base
   cambiaría la pantalla de entrar de las demás pruebas. Que el servidor los
   elija por idioma lo prueban los unitarios de `auth-layout.test.tsx`; aquí
   se mira que caben, en los dos idiomas y en los tres anchos. */
type SignInTextsScreen = {
  readonly name: string;
  readonly locale: "en" | "es";
  readonly texts: StubbedSignInTexts;
};

const SIGN_IN_TEXTS_SCREENS: readonly SignInTextsScreen[] = [
  { name: "entrar-textos-club", locale: "en", texts: SHORT_SIGN_IN_TEXTS },
  { name: "entrar-textos-club-es", locale: "es", texts: SHORT_SIGN_IN_TEXTS },
  {
    name: "entrar-textos-club-largos",
    locale: "en",
    texts: LONG_SIGN_IN_TEXTS,
  },
  {
    name: "entrar-textos-club-largos-es",
    locale: "es",
    texts: LONG_SIGN_IN_TEXTS,
  },
];

async function showSignInTextsOnServedPage(
  page: Page,
  texts: { readonly tagline: string; readonly welcome: string },
): Promise<void> {
  // Antes de que React hidrate, un texto cambiado a mano no casa con lo que
  // pintó el servidor, y React vuelve a poner el suyo.
  await waitForHydration(page, ".auth-brand-headline");
  await page.evaluate(({ tagline, welcome }) => {
    const headline = document.querySelector(".auth-brand-headline");
    const copy = document.querySelector(".auth-brand-copy");
    if (headline === null || copy === null) {
      throw new Error("La pantalla de entrar no tiene lema o párrafo.");
    }
    headline.textContent = tagline;
    copy.textContent = welcome;
  }, texts);
}

async function goToSignInWithClubTexts(
  page: Page,
  signInScreen: SignInTextsScreen,
  theme?: (typeof themes)[number],
): Promise<void> {
  if (signInScreen.locale === "es") {
    await chooseSpanish(page);
  }
  if (theme === undefined) {
    await page.goto(`${APP_URL}${SIGN_IN_PATH}`);
  } else {
    await goToWithTheme(page, SIGN_IN_PATH, theme);
  }
  const { tagline, welcome } = signInScreen.texts[signInScreen.locale];
  if (tagline === null || welcome === null) {
    throw new Error(`${signInScreen.name} necesita lema y párrafo.`);
  }
  await showSignInTextsOnServedPage(page, { tagline, welcome });
}

for (const signInScreen of SIGN_IN_TEXTS_SCREENS) {
  test.describe(signInScreen.name, () => {
    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(signInScreen.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToSignInWithClubTexts(page, signInScreen, theme);
              const snapshot = `${signInScreen.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }

        test("has no horizontal scroll", async ({ page }) => {
          await goToSignInWithClubTexts(page, signInScreen);
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
        });

        test("keeps the club texts inside the brand panel", async ({
          page,
        }) => {
          await goToSignInWithClubTexts(page, signInScreen);
          const overflowing = await page.evaluate(() =>
            [".auth-brand-headline", ".auth-brand-copy"].filter((selector) => {
              const text = document.querySelector(selector);
              return text !== null && text.scrollWidth > text.clientWidth;
            }),
          );
          expect(overflowing).toEqual([]);
        });
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await goToSignInWithClubTexts(page, signInScreen);
      await expectNoAxeViolations(page);
    });
  });
}

test.describe("un Admin frente a la configuración de verdad", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });
  test.describe.configure({ timeout: ACCOUNT_CHANGE_TEST_TIMEOUT_MS });

  test("la abre desde el menú de la cuenta", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${APP_URL}/dashboard`);
    const menu = await openAccountMenu(page);

    await menu.getByRole("link", { name: "Club settings" }).click();

    await expect(page).toHaveURL(new RegExp(`${CLUB_SETTINGS_SCREEN_PATH}$`));
    // Es la primera petición de la corrida al endpoint real: el dev server
    // lo compila aquí.
    await expect(clubNameField(page)).not.toHaveValue("", {
      timeout: ACCOUNT_CHANGE_TIMEOUT_MS,
    });
  });

  test("su menú abierto no tiene violaciones (axe-core)", async ({ page }) => {
    await page.goto(`${APP_URL}/dashboard`);
    await openAccountMenu(page);

    await expectNoAxeViolations(page);
  });

  test("guardar sin cambiar nada responde 200 con lo que hay", async ({
    request,
  }) => {
    const read = await request.get(`${APP_URL}${CLUB_SETTINGS_ENDPOINT}`);
    expect(read.status()).toBe(200);
    const { data } = (await read.json()) as {
      data: {
        name: string;
        initials: string | null;
        accentColor: string;
        seasonStartsOn: string | null;
      };
    };
    const identity = {
      name: data.name,
      initials: data.initials,
      accentColor: data.accentColor,
      seasonStartsOn: data.seasonStartsOn,
    };

    const write = await request.patch(`${APP_URL}${CLUB_SETTINGS_ENDPOINT}`, {
      data: { ...identity, expected: identity },
    });

    expect(write.status()).toBe(200);
    await expect(write.json()).resolves.toMatchObject({ data: identity });
  });

  // #300: la lista de verdad, sin tocar nada del catálogo compartido.
  test("el endpoint de posiciones lista las del club con su marca de archivo", async ({
    request,
  }) => {
    const read = await request.get(
      `${APP_URL}${CLUB_POSITIONS_ADMIN_ENDPOINT}`,
    );

    expect(read.status()).toBe(200);
    const { data } = (await read.json()) as {
      data: { positions: { isArchived: boolean; coverage: unknown }[] };
    };
    expect(data.positions.length).toBeGreaterThan(0);
    expect(typeof data.positions[0]?.isArchived).toBe("boolean");
    // #404: con su función, sólo en la configuración.
    expect(data.positions[0]).toHaveProperty("coverage");
  });

  // #404: una función fuera de las tres no llega a la base.
  test("el endpoint de posiciones rechaza una función desconocida con 400", async ({
    request,
  }) => {
    const read = await request.get(
      `${APP_URL}${CLUB_POSITIONS_ADMIN_ENDPOINT}`,
    );
    const { data } = (await read.json()) as {
      data: { positions: { id: string }[] };
    };
    const first = data.positions[0];
    if (first === undefined) {
      throw new Error("El club no tiene ninguna posición.");
    }

    const write = await request.patch(
      `${APP_URL}${CLUB_POSITIONS_ADMIN_ENDPOINT}/${first.id}`,
      { data: { coverage: "midfielder" } },
    );

    expect(write.status()).toBe(400);
  });

  test("el endpoint de posiciones rechaza una sin nombre con 400", async ({
    request,
  }) => {
    const write = await request.post(
      `${APP_URL}${CLUB_POSITIONS_ADMIN_ENDPOINT}`,
      { data: { names: { en: " ", es: null } } },
    );

    expect(write.status()).toBe(400);
  });

  test("el endpoint rechaza un nombre vacío con 400", async ({ request }) => {
    const empty = {
      name: "",
      initials: null,
      accentColor: "#1c6ea4",
      seasonStartsOn: null,
    };

    const write = await request.patch(`${APP_URL}${CLUB_SETTINGS_ENDPOINT}`, {
      data: { ...empty, expected: empty },
    });

    expect(write.status()).toBe(400);
    await expect(write.json()).resolves.toMatchObject({
      error: { code: "validation_error", reason: "name_required" },
    });
  });

  // #294 (RF-3): un color que no es hexadecimal no llega a la base.
  test("el endpoint rechaza un acento que no es hexadecimal con 400, sin tocar la base", async ({
    request,
  }) => {
    const before = await request.get(`${APP_URL}${CLUB_SETTINGS_ENDPOINT}`);
    const { data } = (await before.json()) as {
      data: {
        name: string;
        initials: string | null;
        accentColor: string;
        seasonStartsOn: string | null;
      };
    };
    const expected = {
      name: data.name,
      initials: data.initials,
      accentColor: data.accentColor,
      seasonStartsOn: data.seasonStartsOn,
    };

    const write = await request.patch(`${APP_URL}${CLUB_SETTINGS_ENDPOINT}`, {
      data: { ...expected, accentColor: "purple", expected },
    });

    expect(write.status()).toBe(400);
    await expect(write.json()).resolves.toMatchObject({
      error: { code: "validation_error", reason: "accent_color_invalid" },
    });
    const after = await request.get(`${APP_URL}${CLUB_SETTINGS_ENDPOINT}`);
    await expect(after.json()).resolves.toMatchObject({ data: expected });
  });
});

test.describe("un Player frente a la configuración del club", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  test("abrirla a mano lo manda al panel", async ({ page }) => {
    await page.goto(`${APP_URL}${CLUB_SETTINGS_SCREEN_PATH}`);

    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("su menú de la cuenta no la ofrece", async ({ page }) => {
    await page.goto(`${APP_URL}/dashboard`);
    const menu = await openAccountMenu(page);

    await expect(menu.getByRole("link", { name: "Club settings" })).toHaveCount(
      0,
    );
  });

  test("el endpoint le responde 403, para leer y para guardar", async ({
    request,
  }) => {
    const identity = {
      name: "Otro club",
      initials: null,
      accentColor: "#7b3fa0",
      seasonStartsOn: null,
    };

    const read = await request.get(`${APP_URL}${CLUB_SETTINGS_ENDPOINT}`);
    const write = await request.patch(`${APP_URL}${CLUB_SETTINGS_ENDPOINT}`, {
      data: { ...identity, expected: identity },
    });

    expect(read.status()).toBe(403);
    expect(write.status()).toBe(403);
  });
});

test.describe("sin sesión frente a la configuración del club", () => {
  test("el endpoint responde 401", async ({ request }) => {
    const read = await request.get(`${APP_URL}${CLUB_SETTINGS_ENDPOINT}`);

    expect(read.status()).toBe(401);
  });

  test("la pantalla manda a iniciar sesión", async ({ page }) => {
    await page.goto(`${APP_URL}${CLUB_SETTINGS_SCREEN_PATH}`);

    await expect(page).toHaveURL(/\/entrar/);
  });
});
/* ---------------------------------------------------------------------------
   El logo del club (#295, RF-4 del PRD de E18a). Sin mockup: se revisa contra
   design-system.md, con el recuadro de iniciales marcando el tamaño y el
   sitio.

   Subir un logo de verdad cambiaría la marca de la base compartida, y con
   ella la cabecera de todas las demás capturas que corren a la vez, también
   en las otras máquinas de CI. Así que, como con el acento, en la cabecera y
   en la pantalla de entrar se pone sobre la página servida la misma imagen
   que pinta `ClubBrandMark`, con su clase. Que el servidor la pinte a partir
   de la marca lo prueban tests/unit/auth-layout.test.tsx y
   tests/unit/app-shell.test.tsx. La pantalla de configuración sí la pinta
   React, con la configuración servida por `page.route`.
   --------------------------------------------------------------------------- */

const LOGO_HOST = "https://logos.example.test";
const CLUB_LOGO_ENDPOINT = `${CLUB_SETTINGS_ENDPOINT}/logo`;
const FIXTURES_DIR = path.join(__dirname, "support", "fixtures");
/** El alto del recuadro de iniciales (`--space-8`), y el tope de ancho que
 * `.club-logo` le da a un logo apaisado. */
const LOGO_BOX_HEIGHT_PX = 32;
const LOGO_BOX_MAX_WIDTH_PX = LOGO_BOX_HEIGHT_PX * 4;
/** Lo que cabe dentro del recuadro de 56px de la fila del logo en General
 * (#720), sin su borde de 1px: un apaisado se estrecha a ese ancho. */
const CLUB_SETTINGS_LOGO_BOX_PX = 56 - 2;

/** La fila del logo en General, y no la vista previa de al lado. */
function clubLogoField(page: Page): Locator {
  return page.locator(".club-logo-field");
}
/** En la cabecera del móvil el logo va junto al nombre y no pasa de 48px de
 * ancho, para que no deje el nombre en unas pocas letras. */
const PHONE_HEADER_LOGO_MAX_WIDTH_PX = LOGO_BOX_HEIGHT_PX * 1.5;
/** En la barra lateral de escritorio el logo va junto al nombre y su tope
 * baja a 2,5 veces el alto, para que el nombre conserve 120px (#352). */
const SIDEBAR_LOGO_MAX_WIDTH_PX = 80;
const SIDEBAR_NAME_MIN_WIDTH_PX = 120;
/** Desde aquí la cabecera es la barra lateral de 240px. */
const SIDEBAR_MIN_VIEWPORT_PX = 768;
/** Cuánto puede apartarse la proporción pintada de la del fichero por el
 * redondeo a píxeles enteros. */
const LOGO_RATIO_TOLERANCE = 0.05;
/** Medio píxel de margen por el redondeo de las cajas. */
const SUBPIXEL_TOLERANCE_PX = 0.5;

/** 256 × 256 y 600 × 160. El apaisado (3,75:1) cabe por debajo del tope de
 * cuatro veces el alto: lo que aquí se prueba es que conserva su proporción,
 * y no el recorte de `object-fit` de uno más ancho que el tope. */
const CLUB_LOGOS = [
  { name: "cuadrado", file: "logo-cuadrado.png" },
  { name: "apaisado", file: "logo-apaisado.png" },
] as const;

type ClubLogoFixture = (typeof CLUB_LOGOS)[number];

/** El logo que se fotografía: el apaisado es el que más empuja al nombre. */
const PHOTOGRAPHED_LOGO: ClubLogoFixture = CLUB_LOGOS[1];

function logoUrlOf(logo: ClubLogoFixture): string {
  return `${LOGO_HOST}/${logo.file}`;
}

function readLogoFixture(file: string): Buffer {
  return readFileSync(path.join(FIXTURES_DIR, file));
}

/** Sirve los ficheros de prueba en `LOGO_HOST`; cualquier otro, 404. */
async function serveClubLogos(page: Page): Promise<void> {
  await page.route(`${LOGO_HOST}/**`, async (route, request) => {
    const logo = CLUB_LOGOS.find((candidate) =>
      request.url().endsWith(`/${candidate.file}`),
    );
    if (logo === undefined) {
      await route.fulfill({ status: 404, body: "" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: readLogoFixture(logo.file),
    });
  });
}

/** `root` acota la búsqueda donde hay más de un logo: en General (#720)
 * también lo enseña la vista previa. */
async function expectLogoLoaded(root: Page | Locator): Promise<void> {
  await expect
    .poll(() =>
      root
        .locator("img.club-logo")
        .evaluate((image: HTMLImageElement) =>
          image.complete ? image.naturalWidth : 0,
        ),
    )
    .toBeGreaterThan(0);
}

/** Lo que pinta `ClubBrandMark` con logo: en la pantalla de entrar sustituye
 * al recuadro de iniciales, y en la cabecera va delante del nombre. */
async function showLogoOnServedPage(
  page: Page,
  logo: ClubLogoFixture,
): Promise<void> {
  // Antes de que React hidrate, la imagen puesta a mano no casa con lo que
  // pintó el servidor, y React la cambia por el recuadro de iniciales.
  await waitForHydration(page, ".auth-brand-mark, .app-brand");
  await page.evaluate(
    ({ url, alt }) => {
      const image = document.createElement("img");
      image.className = "club-logo";
      image.src = url;
      image.alt = alt;
      const initials = document.querySelector(".auth-brand-mark");
      if (initials === null) {
        document.querySelector(".app-brand-lockup")?.prepend(image);
      } else {
        initials.replaceWith(image);
      }
    },
    { url: logoUrlOf(logo), alt: "Victoria Seadragons logo" },
  );
  await expectLogoLoaded(page);
}

/** El logo dentro de su caja: del alto del recuadro, con el ancho que le da
 * su proporción hasta el tope, encajado sin deformarse si llega a él, y sin
 * salirse de su contenedor. */
async function expectLogoFitsItsBox(
  root: Page | Locator,
  maxWidth: number = LOGO_BOX_MAX_WIDTH_PX,
): Promise<void> {
  const fit = await root
    .locator("img.club-logo")
    .evaluate((image: HTMLImageElement) => {
      const box = image.getBoundingClientRect();
      const parent = image.parentElement?.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        right: box.right,
        parentRight: parent?.right ?? 0,
        naturalRatio: image.naturalWidth / image.naturalHeight,
        objectFit: getComputedStyle(image).objectFit,
      };
    });
  expect(fit.height).toBe(LOGO_BOX_HEIGHT_PX);
  expect(fit.width).toBeLessThanOrEqual(maxWidth);
  expect(fit.objectFit).toBe("contain");
  const expectedRatio = Math.min(fit.naturalRatio, maxWidth / fit.height);
  expect(Math.abs(fit.width / fit.height - expectedRatio)).toBeLessThan(
    LOGO_RATIO_TOLERANCE,
  );
  expect(fit.right).toBeLessThanOrEqual(
    fit.parentRight + SUBPIXEL_TOLERANCE_PX,
  );
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
}

type BrandScreen = {
  readonly name: string;
  readonly path: string;
  readonly needsSession: boolean;
  /** Lo que se fotografía: la página entera, o sólo la cabecera. */
  readonly capture: (page: Page) => Locator | null;
  /** El tope de ancho del logo en esta pantalla a ese ancho de ventana. */
  readonly logoMaxWidthAt: (viewportWidth: number) => number;
};

const SIDEBAR_BRAND_SCREEN: BrandScreen = {
  name: "logo-cabecera",
  path: "/dashboard",
  needsSession: true,
  capture: (page) => page.locator(".app-sidebar-header"),
  logoMaxWidthAt: (viewportWidth) =>
    viewportWidth >= SIDEBAR_MIN_VIEWPORT_PX
      ? SIDEBAR_LOGO_MAX_WIDTH_PX
      : PHONE_HEADER_LOGO_MAX_WIDTH_PX,
};

const BRAND_SCREENS: readonly BrandScreen[] = [
  {
    name: "logo-entrar",
    path: "/entrar",
    needsSession: false,
    capture: () => null,
    logoMaxWidthAt: () => LOGO_BOX_MAX_WIDTH_PX,
  },
  SIDEBAR_BRAND_SCREEN,
];

async function goToBrandWithLogo(
  page: Page,
  screenPath: string,
  logo: ClubLogoFixture,
  theme: (typeof themes)[number] = "light",
): Promise<void> {
  await serveClubLogos(page);
  await goToWithTheme(page, screenPath, theme);
  await showLogoOnServedPage(page, logo);
}

async function expectMatchesBrandBaseline(
  page: Page,
  screen: BrandScreen,
  snapshot: string,
): Promise<void> {
  const element = screen.capture(page);
  if (element === null) {
    await createMissingLocalBaseline(snapshot, () =>
      page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
    );
    await expect(page).toHaveScreenshot(snapshot, {
      ...SCREENSHOT_OPTIONS,
      fullPage: true,
      maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
    });
    return;
  }
  await createMissingLocalBaseline(snapshot, () =>
    element.screenshot(SCREENSHOT_OPTIONS),
  );
  await expect(element).toHaveScreenshot(snapshot, {
    ...SCREENSHOT_OPTIONS,
    maxDiffPixels: COMPONENT_MAX_DIFF_PIXELS,
  });
}

for (const screen of BRAND_SCREENS) {
  test.describe(`${screen.name}: la marca con logo`, () => {
    if (screen.needsSession) {
      skipWithoutSession();
      quietNotificationBell();
      test.use({ storageState: E2E_STORAGE_STATE_PATH });
    }

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        for (const logo of CLUB_LOGOS) {
          test(`el logo ${logo.name} encaja sin deformarse ni desbordar`, async ({
            page,
          }) => {
            await goToBrandWithLogo(page, screen.path, logo);

            await expectLogoFitsItsBox(page, screen.logoMaxWidthAt(vp.width));
            await expectNoHorizontalScroll(page);
          });
        }

        for (const theme of themes) {
          test(`matches approved baseline (${theme})`, async ({ page }) => {
            await goToBrandWithLogo(
              page,
              screen.path,
              PHOTOGRAPHED_LOGO,
              theme,
            );

            await expectMatchesBrandBaseline(
              page,
              screen,
              `${screen.name}-${vp.name}-${theme}.png`,
            );
          });
        }
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await goToBrandWithLogo(page, screen.path, PHOTOGRAPHED_LOGO);

      await expectNoAxeViolations(page);
    });
  });
}

type SidebarBrandGeometry = {
  readonly logo: DOMRect | null;
  readonly lockup: DOMRect;
  readonly name: DOMRect;
  readonly nameLineCount: number;
  readonly isNameOverflowing: boolean;
  /** Los botones que se ven en la cabecera de la barra lateral: ninguno en
   * escritorio, donde la campana y la cuenta van arriba (#717). */
  readonly visibleHeaderButtonCount: number;
  readonly sidebar: DOMRect;
};

/** Las cajas de la marca y de los controles en la barra lateral. */
async function readSidebarBrandGeometry(
  page: Page,
): Promise<SidebarBrandGeometry> {
  return page.evaluate(() => {
    const elementOf = (selector: string): HTMLElement => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) {
        throw new Error(`falta ${selector}`);
      }
      return element;
    };
    const boxOf = (selector: string): DOMRect =>
      elementOf(selector).getBoundingClientRect();
    const name = elementOf(".app-brand");
    const lineHeight = parseFloat(getComputedStyle(name).lineHeight);
    return {
      logo:
        document.querySelector("img.club-logo")?.getBoundingClientRect() ??
        null,
      lockup: boxOf(".app-brand-lockup"),
      name: name.getBoundingClientRect(),
      nameLineCount: Math.round(
        name.getBoundingClientRect().height / lineHeight,
      ),
      isNameOverflowing: name.scrollWidth > name.clientWidth,
      visibleHeaderButtonCount: Array.from(
        document.querySelectorAll(".app-sidebar-header button"),
      ).filter((button) => button.getClientRects().length > 0).length,
      sidebar: boxOf(".app-sidebar"),
    };
  });
}

function expectHorizontallyInside(inner: DOMRect, outer: DOMRect): void {
  expect(inner.left).toBeGreaterThanOrEqual(outer.left - SUBPIXEL_TOLERANCE_PX);
  expect(inner.right).toBeLessThanOrEqual(outer.right + SUBPIXEL_TOLERANCE_PX);
}

/** Cuánto pueden apartarse los centros del logo y del nombre. */
const VERTICAL_CENTER_TOLERANCE_PX = 1;

/** No cabe en una línea de 120px a 18px, pero sí en dos. */
const TWO_LINE_CLUB_NAME = "Victoria Seadragons Rugby";

async function renameServedClub(page: Page, name: string): Promise<void> {
  await page.locator(".app-brand").evaluate((element, text) => {
    element.textContent = text;
  }, name);
}

function expectLogoBesideName(geometry: SidebarBrandGeometry): void {
  if (geometry.logo === null) {
    throw new Error("el logo no se pintó");
  }
  expect(geometry.logo.right).toBeLessThanOrEqual(geometry.name.left);
  const logoCenter = geometry.logo.top + geometry.logo.height / 2;
  const nameCenter = geometry.name.top + geometry.name.height / 2;
  expect(Math.abs(logoCenter - nameCenter)).toBeLessThanOrEqual(
    VERTICAL_CENTER_TOLERANCE_PX,
  );
  expect(geometry.name.width).toBeGreaterThanOrEqual(
    SIDEBAR_NAME_MIN_WIDTH_PX - SUBPIXEL_TOLERANCE_PX,
  );
}

function expectHeaderIsOnlyBrand(geometry: SidebarBrandGeometry): void {
  expect(geometry.visibleHeaderButtonCount).toBe(0);
  expectHorizontallyInside(geometry.lockup, geometry.sidebar);
}

/* La barra lateral de escritorio con el logo junto al nombre (#352). */
test.describe("logo-cabecera: el logo en la misma fila que el nombre", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  for (const vp of viewports.filter(
    (candidate) => candidate.width >= SIDEBAR_MIN_VIEWPORT_PX,
  )) {
    test.describe(`@ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const logo of CLUB_LOGOS) {
        test(`el logo ${logo.name} va a la izquierda del nombre, centrado con él`, async ({
          page,
        }) => {
          await goToBrandWithLogo(page, SIDEBAR_BRAND_SCREEN.path, logo);

          const geometry = await readSidebarBrandGeometry(page);
          expectLogoBesideName(geometry);
          expectHeaderIsOnlyBrand(geometry);
          await expectNoHorizontalScroll(page);
        });
      }

      test("un nombre largo se parte en dos líneas entre palabras", async ({
        page,
      }) => {
        await goToBrandWithLogo(
          page,
          SIDEBAR_BRAND_SCREEN.path,
          PHOTOGRAPHED_LOGO,
        );
        await renameServedClub(page, TWO_LINE_CLUB_NAME);

        const geometry = await readSidebarBrandGeometry(page);
        expect(geometry.nameLineCount).toBe(2);
        expect(geometry.isNameOverflowing).toBe(false);
        expectLogoBesideName(geometry);
        expectHeaderIsOnlyBrand(geometry);
        await expectNoHorizontalScroll(page);
      });

      test("sin logo la marca es sólo el nombre, sin hueco delante", async ({
        page,
      }) => {
        await goToWithTheme(page, SIDEBAR_BRAND_SCREEN.path, "light");

        const geometry = await readSidebarBrandGeometry(page);
        expect(geometry.logo).toBeNull();
        expect(geometry.name.left).toBe(geometry.lockup.left);
        expectHeaderIsOnlyBrand(geometry);
      });

      // El apaisado lo fotografía `logo-cabecera: la marca con logo`; el
      // cuadrado es el emblema real del club, el que motivó el ticket.
      for (const theme of themes) {
        test(`con el logo cuadrado coincide con la línea base (${theme})`, async ({
          page,
        }) => {
          await goToBrandWithLogo(
            page,
            SIDEBAR_BRAND_SCREEN.path,
            CLUB_LOGOS[0],
            theme,
          );

          await expectMatchesBrandBaseline(
            page,
            SIDEBAR_BRAND_SCREEN,
            `logo-cabecera-cuadrado-${vp.name}-${theme}.png`,
          );
        });
      }
    });
  }
});

/** La configuración servida con un logo: uno de los de prueba, o una
 * dirección que responde 404, como un fichero borrado del almacenamiento. */
async function goToClubSettingsWithLogo(
  page: Page,
  logoUrl: string,
  theme?: (typeof themes)[number],
): Promise<void> {
  await serveClubLogos(page);
  // Las demás secciones, de mentira como en los demás estados de la
  // pantalla: las de verdad cambian con lo que dejen otras pruebas.
  await stubClubSettingsSections(page, { name: "club-con-logo" });
  // Registrada después, gana a la de `stubClubSettings`.
  await page.route(
    (url) => url.pathname === CLUB_SETTINGS_ENDPOINT,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { ...STUBBED_CLUB_SETTINGS, logoUrl } }),
      });
    },
  );
  if (theme === undefined) {
    await page.goto(`${APP_URL}${clubSettingsPath("general")}`);
  } else {
    await goToWithTheme(page, clubSettingsPath("general"), theme);
  }
  await waitForClubSettingsSection(page, "general");
}

test.describe("club-con-logo", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  for (const vp of viewports) {
    test.describe(`@ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const theme of themes) {
        test(`matches approved baseline (${theme})`, async ({ page }) => {
          await goToClubSettingsWithLogo(
            page,
            logoUrlOf(PHOTOGRAPHED_LOGO),
            theme,
          );
          await expectLogoLoaded(clubLogoField(page));
          const snapshot = `club-con-logo-${vp.name}-${theme}.png`;
          await createMissingLocalBaseline(snapshot, () =>
            page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
          );
          await expect(page).toHaveScreenshot(snapshot, {
            ...SCREENSHOT_OPTIONS,
            fullPage: true,
            maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
          });
        });
      }

      for (const logo of CLUB_LOGOS) {
        test(`el logo ${logo.name} encaja sin deformarse ni desbordar`, async ({
          page,
        }) => {
          await goToClubSettingsWithLogo(page, logoUrlOf(logo));
          await expectLogoLoaded(clubLogoField(page));

          await expectLogoFitsItsBox(
            clubLogoField(page),
            CLUB_SETTINGS_LOGO_BOX_PX,
          );
          await expectNoHorizontalScroll(page);
        });
      }
    });
  }

  test("has no accessibility violations (axe-core)", async ({ page }) => {
    await goToClubSettingsWithLogo(page, logoUrlOf(PHOTOGRAPHED_LOGO));
    await expectLogoLoaded(clubLogoField(page));

    await expectNoAxeViolations(page);
  });

  test("un logo que ya no está en el almacenamiento deja las iniciales", async ({
    page,
  }) => {
    await goToClubSettingsWithLogo(page, `${LOGO_HOST}/borrado.png`);

    await expect(
      page.locator(".club-logo-preview .club-logo-initials"),
    ).toHaveText(STUBBED_CLUB_SETTINGS.initials);
    await expect(page.locator("img.club-logo")).toHaveCount(0);
  });
});

/** Las subidas que el endpoint de verdad rechaza. Ninguna llega a guardar
 * nada, así que no cambian la marca que ven las demás pruebas. */
const REJECTED_LOGO_UPLOADS = [
  {
    name: "un fichero que no es PNG ni WebP",
    body: (): Buffer => Buffer.from("esto no es una imagen"),
    reason: "logo_type_unsupported",
  },
  {
    name: "un logo de más de 512 KB",
    body: (): Buffer =>
      Buffer.concat([
        readLogoFixture("logo-cuadrado.png"),
        Buffer.alloc(512 * 1024),
      ]),
    reason: "logo_too_large",
  },
  {
    name: "un PNG que no se puede decodificar",
    body: (): Buffer => readLogoFixture("foto-corrupta.png"),
    reason: "logo_undecodable",
  },
] as const;

test.describe("un Admin frente al endpoint del logo de verdad", () => {
  skipWithoutSession();
  test.use({ storageState: ADMIN_STORAGE_STATE });
  test.describe.configure({ timeout: ACCOUNT_CHANGE_TEST_TIMEOUT_MS });

  for (const upload of REJECTED_LOGO_UPLOADS) {
    test(`rechaza ${upload.name} con 400 y su motivo, sin tocar la marca`, async ({
      request,
    }) => {
      const before = await request.get(`${APP_URL}${CLUB_SETTINGS_ENDPOINT}`);

      const response = await request.put(`${APP_URL}${CLUB_LOGO_ENDPOINT}`, {
        headers: { "content-type": "image/png" },
        data: upload.body(),
      });

      expect(response.status()).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "validation_error", reason: upload.reason },
      });
      const after = await request.get(`${APP_URL}${CLUB_SETTINGS_ENDPOINT}`);
      expect(await after.json()).toEqual(await before.json());
    });
  }
});

test.describe("un Player frente al endpoint del logo", () => {
  skipWithoutSession();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  test("le responde 403, para subir y para quitar", async ({ request }) => {
    const upload = await request.put(`${APP_URL}${CLUB_LOGO_ENDPOINT}`, {
      headers: { "content-type": "image/png" },
      data: readLogoFixture("logo-cuadrado.png"),
    });
    const removal = await request.delete(`${APP_URL}${CLUB_LOGO_ENDPOINT}`);

    expect(upload.status()).toBe(403);
    expect(removal.status()).toBe(403);
  });
});

test.describe("sin sesión frente al endpoint del logo", () => {
  test("responde 401", async ({ request }) => {
    const removal = await request.delete(`${APP_URL}${CLUB_LOGO_ENDPOINT}`);

    expect(removal.status()).toBe(401);
  });
});
/* ---------------------------------------------------------------------------
   El acento del club (#294, RF-3 del PRD de E18a). Sin mockup: se revisa
   contra design-system.md con un acento lejos del azul de hoy.

   El servidor mete la hoja del acento en el <head> cuando la base guarda un
   color propio. Cambiar el acento del club en la base compartida movería las
   capturas de todas las demás pruebas que corren a la vez, así que aquí se
   aplica la misma hoja, construida por el mismo `buildAccentStylesheet`, sobre
   la página servida. Que el servidor la sirva sin JavaScript lo prueba
   tests/unit/club/accent-injection.test.tsx.
   --------------------------------------------------------------------------- */

/** Morado: botones, enlaces y estados activos se distinguen a simple vista
 * de los de hoy. */
const CLUB_ACCENT = "#7b3fa0";
const CLUB_ACCENT_RGB = "rgb(123, 63, 160)";
const DEFAULT_LIGHT_ACCENT_RGB = "rgb(28, 110, 164)";
const DEFAULT_DARK_ACCENT_RGB = "rgb(51, 161, 224)";

/** El amarillo del prototipo (#341): rellena el botón tal cual, pero como
 * enlace sobre el fondo claro va oscurecido. */
const LIGHT_CLUB_ACCENT = "#ffc94a";
const LIGHT_CLUB_ACCENT_RGB = "rgb(255, 201, 74)";

/** Las dos marcas con las que se revisan las pantallas: una oscura que ya se
 * lee como enlace y una clara que necesita su variante. El morado conserva
 * los nombres de captura que tenía desde el #294. */
const CLUB_ACCENTS = [
  { color: CLUB_ACCENT, snapshotSuffix: "" },
  { color: LIGHT_CLUB_ACCENT, snapshotSuffix: "-amarillo" },
] as const;

function clubAccentStylesheet(accent: string): string {
  const stylesheet = buildAccentStylesheet(accent);
  if (stylesheet === null) {
    throw new Error(`${accent} no produjo hoja de acento`);
  }
  return stylesheet;
}

async function applyClubAccent(
  page: Page,
  accent: string = CLUB_ACCENT,
): Promise<void> {
  await page.addStyleTag({ content: clubAccentStylesheet(accent) });
}

function acceptedAccentPalette(accent: string): AccentPalette {
  const evaluation = evaluateAccentColor(accent);
  if (evaluation.kind !== "accepted") {
    throw new Error(`${accent} fue rechazado: ${evaluation.reason}`);
  }
  return evaluation.palette;
}

/** `#rrggbb` como lo devuelve `getComputedStyle`. */
function toComputedRgb(hex: string): string {
  const [red, green, blue] = [1, 3, 5].map((start) =>
    parseInt(hex.slice(start, start + 2), 16),
  );
  return `rgb(${red}, ${green}, ${blue})`;
}

type AccentScreen = {
  readonly name: string;
  readonly storageState?: string;
  readonly visit: (page: Page, theme: (typeof themes)[number]) => Promise<void>;
};

const DIRECTORY_WITH_REQUESTS = DIRECTORY_STATES.find(
  (state) => state.name === "directorio-admin-con-solicitudes",
);

const ACCENT_SCREENS: readonly AccentScreen[] = [
  {
    name: "acento-entrar",
    visit: (page, theme) => goToWithTheme(page, SIGN_IN_PATH, theme),
  },
  {
    name: "acento-panel",
    storageState: E2E_STORAGE_STATE_PATH,
    // Sin esperar, la captura salía a veces con el inicio cargado y a veces
    // con "Loading…", según lo rápido que respondiera la base.
    visit: async (page, theme) => {
      await goToWithTheme(page, "/dashboard", theme);
      await waitForSectionsLoaded(page, []);
    },
  },
  {
    name: "acento-directorio",
    storageState: ADMIN_STORAGE_STATE,
    visit: async (page, theme) => {
      if (DIRECTORY_WITH_REQUESTS === undefined) {
        throw new Error("falta el estado directorio-admin-con-solicitudes");
      }
      await goToDirectory(page, DIRECTORY_WITH_REQUESTS, theme);
    },
  },
];

async function goToWithClubAccent(
  page: Page,
  accentScreen: AccentScreen,
  { theme, accent }: { theme: (typeof themes)[number]; accent: string },
): Promise<void> {
  await accentScreen.visit(page, theme);
  await applyClubAccent(page, accent);
  await page.mouse.move(0, 0);
}

for (const { color: accent, snapshotSuffix } of CLUB_ACCENTS) {
  for (const accentScreen of ACCENT_SCREENS) {
    const screenName = `${accentScreen.name}${snapshotSuffix}`;
    test.describe(screenName, () => {
      if (accentScreen.storageState !== undefined) {
        skipWithoutSession();
        quietNotificationBell();
        test.use({ storageState: accentScreen.storageState });
      }

      for (const vp of viewports) {
        test.describe(`@ ${vp.name}`, () => {
          test.use({ viewport: { width: vp.width, height: vp.height } });

          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToWithClubAccent(page, accentScreen, { theme, accent });
              const snapshot = `${screenName}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        });
      }

      for (const theme of themes) {
        test(`has no accessibility violations (axe-core, ${theme})`, async ({
          page,
        }) => {
          await goToWithClubAccent(page, accentScreen, { theme, accent });
          await expectNoAxeViolations(page);
        });
      }
    });
  }
}

test.describe("el acento del club sobre la aplicación", () => {
  async function signInButtonColor(page: Page): Promise<string> {
    return page
      .getByRole("button", { name: "Sign in" })
      .evaluate((button) => getComputedStyle(button).backgroundColor);
  }

  test("el botón principal usa el color del club en el tema claro", async ({
    page,
  }) => {
    await goToWithTheme(page, SIGN_IN_PATH, "light");
    await applyClubAccent(page);

    expect(await signInButtonColor(page)).toBe(CLUB_ACCENT_RGB);
  });

  test("en el tema oscuro usa el color del club aclarado, no el azul de hoy", async ({
    page,
  }) => {
    await goToWithTheme(page, SIGN_IN_PATH, "dark");
    await applyClubAccent(page);

    const color = await signInButtonColor(page);
    expect(color).not.toBe(DEFAULT_DARK_ACCENT_RGB);
    expect(color).not.toBe(CLUB_ACCENT_RGB);
  });

  async function signInLinkColor(page: Page): Promise<string> {
    return page
      .locator(".auth-inline-link")
      .evaluate((link) => getComputedStyle(link).color);
  }

  test("con un acento claro, el botón usa el color del club tal cual y el enlace su variante oscura", async ({
    page,
  }) => {
    await goToWithTheme(page, SIGN_IN_PATH, "light");
    await applyClubAccent(page, LIGHT_CLUB_ACCENT);

    expect(await signInButtonColor(page)).toBe(LIGHT_CLUB_ACCENT_RGB);
    expect(await signInLinkColor(page)).toBe(
      toComputedRgb(acceptedAccentPalette(LIGHT_CLUB_ACCENT).light.accentText),
    );
  });

  test("con un acento que ya se lee, el enlace usa el color del club tal cual", async ({
    page,
  }) => {
    await goToWithTheme(page, SIGN_IN_PATH, "light");
    await applyClubAccent(page);

    expect(await signInLinkColor(page)).toBe(CLUB_ACCENT_RGB);
  });

  test("con un acento claro en el tema oscuro, el enlace es el acento aclarado", async ({
    page,
  }) => {
    await goToWithTheme(page, SIGN_IN_PATH, "dark");
    await applyClubAccent(page, LIGHT_CLUB_ACCENT);

    const darkAccent = toComputedRgb(
      acceptedAccentPalette(LIGHT_CLUB_ACCENT).dark.accent,
    );
    expect(await signInButtonColor(page)).toBe(darkAccent);
    expect(await signInLinkColor(page)).toBe(darkAccent);
  });

  test("en el tema oscuro el resto de la paleta no cambia", async ({
    page,
  }) => {
    await goToWithTheme(page, SIGN_IN_PATH, "dark");
    const readPalette = (): Promise<string[]> =>
      page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return [
          "--color-background",
          "--color-panel",
          "--color-text",
          "--color-text-secondary",
          "--color-border",
        ].map((name) => style.getPropertyValue(name).trim());
      });
    const before = await readPalette();

    await applyClubAccent(page);

    expect(await readPalette()).toEqual(before);
  });

  test("sin JavaScript, la página del club sembrado sale con el acento de hoy", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto(`${APP_URL}${SIGN_IN_PATH}`);

    expect(await signInButtonColor(page)).toBe(DEFAULT_LIGHT_ACCENT_RGB);
    await context.close();
  });
});

/* ---------------------------------------------------------------------------
   Noticias (#329): el feed y la publicación abierta. Mockup del feed:
   docs/mockups/news-light.png, news-dark.png y sus versiones móviles. La
   publicación abierta no tiene mockup: se revisa contra design-system.md.

   Las capturas leen datos fijos, servidos por `page.route`, como el
   directorio: lo publicado de verdad cambia con cada test que publique. Lo
   que el endpoint responde se prueba aparte, contra la base (#327).
   --------------------------------------------------------------------------- */

const NEWS_SCREEN_PATH = "/noticias";
const NEWS_FEED_ENDPOINT = "/api/v1/news";
const NEWS_POST_ID = "a0a0a0a0-0000-4000-8000-0000000000a1";
const NEWS_POST_WITHOUT_ATTACHMENTS_ID = "a0a0a0a0-0000-4000-8000-0000000000a2";
const NEWS_FOREIGN_POST_ID = "a0a0a0a0-0000-4000-8000-0000000000a3";
const NEWS_AUTHOR = {
  id: "11111111-0000-4000-8000-000000000011",
  fullName: "Sofía Castro Echeverri",
};
const NEWS_NARROW_WIDTHS = [320, 375, 768] as const;

/** Las portadas (#591) llegan firmadas desde Storage; aquí, de este origen
 * inventado, con las dos versiones de una foto fija (#594). */
const STUBBED_COVER_URL = "https://archivos.test/portada-grande.webp";
const STUBBED_COVER_THUMBNAIL_URL = "https://archivos.test/portada-mini.webp";

/** Las tres categorías, una con un título que parte en dos líneas a 375px, y
 * adjuntos en dos de ellas. Hace cuánto se cuenta desde ahora, así que la
 * fila dice siempre lo mismo. */
const STUBBED_FEED_POSTS = [
  {
    id: NEWS_POST_ID,
    category: "announcement",
    title: "Nationals squad shortlist announced for the August championships",
    excerpt:
      "Twelve Seadragons named in the extended squad for the August nationals in Brisbane. Final eight confirmed after trials.",
    author: NEWS_AUTHOR,
    publishedAt: hoursAgo(49),
    status: "published",
    attachmentCount: 1,
    coverThumbnailUrl: null,
    coverUrl: null,
  },
  {
    id: NEWS_POST_WITHOUT_ATTACHMENTS_ID,
    category: "news",
    title: "Winter training schedule is live",
    excerpt:
      "Two sessions a week through July: Tuesdays at MSAC, Thursdays at Fitzroy.",
    author: {
      id: "22222222-0000-4000-8000-000000000022",
      fullName: "Liam O'Connor",
    },
    publishedAt: hoursAgo(97),
    status: "published",
    attachmentCount: 0,
    coverThumbnailUrl: STUBBED_COVER_THUMBNAIL_URL,
    coverUrl: STUBBED_COVER_URL,
  },
  {
    id: "a0a0a0a0-0000-4000-8000-0000000000a4",
    category: "document",
    title: "Updated pool safety and dive policy",
    excerpt:
      "Please review the revised buddy-check and equipment policy before the next session.",
    author: NEWS_AUTHOR,
    publishedAt: hoursAgo(24 * 8),
    status: "published",
    attachmentCount: 2,
    coverThumbnailUrl: null,
    coverUrl: null,
  },
] as const;

/** La fijada vigente (#592) del feed de escritorio (#594), con portada. Su
 * fin es fijo: la tarjeta lo escribe como fecha, no como tiempo relativo. */
const STUBBED_PINNED_POST = {
  id: "a0a0a0a0-0000-4000-8000-0000000000a7",
  category: "announcement",
  title: "Spring league registration closes Friday",
  excerpt:
    "Have your AUF number and a recent photo ready. Fee waiver requests go through the same form.",
  author: NEWS_AUTHOR,
  publishedAt: hoursAgo(30),
  status: "published",
  attachmentCount: 1,
  coverThumbnailUrl: STUBBED_COVER_THUMBNAIL_URL,
  coverUrl: STUBBED_COVER_URL,
  pinnedUntil: "2026-10-30T08:00:00.000Z",
} as const;

/** La última visita a Noticias: lo de hace menos de tres días sale como no
 * leído, y lo demás no. */
const STUBBED_NEWS_SEEN_AT = hoursAgo(72);

/** Lo bastante dentro para salir del radio de 10 px de la tarjeta. */
const CARD_CORNER_INSET_PX = 16;

/** Fechas fijas: la publicación abierta las escribe enteras, no relativas. */
const STUBBED_POST = {
  id: NEWS_POST_ID,
  category: "announcement",
  title: STUBBED_FEED_POSTS[0].title,
  body: "Twelve Seadragons named in the extended squad for the August nationals in Brisbane.\nFinal eight confirmed after trials.\n\nTraining for the squad starts on Tuesday. <b>Bring fins.</b>",
  author: { ...NEWS_AUTHOR, photoUrl: null },
  audience: { kind: "club" },
  publishedAt: "2026-09-15T08:00:00.000Z",
  editedAt: "2026-09-16T01:30:00.000Z",
  status: "published",
  canManage: false,
  coverUrl: null,
  isPinned: false,
  pinnedUntil: null,
  canPin: false,
  attachments: [
    {
      id: "d0d0d0d0-0000-4000-8000-0000000000d1",
      fileName: "reglamento-seleccion-nacional-2026.pdf",
      contentType: "application/pdf",
      sizeBytes: 2_516_582,
    },
    {
      id: "d0d0d0d0-0000-4000-8000-0000000000d2",
      fileName: "mapa-piscina.png",
      contentType: "image/png",
      sizeBytes: 245_760,
    },
  ],
} as const;

const STUBBED_POST_WITHOUT_ATTACHMENTS = {
  ...STUBBED_POST,
  id: NEWS_POST_WITHOUT_ATTACHMENTS_ID,
  category: "news",
  title: STUBBED_FEED_POSTS[1].title,
  body: "Two sessions a week through July.\nTuesdays at MSAC, Thursdays at Fitzroy.",
  editedAt: null,
  attachments: [],
} as const;

/** Dos de quien mira (#331): una editada, que puede editar y retirar, y otra
 * que ya retiró. */
const NEWS_OWN_POST_ID = "a0a0a0a0-0000-4000-8000-0000000000a5";
const NEWS_OWN_WITHDRAWN_POST_ID = "a0a0a0a0-0000-4000-8000-0000000000a6";

const STUBBED_OWN_POST = {
  ...STUBBED_POST_WITHOUT_ATTACHMENTS,
  id: NEWS_OWN_POST_ID,
  category: "announcement",
  title: "Pool change: Tuesday training moves to MSAC",
  editedAt: "2026-09-16T01:30:00.000Z",
  canManage: true,
} as const;

const STUBBED_OWN_WITHDRAWN_POST = {
  ...STUBBED_OWN_POST,
  id: NEWS_OWN_WITHDRAWN_POST_ID,
  title: "Call-up for the Sydney friendly",
  editedAt: null,
  status: "withdrawn",
} as const;

/** La publicación abierta del diseño 1c (#596), como
 * `docs/mockups/news-redesign-post-dark.png`: con portada, audiencia de
 * grupos, editada, cuerpo en Markdown y un adjunto de cada tipo. Es de quien
 * mira, así que lleva Editar y Retirar. */
const STUBBED_OPEN_POST = {
  ...STUBBED_POST,
  id: "a0a0a0a0-0000-4000-8000-0000000000a8",
  category: "news",
  title: "Seadragons take silver at the Island Cup",
  body: "The under-16 squad brought home **silver** from the Island Cup on Sunday, after five games in two days.\n\n## Highlights\n\n- Four wins in pool play, including a comeback in the quarter-final\n- The *fair-play award*, voted by the other teams\n- Three players at their first tournament\n\n> They kept their heads up the whole weekend, even after the final.\n\nPractice resumes **Tuesday at 6 pm** on Field 2. Photos are in the [shared album](https://example.com/album).",
  audience: { kind: "groups", groupNames: ["U16 squad", "Parents"] },
  canManage: true,
  coverUrl: STUBBED_COVER_URL,
  attachments: [
    ...STUBBED_POST.attachments,
    {
      id: "d0d0d0d0-0000-4000-8000-0000000000d3",
      fileName: "island-cup-results.docx",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 18_432,
    },
  ],
} as const;

/** Sin portada (#596): el fondo de su categoría a la misma altura, con un
 * título de 120 caracteres y un autor de nombre muy largo, que se parten en
 * líneas sin desbordar. */
const STUBBED_NO_COVER_POST = {
  ...STUBBED_POST_WITHOUT_ATTACHMENTS,
  id: "a0a0a0a0-0000-4000-8000-0000000000a9",
  category: "document",
  title:
    "Reminder for every member: the pool safety briefing, the equipment check and the annual dues all fall due before Friday.",
  author: {
    id: "44444444-0000-4000-8000-000000000044",
    fullName:
      "Maximiliana Alejandra de los Ángeles Fitzgerald-Montgomery Castro Echeverri",
    photoUrl: null,
  },
} as const;

/** Una retirada abierta por quien la publicó (#596): sigue marcada. */
const STUBBED_WITHDRAWN_OPEN_POST = {
  ...STUBBED_OPEN_POST,
  id: "a0a0a0a0-0000-4000-8000-0000000000b1",
  title: "Friendly against Sydney is postponed",
  status: "withdrawn",
  coverUrl: null,
  editedAt: null,
} as const;

/** La del móvil (#601), como `docs/mockups/mobile-news-redesign-post-dark.png`:
 * quien mira es Admin y no está fijada, así que la hoja ⋯ lleva Editar,
 * Fijar arriba y Retirar. */
const STUBBED_MOBILE_POST = {
  ...STUBBED_OPEN_POST,
  id: "a0a0a0a0-0000-4000-8000-0000000000b2",
  canPin: true,
  isPinned: false,
  pinnedUntil: null,
} as const;

/** Con imágenes en el cuerpo (#603), como la de
 * `docs/mockups/news-redesign-post-dark.png`: una con pie, apaisada, y otra
 * sin pie, vertical, que se recorta a la altura fija. */
const STUBBED_IMAGE_ID = "1d1d1d1d-0000-4000-8000-0000000000c1";
const STUBBED_UNCAPTIONED_IMAGE_ID = "1d1d1d1d-0000-4000-8000-0000000000c2";
const STUBBED_IMAGE_POST = {
  ...STUBBED_OPEN_POST,
  id: "a0a0a0a0-0000-4000-8000-0000000000b3",
  body: `The under-16 squad brought home **silver** from the Island Cup on Sunday.\n\n![The squad after the final](/api/v1/news/images/${STUBBED_IMAGE_ID})\n\n> They kept their heads up the whole weekend, even after the final.\n\n![](/api/v1/news/images/${STUBBED_UNCAPTIONED_IMAGE_ID})\n\nPractice resumes **Tuesday at 6 pm** on Field 2.`,
  attachments: [],
} as const;

const STUBBED_POSTS = [
  STUBBED_POST,
  STUBBED_POST_WITHOUT_ATTACHMENTS,
  STUBBED_OWN_POST,
  STUBBED_OWN_WITHDRAWN_POST,
  STUBBED_OPEN_POST,
  STUBBED_NO_COVER_POST,
  STUBBED_WITHDRAWN_OPEN_POST,
  STUBBED_MOBILE_POST,
  STUBBED_IMAGE_POST,
] as const;

/** El feed de quien publicó: lo suyo retirado le llega marcado (#331). */
const STUBBED_FEED_WITH_WITHDRAWN = [
  {
    id: NEWS_OWN_WITHDRAWN_POST_ID,
    category: "announcement",
    title: STUBBED_OWN_WITHDRAWN_POST.title,
    excerpt: "The friendly in Sydney is off. We'll share a new date soon.",
    author: NEWS_AUTHOR,
    publishedAt: hoursAgo(26),
    status: "withdrawn",
    attachmentCount: 0,
    coverThumbnailUrl: null,
    coverUrl: null,
  },
  ...STUBBED_FEED_POSTS,
] as const;

function jsonBody(data: unknown): {
  status: number;
  contentType: string;
  body: string;
} {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data }),
  };
}

async function stubNewsCovers(page: Page): Promise<void> {
  const shrunk = await shrinkNewsCover(
    readFileSync(LARGE_PHOTO_FIXTURES.landscape),
  );
  if (shrunk.kind !== "shrunk") {
    throw new Error("La portada fija no se pudo reducir.");
  }
  const versions = new Map([
    [STUBBED_COVER_URL, shrunk.large],
    [STUBBED_COVER_THUMBNAIL_URL, shrunk.thumbnail],
  ]);
  for (const [url, bytes] of versions) {
    await page.route(url, (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/webp",
        body: Buffer.from(bytes),
      }),
    );
  }
}

// El mapa de la tarjeta del lugar (#658) nunca sale a OpenStreetMap en los
// tests: una página fija hace de mapa, igual en cada corrida.
const PLACE_MAP_URL = "https://www.openstreetmap.org/export/embed.html**";

const STUBBED_PLACE_MAP_PAGE = `<!doctype html>
<html><body style="margin:0;height:100vh;background:
linear-gradient(90deg,transparent 48%,#fff 48%,#fff 52%,transparent 52%),
linear-gradient(0deg,transparent 45%,#fff 45%,#fff 55%,transparent 55%),
#e6eedd;">
<div style="position:absolute;left:50%;top:50%;width:14px;height:14px;
margin:-7px;border-radius:50%;background:#2a7fd4;border:2px solid #fff"></div>
</body></html>`;

async function stubPlaceMap(page: Page): Promise<void> {
  await page.route(PLACE_MAP_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: STUBBED_PLACE_MAP_PAGE,
    }),
  );
}

/** El feed y las publicaciones, con el mismo contrato que #327. La de otro
 * grupo responde 404, como la que no existe. Con más de una publicación hay
 * página siguiente, para que se vea "Cargar más". */
async function stubNewsReads(
  page: Page,
  posts: readonly unknown[],
  pinned: unknown = null,
): Promise<void> {
  await stubNewsCovers(page);
  await page.route(
    (url) => url.pathname === NEWS_FEED_ENDPOINT,
    (route) =>
      route.fulfill(
        jsonBody({
          pinned,
          posts,
          nextCursor: posts.length > 1 ? "pagina-2" : null,
          seenAt: STUBBED_NEWS_SEEN_AT,
        }),
      ),
  );
  await page.route(
    (url) => url.pathname.startsWith(`${NEWS_FEED_ENDPOINT}/`),
    (route, request) => {
      const { pathname } = new URL(request.url());
      const known = STUBBED_POSTS.find((post) => pathname.endsWith(post.id));
      if (known !== undefined) {
        return route.fulfill(jsonBody(known));
      }
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "not_found", message: "La publicación no existe." },
        }),
      });
    },
  );
}

type NewsState = {
  readonly name: string;
  readonly path: string;
  readonly feed: readonly unknown[];
  /** La fijada vigente del feed (#592), si la hay. */
  readonly pinned?: unknown;
  readonly heading: RegExp;
  readonly beforeVisit?: (page: Page) => Promise<void>;
  /** Lo que tiene que estar a la vista para que la pantalla haya cargado. */
  readonly ready: (page: Page) => Promise<void>;
};

async function waitForFeedRows(page: Page): Promise<void> {
  await expect(
    page.getByRole("link", { name: STUBBED_FEED_POSTS[0].title }),
  ).toBeVisible();
}

async function waitForPinnedFeed(page: Page): Promise<void> {
  await expect(
    page.getByRole("link", { name: STUBBED_PINNED_POST.title }),
  ).toBeVisible();
}

async function waitForEmptyFeed(page: Page): Promise<void> {
  await expect(
    page.getByText(/Nothing has been published|Todavía no hay nada publicado/),
  ).toBeVisible();
}

async function waitForPost(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(/^$/);
  await expect(
    page.getByText(/Loading the post|Cargando la publicación/),
  ).toHaveCount(0);
}

const MORE_ACTIONS_BUTTON = /^(More actions|Más acciones)$/;
const DESKTOP_MIN_WIDTH_PX = 768;

/** Por debajo de 768 px las acciones viven en la hoja ⋯ de la barra (#601). */
function isPhoneViewport(page: Page): boolean {
  const width = page.viewportSize()?.width;
  if (width === undefined) {
    throw new Error("La página no tiene un tamaño de ventana fijo.");
  }
  return width < DESKTOP_MIN_WIDTH_PX;
}

/** La de quien mira, con sus acciones (#331): en la línea del autor, o en
 * el móvil tras el ⋯. */
async function waitForManagedPost(page: Page): Promise<void> {
  await waitForPost(page);
  await expect(
    isPhoneViewport(page)
      ? page.getByRole("button", { name: MORE_ACTIONS_BUTTON })
      : page.getByRole("link", { name: /^(Edit|Editar)$/ }),
  ).toBeVisible();
}

const WITHDRAW_BUTTON = /^(Withdraw|Retirar)$/;
const WITHDRAW_QUESTION = /^(Withdraw this post\?|¿Retirar esta publicación\?)/;

/** Cuántas veces se alarga la ventana antes de rendirse. */
const MAX_VIEWPORT_FITS = 5;

/** Lecturas iguales seguidas para dar por quieta la altura de la página. */
const STABLE_HEIGHT_READINGS = 5;

/** Cada cuánto se vuelve a leer la altura mientras se mueve. */
const HEIGHT_READING_INTERVAL_MS = 100;

/**
 * La altura de la página cuando deja de moverse. Justo después de alargar la
 * ventana la página puede medir de más un instante, y la ventana sólo crece:
 * con `min-height: 100vh` ese pico se queda como hueco al pie de la captura
 * (#835, `perfil-con-foto` en el móvil salía 12 px más alta unas veces sí y
 * otras no).
 */
async function settledPageHeight(page: Page): Promise<number> {
  let readings: readonly number[] = [];
  await expect
    .poll(
      async () => {
        const height = await page.evaluate(
          () => document.documentElement.scrollHeight,
        );
        readings = [...readings, height].slice(-STABLE_HEIGHT_READINGS);
        return (
          readings.length === STABLE_HEIGHT_READINGS &&
          readings.every((reading) => reading === height)
        );
      },
      { intervals: [HEIGHT_READING_INTERVAL_MS] },
    )
    .toBe(true);
  const settled = readings.at(-1);
  if (settled === undefined) {
    throw new Error("No se llegó a leer la altura de la página.");
  }
  return settled;
}

/**
 * Alarga la ventana hasta que quepa la página entera, sin tocar su ancho.
 *
 * Cuando la página no cabe, la captura de página entera de Chromium
 * (`captureBeyondViewport`) deja la ventana en 1×1 durante un instante (#675).
 * Ahí `(width < 768px)` se cumple, `useIsPhone` pasa a móvil y las acciones
 * de la línea del autor se desmontan: vuelven en reposo, sin lo que se había
 * abierto. Si la página ya cabe, Playwright captura sin ese truco.
 *
 * Alargar la ventana puede alargar la página: el panel del calendario mide
 * según la ventana (#656). Por eso se repite hasta que cabe.
 */
async function fitViewportToPage(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error("La página no tiene un tamaño de ventana fijo.");
  }
  let height = viewport.height;
  for (let attempt = 0; attempt < MAX_VIEWPORT_FITS; attempt += 1) {
    const pageHeight = await settledPageHeight(page);
    if (pageHeight <= height) {
      return;
    }
    height = pageHeight;
    await page.setViewportSize({ width: viewport.width, height });
  }
  throw new Error(
    `La página sigue creciendo tras alargar la ventana ${MAX_VIEWPORT_FITS} veces.`,
  );
}

async function openWithdrawConfirmation(page: Page): Promise<void> {
  await waitForManagedPost(page);
  if (isPhoneViewport(page)) {
    await page.getByRole("button", { name: MORE_ACTIONS_BUTTON }).click();
  }
  await page.getByRole("button", { name: WITHDRAW_BUTTON }).click();
  await expect(page.getByText(WITHDRAW_QUESTION)).toBeVisible();
  // En el móvil la ventana de 1×1 sigue siendo de móvil: la hoja no se cierra.
  if (!isPhoneViewport(page)) {
    await fitViewportToPage(page);
    await expect(page.getByText(WITHDRAW_QUESTION)).toBeVisible();
  }
}

const FEED_HEADING = /Club feed|Novedades del club/;
const postPath = (id: string): string => `${NEWS_SCREEN_PATH}/${id}`;

/** Sin fijada: la más reciente es la destacada y el resto, "Anteriores". */
const FEED_WITH_POSTS: NewsState = {
  name: "noticias-sin-fijar",
  path: NEWS_SCREEN_PATH,
  feed: STUBBED_FEED_POSTS,
  heading: FEED_HEADING,
  ready: waitForFeedRows,
};

/** Con fijada: ella es la destacada y la lista, "Lo último". */
const FEED_WITH_PINNED: NewsState = {
  name: "noticias-fijada",
  path: NEWS_SCREEN_PATH,
  feed: STUBBED_FEED_POSTS,
  pinned: STUBBED_PINNED_POST,
  heading: FEED_HEADING,
  ready: waitForPinnedFeed,
};

const POST_WITH_ATTACHMENTS: NewsState = {
  name: "publicacion-con-adjuntos",
  path: postPath(NEWS_POST_ID),
  feed: [],
  heading: new RegExp(STUBBED_POST.title),
  ready: waitForPost,
};

const NEWS_STATES: readonly NewsState[] = [
  FEED_WITH_POSTS,
  {
    name: "noticias-sin-fijar-es",
    path: NEWS_SCREEN_PATH,
    feed: STUBBED_FEED_POSTS,
    heading: FEED_HEADING,
    beforeVisit: chooseSpanish,
    ready: waitForFeedRows,
  },
  FEED_WITH_PINNED,
  {
    name: "noticias-fijada-es",
    path: NEWS_SCREEN_PATH,
    feed: STUBBED_FEED_POSTS,
    pinned: STUBBED_PINNED_POST,
    heading: FEED_HEADING,
    beforeVisit: chooseSpanish,
    ready: waitForPinnedFeed,
  },
  {
    name: "noticias-una",
    path: NEWS_SCREEN_PATH,
    feed: STUBBED_FEED_POSTS.slice(0, 1),
    heading: FEED_HEADING,
    ready: waitForFeedRows,
  },
  {
    name: "noticias-vacio",
    path: NEWS_SCREEN_PATH,
    feed: [],
    heading: FEED_HEADING,
    ready: waitForEmptyFeed,
  },
  {
    name: "noticias-vacio-es",
    path: NEWS_SCREEN_PATH,
    feed: [],
    heading: FEED_HEADING,
    beforeVisit: chooseSpanish,
    ready: waitForEmptyFeed,
  },
  POST_WITH_ATTACHMENTS,
  {
    name: "publicacion-con-adjuntos-es",
    path: postPath(NEWS_POST_ID),
    feed: [],
    heading: new RegExp(STUBBED_POST.title),
    beforeVisit: chooseSpanish,
    ready: waitForPost,
  },
  {
    name: "publicacion-sin-adjuntos",
    path: postPath(NEWS_POST_WITHOUT_ATTACHMENTS_ID),
    feed: [],
    heading: new RegExp(STUBBED_POST_WITHOUT_ATTACHMENTS.title),
    ready: waitForPost,
  },
  {
    name: "publicacion-no-existe",
    path: postPath(NEWS_FOREIGN_POST_ID),
    feed: [],
    heading: /This post doesn't exist/,
    ready: waitForPost,
  },
  {
    name: "publicacion-editada-propia",
    path: postPath(NEWS_OWN_POST_ID),
    feed: [],
    heading: new RegExp(STUBBED_OWN_POST.title),
    ready: waitForManagedPost,
  },
  {
    name: "publicacion-retirar-confirmacion",
    path: postPath(NEWS_OWN_POST_ID),
    feed: [],
    heading: new RegExp(STUBBED_OWN_POST.title),
    ready: openWithdrawConfirmation,
  },
  {
    name: "publicacion-retirar-confirmacion-es",
    path: postPath(NEWS_OWN_POST_ID),
    feed: [],
    heading: new RegExp(STUBBED_OWN_POST.title),
    beforeVisit: chooseSpanish,
    ready: openWithdrawConfirmation,
  },
  {
    name: "publicacion-retirada-propia",
    path: postPath(NEWS_OWN_WITHDRAWN_POST_ID),
    feed: [],
    heading: new RegExp(STUBBED_OWN_WITHDRAWN_POST.title),
    ready: waitForManagedPost,
  },
  {
    name: "noticias-con-retirada",
    path: NEWS_SCREEN_PATH,
    feed: STUBBED_FEED_WITH_WITHDRAWN,
    heading: FEED_HEADING,
    ready: waitForFeedRows,
  },
];

async function goToNews(
  page: Page,
  state: NewsState,
  theme?: (typeof themes)[number],
): Promise<void> {
  await stubNewsReads(page, state.feed, state.pinned);
  await state.beforeVisit?.(page);
  if (theme === undefined) {
    await page.goto(`${APP_URL}${state.path}`);
  } else {
    await goToWithTheme(page, state.path, theme);
  }
  await expect(
    page.getByRole("heading", { level: 1, name: state.heading }),
  ).toBeVisible();
  await state.ready(page);
}

for (const state of NEWS_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToNews(page, state, theme);
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }
      });
    }

    for (const width of NEWS_NARROW_WIDTHS) {
      test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 812 });
        await goToNews(page, state);
        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await goToNews(page, state);
      await expectNoAxeViolations(page);
    });
  });
}

// #596: la publicación abierta del diseño 1c. Se fotografía a 1440 y 768 en
// los dos temas, y en los dos se mira axe y el scroll horizontal. A 375 la
// barra del móvil llega con el #601: hasta entonces, axe, sin scroll y cada
// control táctil de al menos 44 px.
const OPEN_POST_STATES = [
  { name: "noticia-abierta", post: STUBBED_OPEN_POST },
  { name: "noticia-sin-portada", post: STUBBED_NO_COVER_POST },
  { name: "noticia-retirada", post: STUBBED_WITHDRAWN_OPEN_POST },
] as const;

const OPEN_POST_VIEWPORTS = viewports.filter((vp) => vp.name !== "mobile");
const MOBILE_VIEWPORT = { width: 375, height: 812 } as const;
const MIN_TOUCH_TARGET_PX = 44;

function openPostState(state: (typeof OPEN_POST_STATES)[number]): NewsState {
  return {
    name: state.name,
    path: postPath(state.post.id),
    feed: [],
    heading: new RegExp(state.post.title),
    ready: waitForPost,
  };
}

/** Los controles de la publicación: volver, Editar y Retirar, y cada
 * adjunto. Los enlaces dentro del texto del cuerpo quedan fuera: son parte
 * de una frase (la excepción "inline" de WCAG 2.5.8). */
function touchControlsOf(page: Page): Locator {
  const screen = page.locator(".news-post-screen");
  return screen
    .getByRole("button")
    .or(screen.getByRole("link", { name: /Back to News|Volver a Noticias/ }))
    .or(screen.getByRole("link", { name: /^(Edit|Editar)$/ }));
}

for (const openState of OPEN_POST_STATES) {
  const state = openPostState(openState);
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of OPEN_POST_VIEWPORTS) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        for (const theme of themes) {
          test(`matches approved baseline (${theme})`, async ({ page }) => {
            await goToNews(page, state, theme);
            const snapshot = `${state.name}-${vp.name}-${theme}.png`;
            await createMissingLocalBaseline(snapshot, () =>
              page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
            );
            await expect(page).toHaveScreenshot(snapshot, {
              ...SCREENSHOT_OPTIONS,
              fullPage: true,
              maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
            });
          });

          test(`has no accessibility violations (axe-core, ${theme})`, async ({
            page,
          }) => {
            await goToNews(page, state, theme);
            await expectNoAxeViolations(page);
          });

          test(`has no horizontal scroll (${theme})`, async ({ page }) => {
            await goToNews(page, state, theme);
            expect(await hasHorizontalScroll(page)).toBe(false);
          });
        }
      });
    }

    test.describe("@ 375px", () => {
      test.use({ viewport: MOBILE_VIEWPORT });

      test("has no accessibility violations (axe-core)", async ({ page }) => {
        await goToNews(page, state);
        await expectNoAxeViolations(page);
      });

      test("has no horizontal scroll", async ({ page }) => {
        await goToNews(page, state);
        expect(await hasHorizontalScroll(page)).toBe(false);
      });

      test("every touch control is at least 44px", async ({ page }) => {
        await goToNews(page, state);
        const controls = await touchControlsOf(page).all();
        expect(controls.length).toBeGreaterThan(0);
        for (const control of controls) {
          const box = await control.boundingBox();
          expect(box?.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
          expect(box?.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
        }
      });
    });
  });
}

// #603: las imágenes del cuerpo, a 1440 y a 375 en los dos temas. La
// dirección estable de la API se sirve aquí con los bytes ya reducidos: la
// redirección a la firmada la prueba la integración.
const IMAGE_POST_STATE = "noticia-con-imagen";
const IMAGE_POST_VIEWPORTS = viewports.filter((vp) => vp.name !== "tablet");

async function stubInlineImages(page: Page): Promise<void> {
  const images = new Map([
    [STUBBED_IMAGE_ID, LARGE_PHOTO_FIXTURES.landscape],
    [STUBBED_UNCAPTIONED_IMAGE_ID, LARGE_PHOTO_FIXTURES.portrait],
  ]);
  for (const [imageId, fixture] of images) {
    const shrunk = await shrinkNewsInlineImage(readFileSync(fixture));
    if (shrunk.kind !== "shrunk") {
      throw new Error("La imagen fija no se pudo reducir.");
    }
    await page.route(
      (url) => url.pathname === `/api/v1/news/images/${imageId}`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "image/webp",
          body: Buffer.from(shrunk.image),
        }),
    );
  }
}

/** Las dos imágenes ya pintadas: sin esto la captura sale con el hueco. Son
 * perezosas, así que hay que llegar hasta ellas, y luego volver arriba para
 * que la barra del móvil salga en su sitio. */
async function waitForInlineImages(page: Page): Promise<void> {
  await waitForManagedPost(page);
  const images = page.locator(".news-body-image img");
  await expect(images).toHaveCount(2);
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => element.naturalWidth),
      )
      .toBeGreaterThan(0);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

const IMAGE_POST: NewsState = {
  name: IMAGE_POST_STATE,
  path: postPath(STUBBED_IMAGE_POST.id),
  feed: [],
  heading: new RegExp(STUBBED_IMAGE_POST.title),
  beforeVisit: stubInlineImages,
  ready: waitForInlineImages,
};

test.describe(IMAGE_POST_STATE, () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  for (const vp of IMAGE_POST_VIEWPORTS) {
    test.describe(`@ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const theme of themes) {
        test(`matches approved baseline (${theme})`, async ({ page }) => {
          await goToNews(page, IMAGE_POST, theme);
          // En el móvil la barra de pestañas es fija y en una captura de
          // página entera taparía la foto: se fotografía la pantalla con la
          // primera imagen en medio, como la ve quien lee.
          const fullPage = vp.name !== "mobile";
          if (!fullPage) {
            await page
              .locator(".news-body-image")
              .first()
              .evaluate((element) =>
                element.scrollIntoView({ block: "center" }),
              );
          }
          const snapshot = `${IMAGE_POST_STATE}-${vp.name}-${theme}.png`;
          await createMissingLocalBaseline(snapshot, () =>
            page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage }),
          );
          await expect(page).toHaveScreenshot(snapshot, {
            ...SCREENSHOT_OPTIONS,
            fullPage,
            maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
          });
        });

        test(`has no accessibility violations (axe-core, ${theme})`, async ({
          page,
        }) => {
          await goToNews(page, IMAGE_POST, theme);
          await expectNoAxeViolations(page);
        });
      }

      test("the image fills the column and its caption sits under it", async ({
        page,
      }) => {
        await goToNews(page, IMAGE_POST);
        const column = await page.locator(".news-markdown").boundingBox();
        const image = page.getByRole("img", {
          name: "The squad after the final",
        });
        const box = await image.boundingBox();
        expect(box?.width).toBeCloseTo(column?.width ?? 0, 0);
        expect(box?.height).toBe(vp.name === "mobile" ? 200 : 300);
        await expect(
          page.locator(".news-body-image-caption").first(),
        ).toHaveText("The squad after the final");
      });
    });
  }
});

// #601: la publicación en el móvil, con su barra y con la hoja ⋯ abierta
// (docs/mockups/mobile-news-redesign-post-dark.png y
// mobile-news-redesign-post-actions-dark.png). Sólo a 375: desde 768 manda
// el escritorio, que fotografía el bloque de arriba.
const MOBILE_POST_STATE = "noticia-movil";
const MOBILE_POST_ACTIONS_STATE = "noticia-movil-acciones";
const MOBILE_NARROW_WIDTHS = [320, 375] as const;
const SCROLL_BEFORE_BAR_CHECK_PX = 600;

const MOBILE_POST: NewsState = {
  name: MOBILE_POST_STATE,
  path: postPath(STUBBED_MOBILE_POST.id),
  feed: [],
  heading: new RegExp(STUBBED_MOBILE_POST.title),
  ready: waitForManagedPost,
};

async function openMoreActionsSheet(
  page: Page,
  theme?: (typeof themes)[number],
): Promise<void> {
  await goToNews(page, MOBILE_POST, theme);
  await page.getByRole("button", { name: MORE_ACTIONS_BUTTON }).click();
  await expect(
    page.getByRole("dialog", {
      name: /^(Post actions|Acciones de la publicación)$/,
    }),
  ).toBeVisible();
}

const MOBILE_POST_CAPTURES = [
  {
    name: MOBILE_POST_STATE,
    open: (page: Page, theme?: (typeof themes)[number]) =>
      goToNews(page, MOBILE_POST, theme),
  },
  { name: MOBILE_POST_ACTIONS_STATE, open: openMoreActionsSheet },
] as const;

for (const capture of MOBILE_POST_CAPTURES) {
  test.describe(capture.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE, viewport: MOBILE_VIEWPORT });

    for (const theme of themes) {
      test(`matches approved baseline (${theme})`, async ({ page }) => {
        await capture.open(page, theme);
        const snapshot = `${capture.name}-mobile-${theme}.png`;
        await createMissingLocalBaseline(snapshot, () =>
          page.screenshot(SCREENSHOT_OPTIONS),
        );
        await expect(page).toHaveScreenshot(snapshot, {
          ...SCREENSHOT_OPTIONS,
          maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
        });
      });

      test(`has no accessibility violations (axe-core, ${theme})`, async ({
        page,
      }) => {
        await capture.open(page, theme);
        await expectNoAxeViolations(page);
      });
    }

    for (const width of MOBILE_NARROW_WIDTHS) {
      test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ ...MOBILE_VIEWPORT, width });
        await capture.open(page);
        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    }
  });
}

test.describe(`${MOBILE_POST_STATE}: la barra`, () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE, viewport: MOBILE_VIEWPORT });

  test("se queda arriba al hacer scroll", async ({ page }) => {
    await goToNews(page, MOBILE_POST);
    const bar = page.getByRole("navigation", { name: /^(Post|Publicación)$/ });

    await page.mouse.wheel(0, SCROLL_BEFORE_BAR_CHECK_PX);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);

    const box = await bar.boundingBox();
    expect(box?.y).toBe(0);
    await expect(bar).toBeInViewport();
  });

  test("volver y ⋯ miden 44 px", async ({ page }) => {
    await goToNews(page, MOBILE_POST);
    const bar = page.getByRole("navigation", { name: /^(Post|Publicación)$/ });

    for (const control of [
      bar.getByRole("link", { name: /^(Back to News|Volver a Noticias)$/ }),
      bar.getByRole("button", { name: MORE_ACTIONS_BUTTON }),
    ]) {
      const box = await control.boundingBox();
      expect(box?.width).toBe(MIN_TOUCH_TARGET_PX);
      expect(box?.height).toBe(MIN_TOUCH_TARGET_PX);
    }
  });

  test("en 768 px no hay barra: manda el escritorio", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await goToNews(page, MOBILE_POST);

    await expect(
      page.getByRole("navigation", { name: /^(Post|Publicación)$/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /^(Edit|Editar)$/ }),
    ).toBeVisible();
  });
});

// #590: la etiqueta Document pasa al verde; su contraste se mira en los dos
// temas, no solo en el que trae el navegador.
test.describe("etiquetas de categoría del feed", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  for (const theme of themes) {
    test(`has no accessibility violations (axe-core, ${theme})`, async ({
      page,
    }) => {
      await goToNews(page, FEED_WITH_POSTS, theme);
      await expectNoAxeViolations(page);
    });

    // #594: la destacada fijada lleva su borde y su chincheta en el acento.
    test(`la fijada no tiene violaciones de accesibilidad (axe-core, ${theme})`, async ({
      page,
    }) => {
      await goToNews(page, FEED_WITH_PINNED, theme);
      await expectNoAxeViolations(page);
    });

    test(`la fijada no tiene scroll horizontal a 768 px (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await goToNews(page, FEED_WITH_PINNED, theme);
      expect(await hasHorizontalScroll(page)).toBe(false);
    });
  }
});

// #595: la tira de duración abierta bajo una fila, con otra ya fijada (como
// `news-redesign-feed-pin-duration-dark.png`). La chincheta de la fila sólo
// existe desde 768 px: en el móvil se fija desde la hoja ⋯ (#601).
const PIN_STRIP_STATE = "noticias-tira-fijar";
const PIN_STRIP_VIEWPORTS = viewports.filter((vp) => vp.name !== "mobile");

async function openPinStrip(
  page: Page,
  theme?: (typeof themes)[number],
): Promise<void> {
  await goToNews(page, FEED_WITH_PINNED, theme);
  const title = STUBBED_FEED_POSTS[1].title;
  await page
    .getByRole("button", { name: new RegExp(`^(Pin|Fijar) ${title}$`) })
    .click();
  await expect(
    page.getByRole("group", {
      name: /^(Pin to the top for|Fijar arriba durante)$/,
    }),
  ).toBeVisible();
}

test.describe(PIN_STRIP_STATE, () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  for (const vp of PIN_STRIP_VIEWPORTS) {
    test.describe(`@ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const theme of themes) {
        test(`matches approved baseline (${theme})`, async ({ page }) => {
          await openPinStrip(page, theme);
          const snapshot = `${PIN_STRIP_STATE}-${vp.name}-${theme}.png`;
          await createMissingLocalBaseline(snapshot, () =>
            page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
          );
          await expect(page).toHaveScreenshot(snapshot, {
            ...SCREENSHOT_OPTIONS,
            fullPage: true,
            maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
          });
        });
      }
    });
  }

  for (const theme of themes) {
    test(`has no accessibility violations (axe-core, ${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openPinStrip(page, theme);
      await expectNoAxeViolations(page);
    });
  }

  test("has no horizontal scroll at 768px", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openPinStrip(page);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
});

test.describe("noticias en el navegador", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("a 375px ninguna palabra del feed se parte entre dos líneas", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToNews(page, FEED_WITH_POSTS);

    // Cada palabra, medida con un Range: si ocupa más de un rectángulo, el
    // navegador la partió al final de una línea.
    const splitWords = await page.evaluate(() => {
      const list = document.querySelector("ul[aria-labelledby]");
      if (list === null) {
        throw new Error("No está la lista del feed.");
      }
      const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT);
      const split: string[] = [];
      for (
        let node = walker.nextNode();
        node !== null;
        node = walker.nextNode()
      ) {
        // El extracto va en una línea cortada con puntos suspensivos (#594):
        // un texto que no puede saltar de línea no parte ninguna palabra, y
        // Chromium cuenta aparte el trozo que esconde el corte.
        const parent = node.parentElement;
        if (
          parent !== null &&
          getComputedStyle(parent).whiteSpace === "nowrap"
        ) {
          continue;
        }
        const text = node.textContent ?? "";
        for (const match of text.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          if (range.getClientRects().length > 1) {
            split.push(match[0]);
          }
        }
      }
      return split;
    });

    expect(splitWords).toEqual([]);
  });

  test("el cuerpo respeta los saltos de línea y enseña el HTML como texto", async ({
    page,
  }) => {
    await goToNews(page, POST_WITH_ATTACHMENTS);

    await expect(page.getByText("<b>Bring fins.</b>")).toBeVisible();
    await expect(page.locator("article b")).toHaveCount(0);
    // "Final" empieza tras un salto y "Training" tras una línea en blanco.
    // Sólo con los saltos respetados queda entre las dos un renglón vacío:
    // colapsados, "Training" iría en la misma línea o en la siguiente.
    // El cuerpo es Markdown (#596): cada palabra se busca en todos sus nodos
    // de texto, porque el salto y la línea en blanco los parten.
    const layout = await page
      .locator("article .news-markdown")
      .evaluate((body) => {
        const wordRect = (word: string): DOMRect => {
          const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const start = (node.textContent ?? "").indexOf(word);
            if (start === -1) continue;
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + word.length);
            return range.getBoundingClientRect();
          }
          throw new Error(`El cuerpo no contiene "${word}".`);
        };
        return {
          bodyLeft: body.getBoundingClientRect().left,
          lineHeight: parseFloat(getComputedStyle(body).lineHeight),
          final: wordRect("Final"),
          training: wordRect("Training"),
          brisbane: wordRect("Brisbane."),
        };
      });
    expect(Math.round(layout.final.left)).toBe(Math.round(layout.bodyLeft));
    expect(layout.final.top).toBeGreaterThan(layout.brisbane.top);
    expect(layout.training.top - layout.final.top).toBeGreaterThanOrEqual(
      1.5 * layout.lineHeight,
    );
  });

  test("pulsar un adjunto pide su dirección firmada y navega a ella", async ({
    page,
  }) => {
    const signedUrl = "https://archivos.test/reglamento.pdf?token=firmado";
    await page.route(signedUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: "%PDF",
      }),
    );
    await goToNews(page, POST_WITH_ATTACHMENTS);
    await page.route(
      (url) => url.pathname.includes("/attachments/"),
      (route) =>
        route.fulfill(
          jsonBody({
            status: "available",
            fileName: STUBBED_POST.attachments[0].fileName,
            url: signedUrl,
          }),
        ),
    );

    const requested = page.waitForRequest(signedUrl);
    await page
      .getByRole("button", { name: /Download reglamento-seleccion-nacional/ })
      .click();

    expect((await requested).url()).toBe(signedUrl);
  });

  test("cargar más añade la página siguiente debajo sin mover lo que ya se leía", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToNews(page, FEED_WITH_POSTS);
    // La ruta que se registra después gana: la segunda página es otra.
    await page.route(
      (url) => url.pathname === NEWS_FEED_ENDPOINT,
      (route) =>
        route.fulfill(
          jsonBody({
            pinned: null,
            posts: [
              {
                ...STUBBED_FEED_POSTS[2],
                id: "a0a0a0a0-0000-4000-8000-0000000000b1",
                title: "Geelong friendly match recap",
              },
            ],
            nextCursor: null,
            seenAt: STUBBED_NEWS_SEEN_AT,
          }),
        ),
    );
    await page.getByRole("button", { name: "Load more" }).click();

    await expect(
      page.getByRole("link", { name: "Geelong friendly match recap" }),
    ).toBeFocused();
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(
      0,
    );
    // La primera sigue arriba como destacada (#594); la lista no la repite.
    const titles = await page
      .getByRole("list", { name: /^(Earlier|Anteriores)$/ })
      .getByRole("link")
      .allTextContents();
    expect(titles).toEqual([
      ...STUBBED_FEED_POSTS.slice(1).map((post) => post.title),
      "Geelong friendly match recap",
    ]);
  });

  test("a 375px el feed con fijada no tiene violaciones de accesibilidad (axe-core)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToNews(page, FEED_WITH_PINNED);
    await expectNoAxeViolations(page);
  });

  // #594 y D11 del PRD de E22: antes del feed móvil (#600), a 375 px cada
  // control del feed se sigue pulsando con el dedo. La tarjeta y cada fila se
  // pulsan enteras porque el enlace del título las cubre.
  test("a 375px cada control táctil del feed llega a 44 px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToNews(page, FEED_WITH_PINNED);

    const cards = [
      page.getByRole("article", { name: STUBBED_PINNED_POST.title }),
      ...STUBBED_FEED_POSTS.map((post) =>
        page.getByRole("listitem").filter({
          has: page.getByRole("link", { name: post.title }),
        }),
      ),
    ];
    for (const card of cards) {
      // Un punto junto a la esquina, lejos del título, abre la publicación.
      // No en la misma esquina: la tarjeta tiene el borde redondeado. Todo en
      // un paso: `elementFromPoint` sólo ve lo que está en la ventana, y el
      // scroll suave movería la tarjeta entre medir y apuntar.
      const target = await card.evaluate((element, inset) => {
        element.scrollIntoView({ block: "center", behavior: "instant" });
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + inset,
          box.bottom - inset,
        );
        return {
          height: box.height,
          opensPost: hit?.closest("a") !== null && element.contains(hit),
        };
      }, CARD_CORNER_INSET_PX);
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.opensPost).toBe(true);
    }
    for (const control of [
      page.getByRole("link", { name: /^(Publish|Publicar)$/ }),
      page.getByRole("button", { name: "Load more" }),
    ]) {
      expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
  });
});

// #600: el feed por debajo de 768 px, "#2c Feed" del handoff de E22
// (docs/mockups/mobile-news-redesign-feed-dark.png). Se fotografía a 375 con
// y sin fijada, en los dos temas; quien mira es Admin, que en el escritorio
// tendría chincheta en cada fila y botones de fijar en la destacada.
const MOBILE_FEED_STATES = [
  { ...FEED_WITH_PINNED, name: "noticias-movil-fijada" },
  { ...FEED_WITH_POSTS, name: "noticias-movil-sin-fijar" },
] as const;
const MOBILE_FEED_WIDTHS = [320, 375] as const;
const PUBLISH_LINK = /^(Publish|Publicar)$/;
const PIN_BUTTON = /^(Pin|Fijar|Unpin|Desfijar)\b/;

for (const state of MOBILE_FEED_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE, viewport: MOBILE_VIEWPORT });

    for (const theme of themes) {
      test(`matches approved baseline (${theme})`, async ({ page }) => {
        await goToNews(page, state, theme);
        const snapshot = `${state.name}-mobile-${theme}.png`;
        await createMissingLocalBaseline(snapshot, () =>
          page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
        );
        await expect(page).toHaveScreenshot(snapshot, {
          ...SCREENSHOT_OPTIONS,
          fullPage: true,
          maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
        });
      });

      test(`has no accessibility violations (axe-core, ${theme})`, async ({
        page,
      }) => {
        await goToNews(page, state, theme);
        await expectNoAxeViolations(page);
      });
    }

    for (const width of MOBILE_FEED_WIDTHS) {
      test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: MOBILE_VIEWPORT.height });
        await goToNews(page, state);
        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    }

    test("publicar es un botón de icono de 44 × 44", async ({ page }) => {
      await goToNews(page, state);

      const box = await page
        .getByRole("link", { name: PUBLISH_LINK })
        .boundingBox();
      expect(box?.width).toBe(MIN_TOUCH_TARGET_PX);
      expect(box?.height).toBe(MIN_TOUCH_TARGET_PX);
    });

    test("ni las filas ni la destacada llevan botones de fijar", async ({
      page,
    }) => {
      await goToNews(page, state);

      await expect(page.getByRole("button", { name: PIN_BUTTON })).toHaveCount(
        0,
      );
    });

    test("cargar más ocupa el ancho de la lista y mide 46 px", async ({
      page,
    }) => {
      await goToNews(page, state);

      const button = await page
        .getByRole("button", { name: "Load more" })
        .boundingBox();
      const list = await page.locator(".news-featured").boundingBox();
      expect(button?.height).toBe(46);
      expect(button?.width).toBe(list?.width);
    });
  });
}

test.describe("noticias-movil-fijada en el navegador", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE, viewport: MOBILE_VIEWPORT });

  test("la píldora Fijada no intercepta el toque: abre la publicación", async ({
    page,
  }) => {
    await goToNews(page, FEED_WITH_PINNED);
    const pill = page.locator(".news-featured-pill");
    await expect(pill).toBeVisible();

    await pill.click({ force: true });

    await expect(page).toHaveURL(
      new RegExp(`${postPath(STUBBED_PINNED_POST.id)}$`),
    );
  });

  test("las filas no llevan extracto y la destacada sí", async ({ page }) => {
    await goToNews(page, FEED_WITH_PINNED);

    await expect(page.getByText(STUBBED_PINNED_POST.excerpt)).toBeVisible();
    for (const post of STUBBED_FEED_POSTS) {
      await expect(page.getByText(post.excerpt)).toBeHidden();
    }
  });
});

test.describe("a 768 px el feed sigue siendo el de escritorio (#600)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: ADMIN_STORAGE_STATE,
    viewport: { width: 768, height: 1024 },
  });

  test("sin píldora, con extracto en las filas y Publicar escrito", async ({
    page,
  }) => {
    await goToNews(page, FEED_WITH_PINNED);

    await expect(page.locator(".news-featured-pill")).toBeHidden();
    await expect(page.getByText(STUBBED_FEED_POSTS[0].excerpt)).toBeVisible();
    await expect(page.getByRole("link", { name: PUBLISH_LINK })).toContainText(
      "+ Publish",
    );
  });
});

/* ---------------------------------------------------------------------------
   Publicar en Noticias (#330), rehecho en E22 (#597) según
   docs/mockups/news-redesign-publish-write-dark.png: portada, categoría
   segmentada, título con contador, cuerpo, audiencia y adjuntos. El botón que
   lo abre sale en docs/mockups/news-light.png, en la cabecera del feed.

   Se fotografía a 768 y 1440. A 375 se comprueban axe y el scroll
   horizontal de cada estado; el móvil (#602) se fotografía más abajo, en
   los dos estados de sus mockups.

   Los grupos, las subidas y publicar se sirven con `page.route`: así las
   capturas no dependen de los grupos que haya en la base, y ninguna subida
   de prueba acaba en el almacenamiento. Lo que los endpoints hacen de verdad
   se prueba aparte, contra seadragons-dev (#330).
   --------------------------------------------------------------------------- */

const NEWS_PUBLISH_SCREEN_PATH = "/noticias/publicar";
const NEWS_PUBLISH_ENDPOINT = "/api/v1/news/publish";
const NEWS_UPLOADS_ENDPOINT = "/api/v1/news/publish/uploads";
const PUBLISH_HEADING = /^(New post|Nueva publicación)$/;
const PUBLISH_BUTTON = /^(Publish|Publicar)$/;
const PUBLISH_GROUPS = [
  { id: "9a9a9a9a-0000-4000-8000-000000000009", name: "Senior squad" },
  { id: "8b8b8b8b-0000-4000-8000-000000000008", name: "Masters" },
  { id: "7c7c7c7c-0000-4000-8000-000000000007", name: "Juniors" },
] as const;
const PUBLISH_ATTACHMENTS = [
  { name: "reglamento-seleccion-nacional-2026.pdf", sizeBytes: 2_516_582 },
  { name: "mapa-piscina.png", sizeBytes: 245_760 },
] as const;

/** Los grupos del club y las subidas. Una subida responde con el nombre que
 * se mandó y un tamaño fijo, así la lista dice siempre lo mismo. */
async function stubPublishReads(
  page: Page,
  options: { readonly holdUploads: boolean },
): Promise<void> {
  await page.route(
    (url) => url.pathname === CLUB_GROUPS_ENDPOINT,
    (route) =>
      route.fulfill(
        jsonBody({
          groups: PUBLISH_GROUPS.map((group) => ({ ...group, memberCount: 4 })),
        }),
      ),
  );
  let uploads = 0;
  await page.route(
    (url) => url.pathname === NEWS_UPLOADS_ENDPOINT,
    async (route, request) => {
      if (options.holdUploads) {
        return; // Se queda subiendo: es el estado que se fotografía.
      }
      const fileName = new URL(request.url()).searchParams.get("name") ?? "";
      const known = PUBLISH_ATTACHMENTS.find((file) => file.name === fileName);
      uploads += 1;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: `a7a7a7a7-0000-4000-8000-${String(uploads).padStart(12, "0")}`,
            fileName,
            contentType: "application/pdf",
            sizeBytes: known?.sizeBytes ?? 1_024,
          },
        }),
      });
    },
  );
}

const PUBLISH_COVER_NAME = "portada-seleccion.png";
const COVER_PREVIEW_NAME = /^(Cover photo|Portada)$/;

/** Una portada apaisada con un degradado, para que la vista previa se lea
 * como una foto y no como un bloque de color. */
function coverPicture(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1f5f8b"/><stop offset="1" stop-color="#6fd6b4"/>
    </linearGradient></defs>
    <rect width="1200" height="600" fill="url(#g)"/>
    <circle cx="900" cy="180" r="90" fill="#f2ce78"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function choosePublishCover(page: Page): Promise<void> {
  await page
    .getByLabel(/^(Choose a cover photo|Elegir una portada)$/)
    .setInputFiles({
      name: PUBLISH_COVER_NAME,
      mimeType: "image/png",
      buffer: await coverPicture(),
    });
  await expectCoverPreviewLoaded(page);
}

/** Visible no basta para la captura: la imagen tiene que estar decodificada. */
async function expectCoverPreviewLoaded(page: Page): Promise<void> {
  const preview = page.getByRole("img", { name: COVER_PREVIEW_NAME });
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate(
        (image) => image instanceof HTMLImageElement && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
}

/** Lo que se fotografía de publicar y editar en cada estado. El móvil sólo
 * en los dos estados de sus mockups (#602), más abajo. */
const PUBLISH_PHOTO_VIEWPORTS = viewports.filter(
  (viewport) => viewport.name !== "mobile",
);

async function attachPublishFiles(page: Page): Promise<void> {
  await page.getByLabel(/^(Choose files|Elegir archivos)$/).setInputFiles(
    PUBLISH_ATTACHMENTS.map((file) => ({
      name: file.name,
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
    })),
  );
}

async function fillPublishForm(page: Page): Promise<void> {
  await page.getByRole("radio", { name: /^(Announcement|Aviso)$/ }).check();
  await page
    .getByLabel(/^(Title|Título)$/)
    .fill("Nationals squad shortlist announced for the August championships");
  await page
    .getByLabel(/^(Message|Mensaje)$/)
    .fill(
      "Twelve Seadragons named in the extended squad for the August nationals in Brisbane.\nFinal eight confirmed after trials.",
    );
  await page.getByLabel(/^(Specific groups|Grupos concretos)$/).check();
  await page.getByLabel(PUBLISH_GROUPS[0].name).check();
}

/** Un cuerpo con todo lo que pone la barra de formato (#598). */
const PUBLISH_MARKDOWN_BODY = [
  "Twelve Seadragons named in the **extended squad** for the *August nationals*.",
  "",
  "## Squad",
  "",
  "- Final eight confirmed after trials",
  "- Travel details to follow",
  "",
  "> Train hard, play fair.",
  "",
  "Read the [selection policy](https://example.com/policy).",
].join("\n");

type PublishState = {
  readonly name: string;
  readonly beforeVisit?: (page: Page) => Promise<void>;
  readonly holdUploads?: boolean;
  /** Lo que se hace en la pantalla antes de mirarla. */
  readonly prepare: (page: Page) => Promise<void>;
};

/** El día en que se aprobó la línea base de `publicar-fijando`: con dos
 * semanas, la caja dice que se desfija el 28 de octubre. */
const PIN_BASELINE_NOW = new Date("2026-10-14T02:00:00.000Z");

const PUBLISH_STATES_EN: readonly PublishState[] = [
  { name: "publicar-sin-portada", prepare: async () => undefined },
  {
    name: "publicar-con-portada",
    prepare: async (page) => {
      await fillPublishForm(page);
      await choosePublishCover(page);
    },
  },
  {
    name: "publicar-con-datos-y-adjuntos",
    prepare: async (page) => {
      await fillPublishForm(page);
      await attachPublishFiles(page);
      await expect(
        page.getByRole("button", { name: /^(Remove|Quitar) mapa-piscina/ }),
      ).toBeVisible();
    },
  },
  {
    name: "publicar-aviso-validacion",
    prepare: async (page) => {
      const title = page.getByLabel(/^(Title|Título)$/);
      await title.fill("Pool");
      await title.fill("");
      await page.getByLabel(/^(Specific groups|Grupos concretos)$/).check();
      await expect(title).toHaveAttribute("aria-invalid", "true");
      await expect(
        page.getByRole("button", { name: PUBLISH_BUTTON }),
      ).toBeDisabled();
    },
  },
  {
    name: "publicar-escribir",
    prepare: async (page) => {
      await fillPublishForm(page);
      await page.getByLabel(/^(Message|Mensaje)$/).fill(PUBLISH_MARKDOWN_BODY);
    },
  },
  {
    name: "publicar-vista-previa",
    prepare: async (page) => {
      await fillPublishForm(page);
      await page.getByLabel(/^(Message|Mensaje)$/).fill(PUBLISH_MARKDOWN_BODY);
      await page.getByRole("tab", { name: /^(Preview|Vista previa)$/ }).click();
      await expect(
        page.getByRole("heading", { level: 2, name: "Squad" }),
      ).toBeVisible();
    },
  },
  {
    // La caja de fijar encendida, como el mockup (#599).
    name: "publicar-fijando",
    prepare: async (page) => {
      // La caja dice "Se desfija sola el {fecha}", contada desde hoy: sin un
      // reloj fijo la captura cambia cada día.
      await page.clock.setFixedTime(PIN_BASELINE_NOW);
      await fillPublishForm(page);
      const pin = page.getByRole("switch", {
        name: /^(Pin to the top of the feed|Fijar arriba del feed)$/,
      });
      await pin.click();
      await expect(pin).toHaveAttribute("aria-checked", "true");
    },
  },
  {
    name: "publicar-subiendo",
    holdUploads: true,
    prepare: async (page) => {
      await fillPublishForm(page);
      await attachPublishFiles(page);
      await expect(
        page.getByText(/^(Uploading…|Subiendo…)$/).first(),
      ).toBeVisible();
    },
  },
];

const PUBLISH_STATES: readonly PublishState[] = PUBLISH_STATES_EN.flatMap(
  (state) => [
    state,
    { ...state, name: `${state.name}-es`, beforeVisit: chooseSpanish },
  ],
);

async function goToPublish(
  page: Page,
  state: PublishState,
  theme?: (typeof themes)[number],
): Promise<void> {
  // La caja de fijar del Admin (#599) lee la fijada vigente del feed: sin
  // ninguna, como el mockup, para no depender de lo que haya en la base.
  await page.route(
    (url) => url.pathname === NEWS_FEED_ENDPOINT,
    (route) =>
      route.fulfill(
        jsonBody({ pinned: null, posts: [], nextCursor: null, seenAt: null }),
      ),
  );
  await stubPublishReads(page, { holdUploads: state.holdUploads === true });
  await state.beforeVisit?.(page);
  if (theme === undefined) {
    await page.goto(`${APP_URL}${NEWS_PUBLISH_SCREEN_PATH}`);
  } else {
    await goToWithTheme(page, NEWS_PUBLISH_SCREEN_PATH, theme);
  }
  await expect(
    page.getByRole("heading", { level: 1, name: PUBLISH_HEADING }),
  ).toBeVisible();
  await expect(page.getByLabel(/^(Title|Título)$/)).toBeVisible();
  await state.prepare(page);
  // El puntero se queda donde fue el último clic (una casilla, Guardar) y
  // pinta su hover en la captura según cuánto se movió la página después.
  await page.mouse.move(0, 0);
}

for (const state of PUBLISH_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of PUBLISH_PHOTO_VIEWPORTS) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToPublish(page, state, theme);
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }
      });
    }

    for (const theme of themes) {
      for (const width of NEWS_NARROW_WIDTHS) {
        test(`has no horizontal scroll at ${width}px (${theme})`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 812 });
          await goToPublish(page, state, theme);
          expect(await hasHorizontalScroll(page)).toBe(false);
        });
      }

      for (const vp of viewports) {
        test(`has no accessibility violations at ${vp.name} (axe-core, ${theme})`, async ({
          page,
        }) => {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await goToPublish(page, state, theme);
          await expectNoAxeViolations(page);
        });
      }
    }
  });
}

test.describe("publicar en el navegador", () => {
  skipWithoutSession();
  quietNotificationBell();

  test.describe("como Admin", () => {
    test.use({ storageState: ADMIN_STORAGE_STATE });

    test("el botón del feed abre el formulario", async ({ page }) => {
      await stubNewsReads(page, STUBBED_FEED_POSTS);
      await stubPublishReads(page, { holdUploads: false });
      await page.goto(`${APP_URL}${NEWS_SCREEN_PATH}`);

      await page.getByRole("link", { name: "Publish" }).click();

      await expect(page).toHaveURL(new RegExp(`${NEWS_PUBLISH_SCREEN_PATH}$`));
      await expect(
        page.getByRole("heading", { level: 1, name: PUBLISH_HEADING }),
      ).toBeVisible();
    });

    test("el editor del cuerpo tiene las medidas del handoff (#598)", async ({
      page,
    }) => {
      await stubPublishReads(page, { holdUploads: false });
      await page.goto(`${APP_URL}${NEWS_PUBLISH_SCREEN_PATH}`);
      const editor = page.locator(".news-body-editor");
      const area = page.getByRole("textbox", { name: "Message" });
      const bold = page.getByRole("button", { name: "Bold" });

      await expect(editor).toHaveCSS("border-radius", "10px");
      await expect(page.getByRole("tab", { name: "Write" })).toHaveCSS(
        "border-bottom-width",
        "2px",
      );
      await expect(bold).toHaveCSS("width", "32px");
      await expect(bold).toHaveCSS("height", "32px");
      const touchArea = await bold.evaluate((button) => {
        const after = getComputedStyle(button, "::after");
        return (
          button.getBoundingClientRect().width -
          2 * Number.parseFloat(after.left)
        );
      });
      expect(touchArea).toBe(44);
      await expect(area).toHaveCSS("font-size", "14px");
      await expect(area).toHaveCSS("line-height", "23.8px");
      expect(
        await area.evaluate((element) => getComputedStyle(element).fontFamily),
      ).toMatch(/mono/i);
      const areaBox = await area.boundingBox();
      expect(areaBox?.height).toBeGreaterThanOrEqual(300);
    });

    test("publicar vuelve al feed sin recargar, con la publicación arriba", async ({
      page,
    }) => {
      const published = {
        ...STUBBED_FEED_POSTS[0],
        id: "a0a0a0a0-0000-4000-8000-0000000000c1",
        title: "Pool closed on Tuesday",
        publishedAt: new Date().toISOString(),
        attachmentCount: 2,
      };
      // El feed casa con todo lo que cuelga de /api/v1/news, así que va antes:
      // Playwright atiende primero la ruta registrada más tarde.
      await stubNewsReads(page, [published, ...STUBBED_FEED_POSTS]);
      await stubPublishReads(page, { holdUploads: false });
      await page.goto(`${APP_URL}${NEWS_PUBLISH_SCREEN_PATH}`);
      await page.evaluate(() => {
        (window as { sinRecargar?: boolean }).sinRecargar = true;
      });
      let sent: unknown = null;
      await page.route(
        (url) => url.pathname === NEWS_PUBLISH_ENDPOINT,
        async (route, request) => {
          sent = request.postDataJSON();
          await route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({
              data: { ...STUBBED_POST, id: published.id },
            }),
          });
        },
      );
      await fillPublishForm(page);
      await attachPublishFiles(page);
      await expect(
        page.getByRole("button", { name: /^Remove mapa-piscina/ }),
      ).toBeVisible();

      await page.getByRole("button", { name: PUBLISH_BUTTON }).click();

      await expect(page).toHaveURL(new RegExp(`${NEWS_SCREEN_PATH}$`));
      // Sin fijada, la más reciente es la tarjeta destacada (#594).
      await expect(
        page.getByRole("article", { name: published.title }),
      ).toBeVisible();
      await expect(page.getByRole("status")).toHaveText(
        `Published · we notified ${PUBLISH_GROUPS[0].name}`,
      );
      expect(
        await page.evaluate(
          () => (window as { sinRecargar?: boolean }).sinRecargar,
        ),
      ).toBe(true);
      expect(sent).toMatchObject({
        category: "announcement",
        audience: { kind: "groups", groupIds: [PUBLISH_GROUPS[0].id] },
        coverUploadId: null,
        attachmentUploadIds: [
          "a7a7a7a7-0000-4000-8000-000000000001",
          "a7a7a7a7-0000-4000-8000-000000000002",
        ],
      });
    });
  });

  test.describe("a 375 px", () => {
    test.use({
      storageState: ADMIN_STORAGE_STATE,
      viewport: { width: 375, height: 812 },
    });

    test("cada control táctil del formulario llega a 44 px", async ({
      page,
    }) => {
      await goToPublish(page, PUBLISH_STATES_EN[1] as PublishState);
      await attachPublishFiles(page);
      await expect(
        page.getByRole("button", { name: /^Remove mapa-piscina/ }),
      ).toBeVisible();
      // Lo que se dibuja más pequeño (#602) cuenta con su zona táctil.
      const controls = [
        page.getByRole("button", { name: "Cancel" }),
        page.getByRole("button", { name: PUBLISH_BUTTON }),
        page.getByRole("button", { name: "Remove cover" }),
        ...["Announcement", "News", "Document"].map((name) =>
          page.getByRole("radio", { name }),
        ),
        page.getByLabel("Title"),
        page.getByRole("tab", { name: "Write" }),
        page.getByRole("tab", { name: "Preview" }),
        page.getByRole("button", { name: "Bold" }),
        page.getByRole("switch", { name: "Pin to the top of the feed" }),
        page.getByRole("button", { name: /^Remove mapa-piscina/ }),
        page.getByRole("button", { name: "Add files" }),
        ...["The whole club", "Specific groups"].map((name) =>
          page.locator("label").filter({ hasText: name }),
        ),
        page
          .locator(".news-audience-groups .auth-consent")
          .filter({ hasText: PUBLISH_GROUPS[0].name }),
      ];
      const addCover = page.getByRole("button", { name: "Add cover photo" });

      for (const control of controls) {
        expect(await touchAreaHeight(control)).toBeGreaterThanOrEqual(
          MIN_TOUCH_TARGET_PX,
        );
      }
      await page.getByRole("button", { name: "Remove cover" }).click();
      expect(await touchAreaHeight(addCover)).toBeGreaterThanOrEqual(
        MIN_TOUCH_TARGET_PX,
      );
    });
  });

  test.describe("como Player", () => {
    test.use({ storageState: roleRequestStorageStatePath("perfil-completo") });

    test("no ve el botón de publicar, y la dirección directa lo manda al panel", async ({
      page,
    }) => {
      await stubNewsReads(page, STUBBED_FEED_POSTS);
      await page.goto(`${APP_URL}${NEWS_SCREEN_PATH}`);
      await expect(
        page.getByRole("link", { name: STUBBED_FEED_POSTS[0].title }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Publish" })).toHaveCount(0);

      await page.goto(`${APP_URL}${NEWS_PUBLISH_SCREEN_PATH}`);

      await expect(page).toHaveURL(new RegExp("/dashboard$"));
    });
  });
});

/** Lo que mide de alto la zona que se toca: la caja, o el `::after` que la
 * agranda cuando el control se dibuja más pequeño (D11 de E22). */
async function touchAreaHeight(control: Locator): Promise<number> {
  return control.evaluate((element) => {
    const { height } = element.getBoundingClientRect();
    const after = getComputedStyle(element, "::after");
    if (after.content === "none" || after.position !== "absolute") {
      return height;
    }
    return (
      height - Number.parseFloat(after.top) - Number.parseFloat(after.bottom)
    );
  });
}

/* #602: el formulario de publicar en el móvil, con su barra y el editor
   adaptado (docs/mockups/mobile-news-redesign-publish-write-dark.png y
   mobile-news-redesign-publish-preview-dark.png). Sólo a 375: desde 768
   manda el escritorio, que se fotografía arriba. */
/** Rellenar baja la página; la captura, como el mockup, se mira desde
 * arriba y sin foco en el cuerpo. */
async function backToFormTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    window.scrollTo(0, 0);
    document.querySelector("textarea")?.scrollTo(0, 0);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

const MOBILE_PUBLISH_STATES: readonly PublishState[] = [
  {
    name: "publicar-movil-escribir",
    prepare: async (page) => {
      await fillPublishForm(page);
      await page.getByLabel(/^(Message|Mensaje)$/).fill(PUBLISH_MARKDOWN_BODY);
      await backToFormTop(page);
    },
  },
  {
    name: "publicar-movil-vista-previa",
    prepare: async (page) => {
      await fillPublishForm(page);
      await page.getByLabel(/^(Message|Mensaje)$/).fill(PUBLISH_MARKDOWN_BODY);
      await page.getByRole("tab", { name: /^(Preview|Vista previa)$/ }).click();
      await expect(
        page.getByRole("heading", { level: 2, name: "Squad" }),
      ).toBeVisible();
      await backToFormTop(page);
    },
  },
];

/** Ningún segmento de la categoría parte ni corta su texto. */
async function categoryLabelsFit(page: Page): Promise<boolean> {
  return page
    .locator(".news-category-field label")
    .evaluateAll((labels) =>
      labels.every((label) => label.scrollWidth <= label.clientWidth),
    );
}

const PUBLISH_BAR_NAME = PUBLISH_HEADING;
const PUBLISH_BAR_SUBMIT_PX = 36;
const PUBLISH_TITLE_HEIGHT_PX = 48;
const PUBLISH_TOOLBAR_BUTTON_PX = 40;
const PUBLISH_MOBILE_AREA_MIN_PX = 260;

for (const state of MOBILE_PUBLISH_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE, viewport: MOBILE_VIEWPORT });

    for (const theme of themes) {
      test(`matches approved baseline (${theme})`, async ({ page }) => {
        await goToPublish(page, state, theme);
        const snapshot = `${state.name}-mobile-${theme}.png`;
        await createMissingLocalBaseline(snapshot, () =>
          page.screenshot(SCREENSHOT_OPTIONS),
        );
        await expect(page).toHaveScreenshot(snapshot, {
          ...SCREENSHOT_OPTIONS,
          maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
        });
      });

      test(`has no accessibility violations (axe-core, ${theme})`, async ({
        page,
      }) => {
        await goToPublish(page, state, theme);
        await expectNoAxeViolations(page);
      });
    }

    for (const width of MOBILE_NARROW_WIDTHS) {
      test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ ...MOBILE_VIEWPORT, width });
        await goToPublish(page, state);
        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    }
  });
}

test.describe("publicar en el móvil: la barra y las medidas (#602)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE, viewport: MOBILE_VIEWPORT });

  const writing = MOBILE_PUBLISH_STATES[0] as PublishState;

  test("la barra se queda arriba al hacer scroll", async ({ page }) => {
    await goToPublish(page, writing);
    const bar = page.getByRole("group", { name: PUBLISH_BAR_NAME });

    await page.evaluate(
      (distance) => window.scrollTo(0, distance),
      SCROLL_BEFORE_BAR_CHECK_PX,
    );
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);

    expect((await bar.boundingBox())?.y).toBe(0);
    await expect(bar.getByRole("button", { name: "Cancel" })).toBeInViewport();
    await expect(
      bar.getByRole("button", { name: PUBLISH_BUTTON }),
    ).toBeInViewport();
  });

  test("Publicar se dibuja de 36 px con 44 de zona táctil", async ({
    page,
  }) => {
    await goToPublish(page, writing);
    const submit = page
      .getByRole("group", { name: PUBLISH_BAR_NAME })
      .getByRole("button", { name: PUBLISH_BUTTON });

    expect((await submit.boundingBox())?.height).toBe(PUBLISH_BAR_SUBMIT_PX);
    expect(await touchAreaHeight(submit)).toBe(MIN_TOUCH_TARGET_PX);
  });

  test("el título mide 48 px con letra de 16", async ({ page }) => {
    await goToPublish(page, writing);
    const title = page.getByLabel("Title");

    expect((await title.boundingBox())?.height).toBe(PUBLISH_TITLE_HEIGHT_PX);
    await expect(title).toHaveCSS("font-size", "16px");
  });

  test("las pestañas ocupan el ancho y la barra de formato es su propia fila", async ({
    page,
  }) => {
    await goToPublish(page, writing);
    const editor = await page.locator(".news-body-editor").boundingBox();
    const write = await page.getByRole("tab", { name: "Write" }).boundingBox();
    const preview = await page
      .getByRole("tab", { name: "Preview" })
      .boundingBox();
    const bold = page.getByRole("button", { name: "Bold" });
    const area = await page
      .getByRole("textbox", { name: "Message" })
      .boundingBox();

    expect(write?.height).toBe(MIN_TOUCH_TARGET_PX);
    expect((write?.width ?? 0) + (preview?.width ?? 0)).toBeCloseTo(
      (editor?.width ?? 0) - 2,
      0,
    );
    expect((await bold.boundingBox())?.y).toBeGreaterThanOrEqual(
      (write?.y ?? 0) + (write?.height ?? 0),
    );
    await expect(bold).toHaveCSS("width", `${PUBLISH_TOOLBAR_BUTTON_PX}px`);
    await expect(bold).toHaveCSS("height", `${PUBLISH_TOOLBAR_BUTTON_PX}px`);
    expect(area?.height).toBeGreaterThanOrEqual(PUBLISH_MOBILE_AREA_MIN_PX);
    await expect(
      page.getByRole("button", { name: "Formatting help" }),
    ).toBeVisible();
  });

  for (const width of MOBILE_NARROW_WIDTHS) {
    test(`a ${width} px la barra de formato se desplaza de lado sin mover la página`, async ({
      page,
    }) => {
      await page.setViewportSize({ ...MOBILE_VIEWPORT, width });
      await goToPublish(page, writing);
      const toolbar = page.getByRole("group", { name: "Formatting" });
      await toolbar.scrollIntoViewIfNeeded();

      const scrolled = await toolbar.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
        return element.scrollLeft;
      });

      expect(scrolled).toBeGreaterThan(0);
      await expect(
        page.getByRole("button", { name: "Insert image" }),
      ).toBeInViewport();
      expect(await page.evaluate(() => window.scrollX)).toBe(0);
      expect(await hasHorizontalScroll(page)).toBe(false);
    });
  }

  for (const width of MOBILE_NARROW_WIDTHS) {
    test(`a ${width} px cada segmento de la categoría cabe entero`, async ({
      page,
    }) => {
      await page.setViewportSize({ ...MOBILE_VIEWPORT, width });
      await goToPublish(page, writing);

      expect(await categoryLabelsFit(page)).toBe(true);
    });
  }

  test("la portada vacía mide 140 px con el botón de 40, y con foto 180", async ({
    page,
  }) => {
    await goToPublish(page, writing);
    const addCover = page.getByRole("button", { name: "Add cover photo" });

    expect(
      (await page.locator(".news-cover-banner").boundingBox())?.height,
    ).toBe(140);
    expect((await addCover.boundingBox())?.height).toBe(40);
    await choosePublishCover(page);
    expect(
      (await page.getByRole("img", { name: COVER_PREVIEW_NAME }).boundingBox())
        ?.height,
    ).toBe(180);
    await expect(
      page.getByRole("button", { name: "Remove cover" }),
    ).toBeVisible();
  });

  test("la categoría son tres segmentos iguales de 40 px", async ({ page }) => {
    await goToPublish(page, writing);
    const boxes = await Promise.all(
      ["Announcement", "News", "Document"].map((name) =>
        page
          .locator(".news-category-field label")
          .filter({ hasText: new RegExp(`^${name}$`) })
          .boundingBox(),
      ),
    );

    for (const box of boxes) {
      expect(box?.height).toBe(40);
      expect(box?.width).toBeCloseTo(boxes[0]?.width ?? 0, 0);
    }
  });

  test("la caja de fijar lleva el interruptor de 44 × 26 a la derecha", async ({
    page,
  }) => {
    await goToPublish(page, writing);
    const pin = page.getByRole("switch", {
      name: "Pin to the top of the feed",
    });
    const label = page.getByText("Pin to the top of the feed", { exact: true });

    await pin.click();

    const pinBox = await pin.boundingBox();
    expect(pinBox?.width).toBe(44);
    expect(pinBox?.height).toBe(26);
    expect(pinBox?.x ?? 0).toBeGreaterThan((await label.boundingBox())?.x ?? 0);
    await expect(
      page.getByRole("radio", { name: /^Until I unpin/ }),
    ).toBeAttached();
    await expect(page.getByText(/^Unpins automatically on /)).toBeVisible();
  });

  test("las fichas de grupo llevan 9 × 14 px y Añadir archivos 52", async ({
    page,
  }) => {
    await goToPublish(page, writing);
    const chip = page
      .locator(".news-audience-groups .auth-consent")
      .filter({ hasText: PUBLISH_GROUPS[0].name });

    await expect(chip).toHaveCSS("padding", "9px 14px");
    expect(
      (await page.getByRole("button", { name: "Add files" }).boundingBox())
        ?.height,
    ).toBe(52);
  });

  test("a 320 px en español, Publicando… no pisa el título", async ({
    page,
  }) => {
    await page.setViewportSize({ ...MOBILE_VIEWPORT, width: 320 });
    await goToPublish(page, { ...writing, beforeVisit: chooseSpanish });
    await page.route(
      (url) => url.pathname === NEWS_PUBLISH_ENDPOINT,
      () => undefined, // Se queda publicando: es lo que se mira.
    );
    const bar = page.getByRole("group", { name: PUBLISH_BAR_NAME });

    await bar.getByRole("button", { name: PUBLISH_BUTTON }).click();

    const sending = bar.getByRole("button", { name: "Publicando…" });
    await expect(sending).toBeVisible();
    const heading = await bar.getByRole("heading", { level: 1 }).boundingBox();
    const cancel = await bar
      .getByRole("button", { name: "Cancelar" })
      .boundingBox();
    const submit = await sending.boundingBox();
    expect((heading?.x ?? 0) + (heading?.width ?? 0)).toBeLessThanOrEqual(
      submit?.x ?? 0,
    );
    expect((cancel?.x ?? 0) + (cancel?.width ?? 0)).toBeLessThanOrEqual(
      heading?.x ?? 0,
    );
    expect((submit?.x ?? 0) + (submit?.width ?? 0)).toBeLessThanOrEqual(320);
  });

  test("en 768 px no hay barra: manda el escritorio", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await goToPublish(page, writing);

    await expect(
      page.getByRole("group", { name: PUBLISH_BAR_NAME }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /Back to News/ }),
    ).toBeVisible();
  });
});

/* ---------------------------------------------------------------------------
   Evaluaciones (#322): la tabla, la ficha, la ficha en edición y el miembro
   sin evaluar. Desde #818 la tabla sigue el diseño #1a del handoff de E31
   (docs/design/design_handoff_evaluations/screenshots/02-desktop-player.png),
   con la búsqueda, las fichas, la posición y el orden; en el móvil la tabla
   y la ficha son dos pasos hasta #822.

   Los datos son fijos, servidos por `page.route` como en Noticias: lo que
   los endpoints responden se prueba contra la base (#319 y #322).
   --------------------------------------------------------------------------- */

type StubbedCategory = {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
};

/** Las diez del SRD, con Experience desactivada, y una de 40 caracteres
 * para el caso de contenido largo. Va antes que las fichas de prueba de
 * Evaluaciones, que casan cada nota con su categoría (#819). */
const STUBBED_CATEGORIES: readonly StubbedCategory[] = [
  ...[
    "Fitness",
    "Speed",
    "Endurance",
    "Game awareness",
    "Tactical",
    "Passing",
    "Ball control",
    "Defense",
    "Teamwork",
    "Underwater orientation and breath contro",
  ].map((name, index) => ({
    id: `ca7e0000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name,
    isActive: true,
  })),
  {
    id: "ca7e0000-0000-4000-8000-000000000099",
    name: "Experience",
    isActive: false,
  },
];

const EVALUATIONS_SCREEN_PATH = "/evaluaciones";
const EVALUATIONS_ENDPOINT = "/api/v1/evaluations";
const EVALUATIONS_NARROW_WIDTHS = [320, 375, 768] as const;
const EVALUATIONS_HEADING = /^(Evaluations|Evaluaciones)$/;
const EVALUATED_AT = "2026-09-27T01:02:03.123456+00:00";

const CAMILA_ID = "e1e1e1e1-0000-4000-8000-0000000000e1";
const MATEO_ID = "e1e1e1e1-0000-4000-8000-0000000000e2";

/** Las posiciones del club, como las trae la lista desde #817. */
const STUBBED_FORWARD = {
  id: "905e0000-0000-4000-8000-000000000001",
  names: { en: "Forward", es: "Delantero" },
} as const;
const STUBBED_CENTRE = {
  id: "905e0000-0000-4000-8000-000000000002",
  names: { en: "Centre", es: "Centro" },
} as const;
const STUBBED_HALF_BACK = {
  id: "905e0000-0000-4000-8000-000000000003",
  names: { en: "Half back", es: "Medio" },
} as const;

/** La foto la pinta `MemberAvatar`, ya probado: aquí van las iniciales. */
const STUBBED_ROSTER_EXTRAS = { photoUrl: null } as const;

/** Una con un nombre de tres veces lo normal, para el caso de contenido
 * largo, una evaluada sin categorías, que no tiene media, y dos sin evaluar
 * para la ficha Sin evaluar. */
const STUBBED_ROSTER = [
  {
    status: "evaluated",
    userId: CAMILA_ID,
    fullName: "Camila Ortiz",
    position: STUBBED_FORWARD,
    overall: 7.9,
    updatedAt: EVALUATED_AT,
    updatedBy: "Carla Coach",
    ...STUBBED_ROSTER_EXTRAS,
  },
  {
    status: "evaluated",
    userId: "e1e1e1e1-0000-4000-8000-0000000000e3",
    fullName: "Chloe Nguyen",
    position: STUBBED_CENTRE,
    overall: 8.3,
    updatedAt: "2026-08-28T03:00:00+00:00",
    updatedBy: "Carla Coach",
    ...STUBBED_ROSTER_EXTRAS,
  },
  {
    status: "not_evaluated",
    userId: "e1e1e1e1-0000-4000-8000-0000000000e6",
    fullName: "Grace Lee",
    position: STUBBED_HALF_BACK,
    ...STUBBED_ROSTER_EXTRAS,
  },
  {
    status: "not_evaluated",
    userId: MATEO_ID,
    fullName: "Mateo Fernández",
    position: STUBBED_HALF_BACK,
    ...STUBBED_ROSTER_EXTRAS,
  },
  {
    status: "evaluated",
    userId: "e1e1e1e1-0000-4000-8000-0000000000e4",
    fullName: "Ruby Walsh",
    position: null,
    overall: null,
    updatedAt: EVALUATED_AT,
    updatedBy: null,
    ...STUBBED_ROSTER_EXTRAS,
  },
  {
    status: "evaluated",
    userId: "e1e1e1e1-0000-4000-8000-0000000000e5",
    fullName: "Valentina Maximiliana Rodríguez-Etxeberria de la Fuente",
    position: STUBBED_FORWARD,
    overall: 6.4,
    updatedAt: "2026-06-21T04:00:00+00:00",
    updatedBy: "Carla Coach",
    ...STUBBED_ROSTER_EXTRAS,
  },
] as const;

/** Las activas de `STUBBED_CATEGORIES`: el número de la pestaña. */
const ACTIVE_STUBBED_CATEGORY_COUNT = 10;

/** Más de los que caben en la caja de la tabla (D10). */
const CROWDED_ROSTER_SIZE = 40;

const CROWDED_ROSTER = Array.from(
  { length: CROWDED_ROSTER_SIZE },
  (_, index) => ({
    status: "evaluated",
    userId: `e2e2e2e2-0000-4000-8000-${String(index).padStart(12, "0")}`,
    fullName: `Player ${String(index + 1).padStart(2, "0")}`,
    position: STUBBED_FORWARD,
    overall: 6.5,
    updatedAt: EVALUATED_AT,
    updatedBy: null,
    ...STUBBED_ROSTER_EXTRAS,
  }),
);

/** El resumen que la lista trae desde #817 (D5 de E31), con lo que pinta el
 * panel sin nadie elegido (#819): Defense es la más baja, y Valentina,
 * Chloe y Camila son las que llevan más tiempo sin revisar. */
function stubbedRosterSummary(): unknown {
  return {
    evaluatedCount: 4,
    playerCount: 6,
    categoryAverages: (
      [
        ["Fitness", 7.7],
        ["Speed", 8.3],
        ["Endurance", 7],
        ["Game awareness", 7.3],
        ["Tactical", 6.7],
        ["Passing", 7.7],
        ["Ball control", 8],
        ["Defense", 5.7],
        ["Teamwork", 8.7],
        ["Underwater orientation and breath contro", 7.3],
      ] as const
    ).map(([name, average]) => ({
      categoryId: stubbedCategoryId(name),
      name,
      average,
    })),
    averageOverall: 7.5,
    longestUnreviewed: [
      {
        userId: "e1e1e1e1-0000-4000-8000-0000000000e5",
        fullName: "Valentina Maximiliana Rodríguez-Etxeberria de la Fuente",
        updatedAt: "2026-06-21T04:00:00+00:00",
      },
      {
        userId: "e1e1e1e1-0000-4000-8000-0000000000e3",
        fullName: "Chloe Nguyen",
        updatedAt: "2026-08-28T03:00:00+00:00",
      },
      { userId: CAMILA_ID, fullName: "Camila Ortiz", updatedAt: EVALUATED_AT },
    ],
  };
}

/** Las diez activas del club, como en el mockup. Suman 79: el OVR es 7.9. */
const CAMILA_RATINGS: readonly (readonly [string, number])[] = [
  ["Fitness", 8],
  ["Speed", 9],
  ["Endurance", 7],
  ["Game awareness", 8],
  ["Tactical", 7],
  ["Passing", 8],
  ["Ball control", 9],
  ["Defense", 6],
  ["Teamwork", 9],
  ["Underwater orientation and breath contro", 8],
];

/** El id de la categoría del catálogo con ese nombre, para que la ficha
 * case cada nota con su categoría (#819). */
function stubbedCategoryId(name: string): string {
  const category = STUBBED_CATEGORIES.find((entry) => entry.name === name);
  if (category === undefined) {
    throw new Error(`No hay ninguna categoría de prueba llamada ${name}.`);
  }
  return category.id;
}

/** `retiredName` es una categoría que el club desactivó después de evaluar:
 * la evaluación ya no está al día (#323). */
function stubbedEvaluation(
  ratings: readonly (readonly [string, number])[],
  retiredName?: string,
): unknown {
  const sum = ratings.reduce((total, [, rating]) => total + rating, 0);
  return {
    status: "evaluated",
    memberId: CAMILA_ID,
    updatedAt: EVALUATED_AT,
    overallRating: Math.round((sum * 10) / ratings.length) / 10,
    ratings: ratings.map(([name, rating]) => ({
      categoryId: stubbedCategoryId(name),
      name,
      rating,
      isRetired: name === retiredName,
    })),
    isCurrent: retiredName === undefined,
  };
}

/** Camila evaluada antes de que el club añadiera Underwater orientation y
 * desactivara Experience: la primera sale "nueva · sin nota" (D3) y la
 * segunda, retirada al final. 71 + 8 = 79 en diez: el OVR sigue en 7.9. */
const CAMILA_OUTDATED_RATINGS: readonly (readonly [string, number])[] = [
  ...CAMILA_RATINGS.filter(
    ([name]) => name !== "Underwater orientation and breath contro",
  ),
  ["Experience", 8],
];

/** Lo que queda al ponerla al día: Experience sale y Underwater orientation
 * entra en 5. 71 + 5 = 76 en diez, un OVR de 7.6. */
const CAMILA_REFRESHED_RATINGS: readonly (readonly [string, number])[] = [
  ...CAMILA_OUTDATED_RATINGS.filter(([name]) => name !== "Experience"),
  ["Underwater orientation and breath contro", 5],
];

async function stubEvaluationReads(
  page: Page,
  roster: readonly unknown[],
  camilaEvaluation: unknown = stubbedEvaluation(CAMILA_RATINGS),
): Promise<void> {
  await page.route(
    (url) => url.pathname === EVALUATIONS_ENDPOINT,
    (route) =>
      route.fulfill(
        jsonBody({ members: roster, summary: stubbedRosterSummary() }),
      ),
  );
  await page.route(
    (url) => url.pathname.startsWith(`${EVALUATIONS_ENDPOINT}/`),
    (route, request) => {
      const isMateo = new URL(request.url()).pathname.endsWith(MATEO_ID);
      return route.fulfill(
        jsonBody(
          isMateo
            ? { status: "not_evaluated", memberId: MATEO_ID }
            : camilaEvaluation,
        ),
      );
    },
  );
  // Después de la de arriba, que también casaría: gana la última (#818,
  // el número de la pestaña Categorías y su contenido).
  await page.route(
    (url) => url.pathname === EVALUATION_CATEGORIES_ENDPOINT,
    (route) => route.fulfill(jsonBody({ categories: STUBBED_CATEGORIES })),
  );
}

const RATINGS_LIST = /^(Ratings · 1–10|Notas · 1–10)$/;
/** Una evaluación que no está al día ya no ofrece ponerla al día aparte
 * (#820, D4): se ve en la categoría nueva sin nota. */
const UNRATED = /^(new · not rated|nueva · sin nota)$/;
const SAVE_AND_NEXT = /^(Save & next|Guardar y siguiente)/;
const OUTDATED_CAMILA = stubbedEvaluation(
  CAMILA_OUTDATED_RATINGS,
  "Experience",
);
const EDIT_RATINGS = /^(Edit ratings|Editar notas)$/;
const START_EVALUATION = /^(Start evaluation|Empezar evaluación)$/;
const SQUAD_OVERVIEW = /^(Squad overview|Resumen de la plantilla)$/;
const CAMILA_BUTTON = /Camila Ortiz/;
const PLAYERS_LIST = /^(Players|Jugadores)$/;
const NOT_EVALUATED_CHIP = /^(Not evaluated|Sin evaluar)/;
const SEARCH_BY_NAME = /^(Search by name|Buscar por nombre)$/;
const SORT_BY = /^(Sort by|Ordenar por)$/;

/** La fila de la tabla: el resumen del panel también lleva botones con
 * nombres (#819). */
function rosterButton(page: Page, name: RegExp): Locator {
  return page
    .getByRole("list", { name: PLAYERS_LIST })
    .getByRole("button", { name });
}

async function waitForRoster(page: Page): Promise<void> {
  await expect(rosterButton(page, CAMILA_BUTTON)).toBeVisible();
}

async function openCamila(page: Page): Promise<void> {
  await rosterButton(page, CAMILA_BUTTON).click();
  await expect(page.getByRole("list", { name: RATINGS_LIST })).toBeVisible();
}

/** El panel sale desde 1024 px (D12); más estrecho no hay resumen (D7) y
 * basta con la tabla. */
const EVALUATIONS_PANEL_MIN_WIDTH = 1024;

async function waitForOverview(page: Page, text: string): Promise<void> {
  await waitForRoster(page);
  const width = page.viewportSize()?.width;
  if (width === undefined) {
    throw new Error("La página no tiene un tamaño de ventana fijo.");
  }
  if (width >= EVALUATIONS_PANEL_MIN_WIDTH) {
    await expect(
      page.getByRole("region", { name: SQUAD_OVERVIEW }),
    ).toContainText(text);
  }
}

async function openCamilaFromRoster(page: Page): Promise<void> {
  await waitForRoster(page);
  await openCamila(page);
}

type EvaluationsState = {
  readonly name: string;
  readonly roster: readonly unknown[];
  /** Lo que sirve la ficha de Camila, si no es la evaluación al día. */
  readonly camilaEvaluation?: unknown;
  readonly isSpanish?: boolean;
  /** Si sólo se fotografía a un ancho: los estados del panel lateral sólo
   * existen en escritorio, y los `evaluaciones-movil-*` (#822) son los de la
   * ficha a pantalla completa. Sin él, a los tres anchos. */
  readonly photographedAt?: "desktop" | "mobile";
  readonly ready: (page: Page) => Promise<void>;
};

const EVALUATIONS_LIST: EvaluationsState = {
  name: "evaluaciones-lista",
  roster: STUBBED_ROSTER,
  ready: waitForRoster,
};

const EVALUATIONS_STATES: readonly EvaluationsState[] = [
  EVALUATIONS_LIST,
  { ...EVALUATIONS_LIST, name: "evaluaciones-lista-es", isSpanish: true },
  {
    name: "evaluaciones-ficha",
    roster: STUBBED_ROSTER,
    ready: openCamilaFromRoster,
  },
  {
    name: "evaluaciones-ficha-es",
    roster: STUBBED_ROSTER,
    isSpanish: true,
    ready: openCamilaFromRoster,
  },
  {
    name: "evaluaciones-ficha-por-poner-al-dia",
    roster: STUBBED_ROSTER,
    camilaEvaluation: OUTDATED_CAMILA,
    ready: async (page) => {
      await openCamilaFromRoster(page);
      await expect(page.getByText(UNRATED)).toBeVisible();
    },
  },
  {
    name: "evaluaciones-ficha-por-poner-al-dia-es",
    roster: STUBBED_ROSTER,
    camilaEvaluation: OUTDATED_CAMILA,
    isSpanish: true,
    ready: async (page) => {
      await openCamilaFromRoster(page);
      await expect(page.getByText(UNRATED)).toBeVisible();
    },
  },
  {
    name: "evaluaciones-ficha-editando",
    roster: STUBBED_ROSTER,
    ready: async (page) => {
      await openCamilaFromRoster(page);
      await page.getByRole("button", { name: EDIT_RATINGS }).click();
      await expect(page.getByRole("slider", { name: "Fitness" })).toBeVisible();
    },
  },
  {
    // El siguiente de la lista abierto ya en edición (#820). La red sirve
    // la misma evaluación a cualquiera que no sea Mateo, y el PUT de
    // Camila la devuelve como guardada. Se espera a que se vaya el aviso de
    // guardado, que dura unos 3 segundos, para que la captura no dependa de
    // cuándo se tome.
    name: "evaluaciones-guardar-y-siguiente",
    roster: STUBBED_ROSTER,
    photographedAt: "desktop",
    ready: async (page) => {
      await openCamilaFromRoster(page);
      await page.getByRole("button", { name: EDIT_RATINGS }).click();
      await page.getByRole("button", { name: SAVE_AND_NEXT }).click();
      const chloe = page.getByRole("region", {
        name: /^(Evaluation of|Evaluación de) Chloe Nguyen$/,
      });
      await expect(
        chloe.getByRole("slider", { name: "Fitness" }),
      ).toBeFocused();
      await expect(page.getByText("Camila Ortiz saved")).toBeHidden();
    },
  },
  {
    name: "evaluaciones-sin-evaluar",
    roster: STUBBED_ROSTER,
    ready: async (page) => {
      await rosterButton(page, /Mateo Fernández/).click();
      await expect(
        page.getByRole("button", { name: START_EVALUATION }),
      ).toBeVisible();
    },
  },
  {
    name: "evaluaciones-resumen",
    roster: STUBBED_ROSTER,
    photographedAt: "desktop",
    ready: (page) => waitForOverview(page, "Lowest: Defense"),
  },
  {
    name: "evaluaciones-resumen-todos-evaluados",
    roster: STUBBED_ROSTER.filter((member) => member.status === "evaluated"),
    photographedAt: "desktop",
    ready: (page) => waitForOverview(page, "✓ Everyone has an evaluation."),
  },
  {
    name: "evaluaciones-filtrando",
    roster: STUBBED_ROSTER,
    photographedAt: "desktop",
    ready: async (page) => {
      await waitForRoster(page);
      await page.getByRole("button", { name: NOT_EVALUATED_CHIP }).click();
      await page.getByRole("searchbox", { name: SEARCH_BY_NAME }).fill("ma");
      await expect(page.getByText("1 of 6 players")).toBeVisible();
    },
  },
  {
    name: "evaluaciones-sin-resultados",
    roster: STUBBED_ROSTER,
    photographedAt: "desktop",
    ready: async (page) => {
      await waitForRoster(page);
      await page.getByRole("searchbox", { name: SEARCH_BY_NAME }).fill("zzz");
      await expect(page.getByText("No player matches.")).toBeVisible();
    },
  },
  {
    name: "evaluaciones-movil-lista",
    roster: STUBBED_ROSTER,
    photographedAt: "mobile",
    ready: waitForRoster,
  },
  {
    name: "evaluaciones-movil-ficha",
    roster: STUBBED_ROSTER,
    photographedAt: "mobile",
    ready: openCamilaFromRoster,
  },
  {
    // El último de la lista (Valentina, con el nombre largo) en edición, con
    // Fitness subido con +: la barra fija dice Guardar y no Guardar y
    // siguiente.
    name: "evaluaciones-movil-editando",
    roster: STUBBED_ROSTER,
    photographedAt: "mobile",
    ready: async (page) => {
      await waitForRoster(page);
      await rosterButton(page, /Valentina Maximiliana/).click();
      await page.getByRole("button", { name: EDIT_RATINGS }).click();
      await page.getByRole("button", { name: "Raise Fitness" }).click();
      await expect(page.getByRole("slider", { name: "Fitness" })).toHaveValue(
        "9",
      );
      await expect(
        page.getByRole("button", { name: "Save", exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: "evaluaciones-vacia",
    roster: [],
    ready: async (page) => {
      await expect(
        page.getByText("There's nobody in the club to evaluate yet."),
      ).toBeVisible();
    },
  },
];

async function goToEvaluations(
  page: Page,
  state: EvaluationsState,
  theme?: (typeof themes)[number],
): Promise<void> {
  await stubEvaluationReads(page, state.roster, state.camilaEvaluation);
  if (state.isSpanish === true) {
    await chooseSpanish(page);
  }
  if (theme === undefined) {
    await page.goto(`${APP_URL}${EVALUATIONS_SCREEN_PATH}`);
  } else {
    await goToWithTheme(page, EVALUATIONS_SCREEN_PATH, theme);
  }
  await expect(
    page.getByRole("heading", { level: 1, name: EVALUATIONS_HEADING }),
  ).toBeVisible();
  // El número de Categorías llega en su propia lectura (#818): sin él, la
  // captura sale a veces con la pestaña sin número.
  await expect(
    page.getByRole("tab", { name: /^(Categories|Categorías)/ }),
  ).toContainText(String(ACTIVE_STUBBED_CATEGORY_COUNT));
  await state.ready(page);
}

for (const state of EVALUATIONS_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        const isPhotographedHere =
          state.photographedAt === undefined ||
          state.photographedAt === vp.name;
        if (isStatePhotographed(state.name) && isPhotographedHere) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToEvaluations(page, state, theme);
              // Evaluaciones elige su diseño con `useIsBelowDesktop` (#822):
              // si la página no cabe, la captura entera lo ve un instante
              // como móvil y la ficha cambia de forma a mitad de captura.
              await fitViewportToPage(page);
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }
      });
    }

    for (const width of EVALUATIONS_NARROW_WIDTHS) {
      test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 812 });
        await goToEvaluations(page, state);
        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    }

    for (const theme of themes) {
      test(`has no accessibility violations (axe-core, ${theme})`, async ({
        page,
      }) => {
        await page.setViewportSize(
          state.photographedAt === "mobile"
            ? { width: 375, height: 812 }
            : { width: 1440, height: 900 },
        );
        await goToEvaluations(page, state, theme);
        await expectNoAxeViolations(page);
      });
    }
  });
}

const BACK_TO_THE_LIST = /^(Back to the list|Volver a la lista)$/;

test.describe("evaluaciones en el navegador", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  // Por debajo de 1024 px, también en la tableta (#822, D12).
  for (const width of [375, 768] as const) {
    test(`a ${width}px la lista y la ficha a pantalla completa son dos pasos, con forma de volver`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 812 });
      await goToEvaluations(page, EVALUATIONS_LIST);

      await openCamila(page);
      await expect(page.getByRole("searchbox")).toBeHidden();
      await expect(
        page.getByRole("heading", { level: 1, name: EVALUATIONS_HEADING }),
      ).toBeHidden();
      await expect(
        page.getByRole("group", { name: /^(Actions|Acciones)$/ }),
      ).toBeVisible();
      await page.getByRole("button", { name: BACK_TO_THE_LIST }).click();

      await expect(page.getByRole("searchbox")).toBeVisible();
      await expect(rosterButton(page, CAMILA_BUTTON)).toBeFocused();
      await expect(page.getByRole("list", { name: RATINGS_LIST })).toHaveCount(
        0,
      );
    });
  }

  test("en el móvil los toques miden al menos 44 px y los campos llevan letra de 16 px (#822)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToEvaluations(page, EVALUATIONS_LIST);
    const row = await rosterButton(page, CAMILA_BUTTON).boundingBox();
    expect(row?.height).toBeGreaterThanOrEqual(64);
    for (const field of [
      page.getByRole("searchbox", { name: SEARCH_BY_NAME }),
      page.getByRole("combobox", { name: SORT_BY }),
    ]) {
      expect(
        await field.evaluate((element) => getComputedStyle(element).fontSize),
      ).toBe("16px");
    }

    await openCamila(page);
    await page.getByRole("button", { name: EDIT_RATINGS }).click();

    for (const name of [
      BACK_TO_THE_LIST,
      /^Previous player$/,
      /^Next player$/,
      /^Lower Fitness$/,
      /^Raise Fitness$/,
      /^Cancel$/,
      SAVE_AND_NEXT,
    ]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box?.height, String(name)).toBeGreaterThanOrEqual(44);
      expect(box?.width, String(name)).toBeGreaterThanOrEqual(44);
    }
  });

  test("en el móvil la lista y la ficha llevan las medidas del handoff (#822)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToEvaluations(page, EVALUATIONS_LIST);
    const heightOf = async (locator: Locator): Promise<number | undefined> =>
      (await locator.boundingBox())?.height;
    const fontSizeOf = (locator: Locator): Promise<string> =>
      locator.evaluate((element) => getComputedStyle(element).fontSize);
    const camilaRow = rosterButton(page, CAMILA_BUTTON);

    expect(await fontSizeOf(page.getByRole("heading", { level: 1 }))).toBe(
      "24px",
    );
    expect(
      await heightOf(page.getByRole("searchbox", { name: SEARCH_BY_NAME })),
    ).toBe(46);
    expect(
      await heightOf(page.getByRole("button", { name: NOT_EVALUATED_CHIP })),
    ).toBe(36);
    expect(await heightOf(camilaRow.locator(".evaluation-row-avatar"))).toBe(
      40,
    );
    expect(await fontSizeOf(camilaRow.locator(".evaluation-row-overall"))).toBe(
      "16px",
    );

    await openCamila(page);
    expect(
      await heightOf(page.locator(".evaluation-sheet .evaluation-avatar")),
    ).toBe(60);
    expect(
      await heightOf(page.getByRole("button", { name: EDIT_RATINGS })),
    ).toBe(48);
    await page.getByRole("button", { name: EDIT_RATINGS }).click();
    for (const name of [/^Cancel$/, SAVE_AND_NEXT]) {
      expect(
        await heightOf(page.getByRole("button", { name })),
        String(name),
      ).toBe(48);
    }
  });

  test("la búsqueda, la ficha y el orden sobreviven a recargar (#818)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToEvaluations(page, EVALUATIONS_LIST);

    await page.getByRole("button", { name: NOT_EVALUATED_CHIP }).click();
    await page.getByRole("combobox", { name: SORT_BY }).selectOption("oldest");
    await page.getByRole("searchbox", { name: SEARCH_BY_NAME }).fill("ma");
    await expect(page).toHaveURL(/q=ma/);
    await page.reload();

    await expect(
      page.getByRole("searchbox", { name: SEARCH_BY_NAME }),
    ).toHaveValue("ma");
    await expect(
      page.getByRole("button", { name: NOT_EVALUATED_CHIP }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("combobox", { name: SORT_BY })).toHaveValue(
      "oldest",
    );
    await expect(rosterButton(page, /Mateo Fernández/)).toBeVisible();
    await expect(rosterButton(page, CAMILA_BUTTON)).toHaveCount(0);
  });

  test("la pestaña Categorías va en la dirección y sobrevive a recargar (#818)", async ({
    page,
  }) => {
    await goToEvaluations(page, EVALUATIONS_LIST);

    await page.getByRole("tab", { name: /Categories/ }).click();
    await expect(page).toHaveURL(/tab=categories/);
    await page.reload();

    await expect(page.getByRole("tab", { name: /Categories/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.getByRole("list", { name: ACTIVE_CATEGORIES_LIST }),
    ).toBeVisible();
  });

  test("con muchos jugadores la lista se desplaza en su caja y la cabecera no se mueve (#818)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToEvaluations(page, {
      ...EVALUATIONS_LIST,
      roster: CROWDED_ROSTER,
      ready: async (crowded) => {
        await expect(
          crowded.getByRole("button", { name: /Player 01/ }),
        ).toBeVisible();
      },
    });
    const rows = page.getByRole("list", { name: PLAYERS_LIST });
    const heading = page.getByRole("heading", { level: 1 });
    // Pasar el ratón ya baja la página hasta la lista: se mide después.
    await rows.hover();
    const headingTop = (await heading.boundingBox())?.y;

    await page.mouse.wheel(0, 400);

    await expect
      .poll(() => rows.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    expect(await rows.evaluate((element) => element.clientHeight)).toBe(560);
    expect((await heading.boundingBox())?.y).toBe(headingTop);
  });

  test("con ?miembro= abre ya la ficha de esa persona (#324)", async ({
    page,
  }) => {
    await stubEvaluationReads(page, STUBBED_ROSTER);

    await page.goto(`${APP_URL}${EVALUATIONS_SCREEN_PATH}?miembro=${MATEO_ID}`);

    await expect(
      page.getByRole("button", { name: START_EVALUATION }),
    ).toBeVisible();
  });

  test("en escritorio la lista y la ficha van lado a lado", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToEvaluations(page, EVALUATIONS_LIST);

    await openCamila(page);

    await expect(page.getByRole("searchbox")).toBeVisible();
    await expect(
      page.getByRole("button", { name: BACK_TO_THE_LIST }),
    ).toHaveCount(0);
  });

  test("guardar una evaluación que no está al día la pone al día en la misma petición (#820, D4)", async ({
    page,
  }) => {
    await goToEvaluations(page, {
      ...EVALUATIONS_LIST,
      camilaEvaluation: OUTDATED_CAMILA,
    });
    const saves: unknown[] = [];
    await page.route(
      (url) => url.pathname === `${EVALUATIONS_ENDPOINT}/${CAMILA_ID}`,
      (route, request) => {
        if (request.method() !== "PUT") {
          return route.fallback();
        }
        saves.push(request.postDataJSON());
        return route.fulfill(
          jsonBody(stubbedEvaluation(CAMILA_REFRESHED_RATINGS)),
        );
      },
    );
    await openCamila(page);
    await page.getByRole("button", { name: EDIT_RATINGS }).click();

    await expect(
      page.getByRole("slider", { name: /^Underwater orientation/ }),
    ).toHaveValue("5");
    await expect(page.getByRole("slider", { name: "Experience" })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const ratings = page.getByRole("list", { name: RATINGS_LIST });
    await expect(ratings).toContainText("Underwater orientation");
    await expect(ratings).not.toContainText("Experience");
    await expect(ratings).not.toContainText("not rated");
    await expect(rosterButton(page, CAMILA_BUTTON)).toContainText("7.6");
    expect(saves).toHaveLength(1);
    expect(JSON.stringify(saves[0])).not.toContain(
      stubbedCategoryId("Experience"),
    );
  });

  test("guardar pone el OVR al día sin recargar la página", async ({
    page,
  }) => {
    await goToEvaluations(page, EVALUATIONS_LIST);
    await page.evaluate(() => {
      (window as { sinRecargar?: boolean }).sinRecargar = true;
    });
    const saved = CAMILA_RATINGS.map(([name, rating]) =>
      name === "Defense" ? ([name, 10] as const) : ([name, rating] as const),
    );
    await page.route(
      (url) => url.pathname === `${EVALUATIONS_ENDPOINT}/${CAMILA_ID}`,
      (route, request) =>
        request.method() === "PUT"
          ? route.fulfill(jsonBody(stubbedEvaluation(saved)))
          : route.fallback(),
    );
    await openCamila(page);
    await page.getByRole("button", { name: EDIT_RATINGS }).click();

    await page.getByRole("slider", { name: "Defense" }).fill("10");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.getByText("Camila Ortiz saved")).toBeVisible();
    await expect(rosterButton(page, CAMILA_BUTTON)).toContainText("8.3");
    expect(
      await page.evaluate(
        () => (window as { sinRecargar?: boolean }).sinRecargar,
      ),
    ).toBe(true);
  });
});

/* ---------------------------------------------------------------------------
   La pestaña Categorías de Evaluaciones (#821, RF-5 del PRD de E31): la
   tabla con una desactivada, el nombre repetido en la fila de añadir,
   renombrando en la fila y las desactivadas abiertas. Se revisa contra
   docs/design/design_handoff_evaluations/screenshots/04-desktop-categories.png
   a 768 y 1440; el móvil (#823) va más abajo. Los datos son fijos, servidos por
   `page.route`; lo que los endpoints hacen se prueba contra la base (#320).
   --------------------------------------------------------------------------- */

const EVALUATION_CATEGORIES_TAB_PATH = `${EVALUATIONS_SCREEN_PATH}?tab=categories`;
const EVALUATION_CATEGORIES_OLD_PATH = "/evaluaciones/categorias";
const EVALUATION_CATEGORIES_ENDPOINT = "/api/v1/evaluations/categories";
const ACTIVE_CATEGORIES_LIST = /^(Active categories|Categorías activas)$/;
const NEW_CATEGORY_FIELD = /^(New category|Nueva categoría)$/;
const TAKEN_CATEGORY_NAME =
  /^(There is already a category with that name\.|Ya hay una categoría con ese nombre\.)$/;
const DEACTIVATED_TOGGLE =
  /^(Deactivated categories|Categorías desactivadas): /;

/** GET sirve el catálogo; PUT del orden responde con las activas en el
 * orden que llegó. Lo demás no se escribe en estas pruebas. */
async function stubEvaluationCategories(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith(EVALUATION_CATEGORIES_ENDPOINT),
    async (route, request) => {
      if (request.method() === "PUT") {
        const { categoryIds } = request.postDataJSON() as {
          categoryIds: string[];
        };
        const reordered = [
          ...categoryIds.map((id) =>
            STUBBED_CATEGORIES.find((category) => category.id === id)!,
          ),
          ...STUBBED_CATEGORIES.filter((category) => !category.isActive),
        ];
        await route.fulfill(jsonBody({ categories: reordered }));
        return;
      }
      await route.fulfill(jsonBody({ categories: STUBBED_CATEGORIES }));
    },
  );
}

/** Escribe "speed", que ya existe: el aviso sale mientras se escribe, sin
 * mandar nada. */
async function typeTakenCategoryName(page: Page): Promise<void> {
  await page.getByRole("textbox", { name: NEW_CATEGORY_FIELD }).fill("speed");
  await expect(page.getByText(TAKEN_CATEGORY_NAME)).toBeVisible();
}

async function renameSpeed(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /^(Rename|Renombrar) Speed$/ })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: /^(New name for|Nuevo nombre de) Speed$/,
    }),
  ).toBeFocused();
}

async function openDeactivatedCategories(page: Page): Promise<void> {
  await page.getByRole("button", { name: DEACTIVATED_TOGGLE }).click();
  await expect(
    page.getByRole("button", { name: /^(Reactivate|Reactivar) Experience$/ }),
  ).toBeVisible();
  // El puntero se queda sobre el botón pulsado: la captura saldría con su
  // hover.
  await page.mouse.move(0, 0);
}

type EvaluationCategoriesState = {
  readonly name: string;
  readonly isSpanish?: boolean;
  readonly prepare?: (page: Page) => Promise<void>;
};

const EVALUATION_CATEGORIES_STATES: readonly EvaluationCategoriesState[] = [
  { name: "evaluaciones-categorias" },
  { name: "evaluaciones-categorias-es", isSpanish: true },
  {
    name: "evaluaciones-categorias-nombre-repetido",
    prepare: typeTakenCategoryName,
  },
  {
    name: "evaluaciones-categorias-nombre-repetido-es",
    isSpanish: true,
    prepare: typeTakenCategoryName,
  },
  { name: "evaluaciones-categorias-renombrando", prepare: renameSpeed },
  {
    name: "evaluaciones-categorias-desactivadas-abiertas",
    prepare: openDeactivatedCategories,
  },
];

/** Las tabletas y el escritorio: el móvil de las categorías tiene sus propios
 * estados (#823). */
const EVALUATION_CATEGORIES_VIEWPORTS = viewports.filter(
  (vp) => vp.name !== "mobile",
);

async function goToEvaluationCategories(
  page: Page,
  state: EvaluationCategoriesState,
  theme?: (typeof themes)[number],
): Promise<void> {
  await stubEvaluationReads(page, STUBBED_ROSTER);
  await stubEvaluationCategories(page);
  if (state.isSpanish === true) {
    await chooseSpanish(page);
  }
  if (theme === undefined) {
    await page.goto(`${APP_URL}${EVALUATION_CATEGORIES_TAB_PATH}`);
  } else {
    await goToWithTheme(page, EVALUATION_CATEGORIES_TAB_PATH, theme);
  }
  await expect(
    page.getByRole("heading", { level: 1, name: EVALUATIONS_HEADING }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: ACTIVE_CATEGORIES_LIST }),
  ).toBeVisible();
  // El número de Jugadores llega en su propia lectura: sin él, la captura
  // sale a veces con la pestaña sin número.
  await expect(
    page.getByRole("tab", { name: /^(Players|Jugadores)/ }),
  ).toContainText(String(STUBBED_ROSTER.length));
  await state.prepare?.(page);
}

for (const state of EVALUATION_CATEGORIES_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of EVALUATION_CATEGORIES_VIEWPORTS) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToEvaluationCategories(page, state, theme);
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }
      });
    }

    test("has no horizontal scroll at 768px", async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await goToEvaluationCategories(page, state);
      expect(await hasHorizontalScroll(page)).toBe(false);
    });

    for (const theme of themes) {
      test(`has no accessibility violations (axe-core, ${theme})`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await goToEvaluationCategories(page, state, theme);
        await expectNoAxeViolations(page);
      });
    }
  });
}

/* Las categorías en el móvil (#823, RF-7 del PRD de E31): la tarjeta con la
   indicación de arrastrar, la hoja de una categoría y el nombre repetido en
   la hoja. Se revisa contra docs/design/design_handoff_evaluations/
   screenshots/07-mobile-categories.png a 375; a 320 no se sale por el lado. */

const PHONE_CATEGORIES_VIEWPORT = viewports[0];
const NARROWEST_CATEGORIES_PHONE = { width: 320, height: 640 } as const;

async function openSpeedSheet(page: Page): Promise<void> {
  await page
    .getByRole("list", { name: ACTIVE_CATEGORIES_LIST })
    .getByRole("button", { name: "Speed", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Speed" })).toBeVisible();
}

/** "endurance" ya existe: el aviso sale en la hoja mientras se escribe. */
async function typeTakenNameInSheet(page: Page): Promise<void> {
  await openSpeedSheet(page);
  await page
    .getByRole("dialog", { name: "Speed" })
    .getByRole("textbox", { name: /^(Name|Nombre)$/ })
    .fill("endurance");
  await expect(page.getByText(TAKEN_CATEGORY_NAME)).toBeVisible();
}

type PhoneCategoriesState = EvaluationCategoriesState & {
  /** La hoja va fija abajo: se fotografía la ventana, no la página entera. */
  readonly isSheet: boolean;
};

const PHONE_CATEGORIES_STATES: readonly PhoneCategoriesState[] = [
  { name: "evaluaciones-movil-categorias", isSheet: false },
  {
    name: "evaluaciones-movil-categorias-es",
    isSpanish: true,
    isSheet: false,
  },
  {
    name: "evaluaciones-movil-categoria-hoja",
    prepare: openSpeedSheet,
    isSheet: true,
  },
  {
    name: "evaluaciones-movil-categoria-hoja-nombre-repetido",
    prepare: typeTakenNameInSheet,
    isSheet: true,
  },
];

for (const state of PHONE_CATEGORIES_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    test.describe(`@ ${PHONE_CATEGORIES_VIEWPORT.name}`, () => {
      test.use({
        viewport: {
          width: PHONE_CATEGORIES_VIEWPORT.width,
          height: PHONE_CATEGORIES_VIEWPORT.height,
        },
      });

      if (isStatePhotographed(state.name)) {
        for (const theme of themes) {
          test(`matches approved baseline (${theme})`, async ({ page }) => {
            await goToEvaluationCategories(page, state, theme);
            if (!state.isSheet) {
              // En la página entera, la barra fija de abajo taparía filas.
              await page.addStyleTag({ content: HIDDEN_TAB_BAR_STYLE });
            }
            const options = { ...SCREENSHOT_OPTIONS, fullPage: !state.isSheet };
            const snapshot = `${state.name}-${PHONE_CATEGORIES_VIEWPORT.name}-${theme}.png`;
            await createMissingLocalBaseline(snapshot, () =>
              page.screenshot(options),
            );
            await expect(page).toHaveScreenshot(snapshot, {
              ...options,
              maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
            });
          });
        }
      }

      for (const theme of themes) {
        test(`has no accessibility violations (axe-core, ${theme})`, async ({
          page,
        }) => {
          await goToEvaluationCategories(page, state, theme);
          await expectNoAxeViolations(page);
        });
      }
    });

    test("has no horizontal scroll at 320px", async ({ page }) => {
      await page.setViewportSize(NARROWEST_CATEGORIES_PHONE);
      await goToEvaluationCategories(page, state);
      expect(await hasHorizontalScroll(page)).toBe(false);
    });
  });
}

test.describe("categorías de evaluación en el móvil", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: ADMIN_STORAGE_STATE,
    viewport: {
      width: PHONE_CATEGORIES_VIEWPORT.width,
      height: PHONE_CATEGORIES_VIEWPORT.height,
    },
  });

  test("las filas miden al menos 58 px y el asa 44, sin gesto del navegador", async ({
    page,
  }) => {
    await goToEvaluationCategories(page, { name: "medidas" });
    const row = page
      .getByRole("list", { name: ACTIVE_CATEGORIES_LIST })
      .getByRole("listitem")
      .first();
    const handle = row.getByRole("button", { name: /^Reorder / });

    expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(58);
    expect((await handle.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await expect(handle).toHaveCSS("touch-action", "none");
  });

  test("añadir mide 48 px y las desactivadas 56", async ({ page }) => {
    await goToEvaluationCategories(page, { name: "debajo" });
    await openDeactivatedCategories(page);

    for (const control of [
      page.getByRole("textbox", { name: NEW_CATEGORY_FIELD }),
      page.getByRole("button", { name: "Add", exact: true }),
    ]) {
      expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(48);
    }
    const deactivatedRow = page
      .getByRole("list", { name: "Deactivated categories" })
      .getByRole("listitem")
      .first();
    expect((await deactivatedRow.boundingBox())?.height).toBeGreaterThanOrEqual(
      56,
    );
  });

  test("la hoja lleva el campo y los botones de 48 px", async ({ page }) => {
    await goToEvaluationCategories(page, { name: "hoja" });
    await openSpeedSheet(page);
    const dialog = page.getByRole("dialog", { name: "Speed" });

    for (const control of [
      dialog.getByRole("textbox", { name: "Name" }),
      dialog.getByRole("button", { name: "Deactivate" }),
      dialog.getByRole("button", { name: "Save" }),
    ]) {
      expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(48);
    }
  });
});

test.describe("categorías de evaluación en el navegador", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("se llega desde la pestaña de Evaluaciones", async ({ page }) => {
    await goToEvaluations(page, EVALUATIONS_LIST);
    const categoriesTab = page.getByRole("tab", { name: /^Categories/ });

    await categoriesTab.click();

    await expect(page).toHaveURL(/[?&]tab=categories(&|$)/);
    await expect(categoriesTab).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("list", { name: ACTIVE_CATEGORIES_LIST }),
    ).toBeVisible();
  });

  // D1 del PRD de E31: la pantalla propia ya no existe, y un enlace guardado
  // lleva a la pestaña.
  test("la dirección vieja lleva a la pestaña", async ({ page }) => {
    await stubEvaluationReads(page, STUBBED_ROSTER);
    await stubEvaluationCategories(page);

    await page.goto(`${APP_URL}${EVALUATION_CATEGORIES_OLD_PATH}`);

    await expect(page).toHaveURL(/\/evaluaciones\?tab=categories$/);
    await expect(
      page.getByRole("list", { name: ACTIVE_CATEGORIES_LIST }),
    ).toBeVisible();
  });

  test("se reordena sólo con el teclado, y el foco se queda en el asa", async ({
    page,
  }) => {
    await goToEvaluationCategories(page, { name: "teclado" });

    await page
      .getByRole("button", { name: "Reorder Speed, position 2 of 10" })
      .focus();
    await page.keyboard.press("ArrowUp");

    await expect(
      page.getByRole("button", { name: "Reorder Speed, position 1 of 10" }),
    ).toBeFocused();
    await expect(
      page.getByText("Speed moved to 1 of 10 · saved").first(),
    ).toBeAttached();
  });

  test("se reordena arrastrando por el asa", async ({ page }) => {
    await goToEvaluationCategories(page, { name: "arrastre" });
    const handle = page.getByRole("button", {
      name: "Reorder Endurance, position 3 of 10",
    });
    const target = page
      .getByRole("list", { name: ACTIVE_CATEGORIES_LIST })
      .getByRole("listitem")
      .first();

    await handle.hover();
    await page.mouse.down();
    const box = await target.boundingBox();
    if (box === null) {
      throw new Error("La primera fila no tiene caja");
    }
    // Por pasos: dnd-kit necesita ver que el puntero se mueve para empezar.
    await page.mouse.move(box.x + box.width / 2, box.y + 4, { steps: 12 });
    await page.mouse.up();

    await expect(
      page.getByRole("button", { name: "Reorder Endurance, position 1 of 10" }),
    ).toBeVisible();
  });
});

/* ---------------------------------------------------------------------------
   Editar y retirar una publicación (#331). Editar es el formulario de
   publicar (#597) con los valores cargados, portada incluida, sin adjuntos;
   se fotografía a 768 y 1440, como publicar.

   Como el resto de Noticias, las capturas leen datos fijos servidos por
   `page.route`. Lo que los endpoints hacen de verdad se prueba contra
   seadragons-dev (#331).
   --------------------------------------------------------------------------- */

const NEWS_MANAGE_ENDPOINT = `${NEWS_PUBLISH_ENDPOINT}/${NEWS_OWN_POST_ID}`;
const NEWS_STATUS_ENDPOINT = `${NEWS_MANAGE_ENDPOINT}/status`;
const EDIT_HEADING = /^(Edit post|Editar publicación)$/;
// En el móvil el botón de guardar es el de la barra (#602), "Save".
const SAVE_BUTTON = /^(Save changes|Guardar cambios|Save|Guardar)$/;
const newsEditPath = (id: string): string => `${postPath(id)}/editar`;

/** La portada firmada de la publicación que se edita, servida por el test. */
const STUBBED_COVER_PATH = "/portadas-de-prueba/portada.png";

/** Lo que carga el formulario: dirigida a un grupo del club, con portada. */
const STUBBED_EDITABLE_POST = {
  id: NEWS_OWN_POST_ID,
  category: STUBBED_OWN_POST.category,
  title: STUBBED_OWN_POST.title,
  body: STUBBED_OWN_POST.body,
  audience: { kind: "groups", groupIds: [PUBLISH_GROUPS[0].id] },
  editedAt: STUBBED_OWN_POST.editedAt,
  status: "published",
  coverUploadId: "c0c0c0c0-0000-4000-8000-000000000001",
  coverUrl: `${APP_URL}${STUBBED_COVER_PATH}`,
  isPinned: false,
  pinnedUntil: null,
} as const;

/** Las lecturas del feed y los grupos, y la publicación editable. Va después
 * de las de Noticias: Playwright atiende primero la ruta registrada más
 * tarde, y la del feed casa con todo lo que cuelga de /api/v1/news. */
async function stubEditReads(page: Page): Promise<void> {
  await stubNewsReads(page, STUBBED_FEED_POSTS);
  await stubPublishReads(page, { holdUploads: false });
  const cover = await coverPicture();
  await page.route(
    (url) => url.pathname === STUBBED_COVER_PATH,
    (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: cover }),
  );
  await page.route(
    (url) => url.pathname === NEWS_MANAGE_ENDPOINT,
    (route, request) =>
      request.method() === "GET"
        ? route.fulfill(jsonBody(STUBBED_EDITABLE_POST))
        : route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "conflict", message: "Otra persona guardó." },
            }),
          }),
  );
}

const EDIT_STATES_EN: readonly PublishState[] = [
  {
    name: "editar-noticia",
    prepare: expectCoverPreviewLoaded,
  },
  {
    name: "editar-publicacion-conflicto",
    prepare: async (page) => {
      await page.getByLabel(/^(Title|Título)$/).fill("Pool change: MSAC");
      await page.getByRole("button", { name: SAVE_BUTTON }).click();
      await expect(
        page.getByText(/^(Someone else saved|Otra persona guardó)/),
      ).toBeVisible();
    },
  },
];

const EDIT_STATES: readonly PublishState[] = EDIT_STATES_EN.flatMap((state) => [
  state,
  { ...state, name: `${state.name}-es`, beforeVisit: chooseSpanish },
]);

async function goToEdit(
  page: Page,
  state: PublishState,
  theme?: (typeof themes)[number],
): Promise<void> {
  await stubEditReads(page);
  await state.beforeVisit?.(page);
  const path = newsEditPath(NEWS_OWN_POST_ID);
  if (theme === undefined) {
    await page.goto(`${APP_URL}${path}`);
  } else {
    await goToWithTheme(page, path, theme);
  }
  await expect(
    page.getByRole("heading", { level: 1, name: EDIT_HEADING }),
  ).toBeVisible();
  await expect(page.getByLabel(/^(Title|Título)$/)).toHaveValue(
    STUBBED_EDITABLE_POST.title,
  );
  await state.prepare(page);
  // El puntero se queda donde fue el último clic (una casilla, Guardar) y
  // pinta su hover en la captura según cuánto se movió la página después.
  await page.mouse.move(0, 0);
}

for (const state of EDIT_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of PUBLISH_PHOTO_VIEWPORTS) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToEdit(page, state, theme);
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }
      });
    }

    for (const theme of themes) {
      for (const width of NEWS_NARROW_WIDTHS) {
        test(`has no horizontal scroll at ${width}px (${theme})`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 812 });
          await goToEdit(page, state, theme);
          expect(await hasHorizontalScroll(page)).toBe(false);
        });
      }

      for (const vp of viewports) {
        test(`has no accessibility violations at ${vp.name} (axe-core, ${theme})`, async ({
          page,
        }) => {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await goToEdit(page, state, theme);
          await expectNoAxeViolations(page);
        });
      }
    }
  });
}

test.describe("editar y retirar en el navegador", () => {
  skipWithoutSession();
  quietNotificationBell();

  test.describe("como Admin", () => {
    test.use({ storageState: ADMIN_STORAGE_STATE });

    test("editar abre el formulario cargado y guardar vuelve a la publicación", async ({
      page,
    }) => {
      await stubEditReads(page);
      let sent: unknown = null;
      await page.route(
        (url) => url.pathname === NEWS_MANAGE_ENDPOINT,
        async (route, request) => {
          if (request.method() !== "PATCH") {
            return route.fallback();
          }
          sent = request.postDataJSON();
          return route.fulfill(
            jsonBody({ ...STUBBED_OWN_POST, title: "Pool change: MSAC" }),
          );
        },
      );
      await page.goto(`${APP_URL}${postPath(NEWS_OWN_POST_ID)}`);

      await page.getByRole("link", { name: "Edit" }).click();
      await expect(page).toHaveURL(
        new RegExp(`${newsEditPath(NEWS_OWN_POST_ID)}$`),
      );
      await expect(page.getByLabel(PUBLISH_GROUPS[0].name)).toBeChecked();
      await page.getByLabel("Title").fill("Pool change: MSAC");
      await page.getByRole("button", { name: SAVE_BUTTON }).click();

      await expect(page).toHaveURL(
        new RegExp(`${postPath(NEWS_OWN_POST_ID)}$`),
      );
      expect(sent).toEqual({
        category: STUBBED_EDITABLE_POST.category,
        title: "Pool change: MSAC",
        body: STUBBED_EDITABLE_POST.body,
        audience: STUBBED_EDITABLE_POST.audience,
        expectedEditedAt: STUBBED_EDITABLE_POST.editedAt,
      });
    });

    test("retirar pide confirmación y deja la publicación marcada", async ({
      page,
    }) => {
      await stubNewsReads(page, []);
      let sent: unknown = null;
      await page.route(
        (url) => url.pathname === NEWS_STATUS_ENDPOINT,
        async (route, request) => {
          sent = request.postDataJSON();
          await route.fulfill(
            jsonBody({ ...STUBBED_OWN_POST, status: "withdrawn" }),
          );
        },
      );
      await page.goto(`${APP_URL}${postPath(NEWS_OWN_POST_ID)}`);

      await page.getByRole("button", { name: "Withdraw" }).click();
      expect(sent).toBeNull();
      await page.getByRole("button", { name: "Withdraw post" }).click();

      await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Publish again" }),
      ).toBeVisible();
      expect(sent).toEqual({ status: "withdrawn" });
    });
  });

  test.describe("como Player", () => {
    test.use({ storageState: roleRequestStorageStatePath("perfil-completo") });

    test("la dirección de editar lo manda al panel", async ({ page }) => {
      await page.goto(`${APP_URL}${newsEditPath(NEWS_OWN_POST_ID)}`);

      await expect(page).toHaveURL(new RegExp("/dashboard$"));
    });
  });
});

// La agenda del Calendario (#311). La API se sirve desde el test con el
// contrato de #308 y #309, así la captura no depende de los eventos que haya
// en la base de desarrollo.
const CALENDAR_SCREEN_PATH = "/calendario";
const CALENDAR_AGENDA_ENDPOINT = "/api/v1/events";
const CALENDAR_NARROW_WIDTHS = [320, 375, 768] as const;
// En el móvil la agenda se titula Calendario (#656).
const CALENDAR_HEADING =
  /^(Upcoming events|Próximos eventos|Calendar|Calendario)$/;
const RSVP_MIN_TOUCH_TARGET_PX = 44;

const STUBBED_AGENDA_EVENTS = [
  {
    id: "e0e0e0e0-0000-4000-8000-0000000000e1",
    startsOn: "2026-06-23",
    startTime: "19:00",
    endTime: "20:30",
    endsOn: null,
    place: null,
    placeDetail: null,
    title: "Pool Training",
    eventType: "training",
    location: "MSAC Dive Pool",
    status: "scheduled",
    seriesId: "f0f0f0f0-0000-4000-8000-0000000000f1",
    goingCount: 14,
    maybeCount: 2,
    myResponse: "yes",
    inAudience: true,
    coverThumbUrl: null,
  },
  {
    id: "e0e0e0e0-0000-4000-8000-0000000000e2",
    startsOn: "2026-06-25",
    startTime: "19:30",
    endTime: "21:00",
    endsOn: null,
    place: null,
    placeDetail: null,
    title: "Skills & Conditioning",
    eventType: "training",
    location: "Fitzroy Pool",
    status: "scheduled",
    seriesId: null,
    goingCount: 11,
    maybeCount: 0,
    myResponse: null,
    inAudience: true,
    coverThumbUrl: null,
  },
  {
    id: "e0e0e0e0-0000-4000-8000-0000000000e3",
    startsOn: "2026-06-27",
    startTime: "10:00",
    endTime: "12:00",
    endsOn: null,
    place: null,
    placeDetail: null,
    title: "Scrimmage vs Geelong Krakens at the Geelong Aquatic Centre",
    eventType: "competition",
    location: "Geelong Aquatic Centre, 50 m pool, lanes 1 to 4",
    status: "scheduled",
    seriesId: null,
    goingCount: 18,
    maybeCount: 1,
    myResponse: "maybe",
    inAudience: true,
    coverThumbUrl: null,
  },
  {
    id: "e0e0e0e0-0000-4000-8000-0000000000e4",
    startsOn: "2026-06-28",
    startTime: "17:00",
    endTime: null,
    endsOn: null,
    place: null,
    placeDetail: null,
    title: "Committee Meeting",
    eventType: "meeting",
    location: "Clubroom / Zoom",
    status: "scheduled",
    seriesId: null,
    goingCount: 6,
    maybeCount: 0,
    myResponse: null,
    inAudience: false,
    coverThumbUrl: null,
  },
] as const;

const STUBBED_CANCELLED_EVENT = {
  id: "e0e0e0e0-0000-4000-8000-0000000000e5",
  startsOn: "2026-07-03",
  startTime: "19:00",
  endTime: "23:00",
  endsOn: null,
  place: null,
  placeDetail: null,
  title: "End-of-Season Social",
  eventType: "social",
  location: "The Boatbuilders Yard",
  status: "cancelled",
  seriesId: null,
  goingCount: 22,
  maybeCount: 0,
  myResponse: null,
  inAudience: true,
  coverThumbUrl: null,
} as const;

// Una agenda con un evento de cada tipo, todos en pie (#641): la etiqueta de
// cada tipo con su color, en los dos temas.
const STUBBED_EVENT_OF_EACH_TYPE = [
  ...STUBBED_AGENDA_EVENTS.slice(1),
  {
    ...STUBBED_CANCELLED_EVENT,
    id: "e0e0e0e0-0000-4000-8000-0000000000e8",
    status: "scheduled",
  },
] as const;

// Los pasados y la fila desplegada (#312). El detalle es el mismo para
// cualquier evento; cómo lo ve un Player o un Committee sólo cambia en que al
// segundo la API le manda la audiencia, que es lo que decide la pantalla.
const STUBBED_PAST_EVENTS = [
  {
    ...STUBBED_AGENDA_EVENTS[2],
    id: "e0e0e0e0-0000-4000-8000-0000000000e6",
    startsOn: "2026-05-30",
    title: "Round 3 vs Sydney Stingrays",
    myResponse: "yes",
    goingCount: 16,
    maybeCount: 0,
  },
  {
    ...STUBBED_AGENDA_EVENTS[0],
    id: "e0e0e0e0-0000-4000-8000-0000000000e7",
    startsOn: "2026-05-26",
    goingCount: 12,
    maybeCount: 1,
    myResponse: null,
  },
  {
    ...STUBBED_CANCELLED_EVENT,
    id: "e0e0e0e0-0000-4000-8000-0000000000e8",
    startsOn: "2026-05-15",
    title: "Autumn Quiz Night",
  },
] as const;

const PLAYER_OPENED_EVENT = {
  notes:
    "Bring fins, mask and snorkel. Warm-up starts 15 minutes early.\nParking is at the rear entrance on Aughtie Drive.",
  going: [
    "Ana Ruiz",
    "Ben Walker",
    "Chloe Nguyen",
    "Daniel Okafor",
    "Emma Johansson",
    "Felipe Castro",
    "Grace Lee",
    "Hamish MacLeod",
    "Isabella Rossi",
    "Jack Thompson",
    "Liam O'Connor",
    "Maximiliana Alejandra Fernández-Rodríguez de la Torre",
    "Noah Williams",
    "Olivia Brown",
  ],
  maybe: ["Mia Chen", "Sam Patel"],
} as const;

const COMMITTEE_OPENED_EVENT = {
  ...PLAYER_OPENED_EVENT,
  audience: {
    kind: "groups",
    groups: [
      { id: "a0a0a0a0-0000-4000-8000-0000000000a1", name: "Juniors" },
      { id: "a0a0a0a0-0000-4000-8000-0000000000a2", name: "Masters" },
      {
        id: "a0a0a0a0-0000-4000-8000-0000000000a3",
        name: "Women's Development Squad",
      },
    ],
  },
} as const;

const EMPTY_OPENED_EVENT = { notes: null, going: [], maybe: [] } as const;

// Los equipos del reparto publicado en la fila desplegada (#403). Mockup:
// docs/mockups/mobile-team-light.png y mobile-team-dark.png. Sin reparto
// publicado, la fila no enseña nada de equipos.
const NOT_PUBLISHED_TEAMS = { status: "not_published" } as const;

const CALENDAR_TEAM_POSITIONS = {
  forward: {
    id: "b1b1b1b1-0000-4000-8000-0000000000b1",
    names: { en: "Forward", es: "Ataque" },
  },
  goalkeeper: {
    id: "b1b1b1b1-0000-4000-8000-0000000000b2",
    names: { en: "Goalkeeper", es: "Portería" },
  },
  defender: {
    id: "b1b1b1b1-0000-4000-8000-0000000000b3",
    names: { en: "Defender", es: "Defensa" },
  },
} as const;

function lineupPlayer(
  index: number,
  fullName: string,
  position: keyof typeof CALENDAR_TEAM_POSITIONS | null,
): Record<string, unknown> {
  return {
    userId: `7f7f7f7f-0000-4000-8000-${String(index).padStart(12, "0")}`,
    fullName,
    position: position === null ? null : CALENDAR_TEAM_POSITIONS[position],
    isOutsideSquad: false,
  };
}

const LONG_LINEUP_NAME =
  "Maximiliana Alejandra Fernández-Rodríguez de la Torre";

const PUBLISHED_TEAMS = {
  status: "published",
  publishedAt: "2026-06-20T08:00:00.000Z",
  me: {
    team: "a",
    position: CALENDAR_TEAM_POSITIONS.forward,
    isOutsideSquad: false,
  },
  teams: {
    a: {
      name: "Team Kelp",
      color: "#1C6EA4",
      players: [
        lineupPlayer(1, "Daniela Vargas", "forward"),
        lineupPlayer(2, "Ethan Brown", "forward"),
        lineupPlayer(3, "Isabella Muñoz", "defender"),
        lineupPlayer(4, "Jack Thompson", "defender"),
        lineupPlayer(5, "Mateo Restrepo", "forward"),
        lineupPlayer(6, "Valentina Gómez", "goalkeeper"),
      ],
    },
    b: {
      name: "Team Tide",
      color: "#C99A3E",
      players: [
        lineupPlayer(7, "Chloe Nguyen", "forward"),
        lineupPlayer(8, "Grace Lee", "goalkeeper"),
        lineupPlayer(9, "Hamish MacLeod", "defender"),
        lineupPlayer(10, "Liam O'Connor", "forward"),
        lineupPlayer(11, LONG_LINEUP_NAME, "defender"),
        lineupPlayer(12, "Sam Patel", null),
      ],
    },
  },
} as const;

const UNASSIGNED_TEAMS = { ...PUBLISHED_TEAMS, me: null } as const;

// Dos que respondieron "No puedo ir" después de publicarse (#839): siguen en
// su sitio, tachados y con la ficha. El nombre largo prueba que a 320 px la
// ficha baja de línea sin abrir scroll horizontal.
const NOT_COMING_TEAMS = {
  ...PUBLISHED_TEAMS,
  teams: {
    a: {
      ...PUBLISHED_TEAMS.teams.a,
      players: PUBLISHED_TEAMS.teams.a.players.map((player) =>
        player.fullName === "Mateo Restrepo"
          ? { ...player, isOutsideSquad: true }
          : player,
      ),
    },
    b: {
      ...PUBLISHED_TEAMS.teams.b,
      players: PUBLISHED_TEAMS.teams.b.players.map((player) =>
        player.fullName === LONG_LINEUP_NAME
          ? { ...player, isOutsideSquad: true }
          : player,
      ),
    },
  },
} as const;

type CalendarReads = {
  readonly events: readonly unknown[];
  readonly pastEvents?: readonly unknown[];
  /** Lo que el detalle añade a cualquier evento al desplegarlo. */
  readonly opened?: object;
  /** Los equipos de cualquier evento; sin reparto publicado si falta. */
  readonly teams?: object;
};

/** La agenda de una sola página, y un 422 de evento empezado a cualquier
 * respuesta: sólo el estado del error llega a pulsar. */
async function stubCalendarReads(
  page: Page,
  reads: CalendarReads,
): Promise<void> {
  const pastEvents = reads.pastEvents ?? [];
  await stubPlaceMap(page);
  await page.route(
    (url) => url.pathname === CALENDAR_AGENDA_ENDPOINT,
    (route, request) => {
      const { searchParams } = new URL(request.url());
      const isPast = searchParams.get("period") === "past";
      // Los chips de tipo (#647) piden `types`: la API filtra, el stub también.
      const types = searchParams.get("types")?.split(",") ?? null;
      // El salto a una fecha (#710) pide `from`: los de ese día o antes.
      const from = searchParams.get("from");
      const events = (isPast ? pastEvents : reads.events).filter((event) => {
        const { eventType, startsOn } = event as {
          readonly eventType: string;
          readonly startsOn: string;
        };
        return (
          (types === null || types.includes(eventType)) &&
          (from === null || startsOn <= from)
        );
      });
      return route.fulfill(jsonBody({ events, nextCursor: null }));
    },
  );
  const opened = reads.opened ?? PLAYER_OPENED_EVENT;
  const allEvents = [...reads.events, ...pastEvents];
  await page.route(
    (url) =>
      url.pathname.startsWith(`${CALENDAR_AGENDA_ENDPOINT}/`) &&
      url.pathname.endsWith("/team"),
    (route) => route.fulfill(jsonBody(reads.teams ?? NOT_PUBLISHED_TEAMS)),
  );
  await page.route(
    (url) =>
      allEvents.some((event) => url.pathname === calendarEventPath(event)),
    (route, request) => {
      const { pathname } = new URL(request.url());
      const event = allEvents.find(
        (candidate) => pathname === calendarEventPath(candidate),
      );
      return route.fulfill(
        jsonBody({
          ...(event as object),
          coverUrl: null,
          series: null,
          ...opened,
        }),
      );
    },
  );
  await page.route(
    (url) =>
      url.pathname.startsWith(`${CALENDAR_AGENDA_ENDPOINT}/`) &&
      url.pathname.endsWith("/rsvp"),
    (route) =>
      route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "business_rule",
            message: "El evento ya empezó: ya no se puede responder.",
            reason: "rsvp_event_started",
          },
        }),
      }),
  );
}

function calendarEventPath(event: unknown): string {
  const { id } = event as { readonly id: string };
  return `${CALENDAR_AGENDA_ENDPOINT}/${id}`;
}

type CalendarState = CalendarReads & {
  readonly name: string;
  /** Quién mira. Sin él, un Admin. */
  readonly storageState?: string;
  readonly beforeVisit?: (page: Page) => Promise<void>;
  /** Lo que tiene que estar a la vista para que la pantalla haya cargado. */
  readonly ready: (page: Page) => Promise<void>;
};

async function waitForAgendaRows(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: STUBBED_AGENDA_EVENTS[0].title,
    }),
  ).toBeVisible();
}

async function waitForEmptyAgenda(page: Page): Promise<void> {
  await expect(
    page.getByText(/There are no upcoming events|No hay eventos próximos/),
  ).toBeVisible();
}

/** Responde No puedo al primer evento y espera el aviso del 422 en su
 * panel (#648). */
async function showRsvpError(page: Page): Promise<void> {
  await openFirstPanel(page);
  const panel = eventPanel(page, STUBBED_AGENDA_EVENTS[0].title);
  await panel
    .getByRole("group")
    .getByRole("button", { name: /^(Can't go|No puedo)$/ })
    .click();
  // Sólo el del panel: el anunciador de rutas de Next también es un alert.
  await expect(panel.getByRole("alert")).toBeVisible();
  await page.mouse.move(0, 0);
}

const EVENT_TYPE_NAMES = /^(Training|Competition|Social|Meeting)$/;

async function waitForEachTypeTag(page: Page): Promise<void> {
  // En la lista: los chips de tipo (#647) también nombran los cuatro.
  const agenda = page.getByRole("list", { name: CALENDAR_HEADING });
  await expect(agenda.getByText(EVENT_TYPE_NAMES)).toHaveCount(
    STUBBED_EVENT_OF_EACH_TYPE.length,
  );
}

/** La fila del evento. El día que la agrupa también es un elemento de la
 * lista que la contiene (#647): la fila es el último que casa. */
function agendaRow(page: Page, title: string): Locator {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name: title }) })
    .last();
}

/** El panel del evento elegido (#648) o, en el móvil, su pantalla (#656). */
function eventPanel(page: Page, title: string): Locator {
  return page
    .getByRole("complementary", { name: title })
    .or(page.getByRole("article", { name: title }));
}

/** "Going · n", que sólo sale cuando el detalle ya llegó. */
const PANEL_LOADED_HEADING = /^(Going|Van) · \d+$/;

/** Elige la fila si no lo estaba y espera a que el panel tenga su detalle. */
async function openPanelOf(page: Page, title: string): Promise<Locator> {
  const toggle = agendaRow(page, title).getByRole("button", { name: title });
  if ((await toggle.getAttribute("aria-current")) !== "true") {
    await toggle.click();
  }
  const panel = eventPanel(page, title);
  await expect(
    panel.getByRole("heading", { name: PANEL_LOADED_HEADING }),
  ).toBeVisible();
  await page.mouse.move(0, 0);
  return panel;
}

/** El primer evento llega elegido: espera a que su panel esté pintado. */
async function openFirstPanel(page: Page): Promise<void> {
  await waitForAgendaRows(page);
  await openPanelOf(page, STUBBED_AGENDA_EVENTS[0].title);
}

/** Abre el primer evento y espera a que sus equipos estén pintados. */
async function openFirstPanelWithTeams(page: Page): Promise<void> {
  await openFirstPanel(page);
  await expect(
    eventPanel(page, STUBBED_AGENDA_EVENTS[0].title).getByRole("list", {
      name: PUBLISHED_TEAMS.teams.b.name,
    }),
  ).toBeVisible();
}

/** En escritorio el panel del evento mide como mucho la ventana y corta en
 * la cabecera de los equipos (#839). La captura alarga la ventana hasta que
 * el panel entero cabe sin su scroll, y se ve a quien ya no viene. Bajar el
 * scroll del panel no servía: la ventana de 1×1 de la captura de página
 * entera lo devolvía arriba, y alargar la ventana poco a poco no acababa
 * nunca, porque el panel crece con ella. */
async function showNotComingTeammates(page: Page): Promise<void> {
  await openFirstPanelWithTeams(page);
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error("La página no tiene un tamaño de ventana fijo.");
  }
  const panelBottom = await eventPanel(
    page,
    STUBBED_AGENDA_EVENTS[0].title,
  ).evaluate(
    (panel) =>
      panel.getBoundingClientRect().top + window.scrollY + panel.scrollHeight,
  );
  await page.setViewportSize({
    width: viewport.width,
    height: Math.max(viewport.height, Math.ceil(panelBottom)),
  });
  await fitViewportToPage(page);
  await page.mouse.move(0, 0);
}

/** Cambia a los pasados y espera a que estén pintados. */
async function showPastEvents(page: Page): Promise<void> {
  await waitForAgendaRows(page);
  await page.getByRole("button", { name: /^(Past|Pasados)$/ }).click();
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: STUBBED_PAST_EVENTS[0].title,
    }),
  ).toBeVisible();
  await page.mouse.move(0, 0);
}

const CALENDAR_EXPANDED_AS_PLAYER: CalendarState = {
  name: "calendario-desplegado-player",
  events: STUBBED_AGENDA_EVENTS,
  opened: PLAYER_OPENED_EVENT,
  ready: openFirstPanel,
};

const CALENDAR_WITH_EVENTS: CalendarState = {
  name: "calendario-con-eventos",
  events: STUBBED_AGENDA_EVENTS,
  ready: waitForAgendaRows,
};

const CALENDAR_STATES: readonly CalendarState[] = [
  CALENDAR_WITH_EVENTS,
  {
    name: "calendario-con-eventos-es",
    events: STUBBED_AGENDA_EVENTS,
    beforeVisit: chooseSpanish,
    ready: waitForAgendaRows,
  },
  {
    name: "calendario-vacio",
    events: [],
    ready: waitForEmptyAgenda,
  },
  {
    name: "calendario-vacio-es",
    events: [],
    beforeVisit: chooseSpanish,
    ready: waitForEmptyAgenda,
  },
  {
    name: "calendario-con-cancelado",
    events: [...STUBBED_AGENDA_EVENTS, STUBBED_CANCELLED_EVENT],
    ready: waitForAgendaRows,
  },
  {
    name: "calendario-con-cancelado-es",
    events: [...STUBBED_AGENDA_EVENTS, STUBBED_CANCELLED_EVENT],
    beforeVisit: chooseSpanish,
    ready: waitForAgendaRows,
  },
  {
    name: "calendario-cada-tipo",
    events: STUBBED_EVENT_OF_EACH_TYPE,
    ready: waitForEachTypeTag,
  },
  {
    name: "calendario-error-rsvp",
    events: STUBBED_AGENDA_EVENTS,
    ready: showRsvpError,
  },
  {
    name: "calendario-error-rsvp-es",
    events: STUBBED_AGENDA_EVENTS,
    beforeVisit: chooseSpanish,
    ready: showRsvpError,
  },
  CALENDAR_EXPANDED_AS_PLAYER,
  {
    ...CALENDAR_EXPANDED_AS_PLAYER,
    name: "calendario-desplegado-player-es",
    beforeVisit: chooseSpanish,
  },
  {
    ...CALENDAR_EXPANDED_AS_PLAYER,
    name: "calendario-desplegado-committee",
    opened: COMMITTEE_OPENED_EVENT,
  },
  {
    ...CALENDAR_EXPANDED_AS_PLAYER,
    name: "calendario-desplegado-committee-es",
    opened: COMMITTEE_OPENED_EVENT,
    beforeVisit: chooseSpanish,
  },
  {
    ...CALENDAR_EXPANDED_AS_PLAYER,
    name: "calendario-desplegado-sin-notas",
    opened: EMPTY_OPENED_EVENT,
  },
  {
    ...CALENDAR_EXPANDED_AS_PLAYER,
    name: "calendario-desplegado-sin-notas-es",
    opened: EMPTY_OPENED_EVENT,
    beforeVisit: chooseSpanish,
  },
  {
    ...CALENDAR_EXPANDED_AS_PLAYER,
    name: "calendario-mi-equipo",
    teams: PUBLISHED_TEAMS,
    ready: openFirstPanelWithTeams,
  },
  {
    ...CALENDAR_EXPANDED_AS_PLAYER,
    name: "calendario-mi-equipo-es",
    teams: PUBLISHED_TEAMS,
    beforeVisit: chooseSpanish,
    ready: openFirstPanelWithTeams,
  },
  {
    ...CALENDAR_EXPANDED_AS_PLAYER,
    name: "calendario-equipos-sin-asignar",
    teams: UNASSIGNED_TEAMS,
    ready: openFirstPanelWithTeams,
  },
  {
    ...CALENDAR_EXPANDED_AS_PLAYER,
    name: "calendario-equipos-sin-asignar-es",
    teams: UNASSIGNED_TEAMS,
    beforeVisit: chooseSpanish,
    ready: openFirstPanelWithTeams,
  },
  {
    ...CALENDAR_EXPANDED_AS_PLAYER,
    name: "evento-equipos-ya-no-viene",
    teams: NOT_COMING_TEAMS,
    ready: showNotComingTeammates,
  },
  {
    ...CALENDAR_EXPANDED_AS_PLAYER,
    name: "evento-equipos-ya-no-viene-es",
    teams: NOT_COMING_TEAMS,
    beforeVisit: chooseSpanish,
    ready: showNotComingTeammates,
  },
  {
    name: "calendario-sin-membresia",
    events: STUBBED_AGENDA_EVENTS,
    storageState: UNPAID_MEMBER_STORAGE_STATE_PATH,
    ready: waitForAgendaRows,
  },
  {
    name: "calendario-sin-membresia-es",
    events: STUBBED_AGENDA_EVENTS,
    storageState: UNPAID_MEMBER_STORAGE_STATE_PATH,
    beforeVisit: chooseSpanish,
    ready: waitForAgendaRows,
  },
  {
    name: "calendario-pasados",
    events: STUBBED_AGENDA_EVENTS,
    pastEvents: STUBBED_PAST_EVENTS,
    ready: showPastEvents,
  },
  {
    name: "calendario-pasados-es",
    events: STUBBED_AGENDA_EVENTS,
    pastEvents: STUBBED_PAST_EVENTS,
    beforeVisit: chooseSpanish,
    ready: showPastEvents,
  },
];

async function goToCalendar(
  page: Page,
  state: CalendarState,
  theme?: (typeof themes)[number],
): Promise<void> {
  await stubCalendarReads(page, state);
  await state.beforeVisit?.(page);
  if (theme === undefined) {
    await page.goto(`${APP_URL}${CALENDAR_SCREEN_PATH}`);
  } else {
    await goToWithTheme(page, CALENDAR_SCREEN_PATH, theme);
  }
  await expect(
    page.getByRole("heading", { level: 1, name: CALENDAR_HEADING }),
  ).toBeVisible();
  await state.ready(page);
}

for (const state of CALENDAR_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: state.storageState ?? ADMIN_STORAGE_STATE });

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToCalendar(page, state, theme);
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }
      });
    }

    for (const width of CALENDAR_NARROW_WIDTHS) {
      test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 812 });
        await goToCalendar(page, state);
        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await goToCalendar(page, state);
      await expectNoAxeViolations(page);
    });
  });
}

// La agenda de escritorio de E24 (#647, "#1a Agenda + panel" del handoff;
// mockup: docs/mockups/calendar-redesign-agenda-dark.png). El reloj se fija
// en el jueves 25 de junio de 2026 por la mañana en Melbourne: "TODAY" y
// "This weekend" dependen de hoy, y sin reloj fijo la captura cambiaría cada
// día. El móvil es #656: aquí sólo 768 y 1440.
const AGENDA_REDESIGN_NOW = new Date("2026-06-25T00:00:00.000Z");
const AGENDA_REDESIGN_VIEWPORTS = viewports.filter(
  (vp) => vp.name !== "mobile",
);

const AGENDA_REDESIGN_EVENTS = [
  {
    ...STUBBED_AGENDA_EVENTS[0],
    id: "e0e0e0e0-0000-4000-8000-0000000000f1",
    startsOn: "2026-06-25",
    title: "Tuesday–Thursday open training",
    myResponse: "yes",
  },
  {
    ...STUBBED_CANCELLED_EVENT,
    id: "e0e0e0e0-0000-4000-8000-0000000000f2",
    startsOn: "2026-06-27",
    status: "scheduled",
    title: "Fundraiser trivia night",
    myResponse: "maybe",
    goingCount: 34,
    coverThumbUrl: STUBBED_COVER_THUMBNAIL_URL,
  },
  {
    ...STUBBED_AGENDA_EVENTS[2],
    id: "e0e0e0e0-0000-4000-8000-0000000000f3",
    startsOn: "2026-06-27",
    myResponse: null,
  },
  {
    ...STUBBED_AGENDA_EVENTS[3],
    id: "e0e0e0e0-0000-4000-8000-0000000000f4",
    startsOn: "2026-06-30",
  },
  {
    ...STUBBED_CANCELLED_EVENT,
    id: "e0e0e0e0-0000-4000-8000-0000000000f5",
    myResponse: "no",
  },
] as const;

async function fixAgendaClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(AGENDA_REDESIGN_NOW);
  await stubNewsCovers(page);
}

async function waitForRedesignedAgenda(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: AGENDA_REDESIGN_EVENTS[0].title,
    }),
  ).toBeVisible();
  await expect(page.locator(".agenda-thumbnail img")).toHaveJSProperty(
    "complete",
    true,
  );
}

/** Apaga Competition y Meeting y espera la agenda que pidió con los demás. */
async function filterRedesignedAgenda(page: Page): Promise<void> {
  await waitForRedesignedAgenda(page);
  const chips = page.getByRole("group", {
    name: /^(Event types|Tipos de evento)$/,
  });
  await chips.getByRole("button", { name: "Competition" }).click();
  await chips.getByRole("button", { name: "Meeting" }).click();
  await expect(page).toHaveURL(/types=training%2Csocial$/);
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: AGENDA_REDESIGN_EVENTS[2].title,
    }),
  ).toHaveCount(0);
  await page.mouse.move(0, 0);
}

// El panel del evento (#648, mockups calendar-redesign-agenda-dark.png y
// calendar-redesign-series-edit-scope-dark.png): una cena con imagen, una
// sesión de una serie y una competición de dos días.
const PANEL_SOCIAL_EVENT = {
  ...AGENDA_REDESIGN_EVENTS[1],
  place: {
    name: "Seadragons Clubhouse",
    address: "12 Beach Rd, St Kilda VIC 3182",
    lat: -37.8676,
    lng: 144.9741,
  },
  location: "Seadragons Clubhouse",
} as const;

const PANEL_SERIES_EVENT = AGENDA_REDESIGN_EVENTS[0];

const PANEL_MULTI_DAY_EVENT = {
  ...AGENDA_REDESIGN_EVENTS[2],
  title: "Winter skills camp",
  startTime: "08:30",
  endsOn: "2026-06-28",
  endTime: "17:00",
} as const;

const PANEL_SERIES_OPENED = {
  ...PLAYER_OPENED_EVENT,
  series: { weekdays: [2, 4], endsOn: "2026-09-17", sessionsLeft: 25 },
} as const;

/** Elige el evento y espera su panel con la imagen ya cargada. */
function choosePanelEvent(title: string): (page: Page) => Promise<void> {
  return async (page) => {
    await expect(
      page.getByRole("heading", { level: 3, name: title }),
    ).toBeVisible();
    await openPanelOf(page, title);
    for (const image of await page.locator(".agenda-columns img").all()) {
      await expect(image).toHaveJSProperty("complete", true);
    }
  };
}

const EVENT_PANEL_STATES: readonly CalendarState[] = [
  {
    name: "calendario-panel-social",
    events: [PANEL_SERIES_EVENT, PANEL_SOCIAL_EVENT],
    opened: { ...PLAYER_OPENED_EVENT, coverUrl: STUBBED_COVER_URL },
    beforeVisit: fixAgendaClock,
    ready: choosePanelEvent(PANEL_SOCIAL_EVENT.title),
  },
  {
    name: "calendario-panel-serie",
    events: [PANEL_SERIES_EVENT, PANEL_SOCIAL_EVENT],
    opened: PANEL_SERIES_OPENED,
    beforeVisit: fixAgendaClock,
    ready: choosePanelEvent(PANEL_SERIES_EVENT.title),
  },
  {
    name: "calendario-panel-varios-dias",
    events: [PANEL_SERIES_EVENT, PANEL_MULTI_DAY_EVENT],
    opened: COMMITTEE_OPENED_EVENT,
    beforeVisit: fixAgendaClock,
    ready: choosePanelEvent(PANEL_MULTI_DAY_EVENT.title),
  },
];

const AGENDA_REDESIGN_STATES: readonly CalendarState[] = [
  ...EVENT_PANEL_STATES,
  {
    name: "calendario-agenda",
    events: AGENDA_REDESIGN_EVENTS,
    beforeVisit: fixAgendaClock,
    ready: waitForRedesignedAgenda,
  },
  {
    name: "calendario-agenda-filtrada",
    events: AGENDA_REDESIGN_EVENTS,
    beforeVisit: fixAgendaClock,
    ready: filterRedesignedAgenda,
  },
  {
    name: "calendario-agenda-pasados",
    events: STUBBED_AGENDA_EVENTS,
    pastEvents: STUBBED_PAST_EVENTS,
    beforeVisit: fixAgendaClock,
    ready: showPastEvents,
  },
];

for (const state of AGENDA_REDESIGN_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of AGENDA_REDESIGN_VIEWPORTS) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        for (const theme of themes) {
          test(`matches approved baseline (${theme})`, async ({ page }) => {
            await goToCalendar(page, state, theme);
            const snapshot = `${state.name}-${vp.name}-${theme}.png`;
            await createMissingLocalBaseline(snapshot, () =>
              page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
            );
            await expect(page).toHaveScreenshot(snapshot, {
              ...SCREENSHOT_OPTIONS,
              fullPage: true,
              maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
            });
          });
        }
      });
    }

    test("has no horizontal scroll at 375px", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await goToCalendar(page, state);
      expect(await hasHorizontalScroll(page)).toBe(false);
    });

    for (const theme of themes) {
      test(`has no accessibility violations (axe-core, ${theme})`, async ({
        page,
      }) => {
        await goToCalendar(page, state, theme);
        await expectNoAxeViolations(page);
      });
    }
  });
}

// Voy, Quizás y No puedo en la fila de escritorio (#731): responder desde la
// fila sin elegirla. Toda respuesta recibe el 422 de evento empezado, así que
// el aviso sale bajo los botones de la fila. El móvil no tiene esos botones:
// sólo 768 y 1440.
async function showRowRsvpError(page: Page): Promise<void> {
  await waitForRedesignedAgenda(page);
  const row = agendaRow(page, AGENDA_REDESIGN_EVENTS[2].title);
  await row
    .getByRole("group")
    .getByRole("button", { name: /^(Can't go|No puedo)$/ })
    .click();
  await expect(row.getByRole("alert")).toBeVisible();
  await page.mouse.move(0, 0);
}

const ROW_RSVP_ERROR_STATE: CalendarState = {
  name: "calendario-fila-rsvp-error",
  events: AGENDA_REDESIGN_EVENTS,
  beforeVisit: fixAgendaClock,
  ready: showRowRsvpError,
};

test.describe(ROW_RSVP_ERROR_STATE.name, () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  for (const vp of AGENDA_REDESIGN_VIEWPORTS) {
    test.describe(`@ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const theme of themes) {
        test(`matches approved baseline (${theme})`, async ({ page }) => {
          await goToCalendar(page, ROW_RSVP_ERROR_STATE, theme);
          const snapshot = `${ROW_RSVP_ERROR_STATE.name}-${vp.name}-${theme}.png`;
          await createMissingLocalBaseline(snapshot, () =>
            page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
          );
          await expect(page).toHaveScreenshot(snapshot, {
            ...SCREENSHOT_OPTIONS,
            fullPage: true,
            maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
          });
        });

        test(`has no accessibility violations (axe-core, ${theme})`, async ({
          page,
        }) => {
          await goToCalendar(page, ROW_RSVP_ERROR_STATE, theme);
          await expectNoAxeViolations(page);
        });
      }
    });
  }

  test("has no horizontal scroll at 768px", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 812 });
    await goToCalendar(page, ROW_RSVP_ERROR_STATE);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
});

// Saltar a una fecha en Pasados (#710): tras saltar a un día sin eventos la
// lista empieza en el anterior que sí tiene; antes de todo, el vacío. Con el
// reloj fijo, para que "ayer" y las etiquetas de los días no cambien. A 375
// el selector baja a todo el ancho de la cabecera del móvil (#656).
const PAST_JUMP_DATE = "2026-05-28";
const PAST_JUMP_BEFORE_EVERYTHING = "2026-01-10";

function jumpToPastDate(
  date: string,
  shown: (page: Page) => Promise<void>,
): (page: Page) => Promise<void> {
  return async (page) => {
    await showPastEvents(page);
    const field = page.getByLabel(/^(Go to a date|Ir a una fecha)$/);
    await field.fill(date);
    // Sin el cursor del campo: parpadea y movería la captura.
    await field.blur();
    await shown(page);
    await page.mouse.move(0, 0);
  };
}

const PAST_JUMPED_STATE: CalendarState = {
  name: "calendario-pasados-saltar-fecha",
  events: STUBBED_AGENDA_EVENTS,
  pastEvents: STUBBED_PAST_EVENTS,
  beforeVisit: fixAgendaClock,
  ready: jumpToPastDate(PAST_JUMP_DATE, async (page) => {
    await expect(
      page.getByRole("heading", {
        level: 3,
        name: STUBBED_PAST_EVENTS[0].title,
      }),
    ).toBeHidden();
    await expect(
      page.getByRole("heading", {
        level: 3,
        name: STUBBED_PAST_EVENTS[1].title,
      }),
    ).toBeVisible();
  }),
};

const PAST_JUMP_STATES: readonly CalendarState[] = [
  PAST_JUMPED_STATE,
  {
    name: "calendario-pasados-saltar-vacio",
    events: STUBBED_AGENDA_EVENTS,
    pastEvents: STUBBED_PAST_EVENTS,
    beforeVisit: fixAgendaClock,
    ready: jumpToPastDate(PAST_JUMP_BEFORE_EVERYTHING, async (page) => {
      await expect(
        page.getByText("No events on or before that date."),
      ).toBeVisible();
    }),
  },
];

for (const state of PAST_JUMP_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        for (const theme of themes) {
          test(`matches approved baseline (${theme})`, async ({ page }) => {
            await goToCalendar(page, state, theme);
            const snapshot = `${state.name}-${vp.name}-${theme}.png`;
            await createMissingLocalBaseline(snapshot, () =>
              page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
            );
            await expect(page).toHaveScreenshot(snapshot, {
              ...SCREENSHOT_OPTIONS,
              fullPage: true,
              maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
            });
          });

          test(`has no accessibility violations (axe-core, ${theme})`, async ({
            page,
          }) => {
            await goToCalendar(page, state, theme);
            await expectNoAxeViolations(page);
          });
        }
      });
    }

    test("has no horizontal scroll at 375px", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await goToCalendar(page, state);
      expect(await hasHorizontalScroll(page)).toBe(false);
    });
  });
}

test.describe("calendario-pasados-saltar-movil", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("el selector ocupa el ancho de la cabecera con zona táctil de 44px a 375px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToCalendar(page, PAST_JUMPED_STATE);

    const header = await page.locator(".agenda-header").boundingBox();
    const jump = await page.locator(".agenda-jump").boundingBox();
    const field = await page.getByLabel("Go to a date").boundingBox();
    const latest = await page
      .getByRole("button", { name: "Most recent" })
      .boundingBox();
    expect(jump?.width).toBeCloseTo(header?.width ?? 0, 0);
    expect(field?.height).toBeGreaterThanOrEqual(44);
    expect(latest?.height).toBeGreaterThanOrEqual(44);
  });
});

// Un título tres veces más largo de lo normal a 768 (#731): se corta con
// puntos suspensivos antes de empujar los botones fuera de la fila.
const LONG_TITLE_EVENT = {
  ...AGENDA_REDESIGN_EVENTS[2],
  title:
    "Inter-club scrimmage and skills clinic with the Geelong Krakens and the Ballarat Barracudas",
} as const;

test.describe("calendario-fila-rsvp-titulo-largo", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("corta el título y deja los botones a la vista a 768px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 812 });
    await goToCalendar(page, {
      name: "calendario-fila-rsvp-titulo-largo",
      events: [AGENDA_REDESIGN_EVENTS[0], LONG_TITLE_EVENT],
      beforeVisit: fixAgendaClock,
      ready: waitForAgendaRowsOf(LONG_TITLE_EVENT.title),
    });

    expect(await hasHorizontalScroll(page)).toBe(false);
    const row = agendaRow(page, LONG_TITLE_EVENT.title);
    const title = row.locator(".agenda-title-text");
    expect(
      await title.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    const cantGoButton = row
      .getByRole("group")
      .getByRole("button", { name: /^(Can't go|No puedo)$/ });
    await expect(cantGoButton).toBeInViewport({ ratio: 1 });
  });
});

function waitForAgendaRowsOf(title: string): (page: Page) => Promise<void> {
  return async (page) => {
    await expect(
      page.getByRole("heading", { level: 3, name: title }),
    ).toBeVisible();
  };
}

// El mapa de la tarjeta del lugar (#658, RF-15 y D3 del PRD de E24; la zona
// "MAP PREVIEW" de calendar-redesign-agenda-dark.png). El panel de la cena
// del club, que tiene coordenadas, a 1440 y a 375.
const PLACE_MAP_VIEWPORTS = viewports.filter((vp) => vp.name !== "tablet");

const PLACE_MAP_SELECTOR =
  'iframe[src^="https://www.openstreetmap.org/export/embed.html"]';

/** Elige la cena, lleva su tarjeta a la vista (el iframe es perezoso) y
 * espera a que el mapa haya cargado. */
async function showPlaceMap(page: Page): Promise<void> {
  await choosePanelEvent(PANEL_SOCIAL_EVENT.title)(page);
  const map = eventPanel(page, PANEL_SOCIAL_EVENT.title).locator(
    PLACE_MAP_SELECTOR,
  );
  await map.scrollIntoViewIfNeeded();
  await expect(
    page.frameLocator(PLACE_MAP_SELECTOR).locator("body"),
  ).toBeVisible();
  await page.mouse.move(0, 0);
}

const PLACE_MAP_STATE: CalendarState = {
  name: "calendario-panel-mapa",
  events: [PANEL_SERIES_EVENT, PANEL_SOCIAL_EVENT],
  opened: { ...PLAYER_OPENED_EVENT, coverUrl: STUBBED_COVER_URL },
  beforeVisit: fixAgendaClock,
  ready: showPlaceMap,
};

const PLACE_MAP_CAPTURES = {
  desktop: "calendario-panel-mapa",
  mobile: "calendario-movil-mapa",
} as const;

test.describe("mapa de la tarjeta del lugar", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  for (const vp of PLACE_MAP_VIEWPORTS) {
    test.describe(`@ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });
      const capture =
        PLACE_MAP_CAPTURES[vp.name as keyof typeof PLACE_MAP_CAPTURES];

      for (const theme of themes) {
        test(`matches approved baseline (${theme})`, async ({ page }) => {
          await goToCalendar(page, PLACE_MAP_STATE, theme);
          const snapshot = `${capture}-${theme}.png`;
          const card = eventPanel(page, PANEL_SOCIAL_EVENT.title);
          await createMissingLocalBaseline(snapshot, () =>
            card.screenshot(SCREENSHOT_OPTIONS),
          );
          await expect(card).toHaveScreenshot(snapshot, SCREENSHOT_OPTIONS);
        });

        test(`has no accessibility violations (axe-core, ${theme})`, async ({
          page,
        }) => {
          await goToCalendar(page, PLACE_MAP_STATE, theme);
          await expectNoAxeViolations(page);
        });
      }
    });
  }

  test("tocar el mapa abre Google Maps en otra pestaña", async ({ page }) => {
    await goToCalendar(page, PLACE_MAP_STATE);
    const map = eventPanel(page, PANEL_SOCIAL_EVENT.title).locator(
      PLACE_MAP_SELECTOR,
    );
    const box = await map.boundingBox();
    if (box === null) {
      throw new Error("El mapa no está a la vista.");
    }

    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.mouse.click(box.x + box.width / 4, box.y + box.height / 2),
    ]);

    expect(popup.url()).toContain(
      "https://www.google.com/maps/search/?api=1&query=-37.8676,144.9741",
    );
    await popup.close();
  });

  test("el mapa no mueve nada al aparecer", async ({ page }) => {
    let releaseMap: () => void = () => undefined;
    const mapReleased = new Promise<void>((resolve) => {
      releaseMap = resolve;
    });
    await goToCalendar(page, {
      ...PLACE_MAP_STATE,
      beforeVisit: async (visited) => {
        await fixAgendaClock(visited);
        await visited.route(PLACE_MAP_URL, async (route) => {
          await mapReleased;
          await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: STUBBED_PLACE_MAP_PAGE,
          });
        });
      },
      ready: choosePanelEvent(PANEL_SOCIAL_EVENT.title),
    });
    await page.evaluate(() => {
      const shifts: number[] = [];
      Reflect.set(window, "placeMapShifts", shifts);
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          shifts.push((entry as unknown as { value: number }).value);
        }
      }).observe({ type: "layout-shift" });
    });

    releaseMap();
    await expect(
      page.frameLocator(PLACE_MAP_SELECTOR).locator("body"),
    ).toBeVisible();

    const shifts = await page.evaluate(
      () => Reflect.get(window, "placeMapShifts") as number[],
    );
    expect(shifts).toEqual([]);
  });

  test("sin red se ve el fondo con el pin y Directions sigue", async ({
    page,
  }) => {
    await goToCalendar(page, {
      ...PLACE_MAP_STATE,
      beforeVisit: async (visited) => {
        await fixAgendaClock(visited);
        await visited.route(PLACE_MAP_URL, (route) =>
          route.abort("internetdisconnected"),
        );
      },
      ready: choosePanelEvent(PANEL_SOCIAL_EVENT.title),
    });
    const panel = eventPanel(page, PANEL_SOCIAL_EVENT.title);

    await expect(panel.locator(".agenda-place-map-fallback svg")).toBeVisible();
    await expect(
      panel.getByRole("link", { name: /Directions/ }),
    ).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=-37.8676,144.9741",
    );
  });
});

// El calendario en el móvil (#656, RF-12 y RF-13 del PRD de E24; mockups
// mobile-calendar-redesign-agenda-dark.png, -event-dark.png y
// -event-actions-dark.png): las tarjetas, la pantalla del evento y la hoja
// ⋯ de una serie, a 375. Desde 768 se ve el escritorio, que fotografían los
// estados de arriba. Quien mira es un Admin con la audiencia del detalle: es
// a quien le sale el ⋯.
const MOBILE_CALENDAR_VIEWPORTS = viewports.filter(
  (vp) => vp.name === "mobile",
);

const MOBILE_SERIES_OPENED = {
  ...COMMITTEE_OPENED_EVENT,
  series: PANEL_SERIES_OPENED.series,
} as const;

const MOBILE_CANCELLED_EVENT = AGENDA_REDESIGN_EVENTS[4];

const MORE_ACTIONS_NAME = /^(Event actions|Acciones del evento)$/;

/** Abre el evento de la serie y despliega su hoja ⋯. */
async function showSeriesSheet(page: Page): Promise<void> {
  await choosePanelEvent(PANEL_SERIES_EVENT.title)(page);
  await eventPanel(page, PANEL_SERIES_EVENT.title)
    .getByRole("button", { name: MORE_ACTIONS_NAME })
    .click();
  const sheet = page.getByRole("dialog", { name: MORE_ACTIONS_NAME });
  await expect(
    sheet.getByRole("button", { name: /^(Cancel event|Cancelar evento)$/ }),
  ).toBeVisible();
  // La hoja sube con una transición: se fotografía quieta.
  await expect(sheet).toHaveJSProperty("open", true);
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== "running"),
  );
  await page.mouse.move(0, 0);
}

const MOBILE_AGENDA_STATE: CalendarState = {
  name: "calendario-movil-agenda",
  events: AGENDA_REDESIGN_EVENTS,
  beforeVisit: fixAgendaClock,
  ready: waitForRedesignedAgenda,
};

const MOBILE_CALENDAR_STATES: readonly CalendarState[] = [
  MOBILE_AGENDA_STATE,
  {
    name: "calendario-movil-evento",
    events: [PANEL_SERIES_EVENT, PANEL_SOCIAL_EVENT],
    opened: MOBILE_SERIES_OPENED,
    beforeVisit: fixAgendaClock,
    ready: choosePanelEvent(PANEL_SERIES_EVENT.title),
  },
  {
    name: "calendario-movil-evento-cancelado",
    events: [PANEL_SERIES_EVENT, MOBILE_CANCELLED_EVENT],
    opened: COMMITTEE_OPENED_EVENT,
    beforeVisit: fixAgendaClock,
    ready: choosePanelEvent(MOBILE_CANCELLED_EVENT.title),
  },
  {
    name: "calendario-movil-acciones-serie",
    events: [PANEL_SERIES_EVENT, PANEL_SOCIAL_EVENT],
    opened: MOBILE_SERIES_OPENED,
    beforeVisit: fixAgendaClock,
    ready: showSeriesSheet,
  },
];

/** La hoja vive en la capa superior: se fotografía lo que se ve. */
const MOBILE_VIEWPORT_ONLY_STATES = new Set([
  "calendario-movil-acciones-serie",
]);

for (const state of MOBILE_CALENDAR_STATES) {
  const isFullPage = !MOBILE_VIEWPORT_ONLY_STATES.has(state.name);
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of MOBILE_CALENDAR_VIEWPORTS) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        for (const theme of themes) {
          test(`matches approved baseline (${theme})`, async ({ page }) => {
            await goToCalendar(page, state, theme);
            const snapshot = `${state.name}-${theme}.png`;
            await createMissingLocalBaseline(snapshot, () =>
              page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: isFullPage }),
            );
            await expect(page).toHaveScreenshot(snapshot, {
              ...SCREENSHOT_OPTIONS,
              fullPage: isFullPage,
              maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
            });
          });

          test(`has no accessibility violations (axe-core, ${theme})`, async ({
            page,
          }) => {
            await goToCalendar(page, state, theme);
            await expectNoAxeViolations(page);
          });
        }
      });
    }

    test("has no horizontal scroll at 320px", async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 812 });
      await goToCalendar(page, state);
      expect(await hasHorizontalScroll(page)).toBe(false);
    });
  });
}

test.describe("volver de la pantalla del evento en el móvil", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: ADMIN_STORAGE_STATE,
    viewport: { width: 375, height: 640 },
  });

  const LAST_EVENT = AGENDA_REDESIGN_EVENTS.at(-1) ?? PANEL_SERIES_EVENT;

  /** Baja hasta la última tarjeta y la abre; devuelve el scroll de antes. */
  async function openLastEvent(page: Page): Promise<number> {
    const toggle = agendaRow(page, LAST_EVENT.title).getByRole("button", {
      name: LAST_EVENT.title,
    });
    await toggle.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await toggle.click();
    await expect(
      page.getByRole("article", { name: LAST_EVENT.title }),
    ).toBeVisible();
    return scrollBefore;
  }

  test("el botón de volver deja la agenda donde estaba, con el foco en la tarjeta", async ({
    page,
  }) => {
    await goToCalendar(page, MOBILE_AGENDA_STATE);
    const scrollBefore = await openLastEvent(page);
    expect(scrollBefore).toBeGreaterThan(0);

    await page
      .getByRole("button", {
        name: /^(Back to calendar|Volver al calendario)$/,
      })
      .click();

    await expect(
      agendaRow(page, LAST_EVENT.title).getByRole("button", {
        name: LAST_EVENT.title,
      }),
    ).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });

  test("volver del navegador cierra la pantalla sin salir del calendario", async ({
    page,
  }) => {
    await goToCalendar(page, MOBILE_AGENDA_STATE);
    const calendarUrl = page.url();
    await openLastEvent(page);

    await page.goBack();

    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(
      agendaRow(page, LAST_EVENT.title).getByRole("button", {
        name: LAST_EVENT.title,
      }),
    ).toBeFocused();
    expect(page.url()).toBe(calendarUrl);
  });
});
// #641: el texto de cada etiqueta de tipo cumple AA también en oscuro.
test.describe("calendario-cada-tipo en tema oscuro", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("has no accessibility violations (axe-core)", async ({ page }) => {
    await goToCalendar(
      page,
      {
        name: "calendario-cada-tipo",
        events: STUBBED_EVENT_OF_EACH_TYPE,
        ready: waitForEachTypeTag,
      },
      "dark",
    );
    await expectNoAxeViolations(page);
  });
});

// Sin stubs: la frontera de verdad, con la membresía `pending` sembrada.
test.describe("la puerta de quien no está al día (#453)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: UNPAID_MEMBER_STORAGE_STATE_PATH });

  test("el directorio lo lleva a Pagos", async ({ page }) => {
    await page.goto(`${APP_URL}/directorio`);

    await expect(page).toHaveURL(/\/pagos$/);
  });

  test("el RSVP responde 403 con el motivo", async ({ page }) => {
    const [event] = STUBBED_AGENDA_EVENTS;

    const response = await page.request.post(
      `${APP_URL}${CALENDAR_AGENDA_ENDPOINT}/${event.id}/rsvp`,
      { data: { response: "yes" } },
    );

    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { reason: "membership_not_current" },
    });
  });

  test("el calendario deshabilita el RSVP y enlaza Pagos", async ({ page }) => {
    await stubCalendarReads(page, { events: STUBBED_AGENDA_EVENTS });
    await page.goto(`${APP_URL}${CALENDAR_SCREEN_PATH}`);
    await waitForAgendaRows(page);

    const { title } = STUBBED_AGENDA_EVENTS[1];
    // Los botones están en el panel del evento elegido (#648).
    await agendaRow(page, title).getByRole("button", { name: title }).click();
    await expect(
      eventPanel(page, title).getByRole("button", { name: "Going" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("link", { name: "Go to Payments" }),
    ).toBeVisible();
  });
});

// Pagos (#454, #455). El del socio pendiente va sin stubs: la página lee la
// membresía sembrada al pintarse, y el servidor necesita las llaves de prueba
// de Stripe; sin ellas la pantalla dice que los pagos no están configurados.
// Los demás estados fingen `GET /api/v1/membership`, porque el socio de
// prueba sólo tiene una membresía en `seadragons-dev`.
const PAYMENTS_SCREEN_PATH = "/pagos";
const MEMBERSHIP_ENDPOINT = "/api/v1/membership";
const ADD_CARD_BUTTON_NAME = /^(Add card|Añadir tarjeta)$/;
const PAYMENT_HISTORY_HEADING = /^(Payment history|Historial de pagos)$/;

const PAYMENTS_CARD = {
  brand: "visa",
  last4: "4242",
  expMonth: 8,
  expYear: 2028,
} as const;

function paidMembershipFee(id: string, date: string): object {
  return {
    id,
    date,
    description: "Monthly membership",
    amountCents: 4500,
    status: "paid",
    card: { brand: "visa", last4: "4242" },
    failureReason: null,
    quantity: 1,
    option: null,
  };
}

const PAYMENTS_HISTORY = [
  paidMembershipFee(
    "e0e0e0e0-0000-4000-8000-0000000000e1",
    "2026-09-01T00:00:00.000Z",
  ),
  paidMembershipFee(
    "e0e0e0e0-0000-4000-8000-0000000000e2",
    "2026-08-01T00:00:00.000Z",
  ),
  {
    id: "e0e0e0e0-0000-4000-8000-0000000000e3",
    date: "2026-07-12T00:00:00.000Z",
    description: "Nationals levy",
    amountCents: 8000,
    status: "paid",
    card: { brand: "visa", last4: "4242" },
    failureReason: null,
    quantity: 1,
    option: null,
  },
  paidMembershipFee(
    "e0e0e0e0-0000-4000-8000-0000000000e4",
    "2026-07-01T00:00:00.000Z",
  ),
];

const FAILED_PAYMENT = {
  id: "e0e0e0e0-0000-4000-8000-0000000000e5",
  date: "2026-10-01T00:00:00.000Z",
  description: null,
  amountCents: 4500,
  status: "failed",
  card: { brand: "visa", last4: "4242" },
  failureReason: "Your card was declined.",
  quantity: 1,
  option: null,
} as const;

const NO_SESSIONS = { sessions: 0, movements: [] } as const;

function membershipView(
  membership: object,
  payments: readonly object[],
  sessionBalance: object = NO_SESSIONS,
): object {
  return {
    paymentsConfigured: true,
    membership: {
      plan: "Full",
      monthlyPriceCents: 4500,
      trialEnd: null,
      nextChargeAt: null,
      card: PAYMENTS_CARD,
      waiver: null,
      scheduledChange: null,
      canChangePlan: false,
      planPrices: { Full: 4500, Student: 3200 },
      canChoosePlan: false,
      casualSessionPriceCents: null,
      subscriptionEndsAt: null,
      ...membership,
    },
    payments,
    sessionBalance,
  };
}

const ACTIVE_MEMBERSHIP_VIEW = membershipView(
  { status: "active", nextChargeAt: "2026-10-01T00:00:00.000Z" },
  PAYMENTS_HISTORY,
);

const TRIALING_MEMBERSHIP_VIEW = membershipView(
  {
    plan: "Student",
    status: "trialing",
    monthlyPriceCents: 3200,
    trialEnd: "2026-10-30T00:00:00.000Z",
    nextChargeAt: "2026-10-30T00:00:00.000Z",
  },
  [],
);

const PAST_DUE_MEMBERSHIP_VIEW = membershipView({ status: "past_due" }, [
  FAILED_PAYMENT,
  ...PAYMENTS_HISTORY,
]);

const CANCELLED_MEMBERSHIP_VIEW = membershipView(
  { status: "cancelled", trialEnd: "2026-07-01T00:00:00.000Z" },
  [FAILED_PAYMENT, ...PAYMENTS_HISTORY],
);

const WAIVED_MEMBERSHIP_VIEW = membershipView(
  {
    status: "waived",
    card: null,
    waiver: { reason: "Life member", until: "2027-06-30T00:00:00.000Z" },
  },
  PAYMENTS_HISTORY,
);

// El historial rehecho (#631): varios meses, un fallo con su motivo y sin
// tarjeta guardada, y un pendiente para que aparezca su filtro.
const REDESIGNED_HISTORY = [
  {
    ...FAILED_PAYMENT,
    id: "e0e0e0e0-0000-4000-8000-0000000000f1",
    date: "2026-08-01T00:00:00.000Z",
    card: null,
    failureReason: "Card declined",
  },
  {
    id: "e0e0e0e0-0000-4000-8000-0000000000f2",
    date: "2026-09-18T00:00:00.000Z",
    description: "2026 club jersey",
    amountCents: 6000,
    status: "paid",
    card: { brand: "mastercard", last4: "4444" },
    failureReason: null,
    quantity: 1,
    option: null,
  },
  {
    id: "e0e0e0e0-0000-4000-8000-0000000000f3",
    date: "2026-06-14T00:00:00.000Z",
    description: "Winter league levy",
    amountCents: 3000,
    status: "pending",
    card: null,
    failureReason: null,
    quantity: 1,
    option: null,
  },
  ...PAYMENTS_HISTORY,
];

const FAKE_RECEIPT_URL = "https://pay.stripe.test/receipts/fake";

const REDESIGNED_HISTORY_MEMBERSHIP_VIEW = membershipView(
  { status: "active", nextChargeAt: "2026-10-01T00:00:00.000Z" },
  REDESIGNED_HISTORY,
);

// Casual: sin cuota mensual ni cobro recurrente, y todavía sin pagos.
const EMPTY_HISTORY_MEMBERSHIP_VIEW = membershipView(
  { plan: "Casual", status: "active", monthlyPriceCents: null, card: null },
  [],
);

// El cambio de plan (#456): el selector a quien puede cambiar, y el cambio
// programado con su anulación.
const PLAN_CHANGE_MEMBERSHIP_VIEW = membershipView(
  {
    status: "active",
    nextChargeAt: "2026-10-01T00:00:00.000Z",
    canChangePlan: true,
  },
  PAYMENTS_HISTORY,
);

const SCHEDULED_CHANGE_MEMBERSHIP_VIEW = membershipView(
  {
    status: "active",
    nextChargeAt: "2026-10-01T00:00:00.000Z",
    scheduledChange: {
      plan: "Student",
      effectiveAt: "2026-10-01T00:00:00.000Z",
    },
  },
  PAYMENTS_HISTORY,
);

// Elegir plan antes del primer pago (#479): las tres opciones sin ninguna
// marcada, y con Casual guardado, que no ofrece Checkout.
const CHOOSE_PLAN_MEMBERSHIP_VIEW = membershipView(
  {
    plan: null,
    status: "pending",
    monthlyPriceCents: null,
    card: null,
    canChoosePlan: true,
    planPrices: { Full: 4500, Student: 3200 },
    casualSessionPriceCents: 1500,
  },
  [],
);

const CHOOSE_CASUAL_MEMBERSHIP_VIEW = membershipView(
  {
    plan: "Casual",
    status: "pending",
    monthlyPriceCents: null,
    card: null,
    canChoosePlan: true,
    canChangePlan: true,
    planPrices: { Full: 4500, Student: 3200 },
    casualSessionPriceCents: 1500,
  },
  [],
);

// Los packs de un Casual (#471): uno pendiente que se pone al día comprando
// un pack. Vino de Full, así que no elige plan otra vez.
const CASUAL_PACKS_MEMBERSHIP_VIEW = membershipView(
  {
    plan: "Casual",
    status: "pending",
    monthlyPriceCents: null,
    card: null,
    canChangePlan: true,
    planPrices: { Full: 4500, Student: 3200 },
    casualSessionPriceCents: 1500,
  },
  [],
);

// El saldo de sesiones (#472): un Casual con saldo y movimientos, uno sin
// saldo ni movimientos, y un Full con saldo congelado.
const CASUAL_SESSION_MOVEMENTS = {
  sessions: 3,
  movements: [
    {
      kind: "attendance",
      id: "e0e0e0e0-0000-4000-8000-0000000000f3",
      sessions: -1,
      date: "2026-09-29T10:00:00.000Z",
      training: { title: "Tuesday training", startsOn: "2026-09-29" },
    },
    {
      kind: "attendance",
      id: "e0e0e0e0-0000-4000-8000-0000000000f2",
      sessions: -1,
      date: "2026-09-22T10:00:00.000Z",
      training: null,
    },
    {
      kind: "pack_purchase",
      id: "e0e0e0e0-0000-4000-8000-0000000000f1",
      sessions: 5,
      date: "2026-09-15T00:00:00.000Z",
    },
  ],
} as const;

const CASUAL_MEMBERSHIP = {
  plan: "Casual",
  status: "active",
  monthlyPriceCents: null,
  card: null,
  canChangePlan: true,
  planPrices: { Full: 4500, Student: 3200 },
} as const;

const CASUAL_BALANCE_MEMBERSHIP_VIEW = membershipView(
  CASUAL_MEMBERSHIP,
  [],
  CASUAL_SESSION_MOVEMENTS,
);

const CASUAL_NO_BALANCE_MEMBERSHIP_VIEW = membershipView(
  { ...CASUAL_MEMBERSHIP, status: "pending" },
  [],
);

const FROZEN_BALANCE_MEMBERSHIP_VIEW = membershipView(
  { status: "active", nextChargeAt: "2026-10-01T00:00:00.000Z" },
  PAYMENTS_HISTORY,
  { ...CASUAL_SESSION_MOVEMENTS, sessions: 2 },
);

const BUY_PACK_BUTTON_NAME = /^(Buy|Comprar) 5 (sessions|sesiones)/;

/** Los levies fingidos de Pagos (#473): uno con nombre largo, para ver cómo
 * parte en 375px, y otro corto. Siempre fingidos: los de dev salen de la
 * cuenta de prueba de Stripe y cambiarían la captura. */
const LEVIES_ENDPOINT = "/api/v1/levies";

const NATIONALS_LEVY = {
  id: "price_levy_nationals",
  productId: "prod_levy_nationals",
  name: "Australian Underwater Rugby Nationals 2026 entry",
  description: "Team entry for the national championship in Perth.",
  amountCents: 8000,
  maxQuantity: 1,
  purchasedQuantity: 0,
  lastPurchasedAt: null,
  isPaid: false,
} as const;

const POOL_HIRE_LEVY = {
  id: "price_levy_pool",
  productId: "prod_levy_pool",
  name: "Extra pool hire",
  description: null,
  amountCents: 1250,
  maxQuantity: 1,
  purchasedQuantity: 0,
  lastPurchasedAt: null,
  isPaid: false,
} as const;

const UNPAID_LEVIES: readonly object[] = [NATIONALS_LEVY, POOL_HIRE_LEVY];
const ONE_PAID_LEVY: readonly object[] = [
  {
    ...NATIONALS_LEVY,
    purchasedQuantity: 1,
    lastPurchasedAt: "2026-09-18T02:30:00.000Z",
    isPaid: true,
  },
  POOL_HIRE_LEVY,
];

/** Los extras del socio en filas (#633): uno por comprar, uno de una unidad
 * comprado y uno de varias unidades con tres compradas, que sigue a la
 * venta. */
const JERSEY_LEVY = {
  id: "price_levy_jersey",
  productId: "prod_levy_jersey",
  name: "2026 club jersey",
  description: "Home and away jersey with your number, in the club colours.",
  amountCents: 6000,
  maxQuantity: 10,
  purchasedQuantity: 3,
  lastPurchasedAt: "2026-09-18T02:30:00.000Z",
  isPaid: true,
} as const;

const MEMBER_EXTRAS: readonly object[] = [
  POOL_HIRE_LEVY,
  {
    ...NATIONALS_LEVY,
    purchasedQuantity: 1,
    lastPurchasedAt: "2026-09-18T02:30:00.000Z",
    isPaid: true,
  },
  JERSEY_LEVY,
];

const LEVIES_HEADING = /^(Club extras|Extras del club)$/;

async function stubLevies(
  page: Page,
  levies: readonly object[],
): Promise<void> {
  await page.route(
    (url) => url.pathname === LEVIES_ENDPOINT,
    (route) => route.fulfill(jsonBody({ levies })),
  );
}

/** Lo vendido de los extras del club (#635), fingido como los levies: un
 * Admin lo ve en la pestaña Extras del club. Tres a la venta y uno cerrado,
 * con nombres largos para ver cómo parten la tabla y el detalle. */
const LEVY_SALES_ENDPOINT = `${LEVIES_ENDPOINT}/sales`;
const LEVY_BUYERS_ENDPOINT = /^\/api\/v1\/levies\/products\/[^/]+\/buyers$/;

type LevySaleFixture = {
  readonly productId: string;
  readonly priceId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly amountCents: number;
  readonly soldQuantity: number;
  readonly buyerCount: number;
  readonly status: "open" | "closed";
  readonly soldByOption: readonly object[];
};

function levySale(sale: {
  readonly productId: string;
  readonly name: string;
  readonly description: string | null;
  readonly amountCents: number;
  readonly soldQuantity: number;
  readonly buyerCount: number;
  readonly status?: "open" | "closed";
}): LevySaleFixture {
  return {
    priceId: sale.status === "closed" ? null : `price_${sale.productId}`,
    status: "open",
    soldByOption: [],
    ...sale,
  };
}

const OPEN_LEVY_SALES: readonly LevySaleFixture[] = [
  levySale({
    productId: "prod_island_cup",
    name: "Island Cup entry fee",
    description: "U16 squad. Covers entry, field hire and the team bus.",
    amountCents: 4500,
    soldQuantity: 14,
    buyerCount: 12,
  }),
  levySale({
    productId: "prod_jersey",
    name: "2026 club jersey",
    description: "Home and away jersey with your number, in the club colours.",
    amountCents: 6000,
    soldQuantity: 31,
    buyerCount: 24,
  }),
  levySale({
    productId: "prod_dinner",
    name: "End-of-season dinner",
    description: "Saturday Nov 28 at the clubhouse. Partners welcome.",
    amountCents: 3500,
    soldQuantity: 9,
    buyerCount: 9,
  }),
];

const CLOSED_LEVY_SALES: readonly LevySaleFixture[] = [
  ...OPEN_LEVY_SALES,
  levySale({
    productId: "prod_nationals_2025",
    name: "Australian Underwater Rugby Nationals 2025 entry",
    description: null,
    amountCents: 8000,
    soldQuantity: 18,
    buyerCount: 18,
    status: "closed",
  }),
];

const BUYER_NAMES = [
  "Lucía Fernández",
  "Tom Baker",
  "Maximiliana Fitzgerald-Papadopoulos",
  "Priya Nair",
  "Sam O'Neill",
  "Hana Sato",
  "Dana Whitfield",
  "Andrea Cadavid",
  "Alex Kim",
  "Bruno Díaz",
  "Carla Soto",
  "Dani Vega",
] as const;

/** Doce compras, una de dos unidades, para que la lista llegue a su scroll. */
const LEVY_BUYERS: readonly object[] = BUYER_NAMES.map((fullName, index) => {
  const quantity = index === 0 ? 2 : 1;
  return {
    userId: `buyer-${index}`,
    fullName,
    email: `buyer-${index}@example.com`,
    quantity,
    paidAt: new Date(Date.UTC(2026, 9, 14 - index, 1)).toISOString(),
    amountCents: 4500 * quantity,
    option: null,
  };
});

const SALES_TABLE_NAME = /(extras? on sale|extras? a la venta)/;
const BUYERS_LIST_NAME = /^(Buyers|Compradores)$/;
const NO_CLUB_EXTRAS_TEXT = /(creates them in Stripe|los crea en Stripe)/;

async function stubLevySales(
  page: Page,
  sales: readonly object[],
  buyers: readonly object[],
): Promise<void> {
  await page.route(
    (url) => url.pathname === LEVY_SALES_ENDPOINT,
    (route) => route.fulfill(jsonBody({ sales })),
  );
  await page.route(
    (url) => LEVY_BUYERS_ENDPOINT.test(url.pathname),
    (route) => route.fulfill(jsonBody({ buyers })),
  );
}

/** Espera la tabla y los compradores del primer extra, o el estado vacío. */
async function waitForClubExtras(
  page: Page,
  sales: readonly object[],
): Promise<void> {
  if (sales.length === 0) {
    await expect(page.getByText(NO_CLUB_EXTRAS_TEXT)).toBeVisible();
    return;
  }
  if (isPhoneViewport(page)) {
    // En el móvil (#636) son filas, y los compradores esperan a la hoja.
    await expect(
      page.getByRole("list", { name: SALES_TABLE_NAME }),
    ).toBeVisible();
    return;
  }
  await expect(
    page.getByRole("table", { name: SALES_TABLE_NAME }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: BUYERS_LIST_NAME }),
  ).toBeVisible();
}

type PaymentsTabName = "membership" | "extras";

/** Extras del club, con su cuenta de extras a la venta (#627). */
const EXTRAS_TAB_NAME =
  /^(Club extras|Extras del club) \d+ (for sale|a la venta)$/;

function paymentsPath(
  tab: PaymentsTabName | undefined,
  levyReturn: LevyReturnVisit | undefined,
): string {
  const search = new URLSearchParams(levyReturn?.search);
  if (tab === "extras") {
    search.set("tab", "extras");
  }
  const query = search.toString();
  return query === ""
    ? PAYMENTS_SCREEN_PATH
    : `${PAYMENTS_SCREEN_PATH}?${query}`;
}

/** La vuelta de pagar un extra en Stripe (#692): los parámetros con los que
 * se llega y el aviso que se espera ver en la sección de extras. */
type LevyReturnVisit = {
  readonly search: string;
  readonly notice: RegExp;
};

/** La camiseta de `MEMBER_EXTRAS` sigue en 3: el webhook no ha llegado. */
const LEVY_WAITING_VISIT: LevyReturnVisit = {
  search: `levy=ok&extra=${JERSEY_LEVY.productId}&antes=${JERSEY_LEVY.purchasedQuantity}`,
  notice: /^(Payment received\.|Pago recibido\.)/,
};

const LEVY_CANCELLED_VISIT: LevyReturnVisit = {
  search: "levy=cancelado",
  notice:
    /^(You left Stripe without buying the extra|Saliste de Stripe sin comprar el extra)/,
};

type PaymentsScreenState = {
  readonly name: string;
  /** Lo que sirve el endpoint fingido; sin él, la membresía sembrada. */
  readonly view?: object;
  /** Los levies que sirve su endpoint fingido; sin ellos, ninguno. */
  readonly levies?: readonly object[];
  /** Lo vendido de los extras (#635), en la pestaña Extras del club. Sin
   * ello, ninguno. */
  readonly sales?: readonly object[];
  /** La pestaña que abre un Admin o un Committee (#627). Sin ella, quien
   * mira es un socio sin pestañas. */
  readonly tab?: PaymentsTabName;
  /** Si su axe corre también en oscuro (#627). */
  readonly checksDarkAxe?: boolean;
  /** El filtro del historial que se pulsa antes de mirar (#631). */
  readonly historyFilter?: RegExp;
  /** Con qué se vuelve de pagar un extra (#692). */
  readonly levyReturn?: LevyReturnVisit;
  readonly storageState: string;
  readonly beforeVisit?: (page: Page) => Promise<void>;
};

function paymentsStates(
  name: string,
  view: object,
  levies?: readonly object[],
): readonly PaymentsScreenState[] {
  const storageState = E2E_STORAGE_STATE_PATH;
  return [
    { name, view, levies, storageState },
    {
      name: `${name}-es`,
      view,
      levies,
      storageState,
      beforeVisit: chooseSpanish,
    },
  ];
}

/** Los levies que `GET /api/v1/levies` daría con esos extras a la venta: la
 * insignia de la pestaña los cuenta, así que tiene que cuadrar con la lista
 * de lo vendido. */
function leviesOnSale(sales: readonly LevySaleFixture[]): readonly object[] {
  return sales
    .filter((sale) => sale.status === "open")
    .map((sale) => ({
      id: sale.priceId,
      productId: sale.productId,
      name: sale.name,
      description: sale.description,
      amountCents: sale.amountCents,
      maxQuantity: 1,
      purchasedQuantity: 0,
      lastPurchasedAt: null,
      isPaid: false,
    }));
}

/** La pestaña Extras del club de un Admin (#635), con el primer extra
 * elegido. Su axe corre en claro y en oscuro. */
function clubExtrasStates(
  name: string,
  sales: readonly LevySaleFixture[],
): readonly PaymentsScreenState[] {
  return paymentsStates(name, ACTIVE_MEMBERSHIP_VIEW, leviesOnSale(sales)).map(
    (state) => ({
      ...state,
      sales,
      tab: "extras",
      checksDarkAxe: true,
      storageState: ADMIN_STORAGE_STATE,
    }),
  );
}

/** La cabecera de Pagos (#627): un socio sin pestañas, o un Admin en una de
 * las dos. Su axe corre en claro y en oscuro. */
function paymentsTabsStates(
  name: string,
  tab?: PaymentsTabName,
): readonly PaymentsScreenState[] {
  return paymentsStates(name, ACTIVE_MEMBERSHIP_VIEW, UNPAID_LEVIES).map(
    (state) => ({
      ...state,
      tab,
      checksDarkAxe: true,
      storageState:
        tab === undefined ? E2E_STORAGE_STATE_PATH : ADMIN_STORAGE_STATE,
    }),
  );
}

/** El historial rehecho (#631), con un filtro pulsado o sin él. Su axe corre
 * en claro y en oscuro. */
function paymentHistoryStates(
  name: string,
  view: object,
  historyFilter?: RegExp,
): readonly PaymentsScreenState[] {
  return paymentsStates(name, view).map((state) => ({
    ...state,
    historyFilter,
    checksDarkAxe: true,
  }));
}

// La tira del plan (#628): un pendiente con su plan ya guardado, que ve el
// alta en Checkout dentro de la tira sin depender del socio sembrado.
const PENDING_PLAN_MEMBERSHIP_VIEW = membershipView(
  { status: "pending", card: null },
  [],
);

/** Los extras del socio en filas (#633), con su axe también en oscuro. */
function memberExtrasStates(
  name: string,
  levies: readonly object[],
): readonly PaymentsScreenState[] {
  return paymentsStates(name, ACTIVE_MEMBERSHIP_VIEW, levies).map((state) => ({
    ...state,
    checksDarkAxe: true,
  }));
}

/** La vuelta de pagar un extra (#692): los extras del socio con el aviso de
 * la espera o de la salida sin comprar, con su axe también en oscuro. */
function levyReturnStates(
  name: string,
  levyReturn: LevyReturnVisit,
): readonly PaymentsScreenState[] {
  return memberExtrasStates(name, MEMBER_EXTRAS).map((state) => ({
    ...state,
    levyReturn,
  }));
}

/** Los estados de la tira del plan (#628), con su axe también en oscuro. */
function planStripStates(
  name: string,
  view: object,
): readonly PaymentsScreenState[] {
  return paymentsStates(name, view).map((state) => ({
    ...state,
    checksDarkAxe: true,
  }));
}

const FAILED_FILTER_NAME = /^(Failed|Fallidos)$/;

const PAYMENTS_STATES: readonly PaymentsScreenState[] = [
  { name: "pagos-pendiente", storageState: UNPAID_MEMBER_STORAGE_STATE_PATH },
  {
    name: "pagos-pendiente-es",
    storageState: UNPAID_MEMBER_STORAGE_STATE_PATH,
    beforeVisit: chooseSpanish,
  },
  ...paymentsStates("pagos-activa", ACTIVE_MEMBERSHIP_VIEW),
  ...paymentsStates("pagos-prueba", TRIALING_MEMBERSHIP_VIEW),
  ...paymentsStates("pagos-fallida", PAST_DUE_MEMBERSHIP_VIEW),
  ...paymentsStates("pagos-cancelada", CANCELLED_MEMBERSHIP_VIEW),
  ...paymentsStates("pagos-exenta", WAIVED_MEMBERSHIP_VIEW),
  ...paymentsStates("pagos-historial-vacio", EMPTY_HISTORY_MEMBERSHIP_VIEW),
  ...paymentsStates("pagos-cambio-de-plan", PLAN_CHANGE_MEMBERSHIP_VIEW),
  ...paymentsStates(
    "pagos-cambio-programado",
    SCHEDULED_CHANGE_MEMBERSHIP_VIEW,
  ),
  ...paymentsStates("pagos-elegir-plan", CHOOSE_PLAN_MEMBERSHIP_VIEW),
  ...paymentsStates("pagos-elegir-plan-casual", CHOOSE_CASUAL_MEMBERSHIP_VIEW),
  ...paymentsStates("pagos-casual-packs", CASUAL_PACKS_MEMBERSHIP_VIEW),
  ...paymentsStates("pagos-casual-saldo", CASUAL_BALANCE_MEMBERSHIP_VIEW),
  ...paymentsStates(
    "pagos-casual-sin-saldo",
    CASUAL_NO_BALANCE_MEMBERSHIP_VIEW,
  ),
  ...paymentsStates("pagos-full-congelado", FROZEN_BALANCE_MEMBERSHIP_VIEW),
  ...paymentsStates("pagos-levies", ACTIVE_MEMBERSHIP_VIEW, UNPAID_LEVIES),
  ...paymentsStates("pagos-levy-pagado", ACTIVE_MEMBERSHIP_VIEW, ONE_PAID_LEVY),
  ...memberExtrasStates("pagos-extras-socio", MEMBER_EXTRAS),
  ...clubExtrasStates("pagos-extras-admin", OPEN_LEVY_SALES),
  ...clubExtrasStates("pagos-extras-admin-cerrados", CLOSED_LEVY_SALES),
  ...clubExtrasStates("pagos-extras-admin-vacio", []),
  ...levyReturnStates("pagos-extra-esperando", LEVY_WAITING_VISIT),
  ...levyReturnStates("pagos-extra-cancelado", LEVY_CANCELLED_VISIT),
  ...planStripStates("pagos-plan-activo", PLAN_CHANGE_MEMBERSHIP_VIEW),
  ...planStripStates("pagos-plan-casual", CASUAL_BALANCE_MEMBERSHIP_VIEW),
  ...planStripStates("pagos-plan-exencion", WAIVED_MEMBERSHIP_VIEW),
  ...planStripStates("pagos-plan-pendiente", PENDING_PLAN_MEMBERSHIP_VIEW),
  ...paymentsTabsStates("pagos-pestanas-socio"),
  ...paymentsTabsStates("pagos-pestanas-admin", "membership"),
  ...paymentsTabsStates("pagos-pestanas-admin-extras", "extras"),
  ...paymentHistoryStates(
    "pagos-historial",
    REDESIGNED_HISTORY_MEMBERSHIP_VIEW,
  ),
  ...paymentHistoryStates(
    "pagos-historial-fallidos",
    REDESIGNED_HISTORY_MEMBERSHIP_VIEW,
    FAILED_FILTER_NAME,
  ),
  ...paymentHistoryStates(
    "pagos-historial-sin-resultados",
    ACTIVE_MEMBERSHIP_VIEW,
    FAILED_FILTER_NAME,
  ),
  // La alerta de pago fallido (#474) la pinta la cáscara con el socio
  // sembrado en `past_due`; el panel de Pagos sigue fingido.
  {
    name: "alerta-pago-fallido-pagos",
    view: PAST_DUE_MEMBERSHIP_VIEW,
    storageState: PAST_DUE_MEMBER_STORAGE_STATE_PATH,
  },
  {
    name: "alerta-pago-fallido-pagos-es",
    view: PAST_DUE_MEMBERSHIP_VIEW,
    storageState: PAST_DUE_MEMBER_STORAGE_STATE_PATH,
    beforeVisit: chooseSpanish,
  },
];

function isCasualView(view: object | undefined): boolean {
  return (
    view !== undefined &&
    "membership" in view &&
    typeof view.membership === "object" &&
    view.membership !== null &&
    "plan" in view.membership &&
    view.membership.plan === "Casual"
  );
}

async function serveMembership(page: Page, view: object): Promise<void> {
  await page.route(
    (url) => url.pathname === MEMBERSHIP_ENDPOINT,
    (route) => route.fulfill(jsonBody(view)),
  );
}

async function goToPayments(
  page: Page,
  state: Pick<
    PaymentsScreenState,
    | "view"
    | "levies"
    | "sales"
    | "tab"
    | "beforeVisit"
    | "historyFilter"
    | "levyReturn"
  >,
  theme?: (typeof themes)[number],
): Promise<void> {
  const levies = state.levies ?? [];
  await stubLevies(page, levies);
  // Siempre fingido: los de dev salen de la cuenta de prueba de Stripe.
  await stubLevySales(page, state.sales ?? [], LEVY_BUYERS);
  if (state.view !== undefined) {
    await serveMembership(page, state.view);
    // Un Casual ve los packs del club (#471): fingidos, para que la captura
    // no dependa de la lista de dev ni del precio de Stripe.
    await stubSessionPacks(page);
  }
  await state.beforeVisit?.(page);
  const path = paymentsPath(state.tab, state.levyReturn);
  if (theme === undefined) {
    await page.goto(`${APP_URL}${path}`);
  } else {
    await goToWithTheme(page, path, theme);
  }
  if (state.tab !== "extras") {
    await expect(
      page.getByRole("heading", { level: 2, name: PAYMENT_HISTORY_HEADING }),
    ).toBeVisible();
  }
  if (state.tab !== undefined && levies.length > 0) {
    await expect(
      page.getByRole("tab", { name: EXTRAS_TAB_NAME }),
    ).toBeVisible();
  }
  if (state.view === undefined) {
    await expect(
      page.getByRole("button", { name: ADD_CARD_BUTTON_NAME }),
    ).toBeVisible();
  }
  if (isCasualView(state.view)) {
    await expect(
      page.getByRole("button", { name: BUY_PACK_BUTTON_NAME }),
    ).toBeVisible();
  }
  if (levies.length > 0 && state.tab !== "extras") {
    await expect(
      page.getByRole("heading", { level: 2, name: LEVIES_HEADING }),
    ).toBeVisible();
  }
  if (state.levyReturn !== undefined) {
    await expect(
      page.getByRole("status").filter({ hasText: state.levyReturn.notice }),
    ).toBeVisible();
  }
  if (state.tab === "extras") {
    await waitForClubExtras(page, state.sales ?? []);
  }
  if (state.historyFilter !== undefined) {
    await chooseHistoryFilter(page, state.historyFilter);
  }
}

/** Pulsa un filtro del historial (#631) y espera a que quede marcado. */
async function chooseHistoryFilter(page: Page, name: RegExp): Promise<void> {
  const filter = page.getByRole("button", { name });
  await filter.click();
  await expect(filter).toHaveAttribute("aria-pressed", "true");
}

for (const state of PAYMENTS_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: state.storageState });

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToPayments(page, state, theme);
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }

        test("has no horizontal scroll", async ({ page }) => {
          await goToPayments(page, state);
          expect(await hasHorizontalScroll(page)).toBe(false);
        });
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await goToPayments(page, state);
      await expectNoAxeViolations(page);
    });

    if (state.checksDarkAxe === true) {
      test("has no accessibility violations in dark (axe-core)", async ({
        page,
      }) => {
        await goToPayments(page, state, "dark");
        await expectNoAxeViolations(page);
      });
    }
  });
}

/* La pestaña Extras del club en el móvil (#636, RF-10 del PRD de E23): la
   lista de filas, y la hoja del detalle de un extra sobre la lista atenuada.
   Sin lo recaudado (D3). */

const MOBILE_PAYMENTS_VIEWPORT = { width: 375, height: 812 } as const;
const EXTRA_SHEET_NAME = "Island Cup entry fee";

async function openExtraSheet(page: Page): Promise<Locator> {
  await page
    .getByRole("button", { name: new RegExp(`^${EXTRA_SHEET_NAME}`) })
    .click();
  const sheet = page.getByRole("dialog", { name: EXTRA_SHEET_NAME });
  await expect(
    sheet.getByRole("list", { name: BUYERS_LIST_NAME }),
  ).toBeVisible();
  await sheet.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  return sheet;
}

type MobileExtrasState = {
  readonly name: string;
  readonly beforeVisit?: (page: Page) => Promise<void>;
  readonly opensSheet: boolean;
};

const MOBILE_EXTRAS_STATES: readonly MobileExtrasState[] = [
  { name: "pagos-extras-admin-movil", opensSheet: false },
  {
    name: "pagos-extras-admin-movil-es",
    beforeVisit: chooseSpanish,
    opensSheet: false,
  },
  { name: "pagos-extras-admin-movil-detalle", opensSheet: true },
  {
    name: "pagos-extras-admin-movil-detalle-es",
    beforeVisit: chooseSpanish,
    opensSheet: true,
  },
];

async function goToMobileExtras(
  page: Page,
  state: MobileExtrasState,
  theme?: (typeof themes)[number],
): Promise<void> {
  await goToPayments(
    page,
    {
      view: ACTIVE_MEMBERSHIP_VIEW,
      levies: leviesOnSale(CLOSED_LEVY_SALES),
      sales: CLOSED_LEVY_SALES,
      tab: "extras",
      beforeVisit: state.beforeVisit,
    },
    theme,
  );
  if (state.opensSheet) {
    await openExtraSheet(page);
  }
}

test.describe("la pestaña Extras del club en el móvil (#636)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: ADMIN_STORAGE_STATE,
    viewport: MOBILE_PAYMENTS_VIEWPORT,
  });

  for (const state of MOBILE_EXTRAS_STATES) {
    test.describe(state.name, () => {
      for (const theme of themes) {
        if (isStatePhotographed(state.name)) {
          test(`matches approved baseline (${theme})`, async ({ page }) => {
            await goToMobileExtras(page, state, theme);
            const snapshot = `${state.name}-mobile-${theme}.png`;
            const fullPage = !state.opensSheet;
            await createMissingLocalBaseline(snapshot, () =>
              page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage }),
            );
            await expect(page).toHaveScreenshot(snapshot, {
              ...SCREENSHOT_OPTIONS,
              fullPage,
              maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
            });
          });
        }

        test(`has no accessibility violations (${theme})`, async ({ page }) => {
          await goToMobileExtras(page, state, theme);
          await expectNoAxeViolations(page);
        });
      }

      test("has no horizontal scroll", async ({ page }) => {
        await goToMobileExtras(page, state);
        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    });
  }

  test("las filas miden al menos 64px y la hoja lleva sus medidas", async ({
    page,
  }) => {
    await goToMobileExtras(page, MOBILE_EXTRAS_STATES[0]!);
    const row = page.getByRole("button", {
      name: new RegExp(`^${EXTRA_SHEET_NAME}`),
    });
    expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(64);

    const sheet = await openExtraSheet(page);

    await expect(sheet).toHaveCSS("border-top-left-radius", "20px");
    await expect(
      sheet.getByRole("heading", { name: EXTRA_SHEET_NAME }),
    ).toHaveCSS("font-size", "18px");
    const buyer = sheet
      .getByRole("list", { name: BUYERS_LIST_NAME })
      .getByRole("listitem")
      .first();
    expect((await buyer.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(
      (await buyer.locator(".payments-buyer-avatar").boundingBox())?.width,
    ).toBe(32);
    const exportButton = sheet.getByRole("button", { name: "Export CSV" });
    expect((await exportButton.boundingBox())?.height).toBeGreaterThanOrEqual(
      46,
    );
  });

  test("la hoja atrapa el foco y Escape lo devuelve a la fila", async ({
    page,
  }) => {
    await goToMobileExtras(page, MOBILE_EXTRAS_STATES[0]!);
    const row = page.getByRole("button", {
      name: new RegExp(`^${EXTRA_SHEET_NAME}`),
    });
    await row.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: EXTRA_SHEET_NAME });
    await expect(sheet).toBeVisible();
    expect(
      await sheet.evaluate((dialog) => dialog.contains(document.activeElement)),
    ).toBe(true);

    for (let press = 0; press < 6; press += 1) {
      await page.keyboard.press("Tab");
      expect(
        await sheet.evaluate((dialog) =>
          dialog.contains(document.activeElement),
        ),
      ).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(row).toBeFocused();
  });

  test("a 768px sigue la tabla de escritorio, sin hoja", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await goToMobileExtras(page, MOBILE_EXTRAS_STATES[0]!);

    await expect(
      page.getByRole("table", { name: SALES_TABLE_NAME }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

// Las pestañas de Pagos de un Admin (#627) con el router de verdad: la
// pestaña va en la dirección sin recargar y el atrás la devuelve.
test.describe("las pestañas de Pagos en el navegador (#627)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  const ADMIN_TABS_STATE = {
    view: ACTIVE_MEMBERSHIP_VIEW,
    levies: UNPAID_LEVIES,
    tab: "membership",
  } as const;

  test("Extras del club pone ?tab=extras sin recargar y el atrás vuelve a Mi membresía", async ({
    page,
  }) => {
    await goToPayments(page, ADMIN_TABS_STATE);
    await page.evaluate(() => {
      Object.assign(window, { pagosSinRecargar: true });
    });

    await page.getByRole("tab", { name: EXTRAS_TAB_NAME }).click();

    await expect(page).toHaveURL(/\/pagos\?tab=extras$/);
    await expect(page.getByText(NO_CLUB_EXTRAS_TEXT)).toBeVisible();

    await page.goBack();

    await expect(page).toHaveURL(/\/pagos$/);
    await expect(
      page.getByRole("tab", { name: /^(My membership|Mi membresía)$/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => "pagosSinRecargar" in window)).toBe(true);
  });

  test("a 375px las pestañas son un segmentado de 40px con 44px de zona táctil", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToPayments(page, ADMIN_TABS_STATE);

    const tablist = page.getByRole("tablist");
    const tablistBox = await tablist.boundingBox();
    expect(tablistBox?.height).toBe(40);
    const touchHeight = await page
      .getByRole("tab", { name: EXTRAS_TAB_NAME })
      .evaluate((tab) =>
        getComputedStyle(tab, "::after").getPropertyValue("height"),
      );
    expect(Number.parseFloat(touchHeight)).toBeGreaterThanOrEqual(44);
  });

  test("a 375px la parte activa lleva --color-segment-selected", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToPayments(page, ADMIN_TABS_STATE);

    const colors = await page
      .getByRole("tab", { name: /^(My membership|Mi membresía)$/ })
      .evaluate((tab) => {
        const probe = document.createElement("div");
        probe.style.background = "var(--color-segment-selected)";
        document.body.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { actual: getComputedStyle(tab).backgroundColor, expected };
      });
    expect(colors.actual).toBe(colors.expected);
  });

  test("el foco de teclado en una pestaña se ve con el contorno de acento", async ({
    page,
  }) => {
    await goToPayments(page, ADMIN_TABS_STATE);
    const membershipTab = page.getByRole("tab", {
      name: /^(My membership|Mi membresía)$/,
    });
    await membershipTab.focus();

    await page.keyboard.press("ArrowRight");

    const extrasTab = page.getByRole("tab", { name: EXTRAS_TAB_NAME });
    await expect(extrasTab).toBeFocused();
    const outline = await extrasTab.evaluate((tab) => {
      const probe = document.createElement("div");
      probe.style.color = "var(--color-accent-text)";
      document.body.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      const style = getComputedStyle(tab);
      return {
        accent,
        color: style.outlineColor,
        width: style.outlineWidth,
        style: style.outlineStyle,
      };
    });
    expect(outline.color).toBe(outline.accent);
    expect(outline.width).toBe("2px");
    expect(outline.style).toBe("solid");
  });
});

// El botón de la alerta (#474) pide la factura abierta y sale a su página
// de Stripe. Las dos se fingen: no hay factura de verdad en dev.
const RETRY_PAYMENT_ENDPOINT = "/api/v1/membership/retry-payment";
const FAKE_INVOICE_URL = "https://invoice.stripe.test/i/factura-fingida";

test.describe("la alerta de pago fallido en el navegador (#474)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: PAST_DUE_MEMBER_STORAGE_STATE_PATH });

  test("el botón lleva a la página fingida de la factura", async ({ page }) => {
    await serveDashboard(page, PAST_DUE_DASHBOARD);
    await page.route(
      (url) => url.pathname === RETRY_PAYMENT_ENDPOINT,
      (route) => route.fulfill(jsonBody({ url: FAKE_INVOICE_URL })),
    );
    await page.route(FAKE_INVOICE_URL, (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>Invoice</h1>" }),
    );
    await page.goto(`${APP_URL}${HOME_SCREEN_PATH}`);

    await page
      .getByRole("region", { name: "Payment failed" })
      .getByRole("button", { name: "Retry payment" })
      .click();

    await expect(page).toHaveURL(FAKE_INVOICE_URL);
  });

  test("enseña la fecha del cobro fallido sembrado", async ({ page }) => {
    await serveDashboard(page, PAST_DUE_DASHBOARD);
    await page.goto(`${APP_URL}${HOME_SCREEN_PATH}`);

    await expect(
      page.getByRole("region", { name: "Payment failed" }),
    ).toContainText("1 October 2026");
  });
});

test.describe("Pagos en el navegador", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  // El historial del móvil (#631): filas de al menos 56px con su círculo de
  // 36px, chips y exportar de 44px, y la tabla escondida.
  test("a 375px el historial es una lista de filas tocables", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToPayments(page, { view: REDESIGNED_HISTORY_MEMBERSHIP_VIEW });

    await expect(
      page.getByRole("table", { name: "Payment history" }),
    ).toBeHidden();
    const list = page.getByRole("region", { name: "Payments by month" });
    const row = list.getByRole("button", {
      name: "View receipt for 2026 club jersey",
    });
    const rowBox = await row.boundingBox();
    expect(rowBox?.height).toBeGreaterThanOrEqual(56);
    const circleBox = await row
      .locator(".payments-history-glyph")
      .boundingBox();
    expect(circleBox?.width).toBe(36);
    expect(circleBox?.height).toBe(36);
    const chipBox = await page
      .getByRole("button", { name: "Failed", exact: true })
      .boundingBox();
    expect(chipBox?.height).toBeGreaterThanOrEqual(44);
    const exportBox = await page
      .getByRole("button", { name: "Export CSV" })
      .boundingBox();
    expect(exportBox?.width).toBeGreaterThanOrEqual(44);
    expect(exportBox?.height).toBeGreaterThanOrEqual(44);
  });

  // El recibo (#630, #631) se abre en una pestaña nueva sin acceso a Pagos.
  test("el icono de recibo abre el recibo fingido en una pestaña nueva", async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname.endsWith("/receipt"),
      (route) => route.fulfill(jsonBody({ url: FAKE_RECEIPT_URL })),
    );
    await page
      .context()
      .route(FAKE_RECEIPT_URL, (route) =>
        route.fulfill({ contentType: "text/html", body: "<h1>Receipt</h1>" }),
      );
    await goToPayments(page, { view: REDESIGNED_HISTORY_MEMBERSHIP_VIEW });

    const [receipt] = await Promise.all([
      page.waitForEvent("popup"),
      page
        .getByRole("table", { name: "Payment history" })
        .getByRole("button", { name: "View receipt for 2026 club jersey" })
        .click(),
    ]);

    await expect(receipt).toHaveURL(FAKE_RECEIPT_URL);
    expect(await receipt.evaluate(() => window.opener)).toBeNull();
  });

  test("a 1440px la tira del plan es una fila con los botones a la derecha", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToPayments(page, { view: PLAN_CHANGE_MEMBERSHIP_VIEW });

    const strip = page.getByRole("region", { name: "Current plan" });
    const name = await strip.getByText("Full membership").boundingBox();
    const changePlan = await strip
      .getByRole("button", { name: "Change plan" })
      .boundingBox();
    const updateCard = await strip
      .getByRole("button", { name: "Update card" })
      .boundingBox();
    expect(changePlan!.x).toBeGreaterThan(name!.x + name!.width);
    expect(updateCard!.x).toBeGreaterThan(changePlan!.x);
    expect(updateCard!.y).toBe(changePlan!.y);
    expect(changePlan!.y).toBeLessThan(name!.y + name!.height + 24);
  });

  test("a 375px Cambiar plan y Actualizar tarjeta van lado a lado, de 42px y 44px de zona táctil", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToPayments(page, { view: PLAN_CHANGE_MEMBERSHIP_VIEW });

    const strip = page.getByRole("region", { name: "Current plan" });
    const buttons = [
      strip.getByRole("button", { name: "Change plan" }),
      strip.getByRole("button", { name: "Update card" }),
    ];
    const [changePlan, updateCard] = await Promise.all(
      buttons.map((button) => button.boundingBox()),
    );
    expect(changePlan!.y).toBe(updateCard!.y);
    expect(updateCard!.x).toBeGreaterThan(changePlan!.x + changePlan!.width);
    expect(changePlan!.height).toBe(42);
    for (const button of buttons) {
      const touchHeight = await button.evaluate((element) =>
        getComputedStyle(element, "::after").getPropertyValue("height"),
      );
      expect(Number.parseFloat(touchHeight)).toBeGreaterThanOrEqual(44);
    }
  });

  test("a 375px las tres opciones de plan se apilan", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToPayments(page, { view: CHOOSE_PLAN_MEMBERSHIP_VIEW });

    const options = page
      .getByRole("group", { name: "Choose your membership" })
      .locator("label");
    await expect(options).toHaveCount(3);
    const boxes = await options.evaluateAll((labels) =>
      labels.map((label) => {
        const box = label.getBoundingClientRect();
        return { left: box.left, top: box.top, bottom: box.bottom };
      }),
    );
    expect(new Set(boxes.map((box) => box.left)).size).toBe(1);
    boxes.slice(1).forEach((box, index) => {
      expect(box.top).toBeGreaterThanOrEqual(boxes[index]!.bottom);
    });
  });

  test("con la red caída lo dice y vuelve a pedir al reintentar", async ({
    page,
  }) => {
    // La red falla hasta que se pulsa reintentar. Contar peticiones no
    // sirve: en desarrollo React monta el efecto dos veces.
    let isNetworkDown = true;
    await page.route(
      (url) => url.pathname === MEMBERSHIP_ENDPOINT,
      (route) =>
        isNetworkDown
          ? route.abort("internetdisconnected")
          : route.fulfill(jsonBody(ACTIVE_MEMBERSHIP_VIEW)),
    );
    await page.goto(`${APP_URL}${PAYMENTS_SCREEN_PATH}`);

    // Sólo el de la pantalla: el anunciador de rutas de Next también es un
    // alert.
    await expect(
      page.locator(".admin-load-failure").getByRole("alert"),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    isNetworkDown = false;
    await page.getByRole("button", { name: "Try again" }).click();

    await expect(
      page.getByRole("button", { name: "Update card" }),
    ).toBeVisible();
  });
});
test.describe("calendario en el navegador", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("responder marca el botón y pone los conteos del evento", async ({
    page,
  }) => {
    const [event] = STUBBED_AGENDA_EVENTS;
    await stubCalendarReads(page, { events: STUBBED_AGENDA_EVENTS });
    let sent: unknown = null;
    await page.route(
      (url) => url.pathname === `${CALENDAR_AGENDA_ENDPOINT}/${event.id}/rsvp`,
      async (route, request) => {
        sent = request.postDataJSON();
        await route.fulfill(
          jsonBody({
            eventId: event.id,
            response: "maybe",
            respondedAt: "2026-06-20T08:00:00.000Z",
          }),
        );
      },
    );
    await page.route(
      (url) => url.pathname === `${CALENDAR_AGENDA_ENDPOINT}/${event.id}`,
      (route) =>
        route.fulfill(
          jsonBody({
            ...event,
            myResponse: "maybe",
            goingCount: 13,
            maybeCount: 3,
            coverUrl: null,
            series: null,
            notes: null,
            going: [],
            maybe: [],
          }),
        ),
    );
    await page.goto(`${APP_URL}${CALENDAR_SCREEN_PATH}`);
    await page.getByRole("button", { name: event.title }).click();
    const rsvp = page.getByRole("group", { name: `RSVP: ${event.title}` });

    await rsvp.getByRole("button", { name: "Maybe" }).click();

    await expect(rsvp.getByRole("button", { name: "Maybe" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const panel = eventPanel(page, event.title);
    await expect(panel.getByText("Going · 13")).toBeVisible();
    await expect(panel.getByText("3 maybe")).toBeVisible();
    expect(sent).toEqual({ response: "maybe" });
  });

  test("volver atrás tras salir del calendario deja el mismo filtro (#647)", async ({
    page,
  }) => {
    await goToCalendar(page, CALENDAR_WITH_EVENTS);
    const chips = page.getByRole("group", { name: "Event types" });
    await chips.getByRole("button", { name: "Meeting" }).click();
    await expect(page).toHaveURL(/types=training%2Ccompetition%2Csocial$/);

    await page.getByRole("link", { name: "Directory" }).first().click();
    await expect(page).toHaveURL(/\/directorio/);
    await page.goBack();

    await expect(page).toHaveURL(/types=training%2Ccompetition%2Csocial$/);
    await expect(
      chips.getByRole("button", { name: "Meeting" }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      chips.getByRole("button", { name: "Training" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("heading", {
        level: 3,
        name: STUBBED_AGENDA_EVENTS[3].title,
      }),
    ).toHaveCount(0);
  });

  test("recargar deja el mismo filtro (#647)", async ({ page }) => {
    await goToCalendar(page, CALENDAR_WITH_EVENTS);
    const chips = page.getByRole("group", { name: "Event types" });
    await chips.getByRole("button", { name: "Meeting" }).click();
    await expect(page).toHaveURL(/types=/);

    await page.reload();

    await expect(
      chips.getByRole("button", { name: "Meeting" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("a 375px los botones de RSVP conservan el objetivo táctil de 44px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToCalendar(page, CALENDAR_EXPANDED_AS_PLAYER);

    const heights = await page
      .getByRole("button", { name: /^(Going|Maybe|Can't go)$/ })
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getBoundingClientRect().height),
      );

    expect(heights.length).toBeGreaterThan(0);
    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(RSVP_MIN_TOUCH_TARGET_PX);
    }
  });

  test("con el teclado Enter elige una fila y Espacio otra, y el panel las sigue", async ({
    page,
  }) => {
    await goToCalendar(page, CALENDAR_EXPANDED_AS_PLAYER);
    const [first, second] = STUBBED_AGENDA_EVENTS;
    const firstToggle = agendaRow(page, first.title).getByRole("button", {
      name: first.title,
    });
    const secondToggle = agendaRow(page, second.title).getByRole("button", {
      name: second.title,
    });

    await secondToggle.focus();
    await page.keyboard.press("Enter");

    await expect(secondToggle).toHaveAttribute("aria-current", "true");
    await expect(eventPanel(page, second.title)).toBeVisible();
    await firstToggle.focus();
    await page.keyboard.press("Space");
    await expect(firstToggle).toHaveAttribute("aria-current", "true");
    await expect(eventPanel(page, first.title)).toBeVisible();
  });

  test("al elegir otra fila la lista no se mueve", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 600 });
    await goToCalendar(page, {
      ...CALENDAR_EXPANDED_AS_PLAYER,
      events: [...STUBBED_AGENDA_EVENTS, STUBBED_CANCELLED_EVENT],
    });
    const last = STUBBED_CANCELLED_EVENT.title;
    const toggle = agendaRow(page, last).getByRole("button", { name: last });
    await toggle.scrollIntoViewIfNeeded();
    const scrolled = await page.evaluate(() => window.scrollY);

    await toggle.click();

    await expect(eventPanel(page, last)).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  });

  test("a 1440px el panel mide 380px y va a la derecha de la lista", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToCalendar(page, CALENDAR_EXPANDED_AS_PLAYER);
    const panelBox = await eventPanel(
      page,
      STUBBED_AGENDA_EVENTS[0].title,
    ).boundingBox();
    const listBox = await page
      .getByRole("list", { name: CALENDAR_HEADING })
      .boundingBox();

    expect(panelBox).not.toBeNull();
    expect(listBox).not.toBeNull();
    if (panelBox === null || listBox === null) {
      return;
    }
    expect(panelBox.width).toBe(380);
    expect(panelBox.x).toBeGreaterThan(listBox.x + listBox.width);
  });

  test("pulsar Voy en el panel no cambia la fila elegida", async ({ page }) => {
    await goToCalendar(page, CALENDAR_EXPANDED_AS_PLAYER);
    const { title } = STUBBED_AGENDA_EVENTS[0];

    await eventPanel(page, title)
      .getByRole("group")
      .getByRole("button", { name: "Going" })
      .click();

    await expect(
      agendaRow(page, title).getByRole("button", { name: title }),
    ).toHaveAttribute("aria-current", "true");
  });

  test("a 375px una lista de nombres larga se parte dentro del panel", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToCalendar(page, CALENDAR_EXPANDED_AS_PLAYER);
    const panel = eventPanel(page, STUBBED_AGENDA_EVENTS[0].title);
    await panel.getByRole("button", { name: "See all" }).click();

    const panelBox = await panel.boundingBox();
    const namesBox = await panel
      .getByRole("list", { name: /^(Going|Van)$/ })
      .boundingBox();

    expect(panelBox).not.toBeNull();
    expect(namesBox).not.toBeNull();
    if (panelBox === null || namesBox === null) {
      return;
    }
    expect(namesBox.x + namesBox.width).toBeLessThanOrEqual(
      panelBox.x + panelBox.width,
    );
    expect(namesBox.height).toBeGreaterThan(0);
  });
});

// El diálogo para crear eventos (#313). Los grupos y la creación se sirven
// desde el test, como la agenda: la captura no depende de los grupos que haya
// en la base de desarrollo, y nada se guarda de verdad.
const EVENTS_MANAGE_ENDPOINT = "/api/v1/events/manage";
const EVENT_DIALOG_GROUPS_ENDPOINT = "/api/v1/groups";
// El buscador de lugares (#652) nunca llama a Photon ni a la base de verdad:
// lo que sugiere se sirve desde el test, vacío salvo en sus propios estados.
const EVENT_PLACES_ENDPOINT = "/api/v1/events/manage/places";
const EVENT_DIALOG_NAME = /^(New event|Nuevo evento)$/;
// En el móvil el botón es sólo el + (#656), con su nombre entero.
const EVENT_DIALOG_OPEN = /^(Event|Evento|New event|Nuevo evento)$/;
// En el móvil (#657) el botón de la barra dice sólo Crear.
const EVENT_DIALOG_SUBMIT = /^(Create event|Crear evento|Create|Crear)$/;
const EVENT_DIALOG_TAB_PRESSES = 30;

const STUBBED_EVENT_GROUPS = [
  {
    id: "a1a1a1a1-0000-4000-8000-0000000000a1",
    name: "Senior Squad",
    memberCount: 14,
  },
  {
    id: "a1a1a1a1-0000-4000-8000-0000000000a2",
    name: "Masters",
    memberCount: 8,
  },
] as const;

function eventDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: EVENT_DIALOG_NAME });
}

async function servePlaces(
  page: Page,
  places: readonly Record<string, unknown>[],
): Promise<void> {
  await page.route(
    (url) => url.pathname === EVENT_PLACES_ENDPOINT,
    (route) => route.fulfill(jsonBody({ places, searchAvailable: true })),
  );
}

/** Lo escrito en Lugar como texto libre, con la lista de sugerencias
 * cerrada: la captura mira el formulario, no el buscador. */
async function fillFreeTextLocation(dialog: Locator): Promise<void> {
  const location = dialog.getByLabel(/^(Location|Lugar)$/);
  await location.fill("MSAC Dive Pool");
  await location.blur();
}

/** Abre "+ Evento" con los grupos servidos y espera al formulario. */
async function openEventDialog(page: Page): Promise<Locator> {
  await page.route(
    (url) => url.pathname === EVENT_DIALOG_GROUPS_ENDPOINT,
    (route) => route.fulfill(jsonBody({ groups: STUBBED_EVENT_GROUPS })),
  );
  await servePlaces(page, []);
  await waitForEmptyAgenda(page);
  await page.getByRole("button", { name: EVENT_DIALOG_OPEN }).click();
  const dialog = eventDialog(page);
  await expect(
    dialog.getByRole("radio", { name: /^(The whole club|Todo el club)$/ }),
  ).toBeVisible();
  return dialog;
}

async function fillEventBasics(dialog: Locator): Promise<void> {
  await dialog.getByLabel(/^(Title|Título)$/).fill("Pool Training");
  await dialog.getByLabel(/^(Starts|Empieza)$/).fill("19:00");
  await dialog.getByLabel(/^(Ends|Termina)$/).fill("20:30");
  await fillFreeTextLocation(dialog);
}

async function showOneTimeDialog(page: Page): Promise<void> {
  const dialog = await openEventDialog(page);
  await fillEventBasics(dialog);
  await dialog.getByLabel(/^(Date|Fecha)$/).fill("2026-10-06");
  await page.mouse.move(0, 0);
}

// El resumen de Semanal cuenta las sesiones desde ahora (#651): con el
// reloj real, las fechas de la captura acabarían en el pasado.
const WEEKLY_DIALOG_NOW = new Date("2026-10-01T00:00:00.000Z");

async function pressWeekdays(
  dialog: Locator,
  weekdays: readonly RegExp[],
): Promise<void> {
  for (const weekday of weekdays) {
    await dialog.getByRole("button", { name: weekday }).click();
  }
}

async function showWeeklyDialog(page: Page): Promise<void> {
  await page.clock.setFixedTime(WEEKLY_DIALOG_NOW);
  const dialog = await openEventDialog(page);
  await fillEventBasics(dialog);
  await dialog.getByRole("radio", { name: /^(Weekly|Semanal)$/ }).check();
  await pressWeekdays(dialog, [/^(Tuesday|martes)$/, /^(Thursday|jueves)$/]);
  await dialog.getByLabel(/^(Starts on|Empieza el)$/).fill("2026-10-06");
  await dialog.getByLabel(/^(Until|Hasta)$/).fill("2026-12-17");
  await dialog
    .getByRole("radio", { name: /^(Specific groups|Grupos concretos)$/ })
    .check();
  await dialog
    .getByRole("checkbox", { name: STUBBED_EVENT_GROUPS[0].name })
    .check();
  await page.mouse.move(0, 0);
}

async function showDialogWithError(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === EVENTS_MANAGE_ENDPOINT,
    (route) =>
      route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "business_rule",
            message: "La fecha y la hora del evento ya pasaron.",
            reason: "event_in_past",
          },
        }),
      }),
  );
  await showOneTimeDialog(page);
  const dialog = eventDialog(page);
  await dialog.getByRole("button", { name: EVENT_DIALOG_SUBMIT }).click();
  await expect(dialog.getByLabel(/^(Date|Fecha)$/)).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.mouse.move(0, 0);
}

/** La creación no responde nunca: el diálogo se queda guardando. */
async function showSavingDialog(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === EVENTS_MANAGE_ENDPOINT,
    () => undefined,
  );
  await showOneTimeDialog(page);
  const dialog = eventDialog(page);
  await dialog.getByRole("button", { name: EVENT_DIALOG_SUBMIT }).click();
  await expect(
    dialog.getByRole("button", { name: /^(Saving…|Guardando…)$/ }),
  ).toBeDisabled();
  await page.mouse.move(0, 0);
}

function inBothLanguages(
  name: string,
  ready: (page: Page) => Promise<void>,
): readonly CalendarState[] {
  return [
    { name, events: [], ready },
    { name: `${name}-es`, events: [], beforeVisit: chooseSpanish, ready },
  ];
}

const EVENT_DIALOG_STATES: readonly CalendarState[] = [
  ...inBothLanguages("calendario-dialogo-una-vez", showOneTimeDialog),
  ...inBothLanguages("calendario-dialogo-semanal", showWeeklyDialog),
  ...inBothLanguages("calendario-dialogo-error", showDialogWithError),
  ...inBothLanguages("calendario-dialogo-guardando", showSavingDialog),
];

for (const state of EVENT_DIALOG_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            // Sin `fullPage`: el diálogo vive en la capa superior, sobre lo
            // que se ve de la pantalla, y es eso lo que se revisa.
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToCalendar(page, state, theme);
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot(SCREENSHOT_OPTIONS),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }
      });
    }

    for (const width of CALENDAR_NARROW_WIDTHS) {
      test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 812 });
        await goToCalendar(page, state);
        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await goToCalendar(page, state);
      await expectNoAxeViolations(page);
    });
  });
}

// El diálogo rehecho de E24 (#650): imagen, tipo con icono y cuándo con hora
// de fin. Sólo tableta y escritorio: el móvil es #657. La subida de la imagen
// se sirve desde el test, como la creación: nada se guarda de verdad.
const EVENT_COVER_UPLOADS_ENDPOINT = "/api/v1/events/manage/uploads";
const EVENT_COVER_PREVIEW_NAME = /^(The event image|La imagen del evento)$/;
const REDESIGNED_DIALOG_VIEWPORTS = viewports.filter(
  (vp) => vp.name !== "mobile",
);

async function fillCreateDialog(
  page: Page,
  times: { readonly starts: string; readonly ends: string },
): Promise<Locator> {
  const dialog = await openEventDialog(page);
  await dialog
    .getByRole("radio", { name: /^(Competition|Competición)$/ })
    .check();
  await dialog.getByLabel(/^(Title|Título)$/).fill("Scrimmage vs Geelong");
  await dialog.getByLabel(/^(Date|Fecha)$/).fill("2026-10-14");
  await dialog.getByLabel(/^(Starts|Empieza)$/).fill(times.starts);
  await dialog.getByLabel(/^(Ends|Termina)$/).fill(times.ends);
  await fillFreeTextLocation(dialog);
  return dialog;
}

async function showCreateDialog(page: Page): Promise<void> {
  const dialog = await fillCreateDialog(page, {
    starts: "18:00",
    ends: "19:30",
  });
  await expect(dialog.getByText(/^(Lasts|Dura) 1 h 30 min$/)).toBeVisible();
  await page.mouse.move(0, 0);
}

/** Semanal con lunes y jueves hasta el 17 de diciembre, con el resumen, las
 * próximas fechas y la pista a la vista (#651). */
async function showCreateWeeklyDialog(page: Page): Promise<void> {
  await page.clock.setFixedTime(WEEKLY_DIALOG_NOW);
  const dialog = await fillCreateDialog(page, {
    starts: "18:00",
    ends: "19:30",
  });
  await dialog.getByRole("radio", { name: /^(Weekly|Semanal)$/ }).check();
  await pressWeekdays(dialog, [/^(Monday|lunes)$/, /^(Thursday|jueves)$/]);
  const until = dialog.getByLabel(/^(Until|Hasta)$/);
  await until.fill("2026-12-17");
  await until.blur();
  const hint = dialog.getByText(
    /^(Each session gets its own RSVP|Cada sesión tiene su propio RSVP)/,
  );
  await expect(
    dialog.getByText(/(19 sessions until|19 sesiones hasta el)/),
  ).toBeVisible();
  // Al centro: el pie pegado de los botones tapa lo que queda justo abajo.
  await hint.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.mouse.move(0, 0);
}

async function showCreateDialogWithInvalidEnd(page: Page): Promise<void> {
  const dialog = await fillCreateDialog(page, {
    starts: "18:00",
    ends: "17:00",
  });
  await expect(
    dialog.getByRole("button", { name: EVENT_DIALOG_SUBMIT }),
  ).toBeDisabled();
  await page.mouse.move(0, 0);
}

async function showCreateDialogWithImage(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === EVENT_COVER_UPLOADS_ENDPOINT,
    (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: { id: "c0c0c0c0-0000-4000-8000-0000000000c0" },
        }),
      }),
  );
  const dialog = await fillCreateDialog(page, {
    starts: "18:00",
    ends: "19:30",
  });
  await dialog
    .getByLabel(/^(Choose an image|Elegir una imagen)$/)
    .setInputFiles({
      name: "scrimmage.png",
      mimeType: "image/png",
      buffer: await coverPicture(),
    });
  const preview = dialog.getByRole("img", { name: EVENT_COVER_PREVIEW_NAME });
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
  // La captura mira el pie de la imagen y el cuándo, no sólo la cabecera.
  await dialog
    .getByRole("button", { name: /^(Remove image|Quitar imagen)$/ })
    .scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
}

// Lo que sugiere el buscador para "princes": el lugar del club primero y
// después los de Photon, como en el mockup.
const SUGGESTED_PLACES = [
  {
    source: "club",
    name: "Princes Park, Oval 2",
    address: "Princes Park Dr, Carlton North VIC 3054",
    lat: -37.7836,
    lng: 144.9616,
  },
  {
    source: "search",
    name: "Princes Bridge",
    address: "Swanston St, Melbourne VIC 3000",
    lat: -37.8191,
    lng: 144.9683,
  },
  {
    source: "search",
    name: "Princess Theatre",
    address: "163 Spring St, Melbourne VIC 3000",
    lat: -37.8107,
    lng: 144.9725,
  },
] as const;

async function searchPlaces(page: Page): Promise<Locator> {
  const dialog = await fillCreateDialog(page, {
    starts: "18:00",
    ends: "19:30",
  });
  await servePlaces(page, SUGGESTED_PLACES);
  const location = dialog.getByRole("combobox", { name: /^(Location|Lugar)$/ });
  await location.fill("princes");
  await expect(
    dialog.getByRole("option", { name: /Princess Theatre/ }),
  ).toBeVisible();
  return dialog;
}

async function showPlaceSearch(page: Page): Promise<void> {
  const dialog = await searchPlaces(page);
  await dialog
    .getByRole("option", { name: /keep what you typed|texto libre/ })
    .scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
}

async function showChosenPlace(page: Page): Promise<void> {
  const dialog = await searchPlaces(page);
  await dialog.getByRole("option", { name: /Princes Park, Oval 2/ }).click();
  const detail = dialog.getByLabel(
    /^(Where exactly · optional|Dónde exactamente · opcional)$/,
  );
  await detail.fill("Field 2, near the pavilion");
  await detail.blur();
  await detail.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
}

const REDESIGNED_DIALOG_STATES: readonly CalendarState[] = [
  ...inBothLanguages("calendario-crear", showCreateDialog),
  ...inBothLanguages(
    "calendario-crear-fin-invalido",
    showCreateDialogWithInvalidEnd,
  ),
  ...inBothLanguages("calendario-crear-semanal", showCreateWeeklyDialog),
  ...inBothLanguages("calendario-crear-con-imagen", showCreateDialogWithImage),
  ...inBothLanguages("calendario-crear-lugar-buscando", showPlaceSearch),
  ...inBothLanguages("calendario-crear-lugar-elegido", showChosenPlace),
];

for (const state of REDESIGNED_DIALOG_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of REDESIGNED_DIALOG_VIEWPORTS) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToCalendar(page, state, theme);
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot(SCREENSHOT_OPTIONS),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }
      });
    }

    for (const theme of themes) {
      test(`has no accessibility violations in ${theme} (axe-core)`, async ({
        page,
      }) => {
        await goToCalendar(page, state, theme);
        await expectNoAxeViolations(page);
      });
    }
  });
}

/* #657: crear y editar en el móvil ocupa la pantalla, con la barra de
   Cancelar, el título y Crear arriba ("#2c" del handoff de E24 y
   docs/mockups/mobile-calendar-redesign-create-dark.png). Sólo a 375: desde
   768 manda el diálogo, que se fotografía arriba. */
/** Rellenar baja el cuerpo; la captura, como el mockup, lo mira desde
 * arriba y sin foco en ningún campo. */
async function backToEventFormTop(page: Page): Promise<void> {
  const body = eventDialog(page).locator(".event-dialog-body");
  await body.evaluate((element) => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    element.scrollTo(0, 0);
  });
  await expect
    .poll(() => body.evaluate((element) => element.scrollTop))
    .toBe(0);
}

const MOBILE_EVENT_FORM_STATES: readonly CalendarState[] = [
  {
    name: "calendario-movil-crear",
    events: [],
    ready: async (page) => {
      await showCreateDialog(page);
      await backToEventFormTop(page);
    },
  },
  {
    name: "calendario-movil-crear-semanal",
    events: [],
    // Lo de arriba ya sale en calendario-movil-crear: ésta mira los días,
    // Hasta y el resumen con las próximas fechas.
    ready: async (page) => {
      await showCreateWeeklyDialog(page);
      await backToEventFormTop(page);
      await eventDialog(page)
        .locator(".event-form-weekly")
        .evaluate((panel) => panel.scrollIntoView({ block: "center" }));
    },
  },
];

for (const state of MOBILE_EVENT_FORM_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE, viewport: MOBILE_VIEWPORT });

    for (const theme of themes) {
      test(`matches approved baseline (${theme})`, async ({ page }) => {
        await goToCalendar(page, state, theme);
        const snapshot = `${state.name}-mobile-${theme}.png`;
        await createMissingLocalBaseline(snapshot, () =>
          page.screenshot(SCREENSHOT_OPTIONS),
        );
        await expect(page).toHaveScreenshot(snapshot, {
          ...SCREENSHOT_OPTIONS,
          maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
        });
      });

      test(`has no accessibility violations (axe-core, ${theme})`, async ({
        page,
      }) => {
        await goToCalendar(page, state, theme);
        await expectNoAxeViolations(page);
      });
    }

    for (const width of MOBILE_NARROW_WIDTHS) {
      test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ ...MOBILE_VIEWPORT, width });
        await goToCalendar(page, state);
        expect(await hasHorizontalScroll(page)).toBe(false);
        expect(
          await eventDialog(page)
            .locator(".event-dialog-body")
            .evaluate((body) => body.scrollWidth <= body.clientWidth),
        ).toBe(true);
      });
    }
  });
}

const EVENT_FORM_BAR_SUBMIT_PX = 36;
const EVENT_FORM_COVER_PX = 120;
const EVENT_FORM_COVER_WITH_IMAGE_PX = 160;
const EVENT_FORM_TYPE_PX = 46;
const EVENT_FORM_TIME_PX = 48;
const EVENT_FORM_CHIP_PX = 40;
const EVENT_FORM_REPEAT_PX = 40;
const EVENT_FORM_DAY_PX = 44;
const EVENT_FORM_SWITCH = { width: 44, height: 26 } as const;
const EVENT_FORM_PLACE_OPTION_MIN_PX = 56;
const EVENT_FORM_IOS_NO_ZOOM_FONT = "16px";

function eventFormBar(page: Page): Locator {
  return eventDialog(page).getByRole("group", { name: EVENT_DIALOG_NAME });
}

async function heightOf(control: Locator): Promise<number | undefined> {
  return (await control.boundingBox())?.height;
}

test.describe("el formulario de evento en el móvil: barra y medidas (#657)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE, viewport: MOBILE_VIEWPORT });

  const [CREATE, CREATE_WEEKLY] = MOBILE_EVENT_FORM_STATES as [
    CalendarState,
    CalendarState,
  ];

  test("ocupa la pantalla y la barra se queda arriba al desplazar", async ({
    page,
  }) => {
    await goToCalendar(page, CREATE);
    const dialog = eventDialog(page);

    expect(await dialog.boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: MOBILE_VIEWPORT.width,
      height: MOBILE_VIEWPORT.height,
    });
    await dialog
      .locator(".event-dialog-body")
      .evaluate(
        (body, distance) => body.scrollTo(0, distance),
        SCROLL_BEFORE_BAR_CHECK_PX,
      );
    const bar = eventFormBar(page);
    expect((await bar.boundingBox())?.y).toBe(0);
    await expect(bar.getByRole("button", { name: "Cancel" })).toBeInViewport();
    await expect(bar.getByRole("button", { name: "Create" })).toBeInViewport();
    await expect(
      dialog.getByRole("button", { name: EVENT_DIALOG_SUBMIT }),
    ).toHaveCount(1);
  });

  test("Crear se dibuja de 36 px con 44 de zona táctil", async ({ page }) => {
    await goToCalendar(page, CREATE);
    const submit = eventFormBar(page).getByRole("button", { name: "Create" });

    expect(await heightOf(submit)).toBe(EVENT_FORM_BAR_SUBMIT_PX);
    expect(await touchAreaHeight(submit)).toBe(MIN_TOUCH_TARGET_PX);
  });

  test("la imagen mide 120 y los tipos van en rejilla 2×2 de 46", async ({
    page,
  }) => {
    await goToCalendar(page, CREATE);
    const dialog = eventDialog(page);
    const types = await dialog
      .locator(".event-form-type")
      .evaluateAll((labels) =>
        labels.map((label) => label.getBoundingClientRect()),
      );

    expect(await heightOf(dialog.locator(".event-cover-banner"))).toBe(
      EVENT_FORM_COVER_PX,
    );
    expect(types.map((box) => box.height)).toEqual(
      Array(4).fill(EVENT_FORM_TYPE_PX),
    );
    expect(new Set(types.map((box) => box.top)).size).toBe(2);
  });

  test("con imagen elegida la imagen mide 160", async ({ page }) => {
    await goToCalendar(page, { ...CREATE, ready: showCreateDialogWithImage });

    expect(
      await heightOf(
        eventDialog(page).getByRole("img", { name: EVENT_COVER_PREVIEW_NAME }),
      ),
    ).toBe(EVENT_FORM_COVER_WITH_IMAGE_PX);
  });

  test("Empieza y Termina van lado a lado, de 48, y la fecha a lo ancho", async ({
    page,
  }) => {
    await goToCalendar(page, CREATE);
    const dialog = eventDialog(page);
    const date = await dialog.getByLabel("Date", { exact: true }).boundingBox();
    const starts = await dialog
      .getByLabel("Starts", { exact: true })
      .boundingBox();
    const ends = await dialog.getByLabel("Ends", { exact: true }).boundingBox();

    expect(starts?.height).toBe(EVENT_FORM_TIME_PX);
    expect(ends?.height).toBe(EVENT_FORM_TIME_PX);
    expect(starts?.y).toBe(ends?.y);
    expect(date?.width).toBeGreaterThan((starts?.width ?? 0) * 2);
  });

  test("las duraciones rápidas miden 40 en una sola fila", async ({ page }) => {
    await goToCalendar(page, CREATE);
    const chips = await eventDialog(page)
      .locator(".event-form-chip")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getBoundingClientRect()),
      );

    expect(chips.map((box) => box.height)).toEqual(
      Array(chips.length).fill(EVENT_FORM_CHIP_PX),
    );
    expect(new Set(chips.map((box) => box.top)).size).toBe(1);
  });

  test("Termina otro día es un interruptor de 44×26", async ({ page }) => {
    await goToCalendar(page, CREATE);
    const toggle = eventDialog(page).getByRole("switch", {
      name: "Ends on another day",
    });

    const box = await toggle.boundingBox();
    expect({ width: box?.width, height: box?.height }).toEqual(
      EVENT_FORM_SWITCH,
    );
  });

  test("Repetir mide 40 y los días, de 44, llenan la fila", async ({
    page,
  }) => {
    await goToCalendar(page, CREATE_WEEKLY);
    const dialog = eventDialog(page);
    const row = await dialog.locator(".event-form-days").boundingBox();
    const days = await dialog
      .locator(".event-form-day")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getBoundingClientRect()),
      );
    const first = days[0];
    const last = days[days.length - 1];

    expect(
      await heightOf(dialog.locator(".event-form-segment label").first()),
    ).toBe(EVENT_FORM_REPEAT_PX);
    expect(days.map((box) => [box.width, box.height])).toEqual(
      Array(7).fill([EVENT_FORM_DAY_PX, EVENT_FORM_DAY_PX]),
    );
    expect(first?.left).toBe(row?.x);
    expect(last?.right).toBe((row?.x ?? 0) + (row?.width ?? 0));
  });

  test("los resultados del buscador miden al menos 56 y la × de la tarjeta 44", async ({
    page,
  }) => {
    await goToCalendar(page, {
      ...CREATE,
      ready: async (place) => {
        await searchPlaces(place);
      },
    });
    const dialog = eventDialog(page);
    const heights = await dialog
      .getByRole("option")
      .evaluateAll((options) =>
        options.map((option) => option.getBoundingClientRect().height),
      );

    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(EVENT_FORM_PLACE_OPTION_MIN_PX);
    }
    await dialog.getByRole("option", { name: /Princes Park, Oval 2/ }).click();
    const remove = dialog.getByRole("button", { name: "Change the place" });
    expect(await remove.boundingBox()).toMatchObject({
      width: MIN_TOUCH_TARGET_PX,
      height: MIN_TOUCH_TARGET_PX,
    });
  });

  test("todo campo de texto lleva letra de 16 para que iOS no haga zoom", async ({
    page,
  }) => {
    await goToCalendar(page, CREATE);
    const sizes = await eventDialog(page)
      .locator(
        'input:not([type="checkbox"], [type="radio"], [type="file"]), textarea, select',
      )
      .evaluateAll((fields) =>
        fields.map((field) => getComputedStyle(field).fontSize),
      );

    expect(sizes.length).toBeGreaterThan(0);
    expect(new Set(sizes)).toEqual(new Set([EVENT_FORM_IOS_NO_ZOOM_FONT]));
  });

  test("con el fin antes del inicio Crear de la barra se apaga y Termina lo dice", async ({
    page,
  }) => {
    await goToCalendar(page, {
      ...CREATE,
      ready: showCreateDialogWithInvalidEnd,
    });
    const dialog = eventDialog(page);

    await expect(
      eventFormBar(page).getByRole("button", { name: "Create" }),
    ).toBeDisabled();
    await expect(
      dialog.getByText("The end must be after the start."),
    ).toBeVisible();
  });

  test("Cancelar con cambios pregunta y se queda si se dice que no", async ({
    page,
  }) => {
    await goToCalendar(page, CREATE);
    const question = page.waitForEvent("dialog");
    void question.then((prompt) => prompt.dismiss());

    await eventFormBar(page).getByRole("button", { name: "Cancel" }).click();

    expect((await question).message()).toBe(
      "You have unsaved changes. Leave and discard them?",
    );
    await expect(eventDialog(page)).toBeVisible();
  });

  test("a 768 vuelve el diálogo con su pie", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await goToCalendar(page, CREATE);
    const dialog = eventDialog(page);

    await expect(
      dialog.getByRole("button", { name: /^Create event$/ }),
    ).toBeVisible();
    await expect(eventFormBar(page)).toHaveCount(0);
    expect((await dialog.boundingBox())?.width).toBeLessThan(768);
  });
});

test.describe("diálogo de evento en el navegador", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  const ONE_TIME_DIALOG: CalendarState = {
    name: "calendario-dialogo-una-vez",
    events: [],
    ready: showOneTimeDialog,
  };

  test("Escape lo cierra y devuelve el foco a + Evento", async ({ page }) => {
    await goToCalendar(page, ONE_TIME_DIALOG);

    await page.keyboard.press("Escape");

    await expect(eventDialog(page)).toBeHidden();
    await expect(
      page.getByRole("button", { name: EVENT_DIALOG_OPEN }),
    ).toBeFocused();
  });

  // Al pasar del último control, Chrome lleva el foco a su propia barra (el
  // documento se queda con `body`): eso es del navegador, no de la página.
  // Lo que no puede pasar es que el foco caiga en la agenda de detrás.
  test("el foco no cae en la página de detrás mientras está abierto", async ({
    page,
  }) => {
    await goToCalendar(page, ONE_TIME_DIALOG);

    for (let step = 0; step < EVENT_DIALOG_TAB_PRESSES; step += 1) {
      await page.keyboard.press("Tab");
      const isBehind = await eventDialog(page).evaluate(
        (dialog) =>
          document.activeElement !== document.body &&
          !dialog.contains(document.activeElement),
      );
      expect(isBehind).toBe(false);
    }
  });

  test("al crear cierra el diálogo y avisa en la agenda", async ({ page }) => {
    let sent: unknown = null;
    await page.route(
      (url) => url.pathname === EVENTS_MANAGE_ENDPOINT,
      async (route, request) => {
        sent = request.postDataJSON();
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              repeat: "none",
              event: {
                id: "e0e0e0e0-0000-4000-8000-0000000000e9",
                startsOn: "2026-10-06",
                title: "Pool Training",
                eventType: "training",
                startTime: "19:00",
                location: "MSAC Dive Pool",
                notes: null,
                audience: { kind: "club" },
              },
            },
          }),
        });
      },
    );
    await goToCalendar(page, ONE_TIME_DIALOG);

    await eventDialog(page)
      .getByRole("button", { name: EVENT_DIALOG_SUBMIT })
      .click();

    await expect(eventDialog(page)).toBeHidden();
    await expect(
      page.getByText("Event created. We let the members know."),
    ).toBeVisible();
    expect(sent).toMatchObject({
      repeat: "none",
      title: "Pool Training",
      startsOn: "2026-10-06",
      startTime: "19:00",
    });
  });
});
// Editar y cancelar desde la fila desplegada (#316). La primera fila es una
// ocurrencia de una serie, así que cada acción pregunta primero el alcance:
// editar, solo esta sesión o esta y las siguientes (#655); cancelar, solo
// esta o toda la serie. Todo se sirve desde el test: nada se edita ni se
// cancela de verdad.
const ORGANIZER_EDIT = /^(Edit|Editar)$/;
const ORGANIZER_CANCEL = /^(Cancel|Cancelar)$/;
const ORGANIZER_WHOLE_SERIES =
  /^(The whole series from today on|Toda la serie de hoy en adelante)$/;
const ORGANIZER_FOLLOWING =
  /^(This and all following sessions|Esta y las siguientes)$/;
const ORGANIZER_CONFIRM_SERIES = /^(Cancel series|Cancelar serie)$/;
const EDIT_SERIES_DIALOG_NAME = /^(Edit series|Editar serie)$/;
const EDIT_EVENT_DIALOG_NAME = /^(Edit event|Editar evento)$/;

const ORGANIZER_OPENED_EVENT = {
  ...PLAYER_OPENED_EVENT,
  audience: {
    kind: "groups",
    groups: [
      {
        id: STUBBED_EVENT_GROUPS[0].id,
        name: STUBBED_EVENT_GROUPS[0].name,
      },
    ],
  },
} as const;

/** La serie de la primera fila, para elegir qué editar (#655): los martes
 * hasta septiembre. */
const ORGANIZER_SERIES_OPENED_EVENT = {
  ...ORGANIZER_OPENED_EVENT,
  series: { weekdays: [2], endsOn: "2026-09-15", sessionsLeft: 13 },
} as const;

function firstAgendaRow(page: Page): Locator {
  return agendaRow(page, STUBBED_AGENDA_EVENTS[0].title);
}

/** Editar y Cancelar están en el panel del evento elegido (#648). */
function firstEventPanel(page: Page): Locator {
  return eventPanel(page, STUBBED_AGENDA_EVENTS[0].title);
}

async function stubEventGroups(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === EVENT_DIALOG_GROUPS_ENDPOINT,
    (route) => route.fulfill(jsonBody({ groups: STUBBED_EVENT_GROUPS })),
  );
}

/** Elige la sesión y pulsa Editar: sale qué editar de la serie (#655). */
async function showEditScopeChoice(page: Page): Promise<void> {
  await openFirstPanel(page);
  const row = firstEventPanel(page);
  await row.getByRole("button", { name: ORGANIZER_EDIT }).click();
  await expect(
    row.getByRole("button", { name: ORGANIZER_FOLLOWING }),
  ).toBeVisible();
  // La captura es de página entera: sin esto, su ventana de 1×1
  // pasa la agenda a la pantalla del móvil (#656) y el panel vuelve sin
  // lo que se abrió.
  await fitViewportToPage(page);
  await expect(
    row.getByRole("button", { name: ORGANIZER_FOLLOWING }),
  ).toBeVisible();
  await page.mouse.move(0, 0);
}

async function showSeriesCancelConfirmation(page: Page): Promise<void> {
  await openFirstPanel(page);
  const row = firstEventPanel(page);
  await row.getByRole("button", { name: ORGANIZER_CANCEL }).click();
  await row.getByRole("button", { name: ORGANIZER_WHOLE_SERIES }).click();
  await expect(
    row.getByRole("button", { name: ORGANIZER_CONFIRM_SERIES }),
  ).toBeVisible();
  // Lo mismo que al elegir qué editar: ver showEditScopeChoice.
  await fitViewportToPage(page);
  await expect(
    row.getByRole("button", { name: ORGANIZER_CONFIRM_SERIES }),
  ).toBeVisible();
  await page.mouse.move(0, 0);
}

async function showEditSeriesDialog(page: Page): Promise<void> {
  await stubEventGroups(page);
  await openFirstPanel(page);
  const row = firstEventPanel(page);
  await row.getByRole("button", { name: ORGANIZER_EDIT }).click();
  await row.getByRole("button", { name: ORGANIZER_FOLLOWING }).click();
  const dialog = page.getByRole("dialog", { name: EDIT_SERIES_DIALOG_NAME });
  await expect(
    dialog.getByRole("radio", { name: /^(The whole club|Todo el club)$/ }),
  ).toBeVisible();
  await page.mouse.move(0, 0);
}

function organizerStates(
  name: string,
  ready: (page: Page) => Promise<void>,
  opened: CalendarState["opened"] = ORGANIZER_OPENED_EVENT,
): readonly [CalendarState, CalendarState] {
  const state = {
    events: STUBBED_AGENDA_EVENTS,
    opened,
    ready,
  };
  return [
    { ...state, name },
    { ...state, name: `${name}-es`, beforeVisit: chooseSpanish },
  ];
}

const ORGANIZER_ACTIONS_STATES = organizerStates(
  "calendario-organizador-acciones",
  openFirstPanel,
);
const ORGANIZER_CONFIRM_STATES = organizerStates(
  "calendario-organizador-confirmar-cancelar",
  showSeriesCancelConfirmation,
);

const ORGANIZER_ROW_STATES: readonly CalendarState[] = [
  ...ORGANIZER_ACTIONS_STATES,
  ...organizerStates(
    "calendario-editar-alcance",
    showEditScopeChoice,
    ORGANIZER_SERIES_OPENED_EVENT,
  ),
  ...ORGANIZER_CONFIRM_STATES,
];

const ORGANIZER_DIALOG_STATES: readonly CalendarState[] = organizerStates(
  "calendario-organizador-editar-serie",
  showEditSeriesDialog,
  ORGANIZER_SERIES_OPENED_EVENT,
);

// Editar y Cancelar en el panel son de 768 en adelante: en el móvil van en
// la hoja ⋯ de la pantalla del evento (#656), con sus propios estados.
const ORGANIZER_PANEL_WIDTHS = CALENDAR_NARROW_WIDTHS.filter(
  (width) => width >= 768,
);

for (const state of [...ORGANIZER_ROW_STATES, ...ORGANIZER_DIALOG_STATES]) {
  // El diálogo vive en la capa superior: se fotografía lo que se ve, no la
  // página entera, como en el de crear.
  const isFullPage = ORGANIZER_ROW_STATES.includes(state);
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of PANEL_VIEWPORTS) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToCalendar(page, state, theme);
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({
                  ...SCREENSHOT_OPTIONS,
                  fullPage: isFullPage,
                }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: isFullPage,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }
      });
    }

    for (const width of ORGANIZER_PANEL_WIDTHS) {
      test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 812 });
        await goToCalendar(page, state);
        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    }

    // El contraste de las opciones nuevas (#655) se comprueba en los dos
    // temas.
    for (const theme of themes) {
      test(`has no accessibility violations (axe-core, ${theme})`, async ({
        page,
      }) => {
        await goToCalendar(page, state, theme);
        await expectNoAxeViolations(page);
      });
    }
  });
}

test.describe("editar y cancelar en el navegador", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  const [OCCURRENCE] = STUBBED_AGENDA_EVENTS;
  const [ACTIONS] = ORGANIZER_ACTIONS_STATES;
  const [CONFIRM] = ORGANIZER_CONFIRM_STATES;

  test("al confirmar, la serie queda cancelada y el foco vuelve a su título", async ({
    page,
  }) => {
    let hasCancelled = false;
    await page.route(
      (url) =>
        url.pathname ===
        `${EVENTS_MANAGE_ENDPOINT}/series/${OCCURRENCE.seriesId}/cancellation`,
      (route) => {
        hasCancelled = true;
        return route.fulfill(
          jsonBody({
            seriesId: OCCURRENCE.seriesId,
            cancelledAt: "2026-06-20T08:00:00.000Z",
            cancelledOccurrences: 6,
          }),
        );
      },
    );
    await goToCalendar(page, CONFIRM);
    // La agenda que se pide tras cancelar trae la ocurrencia cancelada.
    await page.route(
      (url) => url.pathname === CALENDAR_AGENDA_ENDPOINT,
      (route) =>
        route.fulfill(
          jsonBody({
            events: hasCancelled
              ? [{ ...OCCURRENCE, status: "cancelled" }]
              : STUBBED_AGENDA_EVENTS,
            nextCursor: null,
          }),
        ),
    );

    await firstEventPanel(page)
      .getByRole("button", { name: ORGANIZER_CONFIRM_SERIES })
      .click();

    await expect(
      page.getByText("Cancelled 6 sessions. We let the audience know."),
    ).toBeVisible();
    await expect(firstAgendaRow(page).getByText("Cancelled")).toBeVisible();
    await expect(
      firstAgendaRow(page).getByRole("heading", { name: OCCURRENCE.title }),
    ).toBeFocused();
  });

  test("a 1440x700 Cancelar se alcanza dentro del panel aunque no quepa", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await goToCalendar(page, ACTIONS);
    const panel = firstEventPanel(page);
    const cancel = panel.getByRole("button", { name: ORGANIZER_CANCEL });
    // Que de verdad no quepa: si no, la prueba no prueba nada.
    await expect(cancel).not.toBeInViewport();

    // Con la rueda, como quien mira: `scrollIntoViewIfNeeded` también
    // movería una caja con `overflow: hidden`.
    await panel.hover();
    await page.mouse.wheel(0, 2000);

    await expect(cancel).toBeInViewport();
  });

  test("Escape cierra el diálogo de editar y devuelve el foco a Editar", async ({
    page,
  }) => {
    await stubEventGroups(page);
    await goToCalendar(page, ACTIONS);
    const row = firstEventPanel(page);
    await row.getByRole("button", { name: ORGANIZER_EDIT }).click();
    await row.getByRole("button", { name: "This session only" }).click();
    const dialog = page.getByRole("dialog", { name: EDIT_EVENT_DIALOG_NAME });
    await expect(dialog.getByLabel("Title")).toHaveValue(OCCURRENCE.title);

    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden();
    await expect(
      row.getByRole("button", { name: ORGANIZER_EDIT }),
    ).toBeFocused();
  });

  // En el móvil la confirmación sale en la hoja ⋯ de la pantalla del evento
  // (#656).
  test("a 375px los botones de confirmar conservan el objetivo táctil de 44px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToCalendar(page, { ...CONFIRM, ready: openFirstPanel });
    await firstEventPanel(page)
      .getByRole("button", { name: /^(Event actions|Acciones del evento)$/ })
      .click();
    const sheet = page.getByRole("dialog", {
      name: /^(Event actions|Acciones del evento)$/,
    });
    await sheet
      .getByRole("button", { name: /^(Cancel event|Cancelar evento)$/ })
      .click();
    await sheet.getByRole("button", { name: ORGANIZER_WHOLE_SERIES }).click();

    const heights = await sheet
      .getByRole("group", { name: /said they're going|dijo que va|dijeron/ })
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getBoundingClientRect().height),
      );

    expect(heights.length).toBeGreaterThan(0);
    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(RSVP_MIN_TOUCH_TARGET_PX);
    }
  });
});
/* ---------------------------------------------------------------------------
   Asistencia (#395, RF-8 del PRD de E8): la hoja con estados mezclados, tras
   guardar, con un error, vacía y sin sesiones. Mockup:
   docs/mockups/attendance-light.png y attendance-dark.png, que es de
   escritorio; en el móvil los tres botones bajan a lo ancho de la fila.

   Los datos son fijos, servidos por `page.route` como en Evaluaciones: lo que
   los endpoints responden y guardan se prueba contra la base (#393).
   --------------------------------------------------------------------------- */

const ATTENDANCE_SCREEN_PATH = "/asistencia";
const ATTENDANCE_SESSIONS_ENDPOINT = "/api/v1/attendance/sessions";
const ATTENDANCE_ENDPOINT = "/api/v1/attendance";
const ATTENDANCE_NARROW_WIDTHS = [320, 375, 768] as const;
const ATTENDANCE_MIN_TOUCH_TARGET_PX = 44;

const POOL_TRAINING_SESSION = {
  eventId: "a7a7a7a7-0000-4000-8000-0000000000a1",
  title: "Pool Training",
  // Martes 23 de junio, 19:00 en Melbourne.
  startsAt: "2026-06-23T09:00:00.000Z",
  hasSheet: false,
  totals: { present: 0, late: 0, absent: 0 },
};

const ATTENDANCE_SESSIONS = [
  POOL_TRAINING_SESSION,
  {
    eventId: "a7a7a7a7-0000-4000-8000-0000000000a2",
    title: "Skills & Conditioning",
    startsAt: "2026-06-18T09:00:00.000Z",
    hasSheet: true,
    totals: { present: 12, late: 1, absent: 1 },
  },
  {
    eventId: "a7a7a7a7-0000-4000-8000-0000000000a3",
    title: "Scrimmage",
    startsAt: "2026-06-13T00:00:00.000Z",
    hasSheet: true,
    totals: { present: 13, late: 0, absent: 1 },
  },
] as const;

const ATTENDANCE_POSITIONS = {
  forward: {
    id: "b0b0b0b0-0000-4000-8000-0000000000b1",
    names: { en: "Forward", es: "Ataque" },
  },
  goalkeeper: {
    id: "b0b0b0b0-0000-4000-8000-0000000000b2",
    names: { en: "Goalkeeper", es: "Portería" },
  },
  defender: {
    id: "b0b0b0b0-0000-4000-8000-0000000000b3",
    names: { en: "Defender", es: "Defensa" },
  },
} as const;

type StubbedAttendanceMember = {
  readonly fullName: string;
  readonly position: keyof typeof ATTENDANCE_POSITIONS | null;
  readonly status: "present" | "late" | "absent";
  readonly rsvpResponse: "yes" | "maybe" | "no" | null;
  readonly isInactive?: boolean;
  /** Sin ella, la fila enseña las iniciales. */
  readonly photoUrl?: string;
};

function attendanceMember(
  fullName: string,
  position: StubbedAttendanceMember["position"],
  status: StubbedAttendanceMember["status"],
  rsvpResponse: StubbedAttendanceMember["rsvpResponse"],
): StubbedAttendanceMember {
  return { fullName, position, status, rsvpResponse };
}

const FIRST_ATTENDEE = "Mateo Restrepo";
const LONG_NAMED_ATTENDEE =
  "Maximiliana Alejandra Fernández-Rodríguez de la Torre";

/** El `userId` de cada fila servida, por su puesto en la lista. */
function attendeeId(index: number): string {
  return `a7a7a7a7-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

const FIRST_ATTENDEE_ID = attendeeId(0);

/** Los del mockup, con sus estados, en los cuatro grupos por respuesta y
 * con quien no dijo que venía en Ausente (#412), más un nombre de tres veces lo normal
 * para el caso de contenido largo y una cuenta desactivada con fila. El
 * primero lleva foto, que se abre en grande (#414). */
const ATTENDANCE_MEMBERS: readonly StubbedAttendanceMember[] = [
  {
    ...attendanceMember(FIRST_ATTENDEE, "forward", "present", "yes"),
    photoUrl: STUBBED_PHOTO_URL,
  },
  attendanceMember("Valentina Gómez", "goalkeeper", "present", "yes"),
  attendanceMember("Liam O'Connor", "defender", "present", "yes"),
  attendanceMember("Chloe Nguyen", "forward", "present", "yes"),
  attendanceMember("Santiago Herrera", "defender", "present", "yes"),
  attendanceMember("Ruby Tan", "goalkeeper", "absent", "maybe"),
  attendanceMember("Camila Ortiz", "forward", "present", "maybe"),
  attendanceMember("Jack Thompson", "defender", "absent", null),
  attendanceMember(LONG_NAMED_ATTENDEE, "forward", "absent", null),
  {
    ...attendanceMember("Oliver Smith", null, "absent", null),
    isInactive: true,
  },
  attendanceMember("Noah Williams", "goalkeeper", "absent", "no"),
  attendanceMember("Ethan Brown", "forward", "late", "no"),
];

type AttendanceViewer = "admin" | "coach";

function stubbedAttendanceSheet(
  members: readonly StubbedAttendanceMember[],
  viewer: AttendanceViewer,
): unknown {
  return {
    eventId: POOL_TRAINING_SESSION.eventId,
    title: POOL_TRAINING_SESSION.title,
    startsAt: POOL_TRAINING_SESSION.startsAt,
    isSaved: false,
    viewer,
    members: members.map((member, index) => ({
      userId: attendeeId(index),
      fullName: member.fullName,
      photoUrl: member.photoUrl ?? null,
      position:
        member.position === null ? null : ATTENDANCE_POSITIONS[member.position],
      status: member.status,
      rsvpResponse: member.rsvpResponse,
      isInactive: member.isInactive ?? false,
    })),
  };
}

type SavedRecords = {
  readonly records: readonly { readonly status: string }[];
};

function totalsOfSaved({ records }: SavedRecords): unknown {
  const count = (status: string) =>
    records.filter((record) => record.status === status).length;
  return {
    present: count("present"),
    late: count("late"),
    absent: count("absent"),
  };
}

type AttendanceReads = {
  readonly sessions: readonly unknown[];
  readonly members: readonly StubbedAttendanceMember[];
  /** Como quién la mira, según la API (#414); sin él, como Admin, que es la
   * sesión de estas pruebas. */
  readonly viewer?: AttendanceViewer;
  /** Lo que responde guardar; sin él, los totales de lo que llega. */
  readonly saveFailure?: { readonly status: number; readonly error: unknown };
};

/** GET de las sesiones y de cualquier hoja; PUT guarda y responde con los
 * totales, o con el fallo pedido. Devuelve los cuerpos que llegaron a PUT. */
async function stubAttendance(
  page: Page,
  reads: AttendanceReads,
): Promise<SavedRecords[]> {
  const saved: SavedRecords[] = [];
  await stubDirectoryPhoto(page);
  await page.route(
    (url) => url.pathname === ATTENDANCE_SESSIONS_ENDPOINT,
    (route) => route.fulfill(jsonBody({ sessions: reads.sessions })),
  );
  await page.route(
    (url) =>
      url.pathname.startsWith(`${ATTENDANCE_ENDPOINT}/`) &&
      url.pathname !== ATTENDANCE_SESSIONS_ENDPOINT,
    (route, request) => {
      if (request.method() !== "PUT") {
        return route.fulfill(
          jsonBody(
            stubbedAttendanceSheet(reads.members, reads.viewer ?? "admin"),
          ),
        );
      }
      const body = request.postDataJSON() as SavedRecords;
      saved.push(body);
      if (reads.saveFailure !== undefined) {
        return route.fulfill({
          status: reads.saveFailure.status,
          contentType: "application/json",
          body: JSON.stringify({ error: reads.saveFailure.error }),
        });
      }
      return route.fulfill(
        jsonBody({
          eventId: POOL_TRAINING_SESSION.eventId,
          totals: totalsOfSaved(body),
        }),
      );
    },
  );
  return saved;
}

const ATTENDANCE_SAVE = /^(Save attendance|Guardar asistencia)/;
const ATTENDANCE_LATE = /^(Late|Tarde)$/;
const CANCELLED_SESSION_FAILURE = {
  status: 422,
  error: {
    code: "business_rule",
    message: "El entrenamiento está cancelado: no lleva asistencia.",
    reason: "attendance_session_cancelled",
  },
};

function attendanceRow(page: Page, fullName: string): Locator {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("group", { name: fullName }) });
}

/** Con la foto de la primera fila pintada: una a medio cargar cambia la
 * captura. */
async function waitForAttendanceSheet(page: Page): Promise<void> {
  await expect(page.getByRole("group", { name: FIRST_ATTENDEE })).toBeVisible();
  await waitForDirectoryPhoto(page);
}

/** Marca a Mateo como Tarde y guarda; espera la confirmación o el aviso. */
async function markLateAndSave(
  page: Page,
  outcome: "status" | "alert",
): Promise<void> {
  await waitForAttendanceSheet(page);
  await attendanceRow(page, FIRST_ATTENDEE)
    .getByRole("button", { name: ATTENDANCE_LATE })
    .click();
  await page.getByRole("button", { name: ATTENDANCE_SAVE }).click();
  // El anunciador de rutas de Next también es un alert: se busca el aviso de
  // la pantalla por su texto.
  await expect(
    outcome === "status"
      ? page.getByText(/^(Saved · |Guardado · )/)
      : page.getByText(/cancelled: it doesn't|está cancelado: no/),
  ).toBeVisible();
  await page.mouse.move(0, 0);
}

type AttendanceState = AttendanceReads & {
  readonly name: string;
  readonly isSpanish?: boolean;
  /** Sin ellos, se fotografía en todos. */
  readonly viewports?: readonly (typeof viewports)[number][];
  readonly ready: (page: Page) => Promise<void>;
};

const ATTENDANCE_ROW_UNSAVED = /^(Not saved yet|Sin guardar todavía)$/;

const ATTENDANCE_SEARCH = /^(Search by name|Buscar por nombre)$/;

/** Cambia a dos socios sin guardar: los dos llevan el punto (#764). */
async function markTwoUnsaved(page: Page): Promise<void> {
  await waitForAttendanceSheet(page);
  for (const fullName of [FIRST_ATTENDEE, "Ruby Tan"]) {
    await attendanceRow(page, fullName)
      .getByRole("button", { name: ATTENDANCE_LATE })
      .click();
  }
  await expect(page.getByTitle(ATTENDANCE_ROW_UNSAVED)).toHaveCount(2);
  await page.mouse.move(0, 0);
}

/** Con cambios, el escritorio los cuenta en Guardar (#764) y el móvil saca
 * la barra fija (#766): cada uno es su propio estado. */
const ATTENDANCE_DESKTOP_VIEWPORTS = viewports.filter((vp) => vp.width >= 768);
const ATTENDANCE_PHONE_VIEWPORTS = viewports.filter((vp) => vp.width < 768);

function withSpanish(state: AttendanceState): readonly AttendanceState[] {
  return [state, { ...state, name: `${state.name}-es`, isSpanish: true }];
}

const ATTENDANCE_SHEET_STATE: AttendanceState = {
  name: "asistencia-hoja",
  sessions: ATTENDANCE_SESSIONS,
  members: ATTENDANCE_MEMBERS,
  ready: waitForAttendanceSheet,
};

/** A un Coach los nombres le salen en texto (#414): la ficha es del Admin. */
const ATTENDANCE_COACH_SHEET_STATE: AttendanceState = {
  ...ATTENDANCE_SHEET_STATE,
  name: "asistencia-hoja-coach",
  viewer: "coach",
};

const ATTENDANCE_STATES: readonly AttendanceState[] = [
  ...withSpanish(ATTENDANCE_SHEET_STATE),
  ...withSpanish(ATTENDANCE_COACH_SHEET_STATE),
  ...withSpanish({
    name: "asistencia-guardada",
    sessions: ATTENDANCE_SESSIONS,
    members: ATTENDANCE_MEMBERS,
    ready: (page) => markLateAndSave(page, "status"),
  }),
  {
    name: "asistencia-sin-guardar",
    sessions: ATTENDANCE_SESSIONS,
    members: ATTENDANCE_MEMBERS,
    viewports: ATTENDANCE_DESKTOP_VIEWPORTS,
    ready: markTwoUnsaved,
  },
  {
    name: "asistencia-sin-guardar-movil",
    sessions: ATTENDANCE_SESSIONS,
    members: ATTENDANCE_MEMBERS,
    viewports: ATTENDANCE_PHONE_VIEWPORTS,
    ready: async (page) => {
      await markTwoUnsaved(page);
      await expect(page.getByText(/^(2 unsaved|2 sin guardar)$/)).toBeVisible();
    },
  },
  // El buscador por nombre: "ma" deja a Mateo y a Maximiliana, cada uno en
  // su grupo, y los totales siguen contando a todos.
  ...withSpanish({
    name: "asistencia-buscando",
    sessions: ATTENDANCE_SESSIONS,
    members: ATTENDANCE_MEMBERS,
    ready: async (page) => {
      await waitForAttendanceSheet(page);
      await page.getByRole("searchbox", { name: ATTENDANCE_SEARCH }).fill("ma");
      await expect(
        page.getByRole("group", { name: LONG_NAMED_ATTENDEE }),
      ).toBeVisible();
      await expect(page.getByRole("group", { name: "Ruby Tan" })).toHaveCount(
        0,
      );
      await page.mouse.move(0, 0);
    },
  }),
  // Con cambios y el buscador a la vez: el campo y, en el móvil, la barra
  // fija de Guardar.
  {
    name: "asistencia-buscando-sin-guardar",
    sessions: ATTENDANCE_SESSIONS,
    members: ATTENDANCE_MEMBERS,
    ready: async (page) => {
      await markTwoUnsaved(page);
      await page.getByRole("searchbox", { name: ATTENDANCE_SEARCH }).fill("ma");
      await expect(page.getByRole("group", { name: "Ruby Tan" })).toHaveCount(
        0,
      );
      await page.mouse.move(0, 0);
    },
  },
  ...withSpanish({
    name: "asistencia-buscando-sin-resultados",
    sessions: ATTENDANCE_SESSIONS,
    members: ATTENDANCE_MEMBERS,
    ready: async (page) => {
      await waitForAttendanceSheet(page);
      await page
        .getByRole("searchbox", { name: ATTENDANCE_SEARCH })
        .fill("zzz");
      await expect(
        page.getByText(/^(No one by that name|Nadie se llama así)$/),
      ).toBeVisible();
      await page.mouse.move(0, 0);
    },
  }),
  ...withSpanish({
    name: "asistencia-error",
    sessions: ATTENDANCE_SESSIONS,
    members: ATTENDANCE_MEMBERS,
    saveFailure: CANCELLED_SESSION_FAILURE,
    ready: (page) => markLateAndSave(page, "alert"),
  }),
  ...withSpanish({
    name: "asistencia-vacia",
    sessions: ATTENDANCE_SESSIONS,
    members: [],
    ready: async (page) => {
      await expect(
        page.getByText(
          /^(Nobody is expected at this session\.|No se espera a nadie en esta sesión\.)$/,
        ),
      ).toBeVisible();
    },
  }),
  ...withSpanish({
    name: "asistencia-sin-sesiones",
    sessions: [],
    members: [],
    ready: async (page) => {
      await expect(
        page.getByRole("link", {
          name: /^(Go to the calendar|Ir al calendario)$/,
        }),
      ).toBeVisible();
    },
  }),
];

async function goToAttendance(
  page: Page,
  state: AttendanceState,
  theme?: (typeof themes)[number],
): Promise<SavedRecords[]> {
  const saved = await stubAttendance(page, state);
  if (state.isSpanish === true) {
    await chooseSpanish(page);
  }
  if (theme === undefined) {
    await page.goto(`${APP_URL}${ATTENDANCE_SCREEN_PATH}`);
  } else {
    await goToWithTheme(page, ATTENDANCE_SCREEN_PATH, theme);
  }
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await state.ready(page);
  return saved;
}

for (const state of ATTENDANCE_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of state.viewports ?? viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToAttendance(page, state, theme);
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }
      });
    }

    for (const width of ATTENDANCE_NARROW_WIDTHS) {
      test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 812 });
        await goToAttendance(page, state);
        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await goToAttendance(page, state);
      await expectNoAxeViolations(page);
    });
  });
}

test.describe("asistencia en el navegador", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("marcar cambia los contadores y guardar manda la hoja entera una vez", async ({
    page,
  }) => {
    const saved = await goToAttendance(page, ATTENDANCE_SHEET_STATE);
    const totals = page.getByRole("list", { name: "Totals" });
    await expect(totals).toHaveText(/^6Present1Late5Absent$/);

    await attendanceRow(page, FIRST_ATTENDEE)
      .getByRole("button", { name: "Late" })
      .click();
    await expect(totals).toHaveText(/^5Present2Late5Absent$/);
    await page.getByRole("button", { name: ATTENDANCE_SAVE }).dblclick();

    await expect(
      page.getByText("Saved · 5 present, 2 late, 5 absent"),
    ).toBeVisible();
    expect(saved.map((body) => body.records.length)).toEqual([
      ATTENDANCE_MEMBERS.length,
    ]);
  });

  test("el enlace a sesiones anteriores mide 44 px y no ensancha la página a 375 px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToAttendance(page, ATTENDANCE_SHEET_STATE);

    const older = page
      .getByRole("group", { name: "Sessions" })
      .getByRole("link", { name: "Older sessions: open the calendar" });
    await expect(older).toBeVisible();
    expect((await older.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test("agrupa la hoja en cuatro regiones, en el orden de las respuestas", async ({
    page,
  }) => {
    await goToAttendance(page, ATTENDANCE_SHEET_STATE);

    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Going",
      "Maybe",
      "No reply",
      "Can't go",
    ]);
    await expect(
      page
        .getByRole("region", { name: "Can't go" })
        .getByRole("group", { name: "Noah Williams" }),
    ).toBeVisible();
  });

  test("cambiar de sesión con cambios sin guardar pregunta antes", async ({
    page,
  }) => {
    await goToAttendance(page, ATTENDANCE_SHEET_STATE);
    await attendanceRow(page, FIRST_ATTENDEE)
      .getByRole("button", { name: "Late" })
      .click();
    const questions: string[] = [];
    // La pregunta es el diálogo nativo: el clic no termina hasta contestarla.
    page.once("dialog", (dialog) => {
      questions.push(dialog.message());
      void dialog.dismiss();
    });

    await page
      .getByRole("group", { name: "Sessions" })
      .getByRole("button", { name: "Thu 18 · Skills & Conditioning" })
      .click();

    expect(questions).toEqual([
      "You have unsaved changes on this session. Discard them?",
    ]);
    await expect(
      page.getByRole("heading", { level: 1, name: /^Pool Training · / }),
    ).toBeVisible();
  });

  test("con ?sesion= abre esa hoja", async ({ page }) => {
    await stubAttendance(page, ATTENDANCE_SHEET_STATE);
    const opened = page.waitForRequest((request) =>
      request
        .url()
        .endsWith(`${ATTENDANCE_ENDPOINT}/${POOL_TRAINING_SESSION.eventId}`),
    );

    await page.goto(
      `${APP_URL}${ATTENDANCE_SCREEN_PATH}?sesion=${POOL_TRAINING_SESSION.eventId}`,
    );

    await opened;
    await waitForAttendanceSheet(page);
  });

  for (const theme of themes) {
    test(`el estado elegido y el punto pasan axe en ${theme} (#764)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await stubAttendance(page, ATTENDANCE_SHEET_STATE);
      await goToWithTheme(page, ATTENDANCE_SCREEN_PATH, theme);
      await markTwoUnsaved(page);

      await expectNoAxeViolations(page);
    });
  }

  test("a 1440px la fila es una línea de al menos 44px con el segmento de 26px (#764)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToAttendance(page, ATTENDANCE_SHEET_STATE);
    const row = attendanceRow(page, LONG_NAMED_ATTENDEE);

    const rowBox = await row.boundingBox();
    const buttonHeights = await row
      .getByRole("group")
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getBoundingClientRect().height),
      );

    expect(rowBox?.height).toBeGreaterThanOrEqual(
      ATTENDANCE_MIN_TOUCH_TARGET_PX,
    );
    expect(rowBox?.height).toBeLessThan(2 * ATTENDANCE_MIN_TOUCH_TARGET_PX);
    expect(buttonHeights).toHaveLength(3);
    for (const height of buttonHeights) {
      expect(height).toBeCloseTo(26, 0);
    }
  });

  test("el punto de sin guardar sale al marcar y se va al volver (#764)", async ({
    page,
  }) => {
    await goToAttendance(page, ATTENDANCE_SHEET_STATE);
    const row = attendanceRow(page, FIRST_ATTENDEE);

    await row.getByRole("button", { name: "Late" }).click();
    await expect(row.getByTitle("Not saved yet")).toBeVisible();
    await row.getByRole("button", { name: "Present" }).click();

    await expect(row.getByTitle("Not saved yet")).toHaveCount(0);
  });

  test("a 375px cada estado tiene 44px de toque de alto sin pisar al vecino (D4, #766)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToAttendance(page, ATTENDANCE_SHEET_STATE);
    const segment = attendanceRow(page, FIRST_ATTENDEE).getByRole("group");
    await segment.scrollIntoViewIfNeeded();

    const zones = await segment
      .getByRole("button")
      .evaluateAll((buttons, reach) => {
        // Chromium redondea el punto: medio píxel justo en el borde de un
        // botón ya cae en el vecino.
        const inset = 0.5;
        const edgeInset = 1;
        const isHit = (button: Element, x: number, y: number): boolean =>
          document.elementFromPoint(x, y)?.closest("button") === button;
        return buttons.map((button, index) => {
          const box = button.getBoundingClientRect();
          const centerX = box.left + box.width / 2;
          const centerY = box.top + box.height / 2;
          const outward = reach - box.width - inset;
          return {
            width: box.width,
            height: box.height,
            reachesTop: isHit(button, centerX, centerY - reach / 2 + inset),
            reachesBottom: isHit(button, centerX, centerY + reach / 2 - inset),
            ownsItsEdges:
              isHit(button, box.left + edgeInset, centerY) &&
              isHit(button, box.right - edgeInset, centerY),
            reachesOutward:
              index === 0
                ? isHit(button, box.left - outward, centerY)
                : index === buttons.length - 1
                  ? isHit(button, box.right + outward, centerY)
                  : null,
          };
        });
      }, ATTENDANCE_MIN_TOUCH_TARGET_PX);

    expect(zones).toHaveLength(3);
    for (const zone of zones) {
      expect(zone.width).toBeCloseTo(34, 0);
      expect(zone.height).toBeCloseTo(40, 0);
      expect(zone).toMatchObject({
        reachesTop: true,
        reachesBottom: true,
        ownsItsEdges: true,
      });
    }
    // Tres zonas de 44px de ancho no caben en un control de 106px sin
    // solaparse: las de los extremos se alargan hacia fuera.
    expect(zones.map((zone) => zone.reachesOutward)).toEqual([
      true,
      null,
      true,
    ]);
  });

  test("a 375px la fila no se apila y todo su bloque de texto abre la ficha (#766)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToAttendance(page, ATTENDANCE_SHEET_STATE);
    const row = attendanceRow(page, FIRST_ATTENDEE);
    await row.scrollIntoViewIfNeeded();
    const rowBox = await boxOf(row);
    const segmentBox = await boxOf(row.getByRole("group"));
    const photoBox = await boxOf(
      row.getByRole("button", { name: OPEN_PHOTO_BUTTON }),
    );
    const nameBox = await boxOf(row.getByText(FIRST_ATTENDEE));

    const touchesOpenRecord = await page.evaluate(
      ({ x, top, bottom }) =>
        [top, bottom].map(
          (y) =>
            document.elementFromPoint(x, y)?.closest("a")?.ariaLabel ?? null,
        ),
      {
        x: nameBox.x + 2,
        top:
          rowBox.y +
          rowBox.height / 2 -
          ATTENDANCE_MIN_TOUCH_TARGET_PX / 2 +
          0.5,
        bottom:
          rowBox.y +
          rowBox.height / 2 +
          ATTENDANCE_MIN_TOUCH_TARGET_PX / 2 -
          0.5,
      },
    );

    expect(rowBox.height).toBeGreaterThanOrEqual(56);
    expect(segmentBox.y).toBeGreaterThan(rowBox.y);
    expect(segmentBox.y + segmentBox.height).toBeLessThan(
      rowBox.y + rowBox.height,
    );
    expect(segmentBox.x).toBeGreaterThan(nameBox.x + nameBox.width);
    expect(photoBox.height).toBeGreaterThanOrEqual(
      ATTENDANCE_MIN_TOUCH_TARGET_PX,
    );
    expect(touchesOpenRecord).toEqual([
      ATTENDANCE_RECORD_LINK,
      ATTENDANCE_RECORD_LINK,
    ]);
  });

  test("a 375px el nombre largo ocupa como mucho dos líneas (#766)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToAttendance(page, ATTENDANCE_SHEET_STATE);
    const row = attendanceRow(page, LONG_NAMED_ATTENDEE);

    const nameLineHeight = await row
      .getByText(LONG_NAMED_ATTENDEE)
      .evaluate((name) => {
        const line = name.closest("a")?.parentElement ?? name.parentElement;
        return line === null ? 0 : line.getBoundingClientRect().height;
      });

    expect(nameLineHeight).toBeGreaterThan(15 * 1.25);
    expect(nameLineHeight).toBeLessThanOrEqual(2 * 15 * 1.25 + 1);
  });

  test("a 375px la barra fija sale con cambios, no tapa la última fila y se va al guardar (#766)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToAttendance(page, ATTENDANCE_SHEET_STATE);
    const save = page.getByRole("button", { name: ATTENDANCE_SAVE });
    await expect(save).toHaveCount(0);

    await attendanceRow(page, FIRST_ATTENDEE)
      .getByRole("button", { name: "Late" })
      .click();
    await expect(save).toBeVisible();
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    const lastRowBox = await boxOf(attendanceRow(page, "Ethan Brown"));
    const barTop = await save.evaluate(
      (button) => button.parentElement?.getBoundingClientRect().top ?? 0,
    );

    expect((await boxOf(save)).height).toBeCloseTo(48, 0);
    expect(lastRowBox.y + lastRowBox.height).toBeLessThanOrEqual(barTop);

    await save.click();
    await expect(page.getByText(/^Saved · /)).toBeAttached();
    await expect(save).toHaveCount(0);
  });

  test("abre la foto de una fila y la cierra con Escape (#414)", async ({
    page,
  }) => {
    await goToAttendance(page, ATTENDANCE_SHEET_STATE);
    await stubAttendeeLargePhoto(page);
    const photo = page.getByRole("button", { name: OPEN_PHOTO_BUTTON });

    await photo.click();
    const dialog = photoDialog(page);
    await expect(
      dialog.getByRole("img", { name: LARGE_PHOTO_NAME }),
    ).toHaveJSProperty("complete", true);
    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden();
    await expect(photo).toBeFocused();
  });

  test("sin cambios, el nombre lleva a la ficha sin preguntar (#414)", async ({
    page,
  }) => {
    await goToAttendance(page, ATTENDANCE_SHEET_STATE);
    const questions: string[] = [];
    page.on("dialog", (dialog) => {
      questions.push(dialog.message());
      void dialog.dismiss();
    });

    await page.getByRole("link", { name: ATTENDANCE_RECORD_LINK }).click();

    await expect(page).toHaveURL(
      `${APP_URL}${DIRECTORY_SCREEN_PATH}/${FIRST_ATTENDEE_ID}`,
    );
    expect(questions).toEqual([]);
  });

  test("con cambios sin guardar, el nombre pregunta y se queda si no se acepta (#414)", async ({
    page,
  }) => {
    await goToAttendance(page, ATTENDANCE_SHEET_STATE);
    const late = attendanceRow(page, FIRST_ATTENDEE).getByRole("button", {
      name: "Late",
    });
    await late.click();
    const questions: string[] = [];
    page.once("dialog", (dialog) => {
      questions.push(dialog.message());
      void dialog.dismiss();
    });

    await page.getByRole("link", { name: ATTENDANCE_RECORD_LINK }).click();

    expect(questions).toEqual([
      "You have unsaved changes on this session. Discard them?",
    ]);
    await expect(page).toHaveURL(`${APP_URL}${ATTENDANCE_SCREEN_PATH}`);
    await expect(late).toHaveAttribute("aria-pressed", "true");
  });

  test("a un Coach los nombres de la hoja no son enlaces (#414)", async ({
    page,
  }) => {
    await goToAttendance(page, ATTENDANCE_COACH_SHEET_STATE);

    await expect(
      page.getByRole("region", { name: "Going" }).getByRole("link"),
    ).toHaveCount(0);
    await expect(
      attendanceRow(page, FIRST_ATTENDEE).getByText(FIRST_ATTENDEE),
    ).toBeVisible();
  });
});

const ATTENDANCE_RECORD_LINK = `Open ${FIRST_ATTENDEE}'s record`;

/** La foto grande de la primera fila, servida como en el directorio. */
async function stubAttendeeLargePhoto(page: Page): Promise<void> {
  const photo = await largeVersionOf("landscape");
  await page.route(STUBBED_LARGE_PHOTO_URL, (route) =>
    route.fulfill({ status: 200, contentType: "image/webp", body: photo }),
  );
  await page.route(
    (url) =>
      url.pathname === `${DIRECTORY_ENDPOINT}/${FIRST_ATTENDEE_ID}/photo`,
    (route) => route.fulfill(jsonBody({ photoUrl: STUBBED_LARGE_PHOTO_URL })),
  );
}
/* ---------------------------------------------------------------------------
   Equipos (#402, RF-9 del PRD de E10): sin eventos, a mano con jugadores en
   las tres listas, balanceado con no evaluados, confirmando la publicación y
   publicado. Mockup: docs/mockups/team-light.png y team-dark.png, que es de
   escritorio; en el móvil las columnas van una debajo de otra.

   Los datos son fijos, servidos por `page.route` como en Asistencia: lo que
   los endpoints responden y guardan se prueba contra la base (#401).
   --------------------------------------------------------------------------- */

const TEAMS_SCREEN_PATH = "/equipos";
const TEAMS_ENDPOINT = "/api/v1/teams";
const CLUB_TEAM_LABELS_ENDPOINT = "/api/v1/club/team-labels";
const TEAMS_NARROW_WIDTHS = [320, 375, 768] as const;
const TEAMS_MIN_TOUCH_TARGET_PX = 44;

const TEAMS_EVENT = {
  id: "7e7e7e7e-0000-4000-8000-0000000000e1",
  title: "Scrimmage vs Geelong",
  eventType: "training",
  startsOn: "2026-06-20",
  startTime: "10:00",
} as const;

const TEAMS_EVENTS = [
  TEAMS_EVENT,
  {
    id: "7e7e7e7e-0000-4000-8000-0000000000e2",
    title: "Pool Training",
    eventType: "training",
    startsOn: "2026-06-23",
    startTime: "19:00",
  },
] as const;

const TEAMS_LABELS = {
  a: { name: "Team Kelp", color: "#1C6EA4" },
  b: { name: "Team Tide", color: "#C99A3E" },
} as const;

type TeamsPosition = keyof typeof ATTENDANCE_POSITIONS;

/** Un jugador como lo sirve la API: la posición del club con su función, y
 * el OVR o el 5,0 virtual del no evaluado. */
function teamsPlayer(
  index: number,
  fullName: string,
  position: TeamsPosition,
  rating: number | null,
): Record<string, unknown> & { readonly userId: string } {
  return {
    userId: `7e7e7e7e-0000-4000-8000-${String(index).padStart(12, "0")}`,
    fullName,
    position: ATTENDANCE_POSITIONS[position],
    coverage: position,
    rating: rating ?? 5,
    isUnrated: rating === null,
    photoUrl: null,
  };
}

/** El mismo jugador con la foto fija (#757): unos con foto y otros con
 * iniciales, como en el mockup. */
function withTeamsPhoto(
  player: ReturnType<typeof teamsPlayer>,
): ReturnType<typeof teamsPlayer> {
  return { ...player, photoUrl: STUBBED_PHOTO_URL };
}

const LONG_NAMED_PLAYER =
  "Maximiliana Alejandra Fernández-Rodríguez de la Torre";

/** Los doce del mockup, con Ethan sin evaluar, más un nombre de tres veces
 * lo normal para el caso de contenido largo. */
const TEAMS_PLAYERS = {
  mateo: withTeamsPhoto(teamsPlayer(1, "Mateo Restrepo", "forward", 8.6)),
  daniela: teamsPlayer(2, "Daniela Vargas", "forward", 8),
  valentina: withTeamsPhoto(
    teamsPlayer(3, "Valentina Gómez", "goalkeeper", 7.4),
  ),
  isabella: teamsPlayer(4, "Isabella Muñoz", "defender", 7.2),
  jack: withTeamsPhoto(teamsPlayer(5, "Jack Thompson", "defender", 6.8)),
  ethan: teamsPlayer(6, "Ethan Brown", "forward", null),
  camila: withTeamsPhoto(teamsPlayer(7, "Camila Ortiz", "forward", 8.3)),
  liam: teamsPlayer(8, "Liam O'Connor", "defender", 8.1),
  santiago: withTeamsPhoto(teamsPlayer(9, "Santiago Herrera", "defender", 7.8)),
  chloe: teamsPlayer(10, "Chloe Nguyen", "forward", 7),
  noah: teamsPlayer(11, "Noah Williams", "goalkeeper", 6.5),
  ruby: withTeamsPhoto(teamsPlayer(12, "Ruby Tan", "goalkeeper", 5.9)),
  long: teamsPlayer(13, LONG_NAMED_PLAYER, "forward", 6.1),
} as const;

const P = TEAMS_PLAYERS;
const KELP = [P.mateo, P.daniela, P.valentina, P.isabella, P.jack, P.ethan];
const TIDE = [P.camila, P.liam, P.santiago, P.chloe, P.noah, P.ruby];

type TeamsPlayerEntry = (typeof KELP)[number];

function assignedTo(
  team: "a" | "b",
  players: readonly TeamsPlayerEntry[],
  outside: readonly TeamsPlayerEntry[] = [],
): unknown[] {
  return players.map((player) => ({
    ...player,
    team,
    isOutsideSquad: outside.includes(player),
  }));
}

/** A mano, con gente en las tres listas: tres por equipo (Noah ya no
 * viene), cuatro disponibles con el no evaluado y el nombre largo, y dos
 * "Quizás". */
const MANUAL_BUILDER = {
  event: TEAMS_EVENT,
  teams: TEAMS_LABELS,
  available: [
    P.camila,
    P.daniela,
    P.ethan,
    P.isabella,
    P.jack,
    P.liam,
    P.long,
    P.mateo,
    P.valentina,
  ],
  maybe: [P.chloe, P.ruby],
  split: {
    mode: "manual",
    publishedAt: null,
    assignments: [
      ...assignedTo("a", [P.mateo, P.valentina, P.isabella]),
      ...assignedTo("b", [P.camila, P.liam, P.noah], [P.noah]),
    ],
  },
};

/** A mano y sin portero en Tide (#759): su ficha de portero dice Sin
 * portero. Tide lleva además el nombre largo, que se corta en su fila. */
const NO_GOALKEEPER_BUILDER = {
  ...MANUAL_BUILDER,
  split: {
    mode: "manual",
    publishedAt: null,
    assignments: [
      ...assignedTo("a", [P.mateo, P.valentina, P.isabella, P.ethan]),
      ...assignedTo("b", [P.camila, P.liam, P.long]),
    ],
  },
};

/** Sin reparto: los doce del mockup dijeron Sí y el nombre largo, Quizás. */
const OPEN_BUILDER = {
  event: TEAMS_EVENT,
  teams: TEAMS_LABELS,
  available: [...KELP, ...TIDE],
  maybe: [P.long],
  split: null,
};

/** El reparto del mockup, guardado en borrador y listo para publicar. */
const DRAFTED_BUILDER = {
  ...OPEN_BUILDER,
  split: {
    mode: "auto",
    publishedAt: null,
    assignments: [...assignedTo("a", KELP), ...assignedTo("b", TIDE)],
  },
};

const BALANCED_SPLIT = {
  teams: TEAMS_LABELS,
  mode: "auto",
  a: KELP,
  b: TIDE,
  totals: {
    a: { playerCount: 6, combinedRating: 43, averageRating: 7.2 },
    b: { playerCount: 6, combinedRating: 43.6, averageRating: 7.3 },
    ratingDifference: 0.6,
  },
  suggestion: null,
  isTimeBudgetExhausted: false,
};

type TeamsWrite = { readonly method: string; readonly path: string };

type TeamsReads = {
  readonly events: readonly unknown[];
  readonly builder: unknown;
};

/** GET de los eventos y del builder; el auto-balance, guardar y publicar
 * responden bien. Devuelve las escrituras que llegaron. */
async function stubTeams(page: Page, reads: TeamsReads): Promise<TeamsWrite[]> {
  const writes: TeamsWrite[] = [];
  await stubDirectoryPhoto(page);
  // Los equipos del club (#755), que pide la ventana de editar (#760).
  await page.route(
    (url) => url.pathname === CLUB_TEAM_LABELS_ENDPOINT,
    (route, request) => {
      if (request.method() === "GET") {
        return route.fulfill(jsonBody(TEAMS_LABELS));
      }
      writes.push({
        method: request.method(),
        path: CLUB_TEAM_LABELS_ENDPOINT,
      });
      // Responde los equipos sin el evento, y que su reparto no estaba
      // guardado (D4).
      const { a, b } = request.postDataJSON() as { a: unknown; b: unknown };
      return route.fulfill(jsonBody({ a, b, eventSplit: "none" }));
    },
  );
  await page.route(
    (url) => url.pathname === TEAMS_ENDPOINT,
    (route) => route.fulfill(jsonBody({ events: reads.events })),
  );
  await page.route(
    (url) => url.pathname.startsWith(`${TEAMS_ENDPOINT}/`),
    (route, request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === "GET") {
        return route.fulfill(jsonBody(reads.builder));
      }
      writes.push({ method: request.method(), path });
      if (path.endsWith("/auto-balance")) {
        return route.fulfill(jsonBody(BALANCED_SPLIT));
      }
      if (path.endsWith("/publication")) {
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              eventId: TEAMS_EVENT.id,
              publishedAt: "2026-06-18T10:05:00.000Z",
              assignedCount: 12,
              notifiedCount: 12,
            },
          }),
        });
      }
      return route.fulfill(
        jsonBody({ eventId: TEAMS_EVENT.id, mode: "manual", assignedCount: 0 }),
      );
    },
  );
  return writes;
}

const TEAMS_AVAILABLE = /^(Available · Going|Disponibles · Van)$/;
const TEAMS_BALANCE = /^Auto-balance$/;
const TEAMS_PUBLISH = /^(Publish|Publicar)$/;
const TEAMS_PUBLISH_QUESTION = /^(Publish teams\?|¿Publicar equipos\?)/;
const TEAMS_TOTALS = /^(Totals|Totales)$/;
const TEAMS_BENCH_TAB = /^(Bench|Banco) /;
/** En el móvil (#762) se comprueba sin scroll en los dos anchos del móvil. */
const TEAMS_PHONE_WIDTHS = [320, 375] as const;
/** Lo que mide cada pieza del móvil (#762, RF-8 del PRD de E28). */
const TEAMS_PHONE_ROW_MIN_PX = 58;
const TEAMS_PHONE_TAB_PX = 40;
const TEAMS_PHONE_BAR_BUTTON_PX = 48;

function teamsRegion(page: Page, name: string | RegExp): Locator {
  return page.getByRole("region", { name });
}

/** La pregunta de publicar: en la página o, en el móvil, la hoja (#762). */
function teamsPublishQuestion(page: Page): Locator {
  return page
    .getByRole("group", { name: TEAMS_PUBLISH_QUESTION })
    .or(page.getByRole("dialog", { name: TEAMS_PUBLISH_QUESTION }));
}

/** El Publicar de la confirmación: el de la cabecera se llama igual. */
function teamsConfirmPublish(page: Page): Locator {
  return teamsPublishQuestion(page).getByRole("button", {
    name: TEAMS_PUBLISH,
  });
}

function teamsPlayerRow(page: Page, fullName: string): Locator {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("group", { name: fullName }) });
}

/** Los totales están en el escritorio y en el móvil, donde el banco va en
 * su pestaña (#762). */
async function waitForTeamBuilder(page: Page): Promise<void> {
  await expect(page.getByRole("group", { name: TEAMS_TOTALS })).toBeVisible();
}

/** Elige una pestaña del móvil (#762); en escritorio no hay y no hace nada. */
async function showTeamsTab(page: Page, name: RegExp): Promise<void> {
  if (await page.getByRole("tablist").isVisible()) {
    await page.getByRole("tab", { name }).click();
  }
}

async function balanceTeams(page: Page): Promise<void> {
  await waitForTeamBuilder(page);
  await page.getByRole("button", { name: TEAMS_BALANCE }).click();
  await expect(
    page.getByText(/^(Teams balanced|Equipos equilibrados)/),
  ).toBeVisible();
  await page.mouse.move(0, 0);
}

const TEAMS_EDIT_KELP =
  /^(Edit name and colour of Team Kelp|Editar nombre y color de Team Kelp)$/;
const TEAMS_EDIT_DIALOG = /^(Edit team|Editar equipo)$/;

/** Abre la ventana de editar Team Kelp (#760): en el móvil, la hoja. */
async function openTeamEditor(page: Page): Promise<void> {
  await waitForTeamBuilder(page);
  await page.getByRole("button", { name: TEAMS_EDIT_KELP }).click();
  await expect(
    page.getByRole("dialog", { name: TEAMS_EDIT_DIALOG }).getByRole("textbox"),
  ).toBeVisible();
  await page.mouse.move(0, 0);
}

async function askToPublish(page: Page): Promise<void> {
  await waitForTeamBuilder(page);
  await page.getByRole("button", { name: TEAMS_PUBLISH }).click();
  await expect(teamsConfirmPublish(page)).toBeVisible();
  await page.mouse.move(0, 0);
}

async function publishTeams(page: Page): Promise<void> {
  await askToPublish(page);
  await teamsConfirmPublish(page).click();
  await expect(page.getByText(/^(Published|Publicado) · /)).toBeVisible();
  await page.mouse.move(0, 0);
}

type TeamsState = TeamsReads & {
  readonly name: string;
  readonly isSpanish?: boolean;
  readonly viewports?: readonly (typeof viewports)[number][];
  /** Los anchos sin scroll horizontal; por defecto, los tres estrechos. */
  readonly narrowWidths?: readonly number[];
  readonly ready: (page: Page) => Promise<void>;
};

function teamsWithSpanish(state: TeamsState): readonly TeamsState[] {
  return [state, { ...state, name: `${state.name}-es`, isSpanish: true }];
}

const TEAMS_MANUAL_STATE: TeamsState = {
  name: "equipos-manual",
  events: TEAMS_EVENTS,
  builder: MANUAL_BUILDER,
  ready: waitForTeamBuilder,
};

const TEAMS_STATES: readonly TeamsState[] = [
  ...teamsWithSpanish({
    name: "equipos-vacio",
    events: [],
    builder: OPEN_BUILDER,
    ready: async (page) => {
      await expect(
        page.getByRole("link", {
          name: /^(Go to the calendar|Ir al calendario)$/,
        }),
      ).toBeVisible();
    },
  }),
  ...teamsWithSpanish(TEAMS_MANUAL_STATE),
  ...teamsWithSpanish({
    name: "equipos-balanceado",
    events: TEAMS_EVENTS,
    builder: OPEN_BUILDER,
    ready: balanceTeams,
  }),
  {
    name: "equipos-sin-portero",
    events: TEAMS_EVENTS,
    builder: NO_GOALKEEPER_BUILDER,
    viewports: viewports.filter((vp) => vp.name !== "mobile"),
    ready: async (page) => {
      await waitForTeamBuilder(page);
      await showTeamsTab(page, /^Tide /);
      await expect(
        teamsRegion(page, "Team Tide").getByText("No goalkeeper"),
      ).toBeVisible();
    },
  },
  ...teamsWithSpanish({
    name: "equipos-confirmar-publicar",
    events: TEAMS_EVENTS,
    builder: DRAFTED_BUILDER,
    ready: askToPublish,
  }),
  {
    name: "equipos-editar",
    events: TEAMS_EVENTS,
    builder: DRAFTED_BUILDER,
    viewports: viewports.filter((vp) => vp.name !== "mobile"),
    ready: openTeamEditor,
  },
  {
    name: "equipos-editar-movil",
    events: TEAMS_EVENTS,
    builder: DRAFTED_BUILDER,
    viewports: viewports.filter((vp) => vp.name === "mobile"),
    ready: openTeamEditor,
  },
  // El móvil (#762): la pestaña de un equipo con cambios sin guardar, el
  // banco y la hoja de publicar.
  {
    name: "equipos-movil-equipo",
    events: TEAMS_EVENTS,
    builder: MANUAL_BUILDER,
    viewports: viewports.filter((vp) => vp.name === "mobile"),
    narrowWidths: TEAMS_PHONE_WIDTHS,
    ready: async (page) => {
      await waitForTeamBuilder(page);
      await page
        .getByRole("button", { name: "Remove Isabella Muñoz from Team Kelp" })
        .click();
      await expect(page.getByRole("button", { name: /^Save/ })).toContainText(
        "Unsaved",
      );
      await page.mouse.move(0, 0);
    },
  },
  {
    name: "equipos-movil-banco",
    events: TEAMS_EVENTS,
    builder: MANUAL_BUILDER,
    viewports: viewports.filter((vp) => vp.name === "mobile"),
    narrowWidths: TEAMS_PHONE_WIDTHS,
    ready: async (page) => {
      await waitForTeamBuilder(page);
      await page.getByRole("tab", { name: TEAMS_BENCH_TAB }).click();
      await expect(teamsRegion(page, TEAMS_AVAILABLE)).toBeVisible();
      await page.mouse.move(0, 0);
    },
  },
  {
    name: "equipos-movil-publicar",
    events: TEAMS_EVENTS,
    builder: DRAFTED_BUILDER,
    viewports: viewports.filter((vp) => vp.name === "mobile"),
    narrowWidths: TEAMS_PHONE_WIDTHS,
    ready: askToPublish,
  },
  ...teamsWithSpanish({
    name: "equipos-publicado",
    events: TEAMS_EVENTS,
    builder: DRAFTED_BUILDER,
    ready: publishTeams,
  }),
];

async function goToTeams(
  page: Page,
  state: TeamsState,
  theme?: (typeof themes)[number],
): Promise<TeamsWrite[]> {
  const writes = await stubTeams(page, state);
  if (state.isSpanish === true) {
    await chooseSpanish(page);
  }
  if (theme === undefined) {
    await page.goto(`${APP_URL}${TEAMS_SCREEN_PATH}`);
  } else {
    await goToWithTheme(page, TEAMS_SCREEN_PATH, theme);
  }
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await state.ready(page);
  return writes;
}

/** Las capturas del Team builder con una ventana abierta, que se mueve si
 * la página entera no cabe en la ventana (#675). */
const OPEN_TEAMS_STATES: ReadonlySet<string> = new Set(["equipos-editar"]);

for (const state of TEAMS_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of state.viewports ?? viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToTeams(page, state, theme);
              // El Team builder usa `useIsPhone` (#762): si la página no
              // cabe, la captura de página entera lo ve un instante como
              // móvil y la ventana de editar equipo sale en otro sitio (#675).
              if (OPEN_TEAMS_STATES.has(state.name)) {
                await fitViewportToPage(page);
              }
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }
      });
    }

    for (const width of state.narrowWidths ?? TEAMS_NARROW_WIDTHS) {
      test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 812 });
        await goToTeams(page, state);
        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      // Un estado sólo del móvil (#762) no existe en escritorio: sus
      // pestañas no se pintan. axe lo mira en el primero de sus tamaños.
      const viewport = state.viewports?.at(0);
      if (viewport !== undefined) {
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
      }
      await goToTeams(page, state);
      await expectNoAxeViolations(page);
    });
  });
}

test.describe("equipos en el navegador", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("mover con los botones cambia los totales al instante sin guardar", async ({
    page,
  }) => {
    const writes = await goToTeams(page, TEAMS_MANUAL_STATE);
    const totals = page.getByRole("group", { name: "Totals" });
    await expect(totals).toContainText("Even");

    await page
      .getByRole("button", { name: "Add Daniela Vargas to Team Kelp" })
      .click();

    await expect(totals).toContainText("Team Kelp 31.2");
    await expect(totals).toContainText("8.3 apart");
    await expect(teamsRegion(page, "Team Kelp")).toContainText(
      "Daniela Vargas",
    );
    expect(writes).toEqual([]);
  });

  test("editar un equipo elige con las flechas, retiene el foco y aplica", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const patches: unknown[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH") {
        patches.push(request.postDataJSON());
      }
    });
    await goToTeams(page, TEAMS_MANUAL_STATE);
    await openTeamEditor(page);
    const dialog = page.getByRole("dialog", { name: "Edit team" });
    await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();

    await dialog.getByRole("radio", { name: "Blue" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("radio", { name: "Navy" })).toBeChecked();
    await dialog.getByRole("button", { name: "Apply" }).focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
    await dialog.getByRole("textbox", { name: "Name" }).fill("Team Reef");
    await dialog.getByRole("button", { name: "Apply" }).click();

    await expect(dialog).toBeHidden();
    await expect(teamsRegion(page, "Team Reef")).toBeVisible();
    // Con el evento abierto, para que su reparto sin publicar cambie también.
    expect(patches).toEqual([
      {
        a: { name: "Team Reef", color: "#2B3F7A" },
        b: TEAMS_LABELS.b,
        eventId: TEAMS_EVENT.id,
      },
    ]);
  });

  test("arrastrar a un disponible a una columna lo mueve", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToTeams(page, TEAMS_MANUAL_STATE);

    await teamsPlayerRow(page, "Jack Thompson").dragTo(
      teamsRegion(page, "Team Tide"),
    );

    await expect(teamsRegion(page, "Team Tide")).toContainText("Jack Thompson");
    await expect(teamsRegion(page, TEAMS_AVAILABLE)).not.toContainText(
      "Jack Thompson",
    );
  });

  test("balancear y publicar con doble toque manda una sola publicación", async ({
    page,
  }) => {
    const writes = await goToTeams(page, {
      ...TEAMS_MANUAL_STATE,
      builder: OPEN_BUILDER,
    });
    await balanceTeams(page);
    await expect(teamsPlayerRow(page, "Ethan Brown")).toContainText("—");
    await page.getByRole("button", { name: TEAMS_PUBLISH }).click();

    await teamsConfirmPublish(page).dblclick();

    await expect(
      page.getByText("Published · 12 players notified"),
    ).toBeVisible();
    expect(writes.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `POST ${TEAMS_ENDPOINT}/${TEAMS_EVENT.id}/auto-balance`,
      `POST ${TEAMS_ENDPOINT}/${TEAMS_EVENT.id}/publication`,
    ]);
  });

  test("a 375px cada botón de mover mide al menos 44px de alto", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToTeams(page, TEAMS_MANUAL_STATE);
    await showTeamsTab(page, TEAMS_BENCH_TAB);

    const heights = await page
      .getByRole("group", { name: LONG_NAMED_PLAYER })
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getBoundingClientRect().height),
      );

    expect(heights).toHaveLength(2);
    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(TEAMS_MIN_TOUCH_TARGET_PX);
    }
  });

  test("a 375px las pestañas, las filas y la barra fija miden lo del diseño", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToTeams(page, TEAMS_MANUAL_STATE);
    const heightOf = async (locator: Locator): Promise<number> => {
      const box = await locator.boundingBox();
      if (box === null) {
        throw new Error("La pieza no se ve.");
      }
      return box.height;
    };

    for (const tab of await page.getByRole("tab").all()) {
      expect(await heightOf(tab)).toBeCloseTo(TEAMS_PHONE_TAB_PX, 0);
    }
    expect(
      await heightOf(teamsPlayerRow(page, "Mateo Restrepo")),
    ).toBeGreaterThanOrEqual(TEAMS_PHONE_ROW_MIN_PX);
    for (const name of [/^Save/, TEAMS_PUBLISH]) {
      expect(
        await heightOf(page.getByRole("button", { name })),
      ).toBeGreaterThanOrEqual(TEAMS_PHONE_BAR_BUTTON_PX);
    }
  });

  // Con cambios sin guardar, que es cuando Guardar lleva más texto; a 320 en
  // español es lo más largo que puede llevar.
  for (const { width, isSpanish } of [
    { width: 375, isSpanish: false },
    { width: 320, isSpanish: true },
  ]) {
    const language = isSpanish ? " en español" : "";
    test(`a ${width}px${language} la barra fija no tapa la última fila del banco`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 812 });
      await goToTeams(page, { ...TEAMS_MANUAL_STATE, isSpanish });
      await page
        .getByRole("button", {
          name: /^(Remove|Sacar a) Isabella Muñoz (from|de) Team Kelp$/,
        })
        .click();
      const save = page.getByRole("button", { name: /^(Save|Guardar)/ });
      await expect(save).toContainText(
        /^(Save|Guardar).*(Unsaved|Sin guardar)$/,
      );
      // Guardar no se corta: lo que pinta cabe en el botón.
      for (const button of [
        save,
        page.getByRole("button", { name: TEAMS_PUBLISH }),
      ]) {
        expect(
          await button.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true);
      }
      await showTeamsTab(page, TEAMS_BENCH_TAB);
      const lastRow = page.getByRole("tabpanel").getByRole("group").last();

      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );

      const row = await lastRow.boundingBox();
      const bar = await page
        .getByRole("button", { name: TEAMS_PUBLISH })
        .locator("xpath=ancestor::div[contains(@class, 'team-phone-bar')]")
        .boundingBox();
      if (row === null || bar === null) {
        throw new Error("La última fila o la barra no se ven.");
      }
      expect(row.y + row.height).toBeLessThanOrEqual(bar.y);
    });
  }
});
/* ---------------------------------------------------------------------------
   La búsqueda global (#427, RF-8 del PRD de E14). El cuadro de la barra de
   arriba sigue docs/mockups/dashboard-light.png; la lupa del móvil, la
   pantalla entera y la lista agrupada no están dibujadas y se revisan contra
   design-system.md. Las capturas responden con una API de mentira, para que
   los resultados sean los mismos en cada corrida; una prueba aparte busca con
   la API de verdad.
   --------------------------------------------------------------------------- */

const SEARCH_ENDPOINT = "/api/v1/search";
const SEARCH_SCREEN_PATH = "/dashboard";
const SEARCH_NAME = /^(Search|Buscar)$/;
const SEARCH_CLOSE_NAME = /^(Close search|Cerrar la búsqueda)$/;
const NOTHING_MATCHES = /^(Nothing matches|Nada coincide con)/;
/** Por debajo, la cáscara es la del móvil: la lupa en vez del cuadro. */
const DESKTOP_MIN_WIDTH = 768;
/** Cinco miembros y "See all members" van antes que el primer evento. */
const ARROWS_TO_FIRST_EVENT = 7;

function fakeSearchId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const SEARCHED_MEMBER_NAMES = [
  "Grace Geelong",
  "Gemma Geeves",
  "Geoffrey Geelan-Whitcombe",
  "Georgia Gee",
  "Gerard Geelhoed",
] as const;

const SEARCH_RESULTS = {
  members: {
    total: 12,
    items: SEARCHED_MEMBER_NAMES.map((fullName, index) => ({
      kind: "member",
      userId: fakeSearchId(index + 1),
      fullName,
      position:
        index === 0
          ? { id: fakeSearchId(90), names: { en: "Forward", es: "Delantero" } }
          : null,
      photoUrl: null,
    })),
  },
  events: {
    total: 2,
    items: [
      {
        kind: "event",
        id: fakeSearchId(20),
        title: "Scrimmage vs Geelong Krakens",
        startsOn: "2026-10-10",
        startTime: "10:00",
        location: "Geelong Aquatic Centre",
        eventType: "competition",
        isCancelled: false,
      },
      {
        kind: "event",
        id: fakeSearchId(21),
        title: "Geelong away day",
        startsOn: "2026-08-15",
        startTime: "09:30",
        location: "Geelong Waterfront",
        eventType: "social",
        isCancelled: true,
      },
    ],
  },
  news: {
    total: 1,
    items: [
      {
        kind: "news",
        id: fakeSearchId(30),
        title: "Travel details for the Geelong tournament",
        category: "announcement",
        publishedAt: "2026-09-20T09:00:00.000Z",
      },
    ],
  },
} as const;

const NO_SEARCH_RESULTS = {
  members: { total: 0, items: [] },
  events: { total: 0, items: [] },
  news: { total: 0, items: [] },
} as const;

type FakeSearchResults = typeof SEARCH_RESULTS | typeof NO_SEARCH_RESULTS;

async function serveSearch(
  page: Page,
  results: FakeSearchResults,
): Promise<void> {
  await page.route(
    (url) => url.pathname === SEARCH_ENDPOINT,
    (route) => route.fulfill({ json: { data: results } }),
  );
}

function isDesktopWidth(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= DESKTOP_MIN_WIDTH;
}

/** El cuadro visible: el de la barra en escritorio, el de la pantalla entera
 * que abre la lupa en el móvil. */
async function openSearch(page: Page): Promise<Locator> {
  if (!isDesktopWidth(page)) {
    await page.getByRole("button", { name: SEARCH_NAME }).click();
  }
  const box = page.getByRole("combobox", { name: SEARCH_NAME });
  await box.click();
  return box;
}

async function searchGlobally(page: Page, text: string): Promise<void> {
  const box = await openSearch(page);
  await box.fill(text);
}

async function waitForSearchAnswer(
  page: Page,
  results: FakeSearchResults,
): Promise<void> {
  if (results.members.total === 0) {
    await expect(page.getByText(NOTHING_MATCHES)).toBeVisible();
    return;
  }
  await expect(page.getByRole("listbox")).toBeVisible();
}

type SearchCapture = {
  readonly name: string;
  readonly results: FakeSearchResults;
  readonly text: string;
  readonly beforeVisit?: (page: Page) => Promise<void>;
};

const SEARCH_CAPTURES: readonly SearchCapture[] = [
  { name: "busqueda-resultados", results: SEARCH_RESULTS, text: "Gee" },
  {
    name: "busqueda-resultados-es",
    results: SEARCH_RESULTS,
    text: "Gee",
    beforeVisit: chooseSpanish,
  },
  {
    name: "busqueda-sin-resultados",
    results: NO_SEARCH_RESULTS,
    text: "Zanzibar",
  },
  {
    name: "busqueda-sin-resultados-es",
    results: NO_SEARCH_RESULTS,
    text: "Zanzíbar",
    beforeVisit: chooseSpanish,
  },
];

async function showSearch(page: Page, capture: SearchCapture): Promise<void> {
  await searchGlobally(page, capture.text);
  await waitForSearchAnswer(page, capture.results);
}

for (const capture of SEARCH_CAPTURES) {
  test.describe(capture.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: E2E_STORAGE_STATE_PATH });

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(capture.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await capture.beforeVisit?.(page);
              await serveSearch(page, capture.results);
              await goToWithTheme(page, SEARCH_SCREEN_PATH, theme);
              await showSearch(page, capture);
              // El ratón se queda sobre el cuadro o la lupa, y una opción
              // debajo saldría con su hover.
              await page.mouse.move(0, 0);
              const snapshot = `${capture.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot(SCREENSHOT_OPTIONS),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });
          }
        }

        test("has no horizontal scroll with the search open", async ({
          page,
        }) => {
          await capture.beforeVisit?.(page);
          await serveSearch(page, capture.results);
          await page.goto(`${APP_URL}${SEARCH_SCREEN_PATH}`);
          await showSearch(page, capture);
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
        });

        test("has no accessibility violations with the search open (axe-core)", async ({
          page,
        }) => {
          await capture.beforeVisit?.(page);
          await serveSearch(page, capture.results);
          await page.goto(`${APP_URL}${SEARCH_SCREEN_PATH}`);
          await showSearch(page, capture);
          await expectNoAxeViolations(page);
        });
      });
    }
  });
}

// La lupa sólo existe en el móvil: recién abierta, la pantalla entera con el
// cuadro vacío y el foco en él.
test.describe("busqueda-movil-abierta", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({
    storageState: E2E_STORAGE_STATE_PATH,
    viewport: { width: 375, height: 812 },
  });

  for (const theme of themes) {
    test(`matches approved baseline (${theme})`, async ({ page }) => {
      await goToWithTheme(page, SEARCH_SCREEN_PATH, theme);
      await openSearch(page);
      await page.mouse.move(0, 0);
      const snapshot = `busqueda-movil-abierta-mobile-${theme}.png`;
      await createMissingLocalBaseline(snapshot, () =>
        page.screenshot(SCREENSHOT_OPTIONS),
      );
      await expect(page).toHaveScreenshot(snapshot, {
        ...SCREENSHOT_OPTIONS,
        maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
      });
    });
  }

  test("has no accessibility violations with the search open (axe-core)", async ({
    page,
  }) => {
    await chooseSpanish(page);
    await page.goto(`${APP_URL}${SEARCH_SCREEN_PATH}`);
    await openSearch(page);
    await expectNoAxeViolations(page);
  });
});

test.describe("la búsqueda global en el navegador", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  test("en escritorio, / lleva el foco al cuadro de la barra", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${APP_URL}${SEARCH_SCREEN_PATH}`);
    await expect(page.getByRole("search")).toBeVisible();

    await page.locator("body").click({ position: { x: 600, y: 400 } });
    await page.keyboard.press("/");

    await expect(
      page.getByRole("combobox", { name: SEARCH_NAME }),
    ).toBeFocused();
  });

  test("en el móvil la barra no se ve y la lupa sí", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${APP_URL}${SEARCH_SCREEN_PATH}`);

    await expect(page.getByRole("button", { name: SEARCH_NAME })).toBeVisible();
    await expect(page.getByRole("search")).toBeHidden();
  });

  test("en el móvil, Cerrar devuelve el foco a la lupa", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${APP_URL}${SEARCH_SCREEN_PATH}`);
    const magnifier = page.getByRole("button", { name: SEARCH_NAME });

    await magnifier.click();
    await expect(
      page.getByRole("combobox", { name: SEARCH_NAME }),
    ).toBeFocused();
    await page.getByRole("button", { name: SEARCH_CLOSE_NAME }).click();

    await expect(page.getByRole("dialog", { name: SEARCH_NAME })).toBeHidden();
    await expect(magnifier).toBeFocused();
  });

  test("las flechas y Enter abren el evento en su fila del calendario", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // El evento buscado es del 10 de octubre de 2026. Sin fijar la hora,
    // desde ese día el calendario lo abre en "pasados" y la URL lleva
    // además `&periodo=past`.
    await page.clock.setFixedTime(HOME_NOW);
    await serveSearch(page, SEARCH_RESULTS);
    await page.goto(`${APP_URL}${SEARCH_SCREEN_PATH}`);
    await searchGlobally(page, "Geelong");
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("15 results");

    for (let step = 0; step < ARROWS_TO_FIRST_EVENT; step += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(
      new RegExp(`/calendario\\?evento=${fakeSearchId(20)}$`),
    );
    await expect(page.getByRole("listbox")).toBeHidden();
  });
});

test.describe("la búsqueda global con los datos de verdad", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("un Admin encuentra a un miembro y llega a su ficha", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${APP_URL}${SEARCH_SCREEN_PATH}`);

    await searchGlobally(page, DECIDABLE_MEMBER_NAME);
    await page
      .getByRole("option", { name: new RegExp(DECIDABLE_MEMBER_NAME) })
      .click();

    await expect(page).toHaveURL(/\/directorio\/[0-9a-f-]{36}$/);
  });
});

/* ---------------------------------------------------------------------------
   La pantalla de inicio (#426, RF-1 a RF-4 del PRD de E14). Mockups:
   docs/mockups/dashboard-light.png y dashboard-dark.png (escritorio),
   mobile-home-light.png y mobile-home-dark.png (móvil). Sin el botón
   "Export" y sin la tesela "Overall" del móvil (D1); la barra de búsqueda
   llega con #427.

   Las capturas leen un dashboard fijo, servido por `page.route`, y un reloj
   fijo: el saludo, "mañana" y "hace N" salen de la hora en que se pinta. El
   nombre del saludo es el de la cuenta, que lee la página (#752). Lo que el
   endpoint de verdad responde se prueba en sus tests de Vitest (#424); el
   RSVP con datos de verdad, al final de esta sección.
   --------------------------------------------------------------------------- */

const DASHBOARD_ENDPOINT = "/api/v1/dashboard";
const HOME_SCREEN_PATH = "/";
const DASHBOARD_NARROW_WIDTHS = [320, 375, 768] as const;
const DASHBOARD_GREETING = /^(Good|Buenos|Buenas) .+, \S+$/;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function dashboardDaysAgo(days: number): string {
  return new Date(HOME_NOW.getTime() - days * DAY_IN_MS).toISOString();
}

const DASHBOARD_POOL_TRAINING_ID = "d0d0d0d0-0000-4000-8000-0000000000d1";

// El próximo evento de la tarjeta "Próximo" (#747): un entrenamiento con
// hora de fin y lugar con coordenadas, como el del handoff de E27.
const DASHBOARD_NEXT_UP = {
  kind: "event",
  id: DASHBOARD_POOL_TRAINING_ID,
  title: "Saturday scrimmage",
  eventType: "training",
  startsOn: "2026-10-03",
  endsOn: null,
  startTime: "09:00",
  endTime: "11:00",
  location: "Princes Park · Field 2",
  place: {
    name: "Princes Park",
    address: "Princes Park Dr, Carlton North VIC 3054",
    lat: -37.7826,
    lng: 144.9611,
  },
  coverUrl: null,
  audience: { kind: "club" },
  goingCount: 14,
  maybeCount: 3,
  myResponse: "yes",
  myTeam: null,
} as const;

const DASHBOARD_MY_TEAM = {
  name: "Team Kelp",
  color: "#1C6EA4",
  position: {
    id: "d0d0d0d0-0000-4000-8000-0000000000d7",
    names: { en: "Full back", es: "Defensa" },
  },
  isOutsideSquad: false,
} as const;

// Las noticias del inicio (#751): la fijada con extracto, que va destacada
// aunque no sea la más nueva, y una de las pequeñas sin leer, como en las
// capturas 01 y 02 del handoff de E27.
const DASHBOARD_LATEST_NEWS = [
  {
    id: "d0d0d0d0-0000-4000-8000-0000000000d4",
    category: "announcement",
    title: "Season launch night: food, awards and the new kit",
    publishedAt: dashboardDaysAgo(2),
    coverUrl: null,
    excerpt:
      "Friday 30 Oct at the clubhouse. Bring the family and RSVP in the calendar so we know how much food to order.",
    isPinned: true,
    isUnread: false,
  },
  {
    id: "d0d0d0d0-0000-4000-8000-0000000000d5",
    category: "news",
    title: "New training times from November",
    publishedAt: dashboardDaysAgo(1),
    coverUrl: null,
    excerpt: "Thursday sessions move to 8pm.",
    isPinned: false,
    isUnread: true,
  },
  {
    id: "d0d0d0d0-0000-4000-8000-0000000000d6",
    category: "document",
    title: "Updated pool safety & dive policy",
    publishedAt: dashboardDaysAgo(8),
    coverUrl: null,
    excerpt: "Read it before your next session.",
    isPinned: false,
    isUnread: false,
  },
];

// Lo que ve de las mismas noticias quien no tiene la membresía al día (D2).
const DASHBOARD_NEWS_TITLES = DASHBOARD_LATEST_NEWS.map(
  ({ id, category, title, publishedAt }) => ({
    id,
    category,
    title,
    publishedAt,
  }),
);

// "Esta semana" (#748): con el inicio el 30 de septiembre, la franja va del
// 30 al 6 de octubre. El sábado 3 es el del Próximo y lleva dos tipos; la
// copa ocupa tres días y uno de ellos tiene además una reunión. El 30 no tiene
// nada, para el día vacío.
const DASHBOARD_WEEK = {
  kind: "week",
  events: [
    {
      id: DASHBOARD_POOL_TRAINING_ID,
      title: "Pool Training",
      eventType: "training",
      startsOn: "2026-10-02",
      endsOn: null,
      startTime: "19:00",
      endTime: "21:00",
      location: "MSAC Dive Pool",
      myResponse: "maybe",
    },
    {
      id: "d0d0d0d0-0000-4000-8000-0000000000e1",
      title: DASHBOARD_NEXT_UP.title,
      eventType: "training",
      startsOn: DASHBOARD_NEXT_UP.startsOn,
      endsOn: null,
      startTime: DASHBOARD_NEXT_UP.startTime,
      endTime: DASHBOARD_NEXT_UP.endTime,
      location: DASHBOARD_NEXT_UP.location,
      myResponse: null,
    },
    {
      id: "d0d0d0d0-0000-4000-8000-0000000000e2",
      title: "Season launch night",
      eventType: "social",
      startsOn: DASHBOARD_NEXT_UP.startsOn,
      endsOn: null,
      startTime: "18:30",
      endTime: null,
      location: "Clubhouse",
      myResponse: "yes",
    },
    {
      id: "d0d0d0d0-0000-4000-8000-0000000000e3",
      title: "Island Cup",
      eventType: "competition",
      startsOn: "2026-10-04",
      endsOn: "2026-10-06",
      startTime: "08:00",
      endTime: "17:00",
      location: "Hobart Aquatic Centre",
      myResponse: null,
    },
    {
      id: "d0d0d0d0-0000-4000-8000-0000000000e4",
      title: "Committee meeting",
      eventType: "meeting",
      startsOn: "2026-10-05",
      endsOn: null,
      startTime: "19:00",
      endTime: "20:00",
      location: "Online",
      myResponse: null,
    },
  ],
} as const;

// Los cuatro pendientes de la columna de gestión (#750), como en la captura
// 02 del handoff de E27. Cada rol recibe sólo los que puede resolver (D9).
const TODO_ROLE_REQUESTS = { kind: "role_requests", count: 3 } as const;

const TODO_ATTENDANCE_MISSING = {
  kind: "attendance_missing",
  eventId: "d0d0d0d0-0000-4000-8000-0000000000f1",
  title: "Monday training",
  startsOn: "2026-09-28",
} as const;

const TODO_TEAMS_UNPUBLISHED = {
  kind: "teams_unpublished",
  eventId: DASHBOARD_NEXT_UP.id,
  title: DASHBOARD_NEXT_UP.title,
} as const;

const TODO_NO_REPLY = {
  kind: "no_reply",
  eventId: DASHBOARD_NEXT_UP.id,
  title: DASHBOARD_NEXT_UP.title,
  count: 6,
} as const;

const ADMIN_DASHBOARD = {
  kind: "member",
  column: "management",
  todos: [
    TODO_ROLE_REQUESTS,
    TODO_ATTENDANCE_MISSING,
    TODO_TEAMS_UNPUBLISHED,
    TODO_NO_REPLY,
  ],
  club: {
    attendance: { percent: 86, previousPercent: 80 },
    members: { active: 48, joinedThisMonth: 3 },
    unreadNews: { count: 3, announcements: 1 },
  },
  viewer: { firstName: "Liam" },
  me: {
    attendance: { percent: 85, attended: 11, sessions: 13, last10: [] },
  },
  latestNews: { kind: "news", posts: DASHBOARD_LATEST_NEWS },
  contactReminder: { kind: "reminder", reminder: "none" },
  nextUp: { ...DASHBOARD_NEXT_UP, teamsStatus: "none" },
  week: DASHBOARD_WEEK,
  membership: { status: "active", plan: "Full", renewsOn: null },
};

// "Mi asistencia" de la columna del Player (#749): las últimas 10 con los
// tres estados, como en la captura 01 del handoff de E27.
const DASHBOARD_LAST_10 = (
  [
    "present",
    "present",
    "late",
    "present",
    "absent",
    "present",
    "present",
    "present",
    "late",
    "present",
  ] as const
).map((status, index) => ({
  eventId: `d0d0d0d0-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
  startsOn: `2026-09-${String(index + 10).padStart(2, "0")}`,
  status,
}));

const DASHBOARD_SEASON_ATTENDANCE = {
  percent: 82,
  attended: 18,
  sessions: 22,
  last10: DASHBOARD_LAST_10,
};

const PLAYER_DASHBOARD = {
  ...ADMIN_DASHBOARD,
  column: "player",
  me: { attendance: DASHBOARD_SEASON_ATTENDANCE },
  membership: { status: "active", plan: "Full", renewsOn: "2027-06-30" },
  nextUp: DASHBOARD_NEXT_UP,
};

// La tarjeta "Próximo" (#747) de quien juega en el reparto publicado, la del
// Admin con el reparto sin publicar y la de quien no tiene nada próximo.
const MY_TEAM_DASHBOARD = {
  ...PLAYER_DASHBOARD,
  nextUp: { ...DASHBOARD_NEXT_UP, myTeam: DASHBOARD_MY_TEAM },
};

// Quien juega pero respondió que no puede ir después de publicarse (#839).
const NOT_COMING_DASHBOARD = {
  ...PLAYER_DASHBOARD,
  nextUp: {
    ...DASHBOARD_NEXT_UP,
    myResponse: "no",
    myTeam: { ...DASHBOARD_MY_TEAM, isOutsideSquad: true },
  },
};

const UNPUBLISHED_TEAMS_DASHBOARD = {
  ...ADMIN_DASHBOARD,
  nextUp: { ...DASHBOARD_NEXT_UP, teamsStatus: "draft" },
};

// La columna de gestión sin pendientes (#750), la del Coach, que no ve las
// solicitudes de rol, y la del Committee, que sólo ve quién no ha respondido
// y no entrena: sin "Mi asistencia" la cuadrícula se queda en tres celdas. La
// del Coach entra con la sesión del Admin, como la hoja de asistencia del
// Coach: no hay Coach sembrado, y cada identidad nueva cuenta en Auth (#415).
const ADMIN_ALL_CAUGHT_UP_DASHBOARD = { ...ADMIN_DASHBOARD, todos: [] };

const COACH_DASHBOARD = {
  ...ADMIN_DASHBOARD,
  todos: [TODO_ATTENDANCE_MISSING, TODO_TEAMS_UNPUBLISHED, TODO_NO_REPLY],
};

const COMMITTEE_DASHBOARD = {
  ...ADMIN_DASHBOARD,
  todos: [TODO_NO_REPLY],
  me: { attendance: null },
  club: {
    ...ADMIN_DASHBOARD.club,
    attendance: { percent: 78, previousPercent: 84 },
  },
};

// La columna del Player sin sesiones elegibles en la temporada (#749).
const NO_SESSIONS_DASHBOARD = {
  ...PLAYER_DASHBOARD,
  me: { attendance: null },
};

// Un Player sin noticias publicadas (#751).
const NO_NEWS_DASHBOARD = {
  ...PLAYER_DASHBOARD,
  latestNews: { kind: "news", posts: [] },
};

const NOTHING_NEXT_DASHBOARD = {
  ...PLAYER_DASHBOARD,
  nextUp: { kind: "none" },
};

// El inicio reducido de quien no tiene la membresía al día (#453): el aviso
// de la membresía vencida con su fecha y la tarjeta "Próximo" con la fila del
// candado en lugar del RSVP (#747).
const RESTRICTED_DASHBOARD = {
  kind: "restricted",
  viewer: { firstName: "Liam" },
  me: { attendance: DASHBOARD_SEASON_ATTENDANCE },
  block: "cancelled",
  contactReminder: { kind: "reminder", reminder: "none" },
  nextUp: { ...DASHBOARD_NEXT_UP, myResponse: null },
  week: DASHBOARD_WEEK,
  membership: {
    status: "restricted",
    block: "cancelled",
    endedOn: "2026-09-15",
  },
  latestNews: { kind: "news", posts: DASHBOARD_NEWS_TITLES },
};

// "Esta semana" (#748) de un Player. Con el Próximo en la franja sale marcado
// su día: aquí la copa de tres días, para ver la fila de un evento de varios
// días. Sin Próximo sale marcado hoy, que no tiene nada.
const WEEK_DASHBOARD = {
  ...PLAYER_DASHBOARD,
  nextUp: {
    ...DASHBOARD_NEXT_UP,
    id: "d0d0d0d0-0000-4000-8000-0000000000e3",
    title: "Island Cup",
    eventType: "competition",
    startsOn: "2026-10-04",
    endsOn: "2026-10-06",
    startTime: "08:00",
    endTime: "17:00",
    location: "Hobart Aquatic Centre",
    place: null,
    myResponse: null,
  },
};

const WEEK_EMPTY_DAY_DASHBOARD = {
  ...PLAYER_DASHBOARD,
  nextUp: { kind: "none" },
};

// El aviso de los datos de contacto que faltan (#498). Sin ninguno de los dos
// es el caso de casi todo socio nuevo, y el aviso más largo: el que más podría
// empujar la tarjeta del entrenamiento en el móvil.
const CONTACT_REMINDER_DASHBOARD = {
  ...PLAYER_DASHBOARD,
  contactReminder: { kind: "reminder", reminder: "both" },
};

const PHONE_REMINDER_DASHBOARD = {
  ...PLAYER_DASHBOARD,
  contactReminder: { kind: "reminder", reminder: "phone" },
};

// El inicio de quien tiene un cobro fallido (#474): el reducido, con la
// alerta de la cáscara encima.
const PAST_DUE_DASHBOARD = {
  ...RESTRICTED_DASHBOARD,
  block: "past_due",
  membership: { status: "restricted", block: "past_due", endedOn: null },
};

type DashboardScreenState = {
  readonly name: string;
  readonly dashboard: object;
  readonly storageState: string;
  readonly beforeVisit?: (page: Page) => Promise<void>;
};

function dashboardStates(
  name: string,
  dashboard: object,
  storageState: string,
): readonly DashboardScreenState[] {
  return [
    { name, dashboard, storageState },
    { name: `${name}-es`, dashboard, storageState, beforeVisit: chooseSpanish },
  ];
}

const DASHBOARD_STATES: readonly DashboardScreenState[] = [
  ...dashboardStates("inicio-admin", ADMIN_DASHBOARD, ADMIN_STORAGE_STATE),
  ...dashboardStates(
    "inicio-admin-todo-al-dia",
    ADMIN_ALL_CAUGHT_UP_DASHBOARD,
    ADMIN_STORAGE_STATE,
  ),
  ...dashboardStates("inicio-coach", COACH_DASHBOARD, ADMIN_STORAGE_STATE),
  ...dashboardStates(
    "inicio-committee",
    COMMITTEE_DASHBOARD,
    CLUB_COMMITTEE_STORAGE_STATE,
  ),
  ...dashboardStates(
    "inicio-jugador",
    PLAYER_DASHBOARD,
    E2E_STORAGE_STATE_PATH,
  ),
  ...dashboardStates(
    "inicio-jugador-sin-sesiones",
    NO_SESSIONS_DASHBOARD,
    E2E_STORAGE_STATE_PATH,
  ),
  ...dashboardStates(
    "inicio-sin-membresia",
    RESTRICTED_DASHBOARD,
    UNPAID_MEMBER_STORAGE_STATE_PATH,
  ),
  ...dashboardStates(
    "inicio-aviso-contacto",
    CONTACT_REMINDER_DASHBOARD,
    E2E_STORAGE_STATE_PATH,
  ),
  ...dashboardStates(
    "inicio-aviso-telefono",
    PHONE_REMINDER_DASHBOARD,
    E2E_STORAGE_STATE_PATH,
  ),
  ...dashboardStates(
    "inicio-proximo-equipo",
    MY_TEAM_DASHBOARD,
    E2E_STORAGE_STATE_PATH,
  ),
  ...dashboardStates(
    "inicio-proximo-ya-no-viene",
    NOT_COMING_DASHBOARD,
    E2E_STORAGE_STATE_PATH,
  ),
  ...dashboardStates(
    "inicio-proximo-sin-publicar",
    UNPUBLISHED_TEAMS_DASHBOARD,
    ADMIN_STORAGE_STATE,
  ),
  ...dashboardStates(
    "inicio-proximo-vacio",
    NOTHING_NEXT_DASHBOARD,
    E2E_STORAGE_STATE_PATH,
  ),
  ...dashboardStates(
    "inicio-noticias-vacio",
    NO_NEWS_DASHBOARD,
    E2E_STORAGE_STATE_PATH,
  ),
  ...dashboardStates("inicio-semana", WEEK_DASHBOARD, E2E_STORAGE_STATE_PATH),
  ...dashboardStates(
    "inicio-semana-dia-vacio",
    WEEK_EMPTY_DAY_DASHBOARD,
    E2E_STORAGE_STATE_PATH,
  ),
  ...dashboardStates(
    "alerta-pago-fallido",
    PAST_DUE_DASHBOARD,
    PAST_DUE_MEMBER_STORAGE_STATE_PATH,
  ),
];

async function serveDashboard(page: Page, dashboard: object): Promise<void> {
  await page.route(
    (url) => url.pathname === DASHBOARD_ENDPOINT,
    (route) => route.fulfill(jsonBody(dashboard)),
  );
}

async function goToDashboard(
  page: Page,
  state: Pick<DashboardScreenState, "dashboard" | "beforeVisit">,
  theme?: (typeof themes)[number],
): Promise<void> {
  await page.clock.setFixedTime(HOME_NOW);
  await serveDashboard(page, state.dashboard);
  await state.beforeVisit?.(page);
  if (theme === undefined) {
    await page.goto(`${APP_URL}${HOME_SCREEN_PATH}`);
  } else {
    await goToWithTheme(page, HOME_SCREEN_PATH, theme);
  }
  await expect(
    page.getByRole("heading", { level: 1, name: DASHBOARD_GREETING }),
  ).toBeVisible();
  await expect(page.locator(".dashboard-skeleton")).toHaveCount(0);
}

for (const state of DASHBOARD_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    quietNotificationBell();
    test.use({ storageState: state.storageState });

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await goToDashboard(page, state, theme);
              const snapshot = `${state.name}-${vp.name}-${theme}.png`;
              await createMissingLocalBaseline(snapshot, () =>
                page.screenshot({ ...SCREENSHOT_OPTIONS, fullPage: true }),
              );
              await expect(page).toHaveScreenshot(snapshot, {
                ...SCREENSHOT_OPTIONS,
                fullPage: true,
                maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
              });
            });

            // Cada ancho reordena el inicio y cada tema cambia los
            // contrastes: axe mira los seis (#752).
            test(`has no accessibility violations (${theme}, axe-core)`, async ({
              page,
            }) => {
              await goToDashboard(page, state, theme);
              await expectNoAxeViolations(page);
            });
          }
        }
      });
    }

    for (const width of DASHBOARD_NARROW_WIDTHS) {
      test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 812 });
        await goToDashboard(page, state);
        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    }

    test("has no accessibility violations (axe-core)", async ({ page }) => {
      await goToDashboard(page, state);
      await expectNoAxeViolations(page);
    });
  });
}

test.describe("la columna del Player en el navegador (#749)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  /** La esquina de un elemento que se ve, o un fallo que dice cuál faltaba. */
  async function cornerOf(locator: Locator): Promise<{ x: number; y: number }> {
    const box = await locator.boundingBox();
    if (box === null) {
      throw new Error(`${locator.toString()} no se ve.`);
    }
    return { x: box.x, y: box.y };
  }

  test("en el móvil Mi asistencia y Membresía van lado a lado", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToDashboard(page, { dashboard: PLAYER_DASHBOARD });

    const attendance = page.getByRole("region", { name: "My attendance" });
    const membership = page.getByRole("region", { name: "Membership" });

    const [left, right] = await Promise.all([
      cornerOf(attendance),
      cornerOf(membership),
    ]);
    expect(right.y).toBe(left.y);
    expect(right.x).toBeGreaterThan(left.x);
  });

  test("en escritorio la columna va a la derecha de Próximo", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToDashboard(page, { dashboard: PLAYER_DASHBOARD });

    const nextUp = page.getByRole("region", { name: "Next up" });
    const attendance = page.getByRole("region", { name: "My attendance" });

    const [card, column] = await Promise.all([
      cornerOf(nextUp),
      cornerOf(attendance),
    ]);
    expect(column.y).toBe(card.y);
    expect(column.x).toBeGreaterThan(card.x);
  });
});

test.describe("la columna de gestión en el navegador (#750)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  /** La caja de un elemento que se ve, o un fallo que dice cuál faltaba. */
  async function boxOf(
    locator: Locator,
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await locator.boundingBox();
    if (box === null) {
      throw new Error(`${locator.toString()} no se ve.`);
    }
    return box;
  }

  function todoRows(page: Page): Locator {
    return page.getByRole("region", { name: "To do" }).getByRole("listitem");
  }

  test("en el móvil Pendientes va entre Próximo y Esta semana, y los números después", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToDashboard(page, { dashboard: ADMIN_DASHBOARD });

    const regionBox = (name: string): ReturnType<typeof boxOf> =>
      boxOf(page.getByRole("region", { name }));
    const [nextUp, todos, week, club] = await Promise.all([
      regionBox("Next up"),
      regionBox("To do"),
      regionBox("This week"),
      regionBox("Club numbers"),
    ]);
    expect(todos.y).toBeGreaterThan(nextUp.y);
    expect(week.y).toBeGreaterThan(todos.y);
    expect(club.y).toBeGreaterThan(week.y);
  });

  test("en el móvil cada pendiente mide al menos 60px y termina en flecha", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToDashboard(page, { dashboard: ADMIN_DASHBOARD });

    const rows = await todoRows(page).all();
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect((await boxOf(row)).height).toBeGreaterThanOrEqual(60);
      await expect(row.locator(".dashboard-todo-action svg")).toBeVisible();
      await expect(row.locator(".dashboard-todo-action-label")).toHaveCSS(
        "position",
        "absolute",
      );
    }
  });

  test("en escritorio va a la derecha de Próximo con filas de al menos 56px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToDashboard(page, { dashboard: ADMIN_DASHBOARD });

    const nextUp = await boxOf(page.getByRole("region", { name: "Next up" }));
    const todos = await boxOf(page.getByRole("region", { name: "To do" }));
    expect(todos.y).toBe(nextUp.y);
    expect(todos.x).toBeGreaterThan(nextUp.x);
    for (const row of await todoRows(page).all()) {
      expect((await boxOf(row)).height).toBeGreaterThanOrEqual(56);
      await expect(row.getByRole("link")).toContainText(
        /Review|Take|Open|See who/,
      );
    }
  });

  test("sin Mi asistencia la última celda ocupa la fila y no deja hueco", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToDashboard(page, { dashboard: COMMITTEE_DASHBOARD });

    const grid = await boxOf(page.locator(".dashboard-club-grid"));
    const cells = page
      .getByRole("region", { name: "Club numbers" })
      .getByRole("listitem");
    await expect(cells).toHaveCount(3);
    const last = await boxOf(cells.last());
    expect(last.width).toBeCloseTo(grid.width, 0);
  });

  test("abre la hoja de la sesión desde Tomar", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToDashboard(page, { dashboard: ADMIN_DASHBOARD });

    await page
      .getByRole("region", { name: "To do" })
      .getByRole("link", { name: "Take" })
      .click();

    await expect(page).toHaveURL(
      `${APP_URL}/asistencia?sesion=${TODO_ATTENDANCE_MISSING.eventId}`,
    );
  });
});

test.describe("el orden del inicio en el navegador (#752)", () => {
  skipWithoutSession();
  quietNotificationBell();

  type Box = { x: number; y: number; width: number; height: number };

  /** La caja de un elemento que se ve, o un fallo que dice cuál faltaba. */
  async function boxOf(locator: Locator): Promise<Box> {
    const box = await locator.boundingBox();
    if (box === null) {
      throw new Error(`${locator.toString()} no se ve.`);
    }
    return box;
  }

  function regionBox(page: Page, name: string): Promise<Box> {
    return boxOf(page.getByRole("region", { name }));
  }

  /** Cada caja empieza debajo de donde acaba la anterior. */
  function expectStacked(boxes: readonly Box[]): void {
    boxes.reduce((above, box) => {
      expect(box.y).toBeGreaterThanOrEqual(above.y + above.height);
      return box;
    });
  }

  /** Lo que queda libre entre el final de una caja y el principio de otra. */
  function gapBetween(
    first: Box,
    second: Box,
    axis: "horizontal" | "vertical",
  ): number {
    return axis === "horizontal"
      ? Math.round(second.x - (first.x + first.width))
      : Math.round(second.y - (first.y + first.height));
  }

  test.describe("un Player", () => {
    test.use({ storageState: E2E_STORAGE_STATE_PATH });

    test("en el móvil va Próximo, Esta semana, su columna lado a lado y Noticias", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await goToDashboard(page, { dashboard: PLAYER_DASHBOARD });

      const [nextUp, week, attendance, membership, news] = await Promise.all([
        regionBox(page, "Next up"),
        regionBox(page, "This week"),
        regionBox(page, "My attendance"),
        regionBox(page, "Membership"),
        regionBox(page, "News"),
      ]);

      expectStacked([nextUp, week, attendance, news]);
      expect(membership.y).toBe(attendance.y);
    });

    test("en el móvil el inicio lleva 14px de margen y 16px entre bloques", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await goToDashboard(page, { dashboard: PLAYER_DASHBOARD });

      const [dashboard, nextUp, week] = await Promise.all([
        boxOf(page.locator(".dashboard")),
        regionBox(page, "Next up"),
        regionBox(page, "This week"),
      ]);

      expect(Math.round(dashboard.x)).toBe(14);
      expect(Math.round(dashboard.width)).toBe(375 - 2 * 14);
      expect(gapBetween(nextUp, week, "vertical")).toBe(16);
    });

    test("en escritorio va la cuadrícula de 1fr y 340px con 18px de hueco, y Noticias a lo ancho debajo", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await goToDashboard(page, { dashboard: PLAYER_DASHBOARD });

      const [dashboard, nextUp, week, attendance, news] = await Promise.all([
        boxOf(page.locator(".dashboard")),
        regionBox(page, "Next up"),
        regionBox(page, "This week"),
        regionBox(page, "My attendance"),
        regionBox(page, "News"),
      ]);

      expect(Math.round(attendance.width)).toBe(340);
      expect(gapBetween(nextUp, attendance, "horizontal")).toBe(18);
      expect(gapBetween(nextUp, week, "vertical")).toBe(18);
      expectStacked([week, news]);
      expect(Math.round(news.width)).toBe(Math.round(dashboard.width));
    });

    test("mientras espera la respuesta saluda y enseña el esqueleto de cada bloque", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.clock.setFixedTime(HOME_NOW);
      let answer: () => void = () => undefined;
      const answered = new Promise<void>((resolve) => {
        answer = resolve;
      });
      await page.route(
        (url) => url.pathname === DASHBOARD_ENDPOINT,
        async (route) => {
          await answered;
          await route.fulfill(jsonBody(PLAYER_DASHBOARD));
        },
      );
      await page.goto(`${APP_URL}${HOME_SCREEN_PATH}`);

      await expect(
        page.getByRole("heading", { level: 1, name: DASHBOARD_GREETING }),
      ).toBeVisible();
      const skeleton = page.locator(".dashboard-skeleton");
      await expect(skeleton.locator(".section-loading-block")).toHaveCount(4);
      await expect(page.getByRole("region", { name: "Next up" })).toHaveCount(
        0,
      );
      await expectNoAxeViolations(page);
      answer();

      await expect(page.getByRole("region", { name: "Next up" })).toBeVisible();
      await expect(skeleton).toHaveCount(0);
    });
  });

  test.describe("la gestión", () => {
    test.use({ storageState: ADMIN_STORAGE_STATE });

    test("en escritorio la columna de gestión mide 340px y Noticias va a lo ancho debajo", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await goToDashboard(page, { dashboard: ADMIN_DASHBOARD });

      const [dashboard, nextUp, todos, club, news] = await Promise.all([
        boxOf(page.locator(".dashboard")),
        regionBox(page, "Next up"),
        regionBox(page, "To do"),
        regionBox(page, "Club numbers"),
        regionBox(page, "News"),
      ]);

      expect(Math.round(todos.width)).toBe(340);
      expect(todos.y).toBe(nextUp.y);
      expectStacked([todos, club, news]);
      expect(Math.round(news.width)).toBe(Math.round(dashboard.width));
    });
  });

  test.describe("un socio restringido", () => {
    test.use({ storageState: UNPAID_MEMBER_STORAGE_STATE_PATH });

    test("en el móvil va el aviso, Próximo, Esta semana, su columna y Noticias", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await goToDashboard(page, { dashboard: RESTRICTED_DASHBOARD });

      const boxes = await Promise.all([
        boxOf(page.getByRole("note", { name: /Your membership expired/ })),
        regionBox(page, "Next up"),
        regionBox(page, "This week"),
        regionBox(page, "My attendance"),
        regionBox(page, "News"),
      ]);

      expectStacked(boxes);
    });
  });
});

/* "Ver equipos" de la franja del equipo (D6 del PRD de E27) abre el evento
   ya en sus equipos: la pantalla entera en el móvil, el panel en escritorio.
   Volver atrás lleva al inicio, de donde se vino. */
test.describe("Ver equipos desde el inicio", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  const NEXT_UP_AGENDA_EVENT = {
    ...STUBBED_AGENDA_EVENTS[0],
    id: DASHBOARD_POOL_TRAINING_ID,
    title: "Saturday scrimmage",
  };

  async function goToTeamsFromHome(page: Page): Promise<void> {
    await stubCalendarReads(page, {
      events: [NEXT_UP_AGENDA_EVENT],
      teams: PUBLISHED_TEAMS,
    });
    await goToDashboard(page, { dashboard: MY_TEAM_DASHBOARD });
    await page
      .getByRole("region", { name: "Next up" })
      .getByRole("link", { name: "See teams" })
      .click();
    await expect(page).toHaveURL(/[?&]ver=equipos/);
  }

  async function openTeamsOnPhone(page: Page): Promise<Locator> {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToTeamsFromHome(page);
    const eventScreen = page.getByRole("article", {
      name: NEXT_UP_AGENDA_EVENT.title,
    });
    await expect(
      eventScreen.getByRole("heading", { name: "Teams" }),
    ).toBeFocused();
    return eventScreen;
  }

  test("en el móvil abre la pantalla del evento con el foco en sus equipos y Volver lleva al inicio", async ({
    page,
  }) => {
    const eventScreen = await openTeamsOnPhone(page);

    await eventScreen.getByRole("button", { name: "Back to calendar" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: DASHBOARD_GREETING }),
    ).toBeVisible();
  });

  test("en el móvil el atrás del navegador también lleva al inicio", async ({
    page,
  }) => {
    await openTeamsOnPhone(page);

    await page.goBack();

    await expect(
      page.getByRole("heading", { level: 1, name: DASHBOARD_GREETING }),
    ).toBeVisible();
  });

  test("en escritorio elige el evento en el panel con el foco en sus equipos", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await goToTeamsFromHome(page);

    const panel = page.getByRole("complementary", {
      name: NEXT_UP_AGENDA_EVENT.title,
    });
    await expect(panel.getByRole("heading", { name: "Teams" })).toBeFocused();
  });
});

test.describe("el inicio en el navegador", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  function nextUpCard(page: Page): Locator {
    return page.getByRole("region", { name: "Next up" });
  }

  /** La caja de un elemento que se ve, o un fallo que dice cuál faltaba. */
  async function boxOf(
    locator: Locator,
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await locator.boundingBox();
    if (box === null) {
      throw new Error(`${locator.toString()} no se ve.`);
    }
    return box;
  }

  test("a 375px la imagen va arriba con 130px, Cómo llegar a todo el ancho y los botones de 56px con el icono encima", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToDashboard(page, { dashboard: PLAYER_DASHBOARD });
    const card = nextUpCard(page);

    const [cover, title, directions, body, going] = await Promise.all([
      boxOf(card.locator(".dashboard-next-up-cover")),
      boxOf(card.getByRole("heading", { name: DASHBOARD_NEXT_UP.title })),
      boxOf(card.getByRole("link", { name: /^Directions/ })),
      boxOf(card.locator(".dashboard-next-up-body")),
      boxOf(card.getByRole("button", { name: "Going" })),
    ]);
    const icon = await boxOf(
      card.getByRole("button", { name: "Going" }).locator("svg"),
    );

    expect(Math.round(cover.height)).toBe(130);
    expect(title.y).toBeGreaterThan(cover.y + cover.height);
    expect(Math.round(directions.height)).toBeGreaterThanOrEqual(44);
    expect(Math.round(directions.width)).toBe(Math.round(body.width - 2 * 16));
    expect(Math.round(going.height)).toBe(56);
    // Con el icono encima del texto, el icono queda centrado en el botón; al
    // lado del texto quedaría desplazado a la izquierda.
    expect(Math.round(icon.x + icon.width / 2)).toBe(
      Math.round(going.x + going.width / 2),
    );
  });

  test("a 375px la franja del equipo mide al menos 52px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToDashboard(page, { dashboard: MY_TEAM_DASHBOARD });

    const strip = nextUpCard(page).locator(".dashboard-next-up-team");

    expect((await boxOf(strip)).height).toBeGreaterThanOrEqual(52);
  });

  test("a 375px la semana lleva el día en una letra, la fecha de 16px, puntos de 6px y filas de 56px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToDashboard(page, { dashboard: PLAYER_DASHBOARD });
    const week = page.getByRole("region", { name: "This week" });
    const saturday = week.getByRole("button", { name: /October 3/ });

    await expect(saturday.locator(".dashboard-week-weekday")).toHaveText("S", {
      useInnerText: true,
    });
    await expect(saturday.locator(".dashboard-week-date")).toHaveCSS(
      "font-size",
      "16px",
    );
    await expect(saturday.locator(".dashboard-week-dot").first()).toHaveCSS(
      "width",
      "6px",
    );
    const row = week.getByRole("link", { name: /Saturday scrimmage/ });
    expect(Math.round((await boxOf(row)).height)).toBe(56);
    await expect(row).toContainText("11:00 am · Princes Park · Field 2");
  });

  test("en escritorio la semana lleva el día en tres letras, la fecha de 18px, puntos de 7px y la columna de la hora de 92px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToDashboard(page, { dashboard: PLAYER_DASHBOARD });
    const week = page.getByRole("region", { name: "This week" });
    const saturday = week.getByRole("button", { name: /October 3/ });

    await expect(saturday.locator(".dashboard-week-weekday")).toHaveText(
      "SAT",
      {
        useInnerText: true,
      },
    );
    await expect(saturday.locator(".dashboard-week-date")).toHaveCSS(
      "font-size",
      "18px",
    );
    await expect(saturday.locator(".dashboard-week-dot").first()).toHaveCSS(
      "width",
      "7px",
    );
    const time = week
      .getByRole("link", { name: /Saturday scrimmage/ })
      .locator(".dashboard-week-time");
    expect(Math.round((await boxOf(time)).width)).toBe(92);
  });

  test("en escritorio la tarjeta lleva la imagen en una columna de 280px a la izquierda", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToDashboard(page, { dashboard: PLAYER_DASHBOARD });
    const card = nextUpCard(page);

    const [cover, body] = await Promise.all([
      boxOf(card.locator(".dashboard-next-up-cover")),
      boxOf(card.locator(".dashboard-next-up-body")),
    ]);

    expect(Math.round(cover.width)).toBe(280);
    expect(body.x).toBeGreaterThanOrEqual(cover.x + cover.width);
    expect(Math.round(body.y)).toBe(Math.round(cover.y));
  });

  test("Voy guarda la respuesta y la marca", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route(
      (url) =>
        url.pathname ===
        `${CALENDAR_AGENDA_ENDPOINT}/${DASHBOARD_NEXT_UP.id}/rsvp`,
      (route) =>
        route.fulfill(
          jsonBody({
            eventId: DASHBOARD_NEXT_UP.id,
            response: "maybe",
            respondedAt: HOME_NOW.toISOString(),
          }),
        ),
    );
    await goToDashboard(page, { dashboard: PLAYER_DASHBOARD });
    const maybe = nextUpCard(page).getByRole("button", { name: "Maybe" });

    await maybe.click();

    await expect(maybe).toHaveAttribute("aria-pressed", "true");
  });

  test("+ Evento abre el calendario con el formulario y entrenamiento elegido", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToDashboard(page, { dashboard: ADMIN_DASHBOARD });

    await page.getByRole("link", { name: "New event" }).click();

    await expect(page).toHaveURL(/\/calendario\?nuevo=training$/);
    const dialog = page.getByRole("dialog", { name: "New event" });
    await expect(dialog.getByRole("radio", { name: "Training" })).toBeChecked();
  });

  test("en el móvil + Evento es un botón de 44px con su nombre entero", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToDashboard(page, { dashboard: ADMIN_DASHBOARD });

    const newEvent = page.getByRole("link", { name: "New event" });
    const box = await boxOf(newEvent);

    expect(Math.round(box.width)).toBe(44);
    expect(Math.round(box.height)).toBe(44);
  });

  test("con la red caída lo dice y vuelve a pedir al reintentar", async ({
    page,
  }) => {
    await page.clock.setFixedTime(HOME_NOW);
    // La red falla hasta que se pulsa reintentar. Contar peticiones no
    // sirve: en desarrollo React monta el efecto dos veces y la primera
    // respuesta se descarta.
    let isNetworkDown = true;
    await page.route(
      (url) => url.pathname === DASHBOARD_ENDPOINT,
      (route) =>
        isNetworkDown
          ? route.abort("internetdisconnected")
          : route.fulfill(jsonBody(ADMIN_DASHBOARD)),
    );
    await page.goto(`${APP_URL}${HOME_SCREEN_PATH}`);

    // Sólo el de la pantalla: el anunciador de rutas de Next también es un
    // alert.
    await expect(page.locator(".dashboard").getByRole("alert")).toBeVisible();
    await expectNoAxeViolations(page);
    isNetworkDown = false;
    await page.getByRole("button", { name: "Try again" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: DASHBOARD_GREETING }),
    ).toBeVisible();
  });
});

test.describe("el aviso del contacto en el inicio (#498)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  test("a 375px no empuja el RSVP de la tarjeta Próximo fuera de la primera pantalla", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToDashboard(page, { dashboard: CONTACT_REMINDER_DASHBOARD });

    await expect(
      page.getByRole("note", {
        name: "Add your phone number and emergency contact",
      }),
    ).toBeVisible();
    const rsvp = page
      .getByRole("region", { name: "Next up" })
      .getByRole("group", { name: `RSVP: ${DASHBOARD_NEXT_UP.title}` });
    const [rsvpBox, tabBarBox] = await Promise.all([
      rsvp.boundingBox(),
      page.getByRole("navigation", { name: "Sections" }).boundingBox(),
    ]);

    // La barra de pestañas va fija abajo: lo que queda debajo no se ve.
    expect(rsvpBox).not.toBeNull();
    expect(tabBarBox).not.toBeNull();
    expect((rsvpBox?.y ?? 0) + (rsvpBox?.height ?? 0)).toBeLessThanOrEqual(
      tabBarBox?.y ?? 0,
    );
  });

  test("el del teléfono, cerrado, no vuelve al recargar", async ({ page }) => {
    await goToDashboard(page, { dashboard: PHONE_REMINDER_DASHBOARD });
    const note = page.getByRole("note", { name: "Add your phone number" });

    await note.getByRole("button", { name: "Dismiss phone reminder" }).click();
    await expect(note).toBeHidden();
    await page.reload();

    await expect(
      page.getByRole("heading", { level: 1, name: DASHBOARD_GREETING }),
    ).toBeVisible();
    await expect(note).toBeHidden();
  });

  test("la fila entera es el enlace a la sección Contacto del perfil", async ({
    page,
  }) => {
    const TOUCH_TARGET_MIN_PX = 44;
    await goToDashboard(page, { dashboard: CONTACT_REMINDER_DASHBOARD });
    const row = page
      .getByRole("note", {
        name: "Add your phone number and emergency contact",
      })
      .getByRole("link", {
        name: "Add your phone number and emergency contact Add contact",
      });

    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    await row.click();

    await expect(page).toHaveURL(/\/cuenta#perfil-contacto$/);
    await expect(page.getByRole("heading", { name: "Contact" })).toBeVisible();
  });
});

type RealNextUp =
  | {
      readonly kind: "event";
      readonly id: string;
      readonly title: string;
      readonly myResponse: "yes" | "maybe" | "no" | null;
    }
  | { readonly kind: "none" | "unavailable" };

/** En la tarjeta "Próximo" (#747) y en el panel del calendario (#648) los
 * botones dicen la respuesta entera. */
const PANEL_RSVP_BUTTON_NAMES = {
  yes: "Going",
  maybe: "Maybe",
  no: "Can't go",
} as const;

test.describe("el RSVP del inicio con los datos de verdad", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  test("responder en la tarjeta deja la respuesta en el calendario", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const dashboardRead = page.waitForResponse(
      (response) => new URL(response.url()).pathname === DASHBOARD_ENDPOINT,
    );
    await page.goto(`${APP_URL}${HOME_SCREEN_PATH}`);
    const body = (await (await dashboardRead).json()) as {
      readonly data: { readonly nextUp: RealNextUp };
    };
    const { nextUp } = body.data;
    test.skip(
      nextUp.kind !== "event",
      "seadragons-dev no tiene ningún evento a la vista del socio de prueba",
    );
    if (nextUp.kind !== "event") {
      return;
    }
    const training = nextUp;
    const answer = training.myResponse === "maybe" ? "no" : "maybe";
    const card = page.getByRole("region", { name: "Next up" });

    try {
      await card
        .getByRole("button", { name: PANEL_RSVP_BUTTON_NAMES[answer] })
        .click();
      await expect(
        card.getByRole("button", { name: PANEL_RSVP_BUTTON_NAMES[answer] }),
      ).toHaveAttribute("aria-pressed", "true");

      await page.goto(`${APP_URL}${CALENDAR_SCREEN_PATH}`);
      // El primero con ese título es el próximo: la agenda va por fecha.
      await page
        .getByRole("button", { name: training.title, exact: true })
        .first()
        .click();
      await expect(
        eventPanel(page, training.title)
          .getByRole("group", { name: `RSVP: ${training.title}` })
          .getByRole("button", { name: PANEL_RSVP_BUTTON_NAMES[answer] }),
      ).toHaveAttribute("aria-pressed", "true");
    } finally {
      // Deja la respuesta que tenía, para que la próxima corrida parta igual.
      if (training.myResponse !== null) {
        await page.request.put(
          `${APP_URL}${CALENDAR_AGENDA_ENDPOINT}/${training.id}/rsvp`,
          { data: { response: training.myResponse } },
        );
      }
    }
  });
});
