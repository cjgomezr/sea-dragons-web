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
 *   wired as globalSetup in playwright.config.ts).
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
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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

async function goToWithTheme(
  page: import("@playwright/test").Page,
  path: string,
  theme: (typeof themes)[number],
): Promise<void> {
  await page.goto(`${APP_URL}${path}`);
  if (theme === "dark") {
    await page.getByRole("button", { name: /tema oscuro/i }).click();
  }
  // networkidle nunca llega mientras el dev server compila bajo carga paralela.
  // Lo que de verdad mueve píxeles son las fuentes, y toHaveScreenshot ya
  // reintenta hasta que la página deja de cambiar.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

// "home" is the pre-existing landing page; "section" is a destination route
// off the sidebar menu, standing in for any of the seven (they share the
// same shell and SectionPlaceholder).
const pages = [
  { name: "home", path: "/" },
  { name: "section", path: "/calendario" },
] as const;

for (const pg of pages) {
  for (const vp of viewports) {
    test.describe(`${pg.name} @ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const theme of themes) {
        test(`matches approved baseline (${theme})`, async ({ page }) => {
          await goToWithTheme(page, pg.path, theme);
          await expect(page).toHaveScreenshot(
            `${pg.name}-${vp.name}-${theme}.png`,
            {
              fullPage: true,
              maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
            },
          );
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
// scoped to the nav that the viewport actually shows.
const SIDEBAR_NAV = "Principal";
const TAB_BAR = "Secciones";

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
    await expect(
      page.getByRole("navigation", { name: TAB_BAR }),
    ).toHaveScreenshot(`tabbar-mobile-${theme}.png`, {
      maxDiffPixels: COMPONENT_MAX_DIFF_PIXELS,
    });
  });

  test(`desktop nav matches approved baseline (${theme})`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToWithTheme(page, "/dashboard", theme);
    await expect(
      page.getByRole("navigation", { name: SIDEBAR_NAV }),
    ).toHaveScreenshot(`nav-desktop-${theme}.png`, {
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

test("marks the active section in the sidebar nav", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(`${APP_URL}/calendario`);
  const current = page
    .getByRole("navigation", { name: SIDEBAR_NAV })
    .locator('[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("Calendario");
});

test("marks the active section in the mobile tab bar", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto(`${APP_URL}/calendario`);
  const current = page
    .getByRole("navigation", { name: TAB_BAR })
    .locator('[aria-current="page"]');
  await expect(current).toHaveCount(1);
  // "Agenda" en móvil, "Calendario" en el sidebar: el test de arriba fija esa
  // otra mitad, así que acortar la etiqueta móvil no puede colarse en ambas.
  await expect(current).toHaveText("Agenda");
});

test("desktop shows the sidebar nav and not the tab bar", async ({ page }) => {
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

test("mobile keeps the overflow sections behind the More tab", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE);
  await page.goto(`${APP_URL}/dashboard`);
  const tabBar = page.getByRole("navigation", { name: TAB_BAR });

  await expect(tabBar.getByRole("link", { name: "Pagos" })).toBeHidden();
  await tabBar.getByRole("button", { name: "Más" }).click();
  await expect(tabBar.getByRole("link", { name: "Pagos" })).toBeVisible();
});

test("mobile tabs keep the 44px touch target after adding icons", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE);
  await page.goto(`${APP_URL}/dashboard`);
  const tabBar = page.getByRole("navigation", { name: TAB_BAR });

  const tabs = await tabBar.getByRole("link").all();
  const moreButton = tabBar.getByRole("button", { name: "Más" });

  for (const tab of [...tabs, moreButton]) {
    const box = await tab.boundingBox();
    expect(box, "tab has no layout box").not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
  }
});

test("mobile tabs keep the 44px touch target at 360px (ASS-004 minimum)", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE_MIN_WIDTH);
  await page.goto(`${APP_URL}/dashboard`);
  const tabBar = page.getByRole("navigation", { name: TAB_BAR });

  const tabs = await tabBar.getByRole("link").all();
  const moreButton = tabBar.getByRole("button", { name: "Más" });

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
test("no mobile tab label wraps to a second line at 375px", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE);
  await page.goto(`${APP_URL}/dashboard`);

  expectEverySingleLine(await getTabLabelLineMetrics(page));
});

test("no mobile tab label wraps to a second line at 360px (ASS-004 minimum)", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE_MIN_WIDTH);
  await page.goto(`${APP_URL}/dashboard`);

  expectEverySingleLine(await getTabLabelLineMetrics(page));
});

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

  const expectedOrder = [
    "Dashboard",
    "Directorio",
    "Calendario",
    "Equipos",
    "Evaluaciones",
    "Noticias",
    "Pagos",
  ];

  const reachedByTabbing: string[] = [];
  const outlineWidths: number[] = [];
  // One extra press covers whatever precedes the nav (the theme toggle).
  for (let press = 0; press < expectedOrder.length + 3; press += 1) {
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

test("every mobile tab label keeps room to spare inside its tab at 360px", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE_MIN_WIDTH);
  await page.goto(`${APP_URL}/dashboard`);

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
  const tooWide = usage.filter(({ ratio }) => ratio > MAX_LABEL_WIDTH_RATIO);
  expect(
    tooWide.map(({ label, ratio }) => `${label} (${Math.round(ratio * 100)}%)`),
    `estas etiquetas pasan del ${MAX_LABEL_WIDTH_RATIO * 100}% de su pestaña y se partirán con una fuente algo más ancha`,
  ).toEqual([]);
});
