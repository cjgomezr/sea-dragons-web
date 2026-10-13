import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import playwrightConfig from "../../../playwright.config";
import { isVisualChange } from "../../support/playwright-image-comparator";
import {
  PAGE_MAX_DIFF_PIXELS,
  SCREENSHOT_COLOR_THRESHOLD,
} from "../../support/screenshot-tolerance";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const UI_SPEC_PATH = path.join(REPO_ROOT, "tests/ui.spec.ts");

// La tolerancia que Playwright aplica cuando nadie fija otra.
const PLAYWRIGHT_DEFAULT_THRESHOLD = 0.2;

// La tolerancia se elige con dos decimales: el escalón siguiente al elegido.
const THRESHOLD_STEP = 0.01;

/**
 * Los tokens del #590 tal como estaban al cambiar la etiqueta Document. Se
 * fijan aquí, y no se leen de globals.css, porque el test guarda un caso
 * histórico: el cambio que la visual dejó pasar en el PR #605.
 */
const THEMES = [
  {
    name: "claro",
    accent: "#1c6ea4",
    success: "#2e9e86",
    panel: "#ffffff",
    text: "#10202e",
  },
  {
    name: "oscuro",
    accent: "#33a1e0",
    success: "#6fd6b4",
    panel: "#13283a",
    text: "#e6eef5",
  },
] as const;

type Theme = (typeof THEMES)[number];

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 120, height: 40 } });
}, 30_000);

afterAll(async () => {
  await browser.close();
}, 30_000);

/** La etiqueta Document sobre el panel, con el fondo que se le pase. Mismas
 * medidas que `.news-category` en globals.css. */
async function paintDocumentLabel(
  theme: Theme,
  background: string,
): Promise<Buffer> {
  await page.setContent(`
    <body style="margin:0;padding:8px;background:${theme.panel}">
      <span style="display:inline-block;padding:2px 8px;font:700 12px sans-serif;
        border-radius:6px;color:${theme.text};background:${background}">
        Document
      </span>
    </body>`);
  return page.screenshot({ animations: "disabled", caret: "hide" });
}

function newsBackground(theme: Theme): string {
  return `color-mix(in srgb, ${theme.accent} 16%, ${theme.panel})`;
}

function documentBackground(theme: Theme): string {
  return `color-mix(in srgb, ${theme.success} 22%, ${theme.panel})`;
}

describe("la tolerancia de color de la visual (#606)", () => {
  it("la aplica playwright.config.ts a todas las capturas", () => {
    expect(playwrightConfig.expect?.toHaveScreenshot?.threshold).toBe(
      SCREENSHOT_COLOR_THRESHOLD,
    );
  });

  it("es más estricta que el 0,2 por defecto de Playwright", () => {
    expect(SCREENSHOT_COLOR_THRESHOLD).toBeLessThan(
      PLAYWRIGHT_DEFAULT_THRESHOLD,
    );
  });

  it("ninguna llamada de ui.spec.ts se la salta con su propio threshold", () => {
    const source = readFileSync(UI_SPEC_PATH, "utf8");

    expect(source).not.toMatch(/\bthreshold\s*:/);
  });

  it("es la más alta que lo ve: un escalón más y el tema claro lo pierde", async () => {
    const [light] = THEMES;
    const before = await paintDocumentLabel(light, newsBackground(light));
    const after = await paintDocumentLabel(light, documentBackground(light));

    const changed = isVisualChange(before, after, {
      threshold: SCREENSHOT_COLOR_THRESHOLD + THRESHOLD_STEP,
      maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
    });

    expect(changed).toBe(false);
  });

  for (const theme of THEMES) {
    describe(`la etiqueta Document en tema ${theme.name}`, () => {
      it("detecta el paso del acento al verde con la tolerancia elegida", async () => {
        const before = await paintDocumentLabel(theme, newsBackground(theme));
        const after = await paintDocumentLabel(
          theme,
          documentBackground(theme),
        );

        const changed = isVisualChange(before, after, {
          threshold: SCREENSHOT_COLOR_THRESHOLD,
          maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
        });

        expect(changed).toBe(true);
      });

      it("no lo detectaba con el 0,2 por defecto", async () => {
        const before = await paintDocumentLabel(theme, newsBackground(theme));
        const after = await paintDocumentLabel(
          theme,
          documentBackground(theme),
        );

        const changed = isVisualChange(before, after, {
          threshold: PLAYWRIGHT_DEFAULT_THRESHOLD,
          maxDiffPixels: PAGE_MAX_DIFF_PIXELS,
        });

        expect(changed).toBe(false);
      });

      it("no ve cambio en la etiqueta News contra sí misma", async () => {
        const first = await paintDocumentLabel(theme, newsBackground(theme));
        const second = await paintDocumentLabel(theme, newsBackground(theme));

        const changed = isVisualChange(first, second, {
          threshold: SCREENSHOT_COLOR_THRESHOLD,
          maxDiffPixels: 0,
        });

        expect(changed).toBe(false);
      });
    });
  }
});
