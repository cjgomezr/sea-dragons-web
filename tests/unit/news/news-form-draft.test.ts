import { describe, expect, it } from "vitest";
import {
  EMPTY_NEWS_FORM_DRAFT,
  type NewsFormDraft,
  isSameNewsFormDraft,
} from "@/components/news/news-form-draft";

/** Si el borrador cambió desde que se abrió el formulario (#602). */

const SENIOR_ID = "9a9a9a9a-0000-4000-8000-000000000009";

const FOR_SENIOR: NewsFormDraft = {
  ...EMPTY_NEWS_FORM_DRAFT,
  audience: { kind: "groups", groupIds: new Set([SENIOR_ID]) },
};

describe("isSameNewsFormDraft", () => {
  it("es el mismo con los mismos valores en objetos distintos", () => {
    expect(
      isSameNewsFormDraft(FOR_SENIOR, {
        ...FOR_SENIOR,
        audience: { kind: "groups", groupIds: new Set([SENIOR_ID]) },
      }),
    ).toBe(true);
  });

  it("cambia si cambia el título", () => {
    expect(
      isSameNewsFormDraft(EMPTY_NEWS_FORM_DRAFT, {
        ...EMPTY_NEWS_FORM_DRAFT,
        title: "Borrador",
      }),
    ).toBe(false);
  });

  it("cambia si cambian los grupos elegidos", () => {
    expect(
      isSameNewsFormDraft(FOR_SENIOR, {
        ...FOR_SENIOR,
        audience: { kind: "groups", groupIds: new Set() },
      }),
    ).toBe(false);
  });

  it("no cambia si vuelve a todo el club con grupos aún marcados", () => {
    expect(
      isSameNewsFormDraft(EMPTY_NEWS_FORM_DRAFT, {
        ...EMPTY_NEWS_FORM_DRAFT,
        audience: { kind: "club", groupIds: new Set([SENIOR_ID]) },
      }),
    ).toBe(true);
  });
});
