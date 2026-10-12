/**
 * El nombre que le abre la ficha a un Admin no va subrayado en la tabla del
 * directorio ni en su panel lateral: en una columna de nombres el subrayado
 * de cada fila sólo añade ruido. La línea aparece al pasar el ratón y con el
 * foco del teclado. Se queda en la lista de solicitudes, donde hay nombres que
 * no se pulsan, y en la hoja de asistencia, en gris, porque ahí avisa de que
 * el nombre saca de la hoja en vez de marcar la presencia.
 */
import { describe, expect, it } from "vitest";
import { cssBlock, readGlobalsCss } from "./helpers/css-tokens";

const globalsCss = readGlobalsCss();

/** Cuerpo de la primera regla cuya lista de selectores incluye `selector`. */
function ruleIncluding(selector: string): string {
  const declarations = globalsCss.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of declarations.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((part) => part.trim());
    if (selectors.includes(selector)) {
      return match[2] ?? "";
    }
  }
  throw new Error(`Selector not found in globals.css: ${selector}`);
}

const LIST_NAME_LINKS = [
  ".directory-record-link",
  ".directory-card-name a",
] as const;

describe("nombres que abren la ficha en las listas del directorio", () => {
  it.each(LIST_NAME_LINKS)("%s no va subrayado en reposo", (selector) => {
    expect(cssBlock(globalsCss, selector)).toMatch(/text-decoration:\s*none;/);
  });

  it.each(LIST_NAME_LINKS)("%s se subraya al pasar el ratón", (selector) => {
    expect(ruleIncluding(`${selector}:hover`)).toMatch(
      /text-decoration:\s*underline;/,
    );
  });

  it.each(LIST_NAME_LINKS)(
    "%s se subraya con el foco del teclado",
    (selector) => {
      expect(ruleIncluding(`${selector}:focus-visible`)).toMatch(
        /text-decoration:\s*underline;/,
      );
    },
  );
});

describe("nombre que abre la ficha en la lista de solicitudes", () => {
  it("sigue subrayado en reposo, junto a los nombres que no se pulsan", () => {
    expect(
      cssBlock(globalsCss, ".directory-overview-name.directory-link-button"),
    ).toMatch(/text-decoration:\s*underline;/);
  });
});

describe("nombre que abre la ficha en la hoja de asistencia", () => {
  const restBlock = cssBlock(globalsCss, ".attendance-record-link");

  it("sigue subrayado en reposo", () => {
    expect(restBlock).toMatch(/text-decoration:\s*underline;/);
  });

  it("pinta el subrayado en el gris de lo secundario", () => {
    expect(restBlock).toMatch(
      /text-decoration-color:\s*var\(--color-text-secondary\);/,
    );
  });

  it("pinta el subrayado del color del texto al pasar el ratón", () => {
    expect(ruleIncluding(".attendance-record-link:hover")).toMatch(
      /text-decoration-color:\s*currentColor;/,
    );
  });
});
