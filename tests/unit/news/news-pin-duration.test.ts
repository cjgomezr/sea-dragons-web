import { describe, expect, it } from "vitest";
import {
  NEWS_PIN_DURATIONS,
  newsPinEndDate,
} from "@/lib/news/news-pin-duration";

/**
 * Hasta cuándo queda fijada una publicación según la duración elegida (#595,
 * RF-5 del PRD de E22). La comparten la tira del feed, el formulario (#599) y
 * la hoja ⋯ del móvil (#601).
 */

const NOW = new Date("2026-10-14T09:30:00.000Z");

describe("fecha de fin de un fijado", () => {
  it("ofrece las cuatro duraciones del diseño, en su orden", () => {
    expect(NEWS_PIN_DURATIONS).toEqual([
      "oneWeek",
      "twoWeeks",
      "fourWeeks",
      "untilUnpinned",
    ]);
  });

  it.each([
    ["oneWeek", "2026-10-21T09:30:00.000Z"],
    ["twoWeeks", "2026-10-28T09:30:00.000Z"],
    ["fourWeeks", "2026-11-11T09:30:00.000Z"],
  ] as const)("con %s termina a la misma hora %s", (duration, expected) => {
    expect(newsPinEndDate(duration, NOW)).toBe(expected);
  });

  it("hasta que la desfije no tiene fecha de fin", () => {
    expect(newsPinEndDate("untilUnpinned", NOW)).toBeNull();
  });
});
