/**
 * #725: cómo se ve una fila mientras se arrastra, según el handoff de E26
 * (`docs/design/design_handoff_club_settings/README.md`, "Drag and drop" y
 * "Touch drag"). Que se ve así lo fotografía Playwright; aquí, que las
 * medidas del handoff están escritas.
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

describe("arrastrar una fila", () => {
  it("con el ratón la fila se queda al 45 % de opacidad", () => {
    expect(declarations(".sortable-row-dragging")).toContain("opacity: 0.45;");
  });

  it("con el dedo la fila se levanta con el fondo del segmento elegido y sombra", () => {
    const block = declarations(".sortable-row-lifted");

    expect(block).toContain("background: var(--color-segment-selected);");
    expect(block).toContain("box-shadow:");
  });

  it("una línea de 2 px en el color de acento marca el destino", () => {
    const line = declarations(
      ".sortable-row-drop-before::before, .sortable-row-drop-after::before",
    );

    expect(line).toContain("height: 2px;");
    expect(line).toContain("background: var(--color-accent);");
    expect(declarations(".sortable-row-drop-before::before")).toContain(
      "top: 0;",
    );
    expect(declarations(".sortable-row-drop-after::before")).toContain(
      "bottom: 0;",
    );
  });

  it("la línea se ve por encima de la fila levantada que pasa sobre ella", () => {
    const zIndexOf = (selector: string): number =>
      Number(/z-index: (\d+);/.exec(declarations(selector))?.[1]);

    expect(
      zIndexOf(
        ".sortable-row-drop-before::before, .sortable-row-drop-after::before",
      ),
    ).toBeGreaterThan(zIndexOf(".sortable-row-lifted"));
  });

  it("el asa no deja hacer scroll a la página mientras se arrastra", () => {
    expect(
      declarations(".club-positions-handle, .club-packs-handle"),
    ).toContain("touch-action: none;");
  });
});
