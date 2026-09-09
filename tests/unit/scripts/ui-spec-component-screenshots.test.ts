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
interface ComponentScreenshot {
  /** La variable a la que el spec asigna el locator del componente. */
  readonly locator: string;
  /** La constante con el nombre accesible de esa nav. */
  readonly role: string;
  /** Con qué empieza el nombre de archivo de su captura. */
  readonly prefix: string;
}

describe("gate visual", () => {
  it("ninguna captura fullPage lleva maxDiffPixelRatio", () => {
    const source = uiSpecSource();

    expect(source).toMatch(/fullPage: true/);
    expect(source).not.toMatch(/maxDiffPixelRatio/);
  });

  /**
   * Las tres mitades que hacen falta para que la captura sea del componente y
   * no de la página: que su nombre sea el del componente, que el locator
   * apunte a esa nav, y que la captura se tome sobre ese locator.
   *
   * Antes cabían en una sola expresión, porque el locator estaba escrito
   * dentro del propio `expect`. El #96 lo sacó a una variable para poder
   * sembrar y comparar exactamente la misma región. La comprobación no
   * pierde nada: sigue sin pasar si la captura se toma de la página entera,
   * si el locator cambia de nav, o si el nombre deja de ser el del
   * componente. Y se exige el orden, para que las tres piezas sean del mismo
   * test y no de dos distintos.
   */
  function expectComponentScreenshot(
    source: string,
    component: ComponentScreenshot,
  ): void {
    const { locator, role, prefix } = component;
    const namesTheComponent = source.indexOf("const name = `" + prefix);
    const pointsAtTheNav = source.indexOf(
      `const ${locator} = page.getByRole("navigation", { name: ${role} });`,
    );
    const capturesThatLocator = source.indexOf(
      `expect(${locator}).toHaveScreenshot(name,`,
    );

    expect(
      namesTheComponent,
      `no hay captura llamada ${prefix}...`,
    ).toBeGreaterThan(-1);
    expect(
      pointsAtTheNav,
      `el locator ${locator} no apunta a la nav ${role}`,
    ).toBeGreaterThan(namesTheComponent);
    expect(
      capturesThatLocator,
      `la captura ${prefix}... no se toma sobre ${locator}`,
    ).toBeGreaterThan(pointsAtTheNav);
  }

  it("existe una captura por componente para la barra de pestañas móvil y otra para la nav de escritorio", () => {
    const source = normalizedUiSpecSource();

    expectComponentScreenshot(source, {
      locator: "tabBar",
      role: "TAB_BAR",
      prefix: "tabbar-mobile-",
    });
    expectComponentScreenshot(source, {
      locator: "sidebar",
      role: "SIDEBAR_NAV",
      prefix: "nav-desktop-",
    });
  });
});
