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
import {
  E2E_STORAGE_STATE_PATH,
  GROUPED_MEMBER_GROUP_NAMES,
  GROUPED_MEMBER_STORAGE_STATE_PATH,
  PHOTOGRAPHED_MEMBERS,
  PROFILE_PHOTO_FIXTURE_PATH,
  incompleteStorageStatePath,
  readE2eSessionState,
  roleRequestStorageStatePath,
  seededMemberName,
} from "./support/e2e-session";
import { shouldCreateMissingSnapshot } from "./support/missing-snapshot-policy";
import { isStatePhotographed } from "./support/spanish-captures";
import { snapshotCreatedNotice } from "./support/visual-baseline-notice";
import { LOCALE_COOKIE_NAME, type Locale } from "@/lib/i18n/locale";

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

// #77: medido comparando esta misma rama sin cambios dos veces en CI
// (Linux), contra la línea base ya aceptada, con tolerancia puesta a cero
// para que cualquier diferencia real de renderizado quedara expuesta en el
// reporte (runs 34072162451 y 34072312519). Resultado: 0 píxeles de
// diferencia en las 22 capturas de página sin regresión real, en ambas
// corridas. Las únicas fallas fueron las dos líneas base oscuras ya sabidas
// como desactualizadas (home-mobile-dark: 1756px, section-mobile-dark:
// 1849px, idénticos en ambas corridas), que no son ruido sino el defecto
// que este ticket corrige. El margen de abajo es generoso frente al ruido
// medido (0) y sigue quedando dos órdenes de magnitud por debajo de la
// regresión real más pequeña observada (1756px). Es un presupuesto
// ABSOLUTO a propósito: uno por ratio crece con el alto de la página y es
// la causa raíz del punto ciego (#77).
const PAGE_MAX_DIFF_PIXELS = 20;
const COMPONENT_MAX_DIFF_PIXELS = 10;

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

