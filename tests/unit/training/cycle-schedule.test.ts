import { describe, expect, it } from "vitest";
import {
  WeekOneCopyTooShortError,
  cycleStartDate,
  weekOneCopyTargets,
} from "@/lib/training/cycle-schedule";

/**
 * Cuándo empieza la semana 1 de un ciclo (#904, D5 del PRD de E35) y a qué
 * semanas pasa la semana 1 al copiarla (RF-8). Son días de calendario de
 * Melbourne: el cambio de horario no mueve ninguno.
 */

describe("cycleStartDate", () => {
  it("con evento, empieza el lunes de la semana del evento menos N − 1 semanas", () => {
    // Domingo 13 de diciembre de 2026: su lunes es el 7; 16 semanas antes del
    // final, el lunes 24 de agosto.
    const start = cycleStartDate(
      { kind: "event", eventName: "Nationals", eventDate: "2026-12-13" },
      16,
    );

    expect(start).toBe("2026-08-24");
  });

  it("con evento en lunes, ese lunes es el de la última semana", () => {
    const start = cycleStartDate(
      { kind: "event", eventName: "Nationals", eventDate: "2026-12-07" },
      2,
    );

    expect(start).toBe("2026-11-30");
  });

  it("con evento en domingo, cuenta desde el lunes anterior, no el siguiente", () => {
    const start = cycleStartDate(
      { kind: "event", eventName: "Nationals", eventDate: "2026-12-13" },
      1,
    );

    expect(start).toBe("2026-12-07");
  });

  it("sin evento, lleva una fecha que no es lunes al lunes de su semana", () => {
    const start = cycleStartDate({ kind: "start", startDate: "2026-10-29" }, 8);

    expect(start).toBe("2026-10-26");
  });

  it("sin evento, deja un lunes como está", () => {
    const start = cycleStartDate({ kind: "start", startDate: "2026-10-26" }, 8);

    expect(start).toBe("2026-10-26");
  });

  it("con una semana, empieza el lunes de la semana del evento", () => {
    const start = cycleStartDate(
      { kind: "event", eventName: "Cup", eventDate: "2027-03-03" },
      1,
    );

    expect(start).toBe("2027-03-01");
  });

  it("con 52 semanas, retrocede 51 semanas desde el lunes del evento", () => {
    const start = cycleStartDate(
      { kind: "event", eventName: "Worlds", eventDate: "2027-08-15" },
      52,
    );

    expect(start).toBe("2026-08-17");
  });

  it("no se mueve un día al cruzar el cambio de horario de Melbourne", () => {
    // El horario de verano empieza el domingo 4 de octubre de 2026 y acaba el
    // domingo 4 de abril de 2027: el ciclo cruza los dos.
    const start = cycleStartDate(
      { kind: "event", eventName: "Autumn Cup", eventDate: "2027-04-10" },
      28,
    );

    expect(start).toBe("2026-09-28");
  });
});

describe("weekOneCopyTargets", () => {
  it("con 4 semanas, copia sólo a la semana 2", () => {
    expect(weekOneCopyTargets(4)).toEqual([2]);
  });

  it("con 5 semanas, copia a las semanas 2 y 3", () => {
    expect(weekOneCopyTargets(5)).toEqual([2, 3]);
  });

  it("con 28 semanas, copia de la 2 a la 26 y deja las dos últimas", () => {
    const targets = weekOneCopyTargets(28);

    expect(targets).toHaveLength(25);
    expect(targets[0]).toBe(2);
    expect(targets.at(-1)).toBe(26);
  });

  it.each([1, 2, 3])("con %i semanas no se puede copiar", (weeks) => {
    expect(() => weekOneCopyTargets(weeks)).toThrow(WeekOneCopyTooShortError);
  });
});
