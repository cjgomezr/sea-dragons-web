/**
 * #703: en un iPhone sin botón, la raya de inicio ocupa el fondo de la
 * pantalla. La barra de pestañas reserva ese hueco debajo de las pestañas, y
 * el final de la página lo suma a lo que ya deja libre para la barra.
 */
import { describe, expect, it } from "vitest";
import { cssBlock, readGlobalsCss } from "./helpers/css-tokens";

const SAFE_AREA_BOTTOM = "env(safe-area-inset-bottom)";

/** Sin saltos de línea: un `calc` largo se parte en dos al formatear. */
const globalsCss = readGlobalsCss().replace(/\s+/g, " ");

describe("hueco de la raya de inicio", () => {
  it("la barra de pestañas lo rellena por debajo de las pestañas", () => {
    expect(cssBlock(globalsCss, ".app-tabbar")).toContain(
      `padding-bottom: ${SAFE_AREA_BOTTOM};`,
    );
  });

  it("el contenido lo suma al relleno que deja libre para la barra", () => {
    expect(cssBlock(globalsCss, ".app-main")).toContain(
      `calc(var(--space-8) + var(--touch-target-min) + ${SAFE_AREA_BOTTOM})`,
    );
  });
});

// #840: la barra se recoloca con un transform en cada scroll; en su propia
// capa el navegador la mueve sin volver a pintar la página.
describe("capa propia de la barra de pestañas", () => {
  it("avisa al navegador de que su transform va a cambiar", () => {
    expect(cssBlock(globalsCss, ".app-tabbar")).toContain(
      "will-change: transform;",
    );
  });
});
