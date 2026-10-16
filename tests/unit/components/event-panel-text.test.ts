import { describe, expect, it } from "vitest";
import {
  describeEventWhen,
  describeSeriesRepeat,
} from "@/components/calendar/event-panel-text";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * Lo que dicen los bloques de hora y de repetición del panel del evento
 * (#648, RF-7 del PRD de E24), en los dos idiomas.
 */

const english = createTranslator("en");
const spanish = createTranslator("es");

describe("bloque de hora del panel", () => {
  it("de un día dice el día entero, las horas y lo que dura", () => {
    const when = describeEventWhen(english, {
      startsOn: "2026-10-14",
      startTime: "18:00",
      endsOn: null,
      endTime: "19:30",
    });

    expect(when).toEqual({
      day: "Wednesday, October 14",
      hours: "6:00 pm – 7:30 pm · 1 h 30 min",
    });
  });

  it("de varios días dice los dos días y la hora de cada extremo con su día", () => {
    const when = describeEventWhen(english, {
      startsOn: "2026-10-24",
      startTime: "08:30",
      endsOn: "2026-10-25",
      endTime: "17:00",
    });

    expect(when).toEqual({
      day: "Sat, Oct 24 – Sun, Oct 25",
      hours: "8:30 am Sat – 5:00 pm Sun · 2 days",
    });
  });

  it("sin hora de fin dice sólo el inicio", () => {
    const when = describeEventWhen(english, {
      startsOn: "2026-10-14",
      startTime: "18:00",
      endsOn: null,
      endTime: null,
    });

    expect(when).toEqual({ day: "Wednesday, October 14", hours: "6:00 pm" });
  });

  it("escribe el de un día en español", () => {
    const when = describeEventWhen(spanish, {
      startsOn: "2026-10-14",
      startTime: "18:00",
      endsOn: null,
      endTime: "19:30",
    });

    expect(when.day).toBe("miércoles, 14 de octubre");
    expect(when.hours).toMatch(/ · 1 h 30 min$/);
  });

  it("escribe el de varios días en español", () => {
    const when = describeEventWhen(spanish, {
      startsOn: "2026-10-24",
      startTime: "08:30",
      endsOn: "2026-10-25",
      endTime: "17:00",
    });

    expect(when.day).toBe("sáb, 24 oct – dom, 25 oct");
    expect(when.hours).toMatch(/ sáb – .* dom · 2 días$/);
  });
});

describe("bloque de repetición del panel", () => {
  it("dice los días de la serie y hasta cuándo, con las sesiones que quedan", () => {
    const repeat = describeSeriesRepeat(english, {
      weekdays: [3],
      endsOn: "2026-12-16",
      sessionsLeft: 10,
    });

    expect(repeat).toEqual({
      days: "Every Wednesday",
      until: "Until Dec 16 · 10 sessions left",
    });
  });

  it("dice una sola sesión en singular", () => {
    const repeat = describeSeriesRepeat(english, {
      weekdays: [1, 4],
      endsOn: "2026-12-17",
      sessionsLeft: 1,
    });

    expect(repeat).toEqual({
      days: "Every Monday and Thursday",
      until: "Until Dec 17 · 1 session left",
    });
  });

  it("escribe la repetición en español", () => {
    const repeat = describeSeriesRepeat(spanish, {
      weekdays: [3],
      endsOn: "2026-12-16",
      sessionsLeft: 10,
    });

    expect(repeat).toEqual({
      days: "Todos los miércoles",
      until: "Hasta el 16 dic · quedan 10 sesiones",
    });
  });

  it("escribe una sola sesión en español", () => {
    const repeat = describeSeriesRepeat(spanish, {
      weekdays: [6],
      endsOn: "2026-12-19",
      sessionsLeft: 1,
    });

    expect(repeat).toEqual({
      days: "Todos los sábados",
      until: "Hasta el 19 dic · queda 1 sesión",
    });
  });
});
