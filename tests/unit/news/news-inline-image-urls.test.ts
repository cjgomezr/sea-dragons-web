import { describe, expect, it } from "vitest";
import {
  newsInlineImageUrlOf,
  readNewsInlineImageId,
} from "@/lib/news/news-inline-image-urls";
import { findNewsInlineImageIds } from "@/lib/news/news-markdown";

/**
 * Qué direcciones del cuerpo de una noticia son imágenes del club (#603,
 * RF-14 del PRD de E22). Sólo esas se pintan, y sólo esas se ligan a la
 * publicación al guardarla.
 */

const IMAGE_ID = "1d1d1d1d-0000-4000-8000-000000000001";
const OTHER_IMAGE_ID = "1d1d1d1d-0000-4000-8000-000000000002";

describe("la dirección de una imagen del cuerpo", () => {
  it("es una dirección estable de la API, sin firma", () => {
    expect(newsInlineImageUrlOf(IMAGE_ID)).toBe(
      `/api/v1/news/images/${IMAGE_ID}`,
    );
  });

  it("de la dirección se lee su id", () => {
    expect(readNewsInlineImageId(newsInlineImageUrlOf(IMAGE_ID))).toBe(
      IMAGE_ID,
    );
  });

  it.each([
    ["una imagen de otro sitio", "https://otro-sitio.test/x.png"],
    [
      "la misma ruta en otro dominio",
      `https://otro-sitio.test/api/v1/news/images/${IMAGE_ID}`,
    ],
    ["un id que no es un uuid", "/api/v1/news/images/../../admin"],
    ["otra ruta de la API", `/api/v1/news/${IMAGE_ID}`],
    ["la ruta con algo detrás", `/api/v1/news/images/${IMAGE_ID}?x=1`],
    ["un data:", "data:image/png;base64,AAAA"],
  ])("%s no es del club", (_case, url) => {
    expect(readNewsInlineImageId(url)).toBeNull();
  });
});

describe("findNewsInlineImageIds", () => {
  it("encuentra las imágenes del club del cuerpo, en orden y sin repetir", () => {
    const body = [
      `![El equipo](/api/v1/news/images/${IMAGE_ID})`,
      "Texto en medio.",
      `![](/api/v1/news/images/${OTHER_IMAGE_ID})`,
      `![otra vez](/api/v1/news/images/${IMAGE_ID})`,
    ].join("\n\n");

    expect(findNewsInlineImageIds(body)).toEqual([IMAGE_ID, OTHER_IMAGE_ID]);
  });

  it("cuenta también la imagen escrita con referencia", () => {
    const body = `![equipo][foto]\n\n[foto]: /api/v1/news/images/${IMAGE_ID}`;

    expect(findNewsInlineImageIds(body)).toEqual([IMAGE_ID]);
  });

  it("no cuenta las imágenes de fuera ni los enlaces a una imagen", () => {
    const body = [
      "![](https://otro-sitio.test/x.png)",
      `[un enlace](/api/v1/news/images/${IMAGE_ID})`,
    ].join("\n\n");

    expect(findNewsInlineImageIds(body)).toEqual([]);
  });

  it("no cuenta la dirección escrita dentro de un bloque de código", () => {
    const body = `\`![](/api/v1/news/images/${IMAGE_ID})\``;

    expect(findNewsInlineImageIds(body)).toEqual([]);
  });
});
