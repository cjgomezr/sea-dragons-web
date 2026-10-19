import { describe, expect, it } from "vitest";
import { seasonStartFor } from "@/lib/club/season";

/**
 * El inicio de la temporada (#744, D1 del PRD de E27): la fecha que fijó el
 * Admin, o el 1 de enero del año en curso si no hay ninguna o todavía no
 * llegó. No hay fecha de fin.
 */

const TODAY = "2026-10-19";

describe("inicio de la temporada", () => {
  it("cuenta desde el 1 de enero del año en curso sin fecha guardada", () => {
    expect(seasonStartFor(null, TODAY)).toBe("2026-01-01");
  });

  it("cuenta desde la fecha guardada si ya pasó", () => {
    expect(seasonStartFor("2026-03-02", TODAY)).toBe("2026-03-02");
  });

  it("cuenta desde una fecha guardada de un año anterior", () => {
    expect(seasonStartFor("2025-09-01", TODAY)).toBe("2025-09-01");
  });

  it("cuenta desde la fecha guardada si es hoy", () => {
    expect(seasonStartFor(TODAY, TODAY)).toBe(TODAY);
  });

  it("cuenta desde el 1 de enero si la fecha guardada es futura", () => {
    expect(seasonStartFor("2026-10-20", TODAY)).toBe("2026-01-01");
  });

  it("toma el 1 de enero del año de hoy al cambiar de año", () => {
    expect(seasonStartFor("2027-02-01", "2027-01-01")).toBe("2027-01-01");
  });
});
