import { describe, expect, it } from "vitest";
import { newsBodyToPlainText } from "@/lib/news/news-markdown";

/**
 * El texto plano del cuerpo tiene que coincidir con lo que pinta
 * `NewsMarkdown` (#609): las cuatro reglas de Markdown que cambiarían el
 * aspecto de una noticia antigua de texto plano tampoco cuentan en el extracto.
 * El feed junta los espacios al recortar, así que aquí se comparan juntos.
 */

const WHITESPACE_RUN = /\s+/g;

function plainTextOf(body: string): string {
  return newsBodyToPlainText(body).replace(WHITESPACE_RUN, " ").trim();
}

describe("newsBodyToPlainText con las reglas apagadas", () => {
  it.each([
    ["Horarios\n---\nLunes 19:00", "Horarios Lunes 19:00"],
    ["Aviso\n===", "Aviso ==="],
    ["Material:\n    gorro\n    aletas", "Material: gorro aletas"],
    ["Material:\n\n\tgorro\n\taletas", "Material: gorro aletas"],
    ["Tom &amp; Jerry", "Tom &amp; Jerry"],
    ["&#169; Seadragons", "&#169; Seadragons"],
    ["~texto~", "~texto~"],
  ])("%j da %j", (body, expected) => {
    expect(plainTextOf(body)).toBe(expected);
  });
});

describe("newsBodyToPlainText con las reglas que siguen igual", () => {
  it.each([
    ["Antes\n\n---\n\nDespués", "Antes Después"],
    ["```\nMSAC-2026\n```", "MSAC-2026"],
    ["~~texto~~", "texto"],
    ["# Título\n\nCuerpo", "Título Cuerpo"],
    ["Traed **gorro** y [aletas](https://a.com).", "Traed gorro y aletas."],
  ])("%j da %j", (body, expected) => {
    expect(plainTextOf(body)).toBe(expected);
  });
});
