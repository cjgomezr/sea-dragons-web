import { describe, expect, it } from "vitest";
import { isNewsUnread, newsUnreadCutoff } from "@/lib/news/news-seen";

/**
 * Qué cuenta como sin leer (#424, D2 del PRD de E14): lo publicado después de
 * la última visita a Noticias, o en los últimos 30 días si nunca las abrió.
 * El inicio cuenta con esta regla y el feed pinta con ella el punto de no
 * leída (#594), así que las dos dicen lo mismo.
 */

const NOW = new Date("2026-10-13T08:00:00.000Z");
const SEEN_AT = "2026-10-10T08:00:00.000Z";

describe("lo que cuenta como sin leer", () => {
  it("es lo publicado después de la última visita", () => {
    const cutoff = newsUnreadCutoff(SEEN_AT, NOW);

    expect(
      isNewsUnread(
        { publishedAt: "2026-10-11T08:00:00.000Z", status: "published" },
        cutoff,
      ),
    ).toBe(true);
  });

  it("no es lo publicado en el instante de la visita ni antes", () => {
    const cutoff = newsUnreadCutoff(SEEN_AT, NOW);

    expect(
      isNewsUnread({ publishedAt: SEEN_AT, status: "published" }, cutoff),
    ).toBe(false);
    expect(
      isNewsUnread(
        { publishedAt: "2026-10-09T08:00:00.000Z", status: "published" },
        cutoff,
      ),
    ).toBe(false);
  });

  it("sin ninguna visita, es lo de los últimos 30 días", () => {
    const cutoff = newsUnreadCutoff(null, NOW);

    expect(
      isNewsUnread(
        { publishedAt: "2026-09-14T08:00:00.000Z", status: "published" },
        cutoff,
      ),
    ).toBe(true);
    expect(
      isNewsUnread(
        { publishedAt: "2026-09-12T08:00:00.000Z", status: "published" },
        cutoff,
      ),
    ).toBe(false);
  });

  it("una retirada nunca está sin leer: no es algo que leer", () => {
    const cutoff = newsUnreadCutoff(SEEN_AT, NOW);

    expect(
      isNewsUnread(
        { publishedAt: "2026-10-11T08:00:00.000Z", status: "withdrawn" },
        cutoff,
      ),
    ).toBe(false);
  });
});
