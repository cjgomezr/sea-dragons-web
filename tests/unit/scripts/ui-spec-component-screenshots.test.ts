import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const UI_SPEC_PATH = path.join(REPO_ROOT, "tests/ui.spec.ts");

function uiSpecSource(): string {
  return readFileSync(UI_SPEC_PATH, "utf8");
}

/**
 * #77: una captura fullPage de 375px de alto reparte el cambio de un
 * componente pequeño (la barra de pestañas) entre miles de píxeles de
 * página, así que cabe holgadamente bajo un presupuesto por RATIO. Cuanto
 * más larga la página, más grande el punto ciego. maxDiffPixels (absoluto)
 * no crece con el alto de la página; maxDiffPixelRatio sí, y esa es la
 * diferencia que crea el punto ciego. Por eso ninguna captura del archivo
 * puede volver a usarlo.
 */
describe("gate visual", () => {
  it("ninguna captura fullPage lleva maxDiffPixelRatio", () => {
    const source = uiSpecSource();

    expect(source).toMatch(/fullPage: true/);
    expect(source).not.toMatch(/maxDiffPixelRatio/);
  });

  it("existe una captura por componente para la barra de pestañas móvil y otra para la nav de escritorio", () => {
    const source = uiSpecSource();

    expect(source).toMatch(
      /getByRole\(\s*"navigation",\s*\{ name: TAB_BAR \},?\s*\),?\s*\)\s*\.toHaveScreenshot\(\s*`tabbar-mobile-/,
    );
    expect(source).toMatch(
      /getByRole\(\s*"navigation",\s*\{ name: SIDEBAR_NAV \},?\s*\),?\s*\)\s*\.toHaveScreenshot\(\s*`nav-desktop-/,
    );
  });
});