function accountMenu(page: Page): Locator {
  return page.getByRole("region", { name: ACCOUNT_BUTTON_NAME });
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
 * de la cuenta, que se cierra después para que la captura no lo lleve. */
async function chooseDarkTheme(page: Page): Promise<void> {
  const darkThemeToggle = page.getByRole("button", {
    name: /tema oscuro|dark theme/i,
  });
  const isInsideApp =
    (await page.getByRole("button", { name: ACCOUNT_BUTTON_NAME }).count()) > 0;
  if (!isInsideApp) {
    await darkThemeToggle.click();
    return;
  }
  await openAccountMenu(page);
  await darkThemeToggle.click();
  await closeAccountMenu(page);
}

async function goToWithTheme(
  page: import("@playwright/test").Page,
  path: string,
  theme: (typeof themes)[number],
): Promise<void> {
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

// "home" is the pre-existing landing page; "section" is a destination route
// off the sidebar menu, standing in for any of the seven (they share the
// same shell and SectionPlaceholder). Las dos viven detrás de la frontera de
// sesión, así que sus tests entran antes de mirarlas.
const APP_PAGES: readonly Screen[] = [
  { name: "home", path: "/" },
  { name: "section", path: "/calendario" },
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

/** `revealToggles` los pone a la vista donde no lo están: dentro de la
 * aplicación viven en el menú de la cuenta (#287). */
function describeTogglesCorner(
  pg: Screen,
  revealToggles?: (page: Page) => Promise<void>,
): void {
  for (const vp of viewports) {
    test.describe(`interruptores-${pg.name} @ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const theme of themes) {
        test(`matches approved baseline (${theme})`, async ({ page }) => {
          await goToWithTheme(page, pg.path, theme);
          await revealToggles?.(page);
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

// Las pantallas de cuentas que se alcanzan sin sesión, más el desenlace del
// enlace de confirmación, que es el panel con más texto.
for (const pg of [
  ...PUBLIC_PAGES,
  ...PASSWORD_RECOVERY_SCREENS,
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

  for (const pg of APP_PAGES) {
    describeScreen(pg);
  }

  // E17 RF-5: el panel y las secciones cambian de largo y de `lang` en
  // español, y eso no lo ve la pasada de axe en inglés.
  for (const pg of APP_PAGES) {
    test(`${pg.name} en español: has no accessibility violations (axe-core)`, async ({
      page,
    }) => {
      await expectNoAxeViolationsInSpanish(page, pg.path);
    });
  }

  describeTogglesCorner({ name: "panel", path: "/dashboard" }, async (page) => {
    await openAccountMenu(page);
    await page.mouse.move(0, 0);
  });

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
        ).toHaveText(["Directory", "Evaluations", "Payments", "Groups"]);
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
  await page.getByLabel("Membership type").selectOption("Full");
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
  await page.getByLabel("Membership type").selectOption("Full");
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

    await expect(page.getByLabel("Membership type")).toBeVisible();
    await expect(page.getByLabel("Country")).toHaveCount(0);
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

      await page.getByLabel("Membership type").selectOption("Student");
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
      await expect(page.getByLabel("Membership type")).toHaveCount(0);
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
  for (const restrictedPath of ["/equipos", "/evaluaciones", "/grupos"]) {
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
};

async function writeTooLongJustification(page: Page): Promise<void> {
  await page
    .getByLabel("Why do you want this role? (optional)")
    .fill(TOO_LONG_JUSTIFICATION);
  await expect(page.getByText(/can be at most 500 characters/)).toBeVisible();
}

const ACCOUNT_PROFILE_ENDPOINT = "/api/v1/account/profile";
const FULL_PROFILE_STORAGE_STATE =
  roleRequestStorageStatePath("perfil-completo");
/** El botón de guardar en los dos idiomas: las capturas en español preparan
 * la pantalla con la misma función. */
const SAVE_PROFILE_BUTTON = /^(Save changes|Guardar cambios)$/;
const PROFILE_SAVED_MESSAGE = /^(Changes saved\.|Cambios guardados\.)$/;

/** Guarda la ficha tal como está. Escribe lo que ya había, así que las
 * capturas de varios tamaños pueden hacerlo a la vez sobre el mismo socio. */
async function saveProfileUnchanged(page: Page): Promise<void> {
  await page.getByRole("button", { name: SAVE_PROFILE_BUTTON }).click();
  await expect(page.getByRole("status")).toHaveText(PROFILE_SAVED_MESSAGE, {
    timeout: ACCOUNT_CHANGE_TIMEOUT_MS,
  });
}

const PHOTO_PROFILE_STORAGE_STATE =
  roleRequestStorageStatePath("perfil-con-foto");
const PROFILE_PHOTO_ALT = /^(Your profile photo|Tu foto de perfil)$/;
const CHOOSE_PHOTO_LABEL = /^(Choose a photo|Elegir una foto)$/;
/** Un byte más de lo que admite la foto de perfil (#245). */
const TOO_LARGE_PHOTO_BYTES = 2 * 1024 * 1024 + 1;

/** La foto llega de Storage por una dirección firmada: sin esperar a que
 * termine de cargar, la captura sale con el círculo vacío. */
async function waitForProfilePhoto(page: Page): Promise<void> {
  await expect(
    page.getByRole("img", { name: PROFILE_PHOTO_ALT }),
  ).toHaveJSProperty("complete", true);
}

/** Elige una foto de más de 2 MB: la pantalla la rechaza sin subirla. */
async function chooseTooLargePhoto(page: Page): Promise<void> {
  await page.getByLabel(CHOOSE_PHOTO_LABEL).setInputFiles({
    name: "foto-enorme.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(TOO_LARGE_PHOTO_BYTES),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: /2 MB/ }),
  ).toBeVisible();
}

async function failProfileSaveOnNetwork(page: Page): Promise<void> {
  await page.route(`**${ACCOUNT_PROFILE_ENDPOINT}`, (route) =>
    route.abort("internetdisconnected"),
  );
  await page.getByRole("button", { name: SAVE_PROFILE_BUTTON }).click();
  // Con texto: el anunciador de rutas de Next también es un `alert`, vacío.
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible();
}

const ACCOUNT_STATES: readonly AccountState[] = [
  { name: "cuenta-formulario", storageState: E2E_STORAGE_STATE_PATH },
  {
    name: "cuenta-pendiente",
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
];

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
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

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        if (isStatePhotographed(state.name)) {
          for (const theme of themes) {
            test(`matches approved baseline (${theme})`, async ({ page }) => {
              await state.beforeVisit?.(page);
              await goToWithTheme(page, ACCOUNT_PATH, theme);
              await state.prepare?.(page);
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

  test("ve su rol y el formulario con Coach y Committee", async ({ page }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);

    await expect(page.getByText("Role: Player")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Coach" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Committee" })).toBeVisible();
  });

  test("en español, la pantalla sale en español", async ({ page }) => {
    await chooseSpanish(page);
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);

    await expect(page.getByText("Rol: Jugador")).toBeVisible();
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
  // aguanta: una sola fila, sin tapar los controles ni salirse, y el texto
  // entero en el árbol aunque se vea recortado. El `title` que pone la cáscara
  // lo prueba `tests/unit/app-shell.test.tsx`.
  const LONGEST_CLUB_NAME =
    "Asociación Deportiva de Rugby Subacuático del Sur · Tasmania";
  for (const width of [360, 375]) {
    test(`un nombre de 60 caracteres se recorta en una sola fila a ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${APP_URL}${ACCOUNT_PATH}`);
      const brandLocator = page.locator(".app-brand");
      const singleLineHeight = await brandLocator.evaluate(
        (element) => element.getBoundingClientRect().height,
      );
      await brandLocator.evaluate((element, name) => {
        element.textContent = name;
      }, LONGEST_CLUB_NAME);

      const brand = await brandLocator.boundingBox();
      const controls = await Promise.all(
        [
          page.getByRole("button", { name: /^Notifications/ }),
          page.getByRole("button", { name: ACCOUNT_BUTTON_NAME }),
        ].map((control) => control.boundingBox()),
      );
      const boxes = controls.flatMap((box) => (box === null ? [] : [box]));
      if (brand === null || boxes.length !== controls.length) {
        throw new Error("la cabecera no dibujó el nombre o algún control");
      }

      expect(brand.height, "el nombre se parte en dos filas").toBe(
        singleLineHeight,
      );
      const brandMiddle = brand.y + brand.height / 2;
      for (const box of boxes) {
        expect(
          brandMiddle > box.y && brandMiddle < box.y + box.height,
          "un control no está en la fila del nombre",
        ).toBe(true);
      }
      expect(
        brand.x + brand.width,
        "el nombre del club tapa los controles",
      ).toBeLessThanOrEqual(Math.min(...boxes.map((box) => box.x)));
      expect(
        Math.max(...boxes.map((box) => box.x + box.width)),
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

test.describe("Mi cuenta con grupos", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: GROUPED_MEMBER_STORAGE_STATE_PATH });

  test("ve sus grupos en orden alfabético", async ({ page }) => {
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);

    const section = page.getByRole("region", { name: "My groups" });
    await expect(section.getByRole("listitem")).toHaveText(
      [...GROUPED_MEMBER_GROUP_NAMES].sort(),
    );
  });

  test("en español, la sección sale en español", async ({ page }) => {
    await chooseSpanish(page);
    await page.goto(`${APP_URL}${ACCOUNT_PATH}`);

    await expect(
      page.getByRole("region", { name: "Mis grupos" }),
    ).toBeVisible();
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

    const section = page.getByRole("region", { name: "My groups" });
    await expect(
      section.getByText("You don't belong to any group yet."),
    ).toBeVisible();
    await expect(section.getByRole("listitem")).toHaveCount(0);
  });

  test("el endpoint devuelve una lista vacía", async ({ request }) => {
    const response = await request.get(`${APP_URL}${ACCOUNT_GROUPS_ENDPOINT}`);

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ data: { groups: [] } });
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
    await page.getByLabel("Full name").fill(newName);
    await page.getByLabel("Position").selectOption("Forward");
    await page.getByLabel("Experience level").selectOption("Advanced");
    await page.getByLabel("Gender").selectOption("non_binary");

    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(ACCOUNT_PROFILE_ENDPOINT) &&
        response.request().method() === "PATCH",
      { timeout: ACCOUNT_CHANGE_TIMEOUT_MS },
    );
    await page.getByRole("button", { name: "Save changes" }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByRole("status")).toHaveText("Changes saved.");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(newName);

    await page.reload();
    await expect(page.getByLabel("Full name")).toHaveValue(newName);
    await expect(page.getByLabel("Position")).toHaveValue("Forward");

    const directory = await page.request.get(
      `${APP_URL}/api/v1/directory?q=${encodeURIComponent(newName)}`,
    );
    expect(directory.status()).toBe(200);
    expect(await directory.json()).toMatchObject({
      data: {
        members: [
          {
            fullName: newName,
            position: "Forward",
            experienceLevel: "Advanced",
          },
        ],
      },
    });

    await page.getByLabel("Position").selectOption("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Changes saved.");
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
          position: null,
          experienceLevel: null,
          gender: null,
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

    await expect(page.getByText("AUF AUF-2026-0275 · expires")).toBeVisible();
    await expect(page.getByLabel("AUF number")).toHaveCount(0);
  });

  test("el endpoint le niega cambiarlo", async ({ request }) => {
    const response = await request.patch(
      `${APP_URL}${ACCOUNT_PROFILE_ENDPOINT}`,
      {
        data: {
          fullName: "Vera Verificada",
          country: "AU",
          position: null,
          experienceLevel: null,
          gender: null,
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

const GROUPS_SCREEN_PATH = "/grupos";
const GROUPS_ENDPOINT = "/api/v1/groups";

/** Justo el tope de `GROUP_NAME_MAX_LENGTH`, para el criterio de los 60
 * caracteres a 375px y el caso de contenido largo de design-system.md. */
const LONG_GROUP_NAME =
  "Juveniles que entrenan los jueves por la tarde en la piscina";

const STUBBED_GROUPS = [
  {
    id: "11111111-0000-4000-8000-000000000001",
    name: "Senior Squad",
    memberCount: 3,
  },
  {
    id: "22222222-0000-4000-8000-000000000002",
    name: LONG_GROUP_NAME,
    memberCount: 0,
  },
];

const STUBBED_GROUP_MEMBERS = [
  { id: "aaaaaaaa-0000-4000-8000-00000000000a", fullName: "Ana Admin" },
  { id: "bbbbbbbb-0000-4000-8000-00000000000b", fullName: "Nerea Ruiz" },
  {
    id: "cccccccc-0000-4000-8000-00000000000c",
    fullName: "Tomás Errekondo Aranburu",
  },
];

const STUBBED_GROUP_CANDIDATES = [
  { id: "dddddddd-0000-4000-8000-00000000000d", fullName: "Bea Nadal" },
  { id: "eeeeeeee-0000-4000-8000-00000000000e", fullName: "Iker Lasa" },
];

const OPENED_GROUP = STUBBED_GROUPS[0];

/** Las tres lecturas de la sección, con datos fijos. Registradas antes de
 * navegar, para que la pantalla no llegue a ver las de verdad. */
async function stubGroupsReads(
  page: Page,
  options: { readonly withGroups: boolean },
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
}

/** La pantalla pide su lista al montarse, así que hasta que llega sólo enseña
 * que está cargando. Sin esperarla, una captura sale del estado de carga y la
 * comparación de un instante después, de la pantalla ya llena. */
async function waitForGroups(page: Page, heading: string): Promise<void> {
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
}

/** Abre la confirmación de borrado del grupo con socios, que es la que dice
 * cuántos tiene. */
async function askToDeleteGroup(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: `Delete ${OPENED_GROUP?.name ?? ""}` })
    .click();
  await expect(page.getByText(/They stay in the club/)).toBeVisible();
}

function openGroupIn(memberHeading: string) {
  return async (page: Page): Promise<void> => {
    await page
      .getByRole("button", { name: OPENED_GROUP?.name ?? "", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: memberHeading }),
    ).toBeVisible();
  };
}

type GroupsState = {
  readonly name: string;
  readonly withGroups: boolean;
  /** El encabezado por el que se sabe que la lista llegó. */
  readonly listHeading: string;
  readonly beforeVisit?: (page: Page) => Promise<void>;
  readonly prepare?: (page: Page) => Promise<void>;
};

const ENGLISH_GROUPS_HEADING = "Club groups";
const SPANISH_GROUPS_HEADING = "Grupos del club";

const GROUPS_STATES: readonly GroupsState[] = [
  {
    name: "grupos-con-grupos",
    withGroups: true,
    listHeading: ENGLISH_GROUPS_HEADING,
  },
  {
    name: "grupos-con-grupos-es",
    withGroups: true,
    listHeading: SPANISH_GROUPS_HEADING,
    beforeVisit: chooseSpanish,
  },
  {
    name: "grupos-sin-grupos",
    withGroups: false,
    listHeading: ENGLISH_GROUPS_HEADING,
  },
  {
    name: "grupos-sin-grupos-es",
    withGroups: false,
    listHeading: SPANISH_GROUPS_HEADING,
    beforeVisit: chooseSpanish,
  },
  {
    name: "grupos-borrar",
    withGroups: true,
    listHeading: ENGLISH_GROUPS_HEADING,
    prepare: askToDeleteGroup,
  },
  {
    name: "grupos-abierto",
    withGroups: true,
    listHeading: ENGLISH_GROUPS_HEADING,
    prepare: openGroupIn(`Members of ${OPENED_GROUP?.name ?? ""}`),
  },
  {
    name: "grupos-abierto-es",
    withGroups: true,
    listHeading: SPANISH_GROUPS_HEADING,
    beforeVisit: chooseSpanish,
    prepare: openGroupIn(`Miembros de ${OPENED_GROUP?.name ?? ""}`),
  },
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
  await waitForGroups(page, state.listHeading);
  await state.prepare?.(page);
}

for (const state of GROUPS_STATES) {
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
      await goToGroups(page, state);
      await expectNoAxeViolations(page);
    });
  });
}

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
      page.getByRole("heading", { name: ENGLISH_GROUPS_HEADING }),
    ).toBeVisible();
  });

  test("en español, la sección sale en español", async ({ page }) => {
    await chooseSpanish(page);
    await page.goto(`${APP_URL}${GROUPS_SCREEN_PATH}`);

    await expect(
      page.getByRole("heading", { level: 1, name: "Grupos" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: SPANISH_GROUPS_HEADING }),
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
const MEMBER_WITHOUT_DATA = {
  userId: "44444444-0000-4000-8000-000000000004",
  fullName: LONG_MEMBER_NAME,
  country: null,
  experienceLevel: null,
  role: "Player",
  position: null,
  status: "active",
  photoUrl: null,
} as const;

/** Una dirección que no existe: la captura la sirve con la foto fija, igual
 * que Storage serviría una dirección firmada. */
const STUBBED_PHOTO_URL = "https://fotos.test/member-photos/mateo.png";
/** La fila que sale con foto en las capturas que la piden (#245). */
const MEMBER_WITH_PHOTO_ID = "22222222-0000-4000-8000-000000000002";

const STUBBED_DIRECTORY_MEMBERS = [
  {
    userId: "11111111-0000-4000-8000-000000000001",
    fullName: "Ana Admin",
    country: "AU",
    experienceLevel: "Advanced",
    role: "Admin",
    position: "Defender",
    status: "active",
    photoUrl: null,
  },
  {
    userId: "22222222-0000-4000-8000-000000000002",
    fullName: "Mateo Restrepo",
    country: "CO",
    experienceLevel: "Advanced",
    role: "Coach",
    position: "Forward",
    status: "active",
    photoUrl: null,
  },
  {
    userId: "33333333-0000-4000-8000-000000000003",
    fullName: "Nerea Ruiz",
    country: "ES",
    experienceLevel: "Beginner",
    role: "Player",
    position: "Goalkeeper",
    status: "active",
    photoUrl: null,
  },
  MEMBER_WITHOUT_DATA,
  {
    userId: "55555555-0000-4000-8000-000000000005",
    fullName: "Zoe Zapata",
    country: "AU",
    experienceLevel: "Intermediate",
    role: "Committee",
    position: "Defender",
    status: "inactive",
    photoUrl: null,
  },
] as const;

/** La única fila con el registro federativo vencido, que es la que la captura
 * del Admin tiene que enseñar señalada (BR-008). Está verificado: vencido y
 * verificado se marcan a la vez (#274). */
const EXPIRED_AUF_MEMBER_ID = "11111111-0000-4000-8000-000000000001";
/** La única fila con un AUF que escribió el socio y nadie ha verificado
 * (#274): así la captura del Admin enseña las tres marcas. */
const UNVERIFIED_AUF_MEMBER_ID = "33333333-0000-4000-8000-000000000003";

function asAdminMember(member: {
  readonly userId: string;
}): Record<string, unknown> {
  const isAufExpired = member.userId === EXPIRED_AUF_MEMBER_ID;
  return {
    ...member,
    aufNumber: `AUF-${member.userId.slice(0, 2)}`,
    aufExpiry: isAufExpired ? "2020-01-31" : "2030-06-30",
    isAufVerified: member.userId !== UNVERIFIED_AUF_MEMBER_ID,
    isAufExpired,
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
  "userId" | "fullName"
> & { readonly userId: string; readonly fullName: string };

/** Lo que el endpoint de #238 hace con la consulta, reducido a lo que estas
 * capturas necesitan distinguir. El orden lo decide el servidor, así que la
 * lista sale en el orden en que está escrita, que ya es el alfabético. */
function stubbedListing(
  searchParams: URLSearchParams,
  options: {
    readonly asAdmin: boolean;
    readonly withPhoto: boolean;
    readonly members: readonly StubbedMember[];
  },
): Record<string, unknown> {
  const { asAdmin } = options;
  const search = searchParams.get("q");
  const role = searchParams.get("role");
  const includeInactive = searchParams.get("includeInactive") === "true";
  const members = options.members.filter(
    (member) =>
      (role === null || member.role === role) &&
      (includeInactive || member.status !== "inactive") &&
      (search === null ||
        normalizeName(member.fullName).includes(normalizeName(search))),
  );
  const listed = members.map((member) =>
    options.withPhoto && member.userId === MEMBER_WITH_PHOTO_ID
      ? { ...member, photoUrl: STUBBED_PHOTO_URL }
      : member,
  );
  return {
    kind: asAdmin ? "admin" : "member",
    members: asAdmin ? listed.map(asAdminMember) : listed,
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
    requestedRole: "Coach",
    justification: LONG_JUSTIFICATION,
    createdAt: "2026-09-17T08:30:00.000Z",
  },
  {
    id: "22222222-0000-4000-8000-0000000000bb",
    userId: MEMBER_WITHOUT_DATA.userId,
    fullName: LONG_MEMBER_NAME,
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
  await page.route(
    (url) => url.pathname === DIRECTORY_ENDPOINT,
    (route, request) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: stubbedListing(new URL(request.url()).searchParams, {
            asAdmin: options.asAdmin,
            withPhoto,
            members: options.members ?? STUBBED_DIRECTORY_MEMBERS,
          }),
        }),
      }),
  );
}

const ENGLISH_DIRECTORY_HEADING = "Club members";
const SPANISH_DIRECTORY_HEADING = "Miembros del club";

/** El título de la bandeja en el idioma de cada lista. */
const TRAY_HEADINGS: Readonly<Record<string, string>> = {
  [ENGLISH_DIRECTORY_HEADING]: "Pending requests",
  [SPANISH_DIRECTORY_HEADING]: "Solicitudes pendientes",
};

const TRAY_LOADING = /Loading the pending requests|Cargando las solicitudes/;

/** La pantalla pide su lista al montarse, y la de un Admin después su
 * bandeja, así que hasta que llegan sólo dicen que están cargando. Sin
 * esperarlas, la captura sale de ese estado. */
async function waitForDirectory(
  page: Page,
  heading: string,
  asAdmin = false,
): Promise<void> {
  await expect(page.getByRole("region", { name: heading })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  if (asAdmin) {
    await expect(
      page.getByRole("region", { name: TRAY_HEADINGS[heading] }),
    ).toBeVisible();
    await expect(page.getByText(TRAY_LOADING)).toHaveCount(0);
  }
}

/** Intenta degradar a la Admin de la lista y espera a que la pantalla explique
 * que no se puede. Lo que responde la base se finge, porque cuántos Admin
 * tiene el club de pruebas depende de qué otros tests estén corriendo. El
 * aviso se busca por su texto: el anunciador de rutas del dev server de Next
 * también lleva `role="alert"`. */
async function refuseLastAdminChange(page: Page): Promise<void> {
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
  await page
    .getByRole("combobox", { name: "Role for Ana Admin" })
    .selectOption("Player");
  await page
    .getByRole("button", { name: "Save the role for Ana Admin" })
    .click();
  await expect(page.getByText(/last Admin/)).toBeVisible();
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

function includeFormerMembers(label: string) {
  return async (page: Page): Promise<void> => {
    await page.getByRole("checkbox", { name: label }).check();
    await expect(page.getByRole("row", { name: "Zoe Zapata" })).toBeVisible();
  };
}

/** La foto de la fila es decorativa (el nombre va al lado), así que se busca
 * por su dirección y no por su nombre accesible. */
async function waitForDirectoryPhoto(page: Page): Promise<void> {
  await expect(
    page.locator(`img[src="${STUBBED_PHOTO_URL}"]`),
  ).toHaveJSProperty("complete", true);
}

type DirectoryState = {
  readonly name: string;
  /** Un Admin recibe la lista marcada como suya, y con ella el control de los
   * dados de baja y la marca del AUF vencido. */
  readonly asAdmin: boolean;
  /** Sólo cuenta para un Admin, que es a quien se le carga la bandeja. */
  readonly withRequests?: boolean;
  /** Una de las filas sale con foto en vez de iniciales (#245). */
  readonly withPhoto?: boolean;
  readonly listHeading: string;
  readonly beforeVisit?: (page: Page) => Promise<void>;
  readonly prepare?: (page: Page) => Promise<void>;
};

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
    prepare: searchFor("zzz", /No member matches/),
  },
  {
    name: "directorio-sin-resultados-es",
    asAdmin: false,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
    prepare: searchFor("zzz", /Nadie del club coincide/),
  },
  {
    name: "directorio-con-inactivos",
    asAdmin: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: includeFormerMembers("Include deactivated accounts"),
  },
  {
    name: "directorio-con-inactivos-es",
    asAdmin: true,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
    prepare: includeFormerMembers("Incluir las cuentas desactivadas"),
  },
  {
    name: "directorio-admin-con-solicitudes",
    asAdmin: true,
    withRequests: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
  },
  {
    name: "directorio-admin-con-solicitudes-es",
    asAdmin: true,
    withRequests: true,
    listHeading: SPANISH_DIRECTORY_HEADING,
    beforeVisit: chooseSpanish,
  },
  {
    name: "directorio-admin-sin-solicitudes",
    asAdmin: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
  },
  {
    name: "directorio-admin-ultimo-admin",
    asAdmin: true,
    listHeading: ENGLISH_DIRECTORY_HEADING,
    prepare: refuseLastAdminChange,
  },
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

/* ---------------------------------------------------------------------------
   El directorio como lista de tarjetas (#283). Por debajo de 768px la tabla
   pierde sus cabeceras y cada socio es una tarjeta con sus datos etiquetados.
   Todo esto vive en la hoja de estilos, así que sólo un navegador lo puede
   probar: el nombre accesible de cada dato con su etiqueta, que ninguna
   palabra se parta, y que el orden sobreviva al cambio de ancho.
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
  options: { readonly asAdmin: boolean },
): Promise<void> {
  await stubDirectoryReads(page, {
    asAdmin: options.asAdmin,
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

function sortOption(page: Page, group: string, option: string): Locator {
  return page
    .getByRole("group", { name: group })
    .locator("label", { hasText: option });
}

function sortRadio(page: Page, group: string, option: string): Locator {
  return page
    .getByRole("group", { name: group })
    .getByRole("radio", { name: option });
}

test.describe("el directorio en pantalla estrecha (#283)", () => {
  skipWithoutSession();
  quietNotificationBell();
  test.use({ storageState: ADMIN_STORAGE_STATE, viewport: NARROW_VIEWPORT });

  test("cada socio es una tarjeta con sus datos etiquetados y sin cabeceras", async ({
    page,
  }) => {
    await goToNarrowDirectory(page, { asAdmin: false });

    const card = page.getByRole("row", { name: "Mateo Restrepo" });
    await expect(page.getByRole("columnheader")).toHaveCount(0);
    await expect(card.getByText("MR")).toBeVisible();
    await expect(card.getByRole("rowheader")).toHaveAccessibleName(
      /Mateo Restrepo\s*Country\s*Colombia\s*Level\s*Advanced/,
    );
    await expect(card.getByRole("cell", { name: "Role Coach" })).toBeVisible();
    await expect(
      card.getByRole("cell", { name: "Position Forward" }),
    ).toBeVisible();
  });

  test("un dato que falta sale con su etiqueta y su guion", async ({
    page,
  }) => {
    await goToNarrowDirectory(page, { asAdmin: false });

    const card = page.getByRole("row", { name: LONG_MEMBER_NAME });
    await expect(card.getByRole("rowheader")).toHaveAccessibleName(
      /Country\s*–\s*Level\s*–/,
    );
    await expect(card.getByRole("cell", { name: "Position –" })).toBeVisible();
  });

  test("ninguna palabra queda partida, tampoco las marcas", async ({
    page,
  }) => {
    await goToNarrowDirectory(page, { asAdmin: true });
    await includeFormerMembers("Include deactivated accounts")(page);
    await expect(page.getByText("Deactivated", { exact: true })).toBeVisible();
    await expect(page.getByText("AUF expired")).toBeVisible();
    await expect(page.getByText("AUF not verified")).toBeVisible();

    expect(await wordsSplitAcrossLines(page)).toEqual([]);
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

  test("se ordena con un control que se ve y se toca", async ({ page }) => {
    await goToNarrowDirectory(page, { asAdmin: false });
    const roleOption = sortOption(page, "Sort by", "Role");
    const box = await roleOption.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);

    const requested = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === DIRECTORY_ENDPOINT &&
        new URL(request.url()).searchParams.get("sort") === "role",
    );
    await roleOption.click();
    await requested;
    await sortOption(page, "Order", "Descending").click();

    await expect(sortRadio(page, "Sort by", "Role")).toBeChecked();
    await expect(sortRadio(page, "Order", "Descending")).toBeChecked();
  });

  test("el orden elegido se conserva al cambiar de ancho, en los dos sentidos", async ({
    page,
  }) => {
    await goToNarrowDirectory(page, { asAdmin: false });
    await sortOption(page, "Sort by", "Position").click();
    await sortOption(page, "Order", "Descending").click();

    await page.setViewportSize(TABLE_VIEWPORT);

    await expect(page.getByRole("group", { name: "Sort by" })).toBeHidden();
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

    await expect(sortRadio(page, "Sort by", "Role")).toBeChecked();
    await expect(sortRadio(page, "Order", "Ascending")).toBeChecked();
  });

  test("un Admin cambia el rol desde la tarjeta con el mismo resultado que en la tabla", async ({
    page,
  }) => {
    await goToNarrowDirectory(page, { asAdmin: true });
    await expect(
      page
        .getByRole("row", { name: "Ana Admin" })
        .getByRole("combobox", { name: "Role for Ana Admin" }),
    ).toBeVisible();

    await refuseLastAdminChange(page);
  });

  test("a 768px sigue siendo la tabla, con sus cabeceras y sin etiquetas", async ({
    page,
  }) => {
    await page.setViewportSize(TABLE_VIEWPORT);
    await goToNarrowDirectory(page, { asAdmin: false });

    await expect(page.getByRole("columnheader")).toHaveCount(3);
    await expect(page.getByRole("group", { name: "Sort by" })).toBeHidden();
    await expect(
      page
        .getByRole("row", { name: "Mateo Restrepo" })
        .getByRole("cell", { name: "Coach", exact: true }),
    ).toBeVisible();
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

    await expect(
      page.getByRole("checkbox", { name: "Include deactivated accounts" }),
    ).toBeVisible();
  });

  test("un Admin ve la bandeja y el control de su propio rol", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);

    await expect(
      page.getByRole("heading", { name: "Pending requests" }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", {
        name: `Role for ${ADMINISTRATION_ADMIN_NAME}`,
      }),
    ).toHaveValue("Admin");
  });

  test("en español, la bandeja sale en español", async ({ page }) => {
    await chooseSpanish(page);
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);

    await expect(
      page.getByRole("heading", { name: "Solicitudes pendientes" }),
    ).toBeVisible();
  });

  test("la ruta vieja de administración lo lleva al directorio", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}/administracion`);

    await expect(page).toHaveURL(new RegExp(`${DIRECTORY_SCREEN_PATH}$`));
    await expect(
      page.getByRole("heading", { name: "Pending requests" }),
    ).toBeVisible();
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

  test("aprobar la saca de la bandeja y deja al miembro con su rol nuevo", async ({
    page,
  }) => {
    // La bandeja se pide aparte, después de la lista. Con la suite entera en
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
      page.getByRole("combobox", { name: `Role for ${DECIDABLE_MEMBER_NAME}` }),
    ).toHaveValue("Committee");
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

  test("no le enseña la bandeja ni el control de rol", async ({ page }) => {
    await page.goto(`${APP_URL}${DIRECTORY_SCREEN_PATH}`);
    await expect(page.getByRole("table")).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Pending requests" }),
    ).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
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

type StubbedMemberRecord = {
  readonly userId: string;
  readonly fullName: string;
  readonly joinedOn: string;
  readonly accountStatus: "incomplete" | "active" | "inactive";
  readonly aufNumber: string;
  readonly aufExpiry: string;
  readonly isAufVerified: boolean;
  readonly dateOfBirth: string;
  readonly registeredAt: string;
  readonly hasGuardianConsent: boolean;
  readonly isAufExpired: boolean;
  readonly groups: readonly { readonly id: string; readonly name: string }[];
};

/** El nombre más largo de la lista, para el caso de contenido largo. */
const CURRENT_RECORD: StubbedMemberRecord = {
  userId: RECORD_MEMBER_ID,
  fullName: LONG_MEMBER_NAME,
  joinedOn: "2024-03-06",
  accountStatus: "active",
  aufNumber: "AUF-2026-0042",
  aufExpiry: "2030-06-30",
  isAufVerified: true,
  dateOfBirth: "1990-05-10",
  registeredAt: "2024-03-06T01:00:00.000Z",
  hasGuardianConsent: false,
  isAufExpired: false,
  groups: [STUBBED_CLUB_GROUPS[0], STUBBED_CLUB_GROUPS[2]].map(
    ({ id, name }) => ({ id, name }),
  ),
};

/** Quien todavía no activó su cuenta: la ficha ofrece reenviar la
 * invitación (#243). */
const PENDING_RECORD: StubbedMemberRecord = {
  ...CURRENT_RECORD,
  accountStatus: "incomplete",
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
  await page.route(
    (url) => url.pathname === CLUB_GROUPS_ENDPOINT,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { groups: STUBBED_CLUB_GROUPS } }),
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
            body: JSON.stringify({ data: record }),
          }),
  );
}

/** Pone un vencimiento anterior al ingreso y guarda: el servidor fingido lo
 * rechaza, y el aviso sale junto al campo. */
function submitExpiryBeforeJoining(saveLabel: string, issueText: RegExp) {
  return async (page: Page): Promise<void> => {
    await page.locator("#ficha-auf-vencimiento").fill("2024-01-15");
    await page.getByRole("button", { name: saveLabel }).click();
    await expect(page.getByText(issueText)).toBeVisible();
  };
}

/** Pone una fecha de nacimiento futura y guarda: el servidor fingido la
 * rechaza, y el aviso sale junto al campo. */
function submitBirthInFuture(saveLabel: string, issueText: RegExp) {
  return async (page: Page): Promise<void> => {
    await page.locator("#ficha-nacimiento").fill("2999-01-01");
    await page.getByRole("button", { name: saveLabel }).click();
    await expect(page.getByText(issueText)).toBeVisible();
  };
}

/** Pone la fecha de un menor sin guardar: la ficha avisa de que el miembro
 * tendrá que dar el consentimiento de su tutor. */
function typeMinorBirth(noticeText: RegExp) {
  return async (page: Page): Promise<void> => {
    await page.locator("#ficha-nacimiento").fill(MINOR_BIRTH);
    await expect(page.getByText(noticeText)).toBeVisible();
  };
}

type MemberRecordState = {
  readonly name: string;
  readonly record: StubbedMemberRecord;
  readonly saveLabel: string;
  readonly saveRejection?: StubbedSaveRejection;
  readonly beforeVisit?: (page: Page) => Promise<void>;
  readonly prepare?: (page: Page) => Promise<void>;
};

const ENGLISH_SAVE_RECORD = "Save the record";
const SPANISH_SAVE_RECORD = "Guardar la ficha";

const MEMBER_RECORD_STATES: readonly MemberRecordState[] = [
  {
    name: "ficha-auf-vigente",
    record: CURRENT_RECORD,
    saveLabel: ENGLISH_SAVE_RECORD,
  },
  {
    name: "ficha-auf-vigente-es",
    record: CURRENT_RECORD,
    saveLabel: SPANISH_SAVE_RECORD,
    beforeVisit: chooseSpanish,
  },
  {
    name: "ficha-auf-vencido",
    record: EXPIRED_RECORD,
    saveLabel: ENGLISH_SAVE_RECORD,
  },
  {
    name: "ficha-auf-vencido-es",
    record: EXPIRED_RECORD,
    saveLabel: SPANISH_SAVE_RECORD,
    beforeVisit: chooseSpanish,
  },
  {
    name: "ficha-auf-sin-verificar",
    record: UNVERIFIED_AUF_RECORD,
    saveLabel: ENGLISH_SAVE_RECORD,
  },
  {
    name: "ficha-auf-sin-verificar-es",
    record: UNVERIFIED_AUF_RECORD,
    saveLabel: SPANISH_SAVE_RECORD,
    beforeVisit: chooseSpanish,
  },
  {
    name: "ficha-invitacion-pendiente",
    record: PENDING_RECORD,
    saveLabel: ENGLISH_SAVE_RECORD,
  },
  {
    name: "ficha-invitacion-pendiente-es",
    record: PENDING_RECORD,
    saveLabel: SPANISH_SAVE_RECORD,
    beforeVisit: chooseSpanish,
  },
  {
    name: "ficha-cuenta-desactivada",
    record: DEACTIVATED_RECORD,
    saveLabel: ENGLISH_SAVE_RECORD,
  },
  {
    name: "ficha-cuenta-desactivada-es",
    record: DEACTIVATED_RECORD,
    saveLabel: SPANISH_SAVE_RECORD,
    beforeVisit: chooseSpanish,
  },
  {
    name: "ficha-aviso-validacion",
    record: CURRENT_RECORD,
    saveLabel: ENGLISH_SAVE_RECORD,
    prepare: submitExpiryBeforeJoining(
      ENGLISH_SAVE_RECORD,
      /can't be before the date they joined/,
    ),
  },
  {
    name: "ficha-aviso-validacion-es",
    record: CURRENT_RECORD,
    saveLabel: SPANISH_SAVE_RECORD,
    beforeVisit: chooseSpanish,
    prepare: submitExpiryBeforeJoining(
      SPANISH_SAVE_RECORD,
      /no puede ser anterior a su fecha de ingreso/,
    ),
  },
  {
    name: "ficha-nacimiento-aviso-validacion",
    record: CURRENT_RECORD,
    saveLabel: ENGLISH_SAVE_RECORD,
    saveRejection: BIRTH_IN_FUTURE_ERROR,
    prepare: submitBirthInFuture(
      ENGLISH_SAVE_RECORD,
      /Date of birth can't be in the future/,
    ),
  },
  {
    name: "ficha-nacimiento-aviso-validacion-es",
    record: CURRENT_RECORD,
    saveLabel: SPANISH_SAVE_RECORD,
    saveRejection: BIRTH_IN_FUTURE_ERROR,
    beforeVisit: chooseSpanish,
    prepare: submitBirthInFuture(
      SPANISH_SAVE_RECORD,
      /La fecha de nacimiento no puede estar en el futuro/,
    ),
  },
  {
    name: "ficha-nacimiento-aviso-tutor",
    record: CURRENT_RECORD,
    saveLabel: ENGLISH_SAVE_RECORD,
    prepare: typeMinorBirth(/will have to give a guardian's details/),
  },
  {
    name: "ficha-nacimiento-aviso-tutor-es",
    record: CURRENT_RECORD,
    saveLabel: SPANISH_SAVE_RECORD,
    beforeVisit: chooseSpanish,
    prepare: typeMinorBirth(/tendrá que dar los datos y el consentimiento/),
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
  await expect(
    page.getByRole("button", { name: state.saveLabel }),
  ).toBeVisible();
  await state.prepare?.(page);
}

for (const state of MEMBER_RECORD_STATES) {
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
              await goToMemberRecord(page, state, theme);
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
      await goToMemberRecord(page, state);
      await expectNoAxeViolations(page);
    });
  });
}

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
    await page.getByLabel("AUF number").fill(aufNumber);
    await page.getByLabel("Expiry date").fill("2099-12-31");
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("/record") &&
        response.request().method() === "PATCH",
      { timeout: ACCOUNT_CHANGE_TIMEOUT_MS },
    );
    await page.getByRole("button", { name: ENGLISH_SAVE_RECORD }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByText("Record saved.")).toBeVisible();

    await page.getByRole("link", { name: /Back to the directory/ }).click();
    await expect(
      page
        .getByRole("row", { name: ADMINISTRATION_ADMIN_NAME })
        .getByText(`AUF ${aufNumber} · expires 31 December 2099`),
    ).toBeVisible();

    // Deja la fila como estaba: sin número, que borra también el vencimiento.
    await openOwnRecordLink(page).click();
    await page.getByLabel("AUF number").fill("");
    await page.getByRole("button", { name: ENGLISH_SAVE_RECORD }).click();
    await expect(page.getByText("Record saved.")).toBeVisible();
    await expect(page.getByLabel("Expiry date")).toHaveValue("");
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
  await page.getByLabel(copy.position).selectOption("Forward");
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

