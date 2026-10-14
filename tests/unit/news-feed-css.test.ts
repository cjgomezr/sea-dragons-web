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
const MOBILE_QUERY = "@media (width < 768px)";

const globalsCss = readGlobalsCss().replace(COMMENT, "");

/** El cuerpo de cada bloque `@media (min-width: 768px)` de la hoja. */
function desktopCss(): string {
  return mediaBlocks(DESKTOP_QUERY);
}

/** El cuerpo de cada bloque `@media (width < 768px)` de la hoja (#600). */
function mobileCss(): string {
  return mediaBlocks(MOBILE_QUERY);
}

/** El cuerpo de cada bloque de la hoja que abre con `query`, juntos. */
function mediaBlocks(query: string): string {
  const blocks: string[] = [];
  let start = globalsCss.indexOf(query);
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
    start = globalsCss.indexOf(query, index);
  }
  return blocks.join("\n");
}

/** Las declaraciones de todas las reglas que nombran exactamente `selector`,
 * sólo o en una lista separada por comas, en `css`, juntas y en una línea. */
function declarations(css: string, selector: string): string {
  const bodies = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, found = ""]) =>
      found.split(",").some((listed) => listed.trim() === selector),
    )
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

describe("la chincheta de cada fila (#595)", () => {
  it("mide 34 px y su zona táctil llega a 44", () => {
    const button = declarations(globalsCss, ".news-row-pin");
    const touchZone = declarations(globalsCss, ".news-row-pin::after");

    expect(button).toContain("width: 34px;");
    expect(button).toContain("height: 34px;");
    expect(touchZone).toContain("inset: -5px;");
  });

  it("sólo sale desde 768 px: en el móvil no hay chincheta por fila", () => {
    expect(declarations(globalsCss, ".news-row-pin")).toContain(
      "display: none;",
    );
    expect(declarations(desktopCss(), ".news-row-pin")).toContain(
      "display: inline-flex;",
    );
  });
});

/* #600: el feed por debajo de 768 px, "Mobile" y "#2c Feed" del handoff. */
describe("cabecera del feed en el móvil", () => {
  it("el título mide 26 px", () => {
    expect(declarations(mobileCss(), ".news-header h1")).toContain(
      "font-size: 26px;",
    );
  });

  it("publicar es un botón de icono de 44 × 44", () => {
    const block = declarations(mobileCss(), ".news-publish-link");

    expect(block).toContain("width: var(--touch-target-min);");
    expect(block).toContain("height: var(--touch-target-min);");
    expect(block).toContain("padding: 0;");
  });

  it("el icono sólo sale en el móvil y la palabra sólo en el escritorio", () => {
    expect(declarations(globalsCss, ".news-publish-icon")).toContain(
      "display: none;",
    );
    expect(declarations(mobileCss(), ".news-publish-icon")).toContain(
      "display: inline-flex;",
    );
    expect(declarations(mobileCss(), ".news-publish-text")).toContain(
      "display: none;",
    );
  });
});

describe("tarjeta destacada en el móvil", () => {
  it("lleva radio 12", () => {
    expect(declarations(mobileCss(), ".news-featured")).toContain(
      "border-radius: 12px;",
    );
  });

  it("la portada mide 190 px y el icono del fondo 64", () => {
    expect(declarations(mobileCss(), ".news-featured-cover")).toContain(
      "height: 190px;",
    );
    const icon = declarations(
      mobileCss(),
      ".news-featured-cover .news-cover-fallback svg",
    );
    expect(icon).toContain("width: 64px;");
    expect(icon).toContain("height: 64px;");
  });

  it("debajo de la portada deja 14 y 16 px de margen", () => {
    expect(declarations(mobileCss(), ".news-featured-body")).toContain(
      "padding: 14px var(--space-4) var(--space-4);",
    );
  });

  it("el título mide 20 px en negrita y el extracto ocupa dos líneas", () => {
    expect(declarations(mobileCss(), ".news-featured-title")).toContain(
      "font-size: 20px;",
    );
    expect(declarations(globalsCss, ".news-featured-title")).toContain(
      "font-weight: 700;",
    );
    expect(declarations(mobileCss(), ".news-featured-excerpt")).toContain(
      "-webkit-line-clamp: 2;",
    );
  });

  it("no lleva el pie ni los botones de fijar", () => {
    expect(declarations(mobileCss(), ".news-featured-footer")).toContain(
      "display: none;",
    );
    expect(declarations(mobileCss(), ".news-featured-pin")).toContain(
      "display: none;",
    );
  });

  it("el estado y la palabra Nueva quedan para el lector de pantalla", () => {
    for (const selector of [".news-featured-status", ".news-unread-word"]) {
      const block = declarations(mobileCss(), selector);
      expect(block).toContain("position: absolute;");
      expect(block).toContain("clip: rect(0, 0, 0, 0);");
    }
  });
});

describe("la píldora de fijada", () => {
  it("sólo sale en el móvil", () => {
    expect(declarations(globalsCss, ".news-featured-pill")).toContain(
      "display: none;",
    );
    expect(declarations(mobileCss(), ".news-featured-pill")).toContain(
      "display: inline-flex;",
    );
  });

  it("va sobre la esquina superior izquierda de la portada sin tapar el toque", () => {
    const pill = declarations(globalsCss, ".news-featured-pill");

    expect(pill).toContain("position: absolute;");
    expect(pill).toContain("pointer-events: none;");
    expect(declarations(mobileCss(), ".news-featured-cover")).toContain(
      "position: relative;",
    );
  });
});

describe("fila de la lista en el móvil", () => {
  it("es una rejilla de 72 px y el resto, con 12 px de hueco y 10 × 16 de margen", () => {
    const block = declarations(mobileCss(), ".news-row");

    expect(block).toContain("grid-template-columns: 72px minmax(0, 1fr);");
    expect(block).toContain("gap: var(--space-3);");
    expect(block).toContain("padding: 10px var(--space-4);");
  });

  it("la lista llega a los bordes para que la fila lleve su propio margen", () => {
    expect(declarations(mobileCss(), ".news-list")).toContain(
      "margin: 0 calc(-1 * var(--space-4));",
    );
  });

  it("la miniatura mide 72 × 72 con radio 8", () => {
    const block = declarations(mobileCss(), ".news-row-thumbnail");

    expect(block).toContain("width: 72px;");
    expect(block).toContain("height: 72px;");
    expect(block).toContain("border-radius: 8px;");
  });

  it("el título mide 15,5 px en peso 650 y ocupa hasta dos líneas", () => {
    const block = declarations(mobileCss(), ".news-row-title");

    expect(block).toContain("font-size: 15.5px;");
    expect(block).toContain("-webkit-line-clamp: 2;");
    expect(declarations(globalsCss, ".news-row-title")).toContain(
      "font-weight: 650;",
    );
  });

  it("la línea lleva categoría, punto, hora y adjuntos: el autor, sólo para el lector", () => {
    const block = declarations(mobileCss(), ".news-row .news-row-author");

    expect(block).toContain("position: absolute;");
    expect(block).toContain("clip: rect(0, 0, 0, 0);");
  });

  it("no lleva extracto", () => {
    expect(declarations(mobileCss(), ".news-row-excerpt")).toContain(
      "display: none;",
    );
  });
});

describe("cargar más en el móvil", () => {
  it("ocupa el ancho y mide 46 px", () => {
    const block = declarations(mobileCss(), ".news-more .admin-secondary");

    expect(block).toContain("width: 100%;");
    expect(block).toContain("min-height: 46px;");
  });
});
