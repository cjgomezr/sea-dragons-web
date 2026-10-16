/**
 * #641: los colores de cada tipo de evento viven en `globals.css`. La
 * etiqueta es el color del tipo al 24 % sobre el panel; el fondo de lo que no
 * tiene imagen, un degradado del color al 32 % hacia el panel, con el icono
 * en ese color. Tabla del handoff: "Event type colours" en
 * `docs/design/design_handoff_calendar/README.md`.
 */
import { describe, expect, it } from "vitest";
import { cssBlock, readGlobalsCss } from "./helpers/css-tokens";

const globalsCss = readGlobalsCss();

// Training pinta su icono con el acento como texto, que con el acento claro
// de un club sigue viéndose sobre el panel (#341).
const TYPE_COLORS = [
  ["training", "--color-accent", "--color-accent-text"],
  ["competition", "--color-warning", "--color-warning"],
  ["social", "--color-success", "--color-success"],
  ["meeting", "--color-type-meeting", "--color-type-meeting"],
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

describe("etiqueta de tipo de evento", () => {
  it("pinta el texto en el color del texto", () => {
    const block = cssBlock(globalsCss, ".event-type-tag");

    expect(declaredValue(block, "color")).toBe("var(--color-text)");
  });

  it.each(TYPE_COLORS)(
    "%s pinta su color sobre el panel",
    (eventType, color) => {
      const block = cssBlock(globalsCss, `.event-type-tag-${eventType}`);

      expect(declaredValue(block, "background")).toBe(
        `color-mix(in srgb, var(${color}) 24%, var(--color-panel))`,
      );
    },
  );
});

describe("fondo de tipo sin imagen", () => {
  it.each(TYPE_COLORS)(
    "%s pinta el degradado de su color sobre el panel",
    (eventType, color) => {
      const block = cssBlock(globalsCss, `.event-cover-fallback-${eventType}`);

      expect(declaredValue(block, "background")).toBe(
        `linear-gradient(135deg, color-mix(in srgb, var(${color}) 32%, var(--color-panel)), var(--color-panel) 80%)`,
      );
    },
  );

  it.each(TYPE_COLORS)(
    "%s pinta el icono en el color de su tipo",
    (eventType, _gradientColor, iconColor) => {
      const block = cssBlock(globalsCss, `.event-cover-fallback-${eventType}`);

      expect(declaredValue(block, "color")).toBe(`var(${iconColor})`);
    },
  );
});

describe("los estilos viejos de la agenda", () => {
  it("ya no declaran el chip de tipo .agenda-type", () => {
    expect(globalsCss).not.toMatch(/\.agenda-type\b/);
  });
});
