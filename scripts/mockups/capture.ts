import type { Page } from "@playwright/test";
import type { ScreenAction } from "./catalog.ts";

export async function applyScreenAction(
  page: Page,
  action: ScreenAction,
): Promise<void> {
  switch (action.type) {
    case "web-nav":
      await page
        .getByRole("button", { name: action.label, exact: true })
        .click();
      return;
    case "web-sign-out":
      await page.locator('[title="Sign out"]').click();
      return;
    case "mobile-tab":
      await page
        .getByRole("button", { name: action.label, exact: true })
        .click();
      return;
  }
}
