/**
 * El perfil y la ficha reparten la página en dos columnas: las tarjetas y la
 * de 340 px de la derecha. En la tableta (de 768 a 1023 px) la barra lateral
 * ya se come 240 px, y a la principal le quedaban unos 150: el número del AUF
 * y la fecha se partían letra a letra (#773). Ahí van apiladas.
 */
import { describe, expect, it } from "vitest";
import { readGlobalsCss } from "./helpers/css-tokens";

const compactCss = readGlobalsCss().replace(/\s+/g, " ");

function twoColumnsFrom(minWidth: string): RegExp {
  return new RegExp(
    `@media \\(min-width: ${minWidth}\\) \\{ \\.profile-layout \\{ grid-template-columns: minmax\\(0, 1fr\\) 340px;`,
  );
}

describe("las columnas del perfil y de la ficha (#773)", () => {
  it("van de lado a lado desde 1024 px", () => {
    expect(compactCss).toMatch(twoColumnsFrom("1024px"));
  });

  it("van apiladas en la tableta", () => {
    expect(compactCss).not.toMatch(twoColumnsFrom("768px"));
  });
});
