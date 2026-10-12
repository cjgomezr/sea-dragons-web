/**
 * #590: los colores de cada categoría de noticia viven en `globals.css`. El
 * fondo de lo que no tiene portada es un degradado del tono de su categoría
 * sobre el panel, y la etiqueta Document deja de reutilizar el acento.
 */
import { describe, expect, it } from "vitest";
import { cssBlock, readGlobalsCss } from "./helpers/css-tokens";

const globalsCss = readGlobalsCss();

const MIN_ICON_OPACITY = 0.35;
const MAX_ICON_OPACITY = 0.65;

// News pinta su icono con el acento como texto, que con el acento claro de un
// club sigue viéndose sobre el panel (#341).
const CATEGORY_TONES = [
  ["announcement", "--color-warning", 30, "--color-warning"],
  ["news", "--color-accent", 32, "--color-accent-text"],
  ["document", "--color-success", 26, "--color-success"],
] as const;

function declaredValue(block: string, property: string): string {
  const match = new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+);`).exec(block);
  const value = match?.[1];
  if (value === undefined) {
    throw new Error(`Property not declared: ${property}`);
  }
  return value
    .replace(/\s+/g, " ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .trim();
}

describe("fondo de categoría sin portada", () => {
  it.each(CATEGORY_TONES)(
    "%s pinta el degradado de su tono sobre el panel",
    (category, tone, weight) => {
      const block = cssBlock(globalsCss, `.news-cover-fallback-${category}`);

      expect(declaredValue(block, "background")).toBe(
        `linear-gradient(135deg, color-mix(in srgb, var(${tone}) ${weight}%, var(--color-panel)), var(--color-panel) 78%)`,
      );
    },
  );

  it.each(CATEGORY_TONES)(
    "%s pinta el icono en el tono de su categoría",
    (category, _gradientTone, _weight, iconTone) => {
      const block = cssBlock(globalsCss, `.news-cover-fallback-${category}`);

      expect(declaredValue(block, "color")).toBe(`var(${iconTone})`);
    },
  );

  it("dibuja el icono con una opacidad entre 0,35 y 0,65", () => {
    const block = cssBlock(globalsCss, ".news-cover-fallback svg");
    const opacity = Number(declaredValue(block, "opacity"));

    expect(opacity).toBeGreaterThanOrEqual(MIN_ICON_OPACITY);
    expect(opacity).toBeLessThanOrEqual(MAX_ICON_OPACITY);
  });
});

describe("etiqueta de categoría Document", () => {
  it("lleva el fondo verde y no el acento", () => {
    const block = cssBlock(globalsCss, ".news-category-document");

    expect(declaredValue(block, "background")).toBe(
      "color-mix(in srgb, var(--color-success) 22%, var(--color-panel))",
    );
  });
});
