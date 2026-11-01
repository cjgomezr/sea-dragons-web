/**
 * #601: las medidas de la publicación en el móvil vienen del handoff de E22
 * (`docs/design/design_handoff_news/README.md`, "#2d Post"). Que la barra se
 * quede arriba al hacer scroll y que nada desborde lo mira Playwright; aquí,
 * que las medidas del handoff están escritas.
 */
import { describe, expect, it } from "vitest";
import { readGlobalsCss } from "./helpers/css-tokens";

const COMMENT = /\/\*[\s\S]*?\*\//g;

const globalsCss = readGlobalsCss().replace(COMMENT, "");

/** Las declaraciones de todas las reglas cuyo selector es exactamente
 * `selector`, juntas y en una línea. */
function declarations(selector: string): string {
  const bodies = [...globalsCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, found = ""]) => found.trim() === selector)
    .map(([, , body = ""]) => body.replace(/\s+/g, " "));
  if (bodies.length === 0) {
    throw new Error(`Rule not found in globals.css: ${selector}`);
  }
  return bodies.join(" ");
}

describe("la barra de la publicación en el móvil", () => {
  it("se pega justo bajo la cabecera de la app al hacer scroll (#957)", () => {
    const block = declarations(".news-post-bar");

    expect(block).toContain("position: sticky;");
    expect(block).toContain("top: var(--app-phone-header-height);");
  });

  it("volver y ⋯ miden 44 px", () => {
    const block = declarations(".news-post-bar-button");

    expect(block).toContain("width: var(--touch-target-min);");
    expect(block).toContain("height: var(--touch-target-min);");
  });
});

describe("la publicación en el móvil", () => {
  it("la portada va a sangre y a 220 px, sin radio", () => {
    const block = declarations(".news-post-screen-phone .news-post-cover");

    expect(block).toContain("height: 220px;");
    expect(block).toContain("margin-inline: calc(-1 * var(--space-4));");
    expect(block).toContain("border-radius: 0;");
  });

  it("el contenido lleva 18 px de margen: los 16 de la página y 2 más", () => {
    const block = declarations(".news-post-screen-phone .news-post-column");

    expect(block).toContain("padding-inline: 2px;");
  });
});

describe("la hoja ⋯", () => {
  it("cada fila mide al menos 52 px", () => {
    expect(declarations(".news-sheet-action")).toContain("min-height: 52px;");
    expect(declarations(".directory-sheet-option")).toContain(
      "min-height: 52px;",
    );
  });

  it("Retirar va en el rojo de peligro", () => {
    expect(declarations(".news-sheet-action-danger")).toContain(
      "color: var(--color-danger);",
    );
  });
});
