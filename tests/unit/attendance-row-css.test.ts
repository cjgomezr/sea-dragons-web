/**
 * En la tableta (de 768 a 1023px, con la barra lateral) la fila de la hoja de
 * asistencia no tiene sitio para el nombre y el segmento con texto: los
 * nombres se cortaban a cuatro o cinco letras (#764). Ahí el segmento enseña
 * sólo los iconos y el texto queda para el lector de pantalla.
 */
import { describe, expect, it } from "vitest";
import { readGlobalsCss } from "./helpers/css-tokens";

const globalsCss = readGlobalsCss();

/** Los cuerpos de cada bloque `@media query`, contando llaves. */
function mediaBlocks(query: string): string[] {
  const opener = `@media ${query} {`;
  const blocks: string[] = [];
  for (
    let start = globalsCss.indexOf(opener);
    start !== -1;
    start = globalsCss.indexOf(opener, start + 1)
  ) {
    let depth = 0;
    for (let at = start + opener.length - 1; at < globalsCss.length; at += 1) {
      if (globalsCss[at] === "{") depth += 1;
      if (globalsCss[at] === "}") depth -= 1;
      if (depth === 0) {
        blocks.push(globalsCss.slice(start + opener.length, at));
        break;
      }
    }
  }
  return blocks;
}

/** El cuerpo de la regla `selector` dentro de algún bloque `@media query`. */
function ruleInsideMedia(query: string, selector: string): string {
  for (const block of mediaBlocks(query)) {
    const rules = block.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of rules.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if ((match[1] ?? "").trim() === selector) {
        return match[2] ?? "";
      }
    }
  }
  throw new Error(`${selector} not found inside @media ${query}`);
}

describe("el segmento de la asistencia en la tableta", () => {
  it("esconde a la vista el texto de cada estado y lo deja al lector de pantalla", () => {
    const rule = ruleInsideMedia(
      "(768px <= width < 1024px)",
      ".attendance-choice-label",
    );

    expect(rule).toMatch(/position:\s*absolute;/);
    expect(rule).toMatch(/clip:\s*rect\(0,\s*0,\s*0,\s*0\);/);
    expect(rule).not.toMatch(/display:\s*none;/);
  });
});
