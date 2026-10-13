import { describe, expect, it } from "vitest";
import {
  InvalidNewsPinUntilError,
  isNewsPinActive,
  readNewsPinUntil,
} from "@/lib/news/news-pin-rule";

/**
 * La regla de "está fijada" (#592, RF-3 y D7 del PRD de E22): la caducidad
 * se calcula al leer, comparando `pinnedUntil` con la hora actual.
 */

const NOW = new Date("2026-10-13T10:00:00.000Z");
const PINNED_AT = "2026-10-10T10:00:00.000Z";

describe("isNewsPinActive", () => {
  it("no está fijada si no tiene fijado", () => {
    expect(isNewsPinActive(null, NOW)).toBe(false);
  });

  it("está fijada sin fecha de fin", () => {
    expect(
      isNewsPinActive({ pinnedAt: PINNED_AT, pinnedUntil: null }, NOW),
    ).toBe(true);
  });

  it("está fijada si su fecha de fin aún no llega", () => {
    expect(
      isNewsPinActive(
        { pinnedAt: PINNED_AT, pinnedUntil: "2026-10-13T10:00:01.000Z" },
        NOW,
      ),
    ).toBe(true);
  });

  it("cuenta como no fijada en cuanto llega su fecha de fin", () => {
    expect(
      isNewsPinActive(
        { pinnedAt: PINNED_AT, pinnedUntil: NOW.toISOString() },
        NOW,
      ),
    ).toBe(false);
  });

  it("cuenta como no fijada si su fecha de fin ya pasó", () => {
    expect(
      isNewsPinActive(
        { pinnedAt: PINNED_AT, pinnedUntil: "2026-10-12T10:00:00.000Z" },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("readNewsPinUntil", () => {
  it("deja sin fecha de fin a quien no la pone", () => {
    expect(readNewsPinUntil(null, NOW)).toBeNull();
  });

  it("devuelve la fecha de fin futura como instante ISO", () => {
    expect(readNewsPinUntil("2026-10-27T10:00:00+11:00", NOW)).toBe(
      "2026-10-26T23:00:00.000Z",
    );
  });

  it("rechaza una fecha de fin que ya pasó", () => {
    expect(() => readNewsPinUntil("2026-10-13T09:59:59.000Z", NOW)).toThrow(
      InvalidNewsPinUntilError,
    );
  });

  it("rechaza una fecha de fin que es justo ahora", () => {
    expect(() => readNewsPinUntil(NOW.toISOString(), NOW)).toThrow(
      InvalidNewsPinUntilError,
    );
  });

  it("rechaza una fecha de fin mal formada", () => {
    expect(() => readNewsPinUntil("la semana que viene", NOW)).toThrow(
      InvalidNewsPinUntilError,
    );
  });
});
