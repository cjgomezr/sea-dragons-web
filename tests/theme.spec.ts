/**
 * FR-079: the theme choice must survive a reload. The visual baselines in
 * ui.spec.ts only ever photograph the light theme, so persistence needs its
 * own end-to-end check against a real browser and real localStorage.
 */
import { expect, test } from "@playwright/test";

const APP_URL = process.env.APP_URL ?? "http://localhost:3417";

test("keeps the chosen theme after a reload", async ({ page }) => {
  await page.goto(APP_URL);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: /tema oscuro/i }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.reload();

  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: /tema claro/i })).toBeVisible();
});

test("serves the versioned health endpoint", async ({ request }) => {
  const response = await request.get(`${APP_URL}/api/v1/health`);
  const body = await response.json();

  // 503 without Supabase credentials is the honest answer, not a failure.
  expect([200, 503]).toContain(response.status());
  expect(body).toMatchObject({ database: expect.any(String), status: expect.any(String) });
});
