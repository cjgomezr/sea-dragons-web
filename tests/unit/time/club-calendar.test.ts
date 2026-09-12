import { describe, expect, it } from "vitest";
import { CLUB_TIME_ZONE, clubCalendarDate } from "@/lib/time/club-calendar";

describe("calendario del club", () => {
  it("opera en la zona horaria de Melbourne", () => {
    expect(CLUB_TIME_ZONE).toBe("Australia/Melbourne");
  });

  it("devuelve el día del club, no el de UTC, cuando los dos no coinciden", () => {
    // 23:00 UTC del 11 ya es el 12 en Melbourne (AEST, UTC+10).
    const instant = new Date("2026-09-11T23:00:00.000Z");

    expect(clubCalendarDate(instant)).toBe("2026-09-12");
  });

  it("devuelve el día del club durante el horario de verano (AEDT, UTC+11)", () => {
    const instant = new Date("2026-12-31T13:30:00.000Z");

    expect(clubCalendarDate(instant)).toBe("2027-01-01");
  });

  it("rellena mes y día con cero a la izquierda", () => {
    const instant = new Date("2026-03-05T00:00:00.000Z");

    expect(clubCalendarDate(instant)).toBe("2026-03-05");
  });
});
