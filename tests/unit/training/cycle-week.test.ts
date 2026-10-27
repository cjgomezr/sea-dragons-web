import { describe, expect, it } from "vitest";
import { cycleEndDate, cycleWeekAt } from "@/lib/training/cycle-week";

/**
 * La semana del ciclo en la que cae un instante (#898, D5 del PRD de E35),
 * con la hora de Melbourne y el reloj inyectado.
 */

/** Un lunes. Cuatro semanas acaban el domingo 2026-10-25. */
const CYCLE = { startDate: "2026-09-28", weeks: 4 };

describe("cycleWeekAt", () => {
  it("el lunes de inicio, a primera hora de Melbourne, es la semana 1", () => {
    // 00:30 del lunes en Melbourne (AEST, UTC+10) es domingo en UTC.
    const now = new Date("2026-09-27T14:30:00Z");

    expect(cycleWeekAt(CYCLE, now)).toEqual({
      week: 1,
      phase: "running",
      today: "2026-09-28",
    });
  });

  it("el domingo de fin, a última hora de Melbourne, es la semana N", () => {
    // 23:30 del domingo 25 en Melbourne (AEDT, UTC+11).
    const now = new Date("2026-10-25T12:30:00Z");

    expect(cycleWeekAt(CYCLE, now)).toEqual({
      week: 4,
      phase: "running",
      today: "2026-10-25",
    });
  });

  it("antes del inicio es la semana 1 de un ciclo que no empezó", () => {
    const now = new Date("2026-09-27T13:30:00Z");

    expect(cycleWeekAt(CYCLE, now)).toEqual({
      week: 1,
      phase: "not_started",
      today: "2026-09-27",
    });
  });

  it("después del fin es la semana N de un ciclo terminado", () => {
    // 00:30 del lunes 26 en Melbourne.
    const now = new Date("2026-10-25T13:30:00Z");

    expect(cycleWeekAt(CYCLE, now)).toEqual({
      week: 4,
      phase: "finished",
      today: "2026-10-26",
    });
  });

  it("cruza el cambio al horario de verano sin moverse de día", () => {
    // El horario de verano empieza el domingo 4 de octubre de 2026 a las
    // 02:00. El domingo a las 23:30 sigue en la semana 1; el lunes a las
    // 00:30 ya es la 2.
    const sundayNight = new Date("2026-10-04T12:30:00Z");
    const mondayMorning = new Date("2026-10-04T13:30:00Z");

    expect(cycleWeekAt(CYCLE, sundayNight)).toMatchObject({
      week: 1,
      today: "2026-10-04",
    });
    expect(cycleWeekAt(CYCLE, mondayMorning)).toMatchObject({
      week: 2,
      today: "2026-10-05",
    });
  });
});

describe("cycleEndDate", () => {
  it("es el domingo de la última semana", () => {
    expect(cycleEndDate(CYCLE)).toBe("2026-10-25");
  });
});
