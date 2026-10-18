/**
 * #722: las medidas de la tabla de packs vienen del handoff de E26
 * (`docs/design/design_handoff_club_settings/README.md`, "Tab: Session
 * packs" y "Mobile"). Que nada desborde y cómo se ve lo mira Playwright;
 * aquí, que las medidas del handoff están escritas.
 */
import { describe, expect, it } from "vitest";
import { readGlobalsCss } from "./helpers/css-tokens";

const COMMENT = /\/\*[\s\S]*?\*\//g;

const globalsCss = readGlobalsCss().replace(COMMENT, "");

/** Las declaraciones de todas las reglas cuyo selector es exactamente
 * `selector`, juntas y en una línea. */
function declarations(selector: string): string {
  const bodies = [...globalsCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, found = ""]) => found.replace(/\s+/g, " ").trim() === selector)
    .map(([, , body = ""]) => body.replace(/\s+/g, " "));
  if (bodies.length === 0) {
    throw new Error(`Rule not found in globals.css: ${selector}`);
  }
  return bodies.join(" ");
}

describe("la tabla de packs", () => {
  it("mide 620 px como mucho", () => {
    expect(declarations(".club-packs-section")).toContain("max-width: 620px;");
  });

  it("en escritorio reparte la fila en 36px | 1fr | 110px | 40px", () => {
    expect(declarations(".club-packs-row")).toContain(
      "grid-template-columns: 36px minmax(0, 1fr) 110px 40px;",
    );
  });

  it("la etiqueta va en mono, negrita y con el fondo del segmento elegido", () => {
    const block = declarations(".club-packs-badge");

    expect(block).toContain("font-family: var(--font-family-mono);");
    expect(block).toContain("font-weight: 700;");
    expect(block).toContain("background: var(--color-segment-selected);");
  });

  it("el botón de borrar se pone rojo al pasar por encima", () => {
    expect(declarations(".club-packs-remove:hover:not(:disabled)")).toContain(
      "color: var(--color-danger);",
    );
  });

  it("el botón + de escritorio mide 32 px", () => {
    const block = declarations(".club-packs-add-submit");

    expect(block).toContain("width: 32px;");
    expect(block).toContain("height: 32px;");
  });
});

describe("la tabla de packs en el móvil", () => {
  it("cada fila mide 60 px", () => {
    expect(declarations(".club-packs-row")).toContain("min-height: 60px;");
  });

  it("el asa y el botón de borrar miden 44 px", () => {
    const block = declarations(".club-packs-handle, .club-packs-remove");

    expect(block).toContain("width: var(--touch-target-min);");
    expect(block).toContain("height: var(--touch-target-min);");
  });

  it("el campo de añadir mide 48 px con letra de 16 px", () => {
    const block = declarations(".club-packs-add input");

    expect(block).toContain("height: 48px;");
    expect(block).toContain("font-size: 16px;");
  });
});
