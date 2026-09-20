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
  type Page,
  type PageScreenshotOptions,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ADMINISTRATION_ADMIN_NAME,
  DECIDABLE_MEMBER_NAME,
  E2E_STORAGE_STATE_PATH,
  GROUPED_MEMBER_GROUP_NAMES,
  GROUPED_MEMBER_STORAGE_STATE_PATH,
  PHOTOGRAPHED_MEMBERS,
  incompleteStorageStatePath,
  readE2eSessionState,
  roleRequestStorageStatePath,
} from "./support/e2e-session";
import { shouldCreateMissingSnapshot } from "./support/missing-snapshot-policy";
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

async function goToWithTheme(
  page: import("@playwright/test").Page,
  path: string,
  theme: (typeof themes)[number],
): Promise<void> {
  await page.goto(`${APP_URL}${path}`);
  await page.addStyleTag({ content: HIDE_DEV_OVERLAY_CSS });
  if (theme === "dark") {
    await page.getByRole("button", { name: /tema oscuro|dark theme/i }).click();
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

  describeTogglesCorner({ name: "panel", path: "/dashboard" });

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
    // The extra presses cover what precedes the nav: the theme toggle, the
    // language toggle and sign out, plus one to spare.
    for (let press = 0; press < expectedOrder.length + 4; press += 1) {
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
     siembra el arranque para la pantalla de administración. Committee ve lo
     mismo que Player y Coach lo mismo que Admin sin Administración: los
     unitarios cubren los cuatro, aquí se fotografían los dos extremos.
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

      test("the sidebar offers every section and Administration", async ({
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
          "Administration",
        ]);
        await expect(
          sidebar.getByRole("link", { name: "Administration" }),
        ).toHaveAttribute("href", "/administracion");
        await expect(
          sidebar.getByRole("link", { name: "Groups" }),
        ).toHaveAttribute("href", "/grupos");
      });

      test("the tab bar keeps the Coach tabs and adds Administration behind More", async ({
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
          "Evaluations",
          "Payments",
          "Groups",
          "Administration",
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

  test("cerrar sesión desde cualquier pantalla aterriza en la entrada", async ({
    page,
    context,
  }) => {
    await openOwnSession(page, context);
    await page.setViewportSize(DESKTOP);
    await page.goto(`${APP_URL}/calendario`);

    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL(new RegExp(`${SIGN_IN_PATH}$`));
  });

  test("tras cerrar sesión, la aplicación vuelve a estar cerrada", async ({
    page,
    context,
  }) => {
    await openOwnSession(page, context);
    await page.setViewportSize(DESKTOP);
    await page.goto(`${APP_URL}/dashboard`);
    await page.getByRole("button", { name: "Sign out" }).click();
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
    await primera.getByRole("button", { name: "Sign out" }).click();
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
  for (const restrictedPath of [
    "/equipos",
    "/evaluaciones",
    "/administracion",
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
};

async function writeTooLongJustification(page: Page): Promise<void> {
  await page
    .getByLabel("Why do you want this role? (optional)")
    .fill(TOO_LONG_JUSTIFICATION);
  await expect(page.getByText(/can be at most 500 characters/)).toBeVisible();
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

for (const state of ACCOUNT_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    test.use({ storageState: state.storageState });

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

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

  test("llega desde el enlace de la cabecera", async ({ page }) => {
    await page.goto(`${APP_URL}/calendario`);

    await page.getByRole("link", { name: "My account" }).click();

    await expect(page).toHaveURL(new RegExp(`${ACCOUNT_PATH}$`));
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

  // El nombre del club y los cuatro controles viven en la misma fila del
  // móvil. A 360 y 375 tienen que caber sin partirla ni tapar el nombre.
  for (const width of [360, 375]) {
    test(`la cabecera cabe en una fila a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${APP_URL}${ACCOUNT_PATH}`);

      const brand = await page.locator(".app-brand").boundingBox();
      const controlBoxes = await Promise.all(
        [
          page.getByRole("button", { name: /theme/i }),
          page.getByRole("button", { name: /español/i }),
          page.getByRole("link", { name: "My account" }),
          page.getByRole("button", { name: "Sign out" }),
        ].map((control) => control.boundingBox()),
      );
      const boxes = controlBoxes.flatMap((box) => (box === null ? [] : [box]));
      if (brand === null || boxes.length !== controlBoxes.length) {
        throw new Error("la cabecera no dibujó el nombre o algún control");
      }

      const tops = new Set(boxes.map((box) => Math.round(box.y)));
      expect(tops.size, "los cuatro controles no están en una fila").toBe(1);
      const firstControlLeft = Math.min(...boxes.map((box) => box.x));
      expect(
        brand.x + brand.width,
        "el nombre del club queda tapado por los controles",
      ).toBeLessThanOrEqual(firstControlLeft);
    });
  }
});

test.describe("Mi cuenta con grupos", () => {
  skipWithoutSession();
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

test.describe("Mi cuenta con una solicitud pendiente", () => {
  skipWithoutSession();
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
   La pantalla de administración (#212). La fila de socio se revisa contra
   docs/mockups/directory-light.png; la bandeja, contra design-system.md.

   Las capturas leen datos fijos, servidos por `page.route`: la bandeja y la
   lista enseñan TODO el club, así que en el club compartido de la suite una
   captura cambiaría con cada socio que cualquier otro test creara. Lo que los
   endpoints de verdad responden se prueba aparte, en esta misma sección, con
   la sesión del Admin sembrado.
   --------------------------------------------------------------------------- */

const ADMINISTRATION_PATH = "/administracion";
const MEMBERS_ENDPOINT = "/api/v1/members";
const PENDING_REQUESTS_ENDPOINT = "/api/v1/role-requests";
const ADMIN_STORAGE_STATE = roleRequestStorageStatePath(
  "admin-de-administracion",
);

/** Tres veces el largo de una nota normal, para el caso de contenido largo de
 * design-system.md y el criterio de los 375px del ticket. */
const LONG_JUSTIFICATION =
  "Llevo tres temporadas entrenando al grupo de juveniles los jueves y también los sábados por la mañana cuando hay torneo, y me gustaría poder cargar las alineaciones y las asistencias sin pedírselo cada vez a alguien del comité.";

const STUBBED_MEMBERS = [
  {
    userId: "aaaaaaaa-0000-4000-8000-00000000000a",
    fullName: "Ana Admin",
    email: "ana.admin@example.test",
    role: "Admin",
  },
  {
    userId: "bbbbbbbb-0000-4000-8000-00000000000b",
    fullName: "Nerea Ruiz",
    email: "nerea.ruiz@example.test",
    role: "Player",
  },
  {
    userId: "cccccccc-0000-4000-8000-00000000000c",
    fullName: "Tomás Errekondo Aranburu",
    email: "tomas.errekondo.aranburu@example.test",
    role: "Coach",
  },
];

const STUBBED_REQUESTS = [
  {
    id: "11111111-0000-4000-8000-000000000001",
    userId: STUBBED_MEMBERS[1]?.userId,
    fullName: "Nerea Ruiz",
    requestedRole: "Coach",
    justification: LONG_JUSTIFICATION,
    createdAt: "2026-09-17T08:30:00.000Z",
  },
  {
    id: "22222222-0000-4000-8000-000000000002",
    userId: STUBBED_MEMBERS[2]?.userId,
    fullName: "Tomás Errekondo Aranburu",
    requestedRole: "Committee",
    justification: null,
    createdAt: "2026-09-18T02:00:00.000Z",
  },
];

/** Las dos lecturas, con datos fijos. Registradas antes de navegar, para que
 * la pantalla no llegue a ver las de verdad. */
async function stubAdministrationReads(
  page: Page,
  options: { readonly withRequests: boolean },
): Promise<void> {
  await page.route(
    (url) => url.pathname === MEMBERS_ENDPOINT,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { members: STUBBED_MEMBERS } }),
      }),
  );
  await page.route(
    (url) => url.pathname === PENDING_REQUESTS_ENDPOINT,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { requests: options.withRequests ? STUBBED_REQUESTS : [] },
        }),
      }),
  );
}

/** Lo que responde la base cuando alguien intenta degradar al último Admin del
 * club (#211). Aquí se finge porque cuántos Admin tiene el club de pruebas
 * depende de qué otros tests estén corriendo. */
async function stubLastAdminRefusal(page: Page): Promise<void> {
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
}

/** La pantalla pide sus dos listas al montarse, así que hasta que llegan sólo
 * enseña que está cargando. Sin esperarlas, una captura sale del estado de
 * carga y la comparación de un instante después, de la pantalla ya llena. */
async function waitForAdministration(
  page: Page,
  heading: string,
): Promise<void> {
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
}

/** Intenta degradar al Admin de la lista y espera a que la pantalla explique
 * que no se puede. El aviso se busca por su texto: el anunciador de rutas del
 * dev server de Next también lleva `role="alert"`. */
async function refuseLastAdminChange(page: Page): Promise<void> {
  await stubLastAdminRefusal(page);
  await page
    .getByRole("combobox", { name: "Role for Ana Admin" })
    .selectOption("Player");
  await page
    .getByRole("button", { name: "Save the role for Ana Admin" })
    .click();
  await expect(page.getByText(/last Admin/)).toBeVisible();
}

type AdministrationState = {
  readonly name: string;
  readonly withRequests: boolean;
  readonly prepare?: (page: Page) => Promise<void>;
};

const ADMINISTRATION_STATES: readonly AdministrationState[] = [
  { name: "administracion-con-solicitudes", withRequests: true },
  { name: "administracion-sin-solicitudes", withRequests: false },
  {
    name: "administracion-ultimo-admin",
    withRequests: false,
    prepare: refuseLastAdminChange,
  },
];

for (const state of ADMINISTRATION_STATES) {
  test.describe(state.name, () => {
    skipWithoutSession();
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        for (const theme of themes) {
          test(`matches approved baseline (${theme})`, async ({ page }) => {
            await stubAdministrationReads(page, state);
            await goToWithTheme(page, ADMINISTRATION_PATH, theme);
            await waitForAdministration(page, "Club members");
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

        test("has no horizontal scroll", async ({ page }) => {
          await stubAdministrationReads(page, state);
          await page.goto(`${APP_URL}${ADMINISTRATION_PATH}`);
          await waitForAdministration(page, "Club members");
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
      await stubAdministrationReads(page, state);
      await page.goto(`${APP_URL}${ADMINISTRATION_PATH}`);
      await waitForAdministration(page, "Club members");
      await state.prepare?.(page);
      await expectNoAxeViolations(page);
    });

    // Como `expectNoAxeViolationsInSpanish`, pero esperando a que las listas
    // lleguen: en la pantalla de carga no hay casi nada que axe pueda revisar.
    test("en español: has no accessibility violations (axe-core)", async ({
      page,
    }) => {
      await stubAdministrationReads(page, state);
      await chooseSpanish(page);
      await page.goto(`${APP_URL}${ADMINISTRATION_PATH}`);
      await expect(page.locator("html")).toHaveAttribute("lang", "es");
      await waitForAdministration(page, "Miembros del club");
      await expectNoAxeViolations(page);
    });
  });
}

test.describe("la pantalla de administración con los datos de verdad", () => {
  skipWithoutSession();
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("un Admin ve la bandeja y a los socios de su club", async ({ page }) => {
    await page.goto(`${APP_URL}${ADMINISTRATION_PATH}`);

    await expect(
      page.getByRole("heading", { name: "Pending requests" }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", {
        name: `Role for ${ADMINISTRATION_ADMIN_NAME}`,
      }),
    ).toHaveValue("Admin");
  });

  test("en español, la pantalla sale en español", async ({ page }) => {
    await chooseSpanish(page);
    await page.goto(`${APP_URL}${ADMINISTRATION_PATH}`);

    await expect(
      page.getByRole("heading", { name: "Solicitudes pendientes" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Miembros del club" }),
    ).toBeVisible();
  });

  test("las dos lecturas responden 200 a un Admin", async ({ request }) => {
    const members = await request.get(`${APP_URL}${MEMBERS_ENDPOINT}`);
    const pending = await request.get(
      `${APP_URL}${PENDING_REQUESTS_ENDPOINT}?status=pending`,
    );

    expect(members.status()).toBe(200);
    expect(pending.status()).toBe(200);
  });
});

test.describe("un Player frente a la pantalla de administración", () => {
  skipWithoutSession();
  test.use({ storageState: E2E_STORAGE_STATE_PATH });

  test("aterriza en el panel al pedirla", async ({ page }) => {
    await page.goto(`${APP_URL}${ADMINISTRATION_PATH}`);

    await expect(page).toHaveURL(new RegExp("/dashboard$"));
  });

  test("las dos lecturas le responden 403", async ({ request }) => {
    const members = await request.get(`${APP_URL}${MEMBERS_ENDPOINT}`);
    const pending = await request.get(
      `${APP_URL}${PENDING_REQUESTS_ENDPOINT}?status=pending`,
    );

    expect(members.status()).toBe(403);
    expect(pending.status()).toBe(403);
  });
});

test.describe("un Admin que decide una solicitud desde la bandeja", () => {
  skipWithoutSession();
  test.use({ storageState: ADMIN_STORAGE_STATE });
  // Sin reintentos: el primer intento ya aprueba la solicitud, y el segundo
  // encontraría la bandeja sin ella y taparía por qué falló el primero.
  test.describe.configure({
    retries: 0,
    timeout: ACCOUNT_CHANGE_TEST_TIMEOUT_MS,
  });

  test("aprobar la saca de la bandeja y deja al socio con su rol nuevo", async ({
    page,
  }) => {
    await page.goto(`${APP_URL}${ADMINISTRATION_PATH}`);
    const approve = page.getByRole("button", {
      name: `Approve the request from ${DECIDABLE_MEMBER_NAME}`,
    });
    await expect(approve).toBeVisible();

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

/* ---------------------------------------------------------------------------
   La sección Grupos (#228). Sin mockup propio: se revisa contra
   design-system.md, y la fila de socio del panel contra
   docs/mockups/directory-light.png, como la pantalla de administración.

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
    test.use({ storageState: ADMIN_STORAGE_STATE });

    for (const vp of viewports) {
      test.describe(`@ ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

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
