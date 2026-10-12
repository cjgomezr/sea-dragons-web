import { render } from "@testing-library/react";
import { FileText } from "@phosphor-icons/react/dist/ssr/FileText";
import { MegaphoneSimple } from "@phosphor-icons/react/dist/ssr/MegaphoneSimple";
import { Newspaper } from "@phosphor-icons/react/dist/ssr/Newspaper";
import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import { describe, expect, it } from "vitest";
import { NewsCategoryFallback } from "@/components/news/NewsCategoryFallback";
import { NewsCategoryLabel } from "@/components/news/NewsCategoryLabel";
import { createTranslator } from "@/lib/i18n/translator";
import type { NewsCategory } from "@/lib/news/news-posts";

/**
 * El fondo de lo que no tiene portada (#590, RF-1 del PRD de E22): un
 * degradado y un icono por categoría. El degradado y el tono los pone la hoja
 * de estilos por la clase de la categoría (`news-category-css.test.ts`).
 */

function renderFallback(
  props: React.ComponentProps<typeof NewsCategoryFallback>,
): HTMLElement {
  const { container } = render(<NewsCategoryFallback {...props} />);
  const fallback = container.firstElementChild;
  if (!(fallback instanceof HTMLElement)) {
    throw new Error("NewsCategoryFallback rendered nothing");
  }
  return fallback;
}

function iconOf(fallback: HTMLElement): SVGSVGElement {
  const svg = fallback.querySelector("svg");
  if (svg === null) {
    throw new Error("The fallback has no icon");
  }
  return svg;
}

function referenceShape(Glyph: PhosphorGlyph): string {
  const { container } = render(<Glyph />);
  const svg = container.querySelector("svg");
  if (svg === null) {
    throw new Error("Reference glyph rendered no <svg>");
  }
  return svg.innerHTML;
}

const CATEGORY_GLYPHS = [
  ["announcement", MegaphoneSimple],
  ["news", Newspaper],
  ["document", FileText],
] as const satisfies readonly (readonly [NewsCategory, PhosphorGlyph])[];

describe("NewsCategoryFallback", () => {
  it.each(CATEGORY_GLYPHS)("%s draws its own icon", (category, glyph) => {
    const fallback = renderFallback({ category, iconSize: 88 });

    expect(iconOf(fallback).innerHTML).toBe(referenceShape(glyph));
  });

  it.each(CATEGORY_GLYPHS)("%s carries its category class", (category) => {
    const fallback = renderFallback({ category, iconSize: 88 });

    expect(fallback).toHaveClass(
      "news-cover-fallback",
      `news-cover-fallback-${category}`,
    );
  });

  it.each([88, 64, 32] as const)("draws the icon at %i px", (iconSize) => {
    const icon = iconOf(renderFallback({ category: "news", iconSize }));

    expect(icon).toHaveAttribute("width", String(iconSize));
    expect(icon).toHaveAttribute("height", String(iconSize));
  });

  it("hides the icon from assistive technology", () => {
    const icon = iconOf(
      renderFallback({ category: "announcement", iconSize: 32 }),
    );

    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("focusable", "false");
  });
});

describe("NewsCategoryLabel", () => {
  it("gives Document its own modifier", () => {
    const { getByText } = render(
      <NewsCategoryLabel
        translate={createTranslator("en")}
        category="document"
      />,
    );

    expect(getByText("Document")).toHaveClass("news-category-document");
  });
});
