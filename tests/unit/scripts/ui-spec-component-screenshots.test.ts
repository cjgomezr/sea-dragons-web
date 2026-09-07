import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const UI_SPEC_PATH = path.join(REPO_ROOT, "tests/ui.spec.ts");

function uiSpecSource(): string {
  return readFileSync(UI_SPEC_PATH, "utf8");
}

/**
 * Espacios normalizados a uno solo: el formatter reenvuelve estas llamadas
 * (una coma final, una línea que colapsa) sin cambiar lo que de verdad
 * importa, así que la comparación no puede depender de la forma exacta en
 * que están partidas. Mismo enfoque que baseline-doctrine.test.ts.
 */
function normalizedUiSpecSource(): string {
  return uiSpecSource().replace(/\s+/g, " ");
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
    const source = normalizedUiSpecSource();

    expect(source).toMatch(
      /getByRole\("navigation", \{ name: TAB_BAR \}\),? ?\)\.toHaveScreenshot\(`tabbar-mobile-/,
    );
    expect(source).toMatch(
      /getByRole\("navigation", \{ name: SIDEBAR_NAV \}\),? ?\)\.toHaveScreenshot\(`nav-desktop-/,
    );
  });
});
