import { describe, expect, it } from "vitest";
import { newsAttachmentKindOf } from "@/lib/news/news-attachment-kind";

/** El icono de cada adjunto en la publicación abierta (#596). */

describe("newsAttachmentKindOf", () => {
  it.each([
    ["application/pdf", "pdf"],
    ["image/jpeg", "image"],
    ["image/png", "image"],
    ["image/webp", "image"],
    ["application/msword", "word"],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "word",
    ],
  ])("%s es %s", (contentType, kind) => {
    expect(newsAttachmentKindOf(contentType)).toBe(kind);
  });

  it("un tipo que no se admite cae al archivo genérico", () => {
    expect(newsAttachmentKindOf("text/csv")).toBe("other");
  });

  it("no confunde una propiedad heredada con un tipo", () => {
    expect(newsAttachmentKindOf("toString")).toBe("other");
  });
});
