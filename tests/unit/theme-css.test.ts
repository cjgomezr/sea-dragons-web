/**
 * #174: los colores del tema no pueden depender de que corra un script.
 *
 * `data-theme` lo escribe `ThemeScript`. Cuando ese script no llega a
 * ejecutarse (lo reportaron en producción, con una extensión que bloquea
 * scripts en línea), toda variable definida sólo dentro de un bloque
 * `[data-theme]` queda sin valor, el navegador descarta la declaración entera
 * y la pantalla se ve sin fondo y sin bordes. Estos tests miran la cascada de
 * `globals.css`; `tests/theme.spec.ts` comprueba el resultado en un navegador.
 */
import { describe, expect, it } from "vitest";
import {
  cssBlock,
  cssCustomProperties,
  readGlobalsCss,
} from "./helpers/css-tokens";

const ROOT = ":root";
const MANUAL_DARK = ':root[data-theme="dark"]';
const SYSTEM_DARK = ':root:not([data-theme="light"])';
const SYSTEM_DARK_MEDIA = "@media (prefers-color-scheme: dark)";

const globalsCss = readGlobalsCss();
const rootBlock = cssBlock(globalsCss, ROOT);
const rootTokens = cssCustomProperties(rootBlock);
const manualDarkBlock = cssBlock(globalsCss, MANUAL_DARK);
const systemDarkBlock = cssBlock(globalsCss, SYSTEM_DARK);

/**
 * Nombres, sin el `--`, de cada variable que la hoja consume con `var()`.
 *
 * Los comentarios se quitan antes: los de esta hoja citan variables (a veces
 * con comodín, `var(--color-*)`) y no son declaraciones de nada.
 */
function referencedCustomProperties(css: string): readonly string[] {
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const names = [...declarations.matchAll(/var\(\s*--([\w-]+)/g)].flatMap(
    (match) => (match[1] === undefined ? [] : [match[1]]),
  );
  return [...new Set(names)].sort();
}

describe("tokens del tema sin data-theme", () => {
  it("define en :root toda variable que la hoja consume con var()", () => {
    const undefinedInRoot = referencedCustomProperties(globalsCss).filter(
      (name) => rootTokens[name] === undefined,
    );

    expect(undefinedInRoot).toEqual([]);
  });

  it("da a cada token del tema oscuro un valor por defecto en :root", () => {
    const withoutDefault = Object.keys(
      cssCustomProperties(manualDarkBlock),
    ).filter((name) => rootTokens[name] === undefined);

    expect(withoutDefault).toEqual([]);
  });

  it("declara color-scheme: light junto a la paleta clara", () => {
    expect(rootBlock).toMatch(/color-scheme:\s*light;/);
  });
});

describe("tema por preferencia del sistema", () => {
  it("declara un bloque para prefers-color-scheme: dark", () => {
    expect(globalsCss).toContain(SYSTEM_DARK_MEDIA);
  });

  it("repite exactamente los tokens del tema oscuro", () => {
    expect(cssCustomProperties(systemDarkBlock)).toEqual(
      cssCustomProperties(manualDarkBlock),
    );
  });

  it("declara color-scheme: dark", () => {
    expect(systemDarkBlock).toMatch(/color-scheme:\s*dark;/);
  });
});

describe("la elección manual gana", () => {
  it("deja fuera de la preferencia del sistema a quien eligió el tema claro", () => {
    expect(globalsCss).toContain(SYSTEM_DARK);
  });

  // Los dos selectores pesan igual (0,2,0): quien decide es el orden.
  it("declara el tema oscuro manual después de la preferencia del sistema", () => {
    expect(globalsCss.indexOf(MANUAL_DARK)).toBeGreaterThan(
      globalsCss.indexOf(SYSTEM_DARK_MEDIA),
    );
  });

  it("declara color-scheme: dark en el tema oscuro manual", () => {
    expect(manualDarkBlock).toMatch(/color-scheme:\s*dark;/);
  });
});
