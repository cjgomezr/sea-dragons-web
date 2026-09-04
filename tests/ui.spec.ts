/**
 * Visual regression + accessibility gate.
 *
 * - toHaveScreenshot() compares pixel-by-pixel against an approved baseline.
 *   First run (or after ui-reviewer says BASELINE-READY) generate baselines:
 *     npx playwright test --update-snapshots
 *   From then on, any visual drift fails the build, and the Stop hook
 *   blocks Claude from finishing until it's fixed or the baseline is
 *   intentionally re-approved by a human.
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

for (const vp of viewports) {
  test.describe(`home @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("matches approved baseline", async ({ page }) => {
      await page.goto(APP_URL);
      // networkidle nunca llega mientras el dev server compila bajo carga paralela.
      // Lo que de verdad mueve píxeles son las fuentes, y toHaveScreenshot ya
      // reintenta hasta que la página deja de cambiar.
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await expect(page).toHaveScreenshot(`home-${vp.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      });
    });

    test("has no horizontal scroll", async ({ page }) => {
      await page.goto(APP_URL);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(overflow, `horizontal overflow at ${vp.width}px`).toBe(false);
    });
  });
}

test("has no accessibility violations (axe-core)", async ({ page }) => {
  await page.goto(APP_URL);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});
