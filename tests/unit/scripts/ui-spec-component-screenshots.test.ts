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

interface ComponentScreenshot {
  /** La constante con el nombre accesible de la nav del componente. */
  readonly role: string;
  /** Con qué empieza el nombre de archivo de su captura. */
  readonly prefix: string;
}

/**
 * El tramo del fuente que va desde el nombre de esta captura hasta el
 * arranque del test siguiente.
 *
 * Acotar importa, y no es cosmético: `const tabBar = ...` se declara cinco
 * veces en el spec, una por test. Buscando cada pieza por su cuenta en el
 * archivo entero, el guarda ataría piezas de tests distintos, pasaría por
 * accidente del orden actual y se pondría rojo con sólo mover un bloque de
 * sitio.
 */
function testBodyDeclaring(source: string, prefix: string): string {
  const start = source.indexOf("const name = `" + prefix);
  if (start === -1) {
    return "";
  }
  const nextTest = source.indexOf(" test(", start);
  return nextTest === -1 ? source.slice(start) : source.slice(start, nextTest);
}

/**
 * A qué variable asigna ese test el locator de su nav.
 *
 * Se lee del fuente en vez de fijarla aquí para que renombrarla siga siendo
 * un renombre y no rompa el guarda. Lo que se comprueba es que la captura
 * salga de la nav, no cómo se llame la variable que la sostiene.
 */
function navLocatorNameIn(body: string, role: string): string | null {
  const declaration = new RegExp(
    `const (\\w+) = page\\.getByRole\\("navigation", \\{ name: ${role} \\}\\);`,
  );
  return body.match(declaration)?.[1] ?? null;
}

describe("gate visual", () => {
  /**
   * #77: una captura fullPage de 375px de alto reparte el cambio de un
   * componente pequeño (la barra de pestañas) entre miles de píxeles de
   * página, así que cabe holgadamente bajo un presupuesto por RATIO. Cuanto
   * más larga la página, más grande el punto ciego. maxDiffPixels (absoluto)
   * no crece con el alto de la página; maxDiffPixelRatio sí, y esa es la
   * diferencia que crea el punto ciego. Por eso ninguna captura del archivo
   * puede volver a usarlo.
   */
  it("ninguna captura fullPage lleva maxDiffPixelRatio", () => {
    const source = uiSpecSource();

    expect(source).toMatch(/fullPage: true/);
    expect(source).not.toMatch(/maxDiffPixelRatio/);
  });

  /**
   * Las tres piezas que hacen que la captura sea del componente y no de la
   * página, todas dentro del mismo test: que haya un locator apuntando a esa
   * nav, que la siembra lo tome a él, y que la comparación también.
   *
   * Antes bastaba una expresión más corta, porque el locator se escribía
   * dentro del propio `expect`. El #96 lo sacó a una variable para poder
   * sembrar y comparar exactamente la misma región.
   */
  function expectComponentScreenshot(
    source: string,
    { role, prefix }: ComponentScreenshot,
  ): void {
    const body = testBodyDeclaring(source, prefix);
    expect(body, `no hay ninguna captura llamada ${prefix}...`).not.toBe("");

    const locator = navLocatorNameIn(body, role);
    expect(
      locator,
      `la captura ${prefix}... no sale de un locator sobre la nav ${role}`,
    ).not.toBeNull();

    expect(
      body,
      `la captura ${prefix}... no se siembra sobre ${locator}`,
    ).toContain(
      `createMissingLocalBaseline(name, () => ${locator}.screenshot(`,
    );
    expect(
      body,
      `la captura ${prefix}... no se compara sobre ${locator}`,
    ).toContain(`expect(${locator}).toHaveScreenshot(name,`);
  }

  it("existe una captura por componente para la barra de pestañas móvil y otra para la nav de escritorio", () => {
    const source = normalizedUiSpecSource();

    expectComponentScreenshot(source, {
      role: "TAB_BAR",
      prefix: "tabbar-mobile-",
    });
    expectComponentScreenshot(source, {
      role: "SIDEBAR_NAV",
      prefix: "nav-desktop-",
    });
  });
});
