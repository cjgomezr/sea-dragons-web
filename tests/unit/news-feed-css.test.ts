/**
 * #594: las medidas del feed de escritorio vienen del handoff de E22
 * (`docs/design/design_handoff_news/README.md`, "Feed (#2a)"). Las de
 * escritorio viven bajo `@media (min-width: 768px)`; por debajo manda el
 * móvil (#600).
 */
import { describe, expect, it } from "vitest";
import { readGlobalsCss } from "./helpers/css-tokens";

const COMMENT = /\/\*[\s\S]*?\*\//g;
const DESKTOP_QUERY = "@media (min-width: 768px)";

const globalsCss = readGlobalsCss().replace(COMMENT, "");

/** El cuerpo de cada bloque `@media (min-width: 768px)` de la hoja. */
function desktopCss(): string {
  const blocks: string[] = [];
  let start = globalsCss.indexOf(DESKTOP_QUERY);
  while (start !== -1) {
    const open = globalsCss.indexOf("{", start);
    let depth = 1;
    let index = open + 1;
    while (depth > 0) {
      const char = globalsCss[index];
      depth += char === "{" ? 1 : char === "}" ? -1 : 0;
      index += 1;
    }
    blocks.push(globalsCss.slice(open + 1, index - 1));
    start = globalsCss.indexOf(DESKTOP_QUERY, index);
  }
  return blocks.join("\n");
}

/** Las declaraciones de todas las reglas cuyo selector es exactamente
 * `selector`, en `css`, juntas y en una línea. */
function declarations(css: string, selector: string): string {
  const bodies = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, found = ""]) => found.trim() === selector)
    .map(([, , body = ""]) => body.replace(/\s+/g, " "));
  if (bodies.length === 0) {
    throw new Error(`Rule not found in globals.css: ${selector}`);
  }
  return bodies.join(" ");
}

describe("cabecera del feed", () => {
  it("la etiqueta va en mono, a 11 px y en mayúsculas", () => {
    const block = declarations(globalsCss, ".news-eyebrow");

    expect(block).toContain("font-family: var(--font-family-mono);");
    expect(block).toContain("font-size: 11px;");
    expect(block).toContain("text-transform: uppercase;");
  });

  it("el título mide 28 px en peso 700", () => {
    const block = declarations(globalsCss, ".news-header h1");

    expect(block).toContain("font-size: 28px;");
    expect(block).toContain("font-weight: 700;");
  });
});

describe("tarjeta destacada en escritorio", () => {
  it("es una rejilla de 1.25fr y 1fr", () => {
    expect(declarations(desktopCss(), ".news-featured")).toContain(
      "grid-template-columns: 1.25fr 1fr;",
    );
  });

  it("la fijada lleva el borde en el acento al 45 %", () => {
    expect(declarations(globalsCss, ".news-featured-pinned")).toContain(
      "border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);",
    );
  });

  it("la portada mide al menos 300 px y se encuadra sin deformarse", () => {
    expect(declarations(desktopCss(), ".news-featured-cover")).toContain(
      "min-height: 300px;",
    );
    expect(declarations(globalsCss, ".news-cover-image")).toContain(
      "object-fit: cover;",
    );
  });

  it("el título mide 24 px y el extracto 15 px en el texto suave", () => {
    expect(declarations(globalsCss, ".news-featured-title")).toContain(
      "font-size: 24px;",
    );
    const excerpt = declarations(globalsCss, ".news-featured-excerpt");
    expect(excerpt).toContain("font-size: 15px;");
    expect(excerpt).toContain("color: var(--color-text-soft);");
  });
});

describe("fila de la lista", () => {
  it("es una rejilla de 88 px, el resto y una columna a su medida", () => {
    expect(declarations(globalsCss, ".news-row")).toContain(
      "grid-template-columns: 88px minmax(0, 1fr) auto;",
    );
  });

  it("al pasar el ratón toma el fondo del panel", () => {
    expect(declarations(globalsCss, ".news-row:hover")).toContain(
      "background: var(--color-panel);",
    );
  });

  it("la miniatura mide 88 × 88", () => {
    const block = declarations(globalsCss, ".news-row-thumbnail");

    expect(block).toContain("width: 88px;");
    expect(block).toContain("height: 88px;");
  });

  it("el título mide 16,5 px en peso 650", () => {
    const block = declarations(globalsCss, ".news-row-title");

    expect(block).toContain("font-size: 16.5px;");
    expect(block).toContain("font-weight: 650;");
  });

  it("el extracto ocupa una línea y se corta con puntos suspensivos", () => {
    const block = declarations(globalsCss, ".news-row-excerpt");

    expect(block).toContain("white-space: nowrap;");
    expect(block).toContain("text-overflow: ellipsis;");
  });

  it("hace cuánto y el autor no se parten", () => {
    expect(declarations(globalsCss, ".news-row-byline")).toContain(
      "white-space: nowrap;",
    );
  });

  it("el punto de no leída mide 7 px y va en el acento", () => {
    const block = declarations(globalsCss, ".news-unread-dot");

    expect(block).toContain("width: 7px;");
    expect(block).toContain("height: 7px;");
    expect(block).toContain("background: var(--color-accent);");
  });
});
