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

// #77: medido comparando la misma rama sin cambios dos veces en CI (Linux),
// contra la línea base ya aceptada, con tolerancia puesta a cero para que
// cualquier diferencia real de renderizado quedara expuesta en el reporte.
// Ver el PR de este ticket para las corridas exactas y los píxeles medidos
// en cada caso. Es un presupuesto ABSOLUTO a propósito: uno por ratio crece
// con el alto de la página y es la causa raíz del punto ciego (#77).
// TEMPORAL: en cero a propósito para esta medición. No mergear.
const PAGE_MAX_DIFF_PIXELS = 0;
const COMPONENT_MAX_DIFF_PIXELS = 0;

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
          await page.goto(`${APP_URL}${pg.path}`);
          if (theme === "dark") {
            await page.getByRole("button", { name: /tema oscuro/i }).click();
          }
          // networkidle nunca llega mientras el dev server compila bajo carga paralela.
          // Lo que de verdad mueve píxeles son las fuentes, y toHaveScreenshot ya
          // reintenta hasta que la página deja de cambiar.
          await page.evaluate(async () => {
            await document.fonts.ready;
          });
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

// Matches --touch-target-min in globals.css (WCAG 2.5.5).
const TOUCH_TARGET_MIN_PX = 44;

// The shell renders both navs and lets CSS pick one, so every assertion is
// scoped to the nav that the viewport actually shows.
const SIDEBAR_NAV = "Principal";
const TAB_BAR = "Secciones";

async function goToWithTheme(
  page: import("@playwright/test").Page,
  path: string,
  theme: (typeof themes)[number],
): Promise<void> {
  await page.goto(`${APP_URL}${path}`);
  if (theme === "dark") {
    await page.getByRole("button", { name: /tema oscuro/i }).click();
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

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
  // The tab bar is a thin fixed strip: a fraction of the viewport, not most of it.
  expect(box!.height).toBeLessThan(MOBILE.height * 0.2);
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
  // The sidebar is a narrow column: a fraction of the viewport, not most of it.
  expect(box!.width).toBeLessThan(DESKTOP.width * 0.3);
});

test("the page screenshot still spans well beyond the tab bar component", async ({
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
  // A correct tab bar inside a broken layout must still be caught: the page
  // capture covers far more surface than the component capture alone.
  expect(pageHeight).toBeGreaterThan(tabBarBox!.height * 2);
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
  await expect(current).toHaveText("Calendario");
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