function fakeNotificationId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const SAMPLE_NOTIFICATIONS: readonly FakeNotification[] = [
  {
    id: fakeNotificationId(1),
    type: "role_request_received",
    data: { requesterName: "Nerea Ruiz", requestedRole: "Coach" },
    createdAt: hoursAgo(2),
    isRead: false,
  },
  {
    id: fakeNotificationId(2),
    type: "role_changed",
    data: { newRole: "Committee" },
    createdAt: hoursAgo(5),
    isRead: false,
  },
  {
    id: fakeNotificationId(3),
    type: "role_request_rejected",
    data: { requestedRole: "Coach" },
    createdAt: hoursAgo(26),
    isRead: false,
  },
  {
    id: fakeNotificationId(4),
    type: "role_changed",
    data: { newRole: "Player" },
    createdAt: hoursAgo(24 * 9),
    isRead: true,
  },
];

function unreadOnly(count: number): readonly FakeNotification[] {
  return Array.from({ length: count }, (_, index) => ({
    id: fakeNotificationId(index + 1),
    type: "role_changed",
    data: { newRole: "Coach" },
    createdAt: hoursAgo(index + 1),
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
          const header = page.locator(".app-sidebar-header");
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

  // La barra lateral mide 240px: la campana y el botón de la cuenta (#287)
  // caben en ella en una sola fila, sin salirse.
  for (const width of [768, 1440]) {
    test(`los controles de la cabecera caben en una fila de la barra lateral a ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${APP_URL}${NOTIFICATIONS_SCREEN_PATH}`);

      const sidebar = await page.locator(".app-sidebar").boundingBox();
      const bell = await page
        .getByRole("button", { name: BELL_NAME })
        .boundingBox();
      const account = await page
        .getByRole("button", { name: ACCOUNT_BUTTON_NAME })
        .boundingBox();
      if (sidebar === null || bell === null || account === null) {
        throw new Error("la barra lateral no dibujó sus controles");
      }

      expect(
        Math.round(account.y),
        "los controles se parten en dos filas",
      ).toBe(Math.round(bell.y));
      expect(account.x + account.width).toBeLessThanOrEqual(
        sidebar.x + sidebar.width,
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
    const controlsInList = await notificationsRegion(page)
      .getByRole("button")
      .count();

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

    await expect(menu.getByRole("listitem")).toHaveText([
      /My profile/,
      /Appearance/,
      /Language/,
      /Sign out/,
    ]);
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
    const controlsInMenu =
      (await menu.getByRole("button").count()) +
      (await menu.getByRole("link").count());

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

    await menu.getByRole("button", { name: /dark theme/i }).click();

    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(accountMenu(page)).toBeVisible();
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    const reopened = await openAccountMenu(page);
    await expect(
      reopened.getByRole("button", { name: /light theme/i }),
    ).toBeVisible();
  });

  test("el idioma cambia toda la aplicación, el propio menú incluido, y se conserva al recargar", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}/dashboard`);
    const menu = await openAccountMenu(page);

    await menu.getByRole("button", { name: /switch to español/i }).click();

    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(accountMenu(page)).toBeVisible();
    await expect(
      accountMenu(page).getByRole("link", { name: "Mi perfil" }),
    ).toBeVisible();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    const reopened = await openAccountMenu(page);
    await expect(
      reopened.getByRole("button", { name: /cambiar a english/i }),
    ).toBeVisible();
  });
});
