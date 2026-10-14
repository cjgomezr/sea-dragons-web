/**
 * #593: los estilos del cuerpo en Markdown vienen del handoff de E22
 * (`docs/design/design_handoff_news/README.md`).
 */
import { describe, expect, it } from "vitest";
import { readGlobalsCss } from "./helpers/css-tokens";

const COMMENT = /\/\*[\s\S]*?\*\//g;
const RULE = /([^{}]+)\{([^}]*)\}/g;

const globalsCss = readGlobalsCss().replace(COMMENT, "");

/** Las declaraciones de la regla cuya lista de selectores es exactamente
 * `selectors`, sin importar los saltos de línea entre ellos. */
function declarations(...selectors: readonly string[]): string {
  const wanted = selectors.join(",");
  for (const [, selectorList = "", body = ""] of globalsCss.matchAll(RULE)) {
    const found = selectorList
      .split(",")
      .map((selector) => selector.trim())
      .join(",");
    if (found === wanted) {
      return body.replace(/\s+/g, " ");
    }
  }
  throw new Error(`Rule not found in globals.css: ${wanted}`);
}

describe("estilos del cuerpo en Markdown", () => {
  it("pinta los párrafos a 16 px con interlineado 1,65 en el texto suave", () => {
    const block = declarations(".news-markdown p");

    expect(block).toContain("font-size: 16px;");
    expect(block).toContain("line-height: 1.65;");
    expect(block).toContain("color: var(--color-text-soft);");
  });

  it.each([
    [".news-markdown h1", "23px"],
    [".news-markdown h2", "19px"],
    [".news-markdown h3", "16.5px"],
  ])("%s mide %s", (selector, size) => {
    expect(declarations(selector)).toContain(`font-size: ${size};`);
  });

  it("los encabezados van en peso 700 y en el color del texto", () => {
    const block = declarations(
      ".news-markdown h1",
      ".news-markdown h2",
      ".news-markdown h3",
    );

    expect(block).toContain("font-weight: 700;");
    expect(block).toContain("color: var(--color-text);");
  });

  it("sangra las listas 22 px", () => {
    expect(declarations(".news-markdown ul", ".news-markdown ol")).toContain(
      "padding-left: 22px;",
    );
  });

  it("la cita lleva un borde de acento de 3 px y va en cursiva a 17 px", () => {
    const block = declarations(".news-markdown blockquote");

    expect(block).toContain("border-left: 3px solid var(--color-accent);");
    expect(block).toContain("font-style: italic;");
    expect(block).toContain("font-size: 17px;");
  });

  it("los enlaces van en el acento", () => {
    expect(declarations(".news-markdown a")).toContain(
      "color: var(--color-accent-text);",
    );
  });

  it("el código va en mono sobre el color de hover", () => {
    const block = declarations(".news-markdown code");

    expect(block).toContain("font-family: var(--font-family-mono);");
    expect(block).toContain("background: var(--color-hover);");
  });
});

describe("las imágenes del cuerpo (#603)", () => {
  it("van a lo ancho de la columna, con radio 8 y recortadas a 200 px en el móvil", () => {
    const block = declarations(".news-body-image img");

    expect(block).toContain("display: block;");
    expect(block).toContain("width: 100%;");
    expect(block).toContain("height: 200px;");
    expect(block).toContain("border-radius: 8px;");
    expect(block).toContain("object-fit: cover;");
  });

  it("miden 300 px de alto desde el escritorio", () => {
    expect(globalsCss).toMatch(
      /@media \(min-width: 768px\) \{\s*\.news-body-image img \{[^}]*height: 300px;/,
    );
  });

  it("el pie va a 13 px en el texto secundario", () => {
    const block = declarations(".news-body-image-caption");

    expect(block).toContain("display: block;");
    expect(block).toContain("font-size: 13px;");
    expect(block).toContain("color: var(--color-text-secondary);");
  });
});
