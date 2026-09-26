import { describe, expect, it } from "vitest";
import {
  type NewsDraftInput,
  listNewsDraftIssues,
} from "@/lib/news/news-draft";
import { NEWS_TITLE_MAX_LENGTH } from "@/lib/news/news-posts";

/**
 * La misma regla que el servidor aplica al publicar (#327), comprobada en el
 * formulario antes de mandar nada (#330): así el aviso sale junto a su campo.
 */

const VALID: NewsDraftInput = {
  title: "Cambia la piscina",
  body: "El martes entrenamos en MSAC.",
  audience: { kind: "club" },
};

describe("formulario de publicar: validación", () => {
  it("no encuentra nada en un borrador completo", () => {
    expect(listNewsDraftIssues(VALID)).toEqual([]);
  });

  it.each(["", "   "])("pide el título si viene %j", (title) => {
    expect(listNewsDraftIssues({ ...VALID, title })).toEqual([
      { field: "title", code: "title_missing" },
    ]);
  });

  it("acepta un título de justo 120 caracteres, contados sin los espacios de los bordes", () => {
    const title = ` ${"ñ".repeat(NEWS_TITLE_MAX_LENGTH)} `;

    expect(listNewsDraftIssues({ ...VALID, title })).toEqual([]);
  });

  it("rechaza un título de más de 120 caracteres", () => {
    const title = "a".repeat(NEWS_TITLE_MAX_LENGTH + 1);

    expect(listNewsDraftIssues({ ...VALID, title })).toEqual([
      { field: "title", code: "title_too_long" },
    ]);
  });

  it("pide el cuerpo si sólo trae blancos y saltos de línea", () => {
    expect(listNewsDraftIssues({ ...VALID, body: " \n\n " })).toEqual([
      { field: "body", code: "body_missing" },
    ]);
  });

  it("pide al menos un grupo cuando la audiencia es de grupos", () => {
    expect(
      listNewsDraftIssues({
        ...VALID,
        audience: { kind: "groups", groupIds: [] },
      }),
    ).toEqual([{ field: "audience", code: "audience_groups_empty" }]);
  });

  it("marca todos los campos que fallan a la vez, en el orden del formulario", () => {
    expect(
      listNewsDraftIssues({
        title: "",
        body: "",
        audience: { kind: "groups", groupIds: [] },
      }).map((issue) => issue.field),
    ).toEqual(["title", "body", "audience"]);
  });
});
