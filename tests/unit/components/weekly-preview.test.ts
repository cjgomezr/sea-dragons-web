import { describe, expect, it } from "vitest";
import { previewWeeklySeries } from "@/components/calendar/weekly-preview";
import type { IsoWeekday } from "@/lib/events/event-occurrences";
import { generateWeeklyOccurrences } from "@/lib/events/event-occurrences";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * El resumen de una serie semanal antes de crearla (#651, RF-10 del PRD de
 * E24): cuántas sesiones salen, hasta cuándo y cuáles son las primeras, con
 * la misma regla que el servidor.
 */

const english = createTranslator("en");
const spanish = createTranslator("es");

const BEFORE_THE_SERIES = { date: "2026-10-01", time: "09:00" };

const MONDAYS_AND_THURSDAYS = {
  weekdays: new Set<IsoWeekday>([1, 4]),
  startsOn: "2026-10-01",
  endsOn: "2026-12-17",
  startTime: "18:00",
  endTime: "19:30",
};

describe("resumen de una serie semanal", () => {
  it("con dos días dice los dos, las horas, cuántas sesiones y la última", () => {
    const preview = previewWeeklySeries(
      english,
      MONDAYS_AND_THURSDAYS,
      BEFORE_THE_SERIES,
    );

    expect(preview).toMatchObject({
      kind: "sessions",
      summary:
        "Every Monday and Thursday, 6:00 pm – 7:30 pm · 23 sessions until Thu, 17 Dec",
    });
  });

  it("en español dice los días en plural y la fecha con el día delante", () => {
    const preview = previewWeeklySeries(
      spanish,
      MONDAYS_AND_THURSDAYS,
      BEFORE_THE_SERIES,
    );

    expect(preview).toMatchObject({
      kind: "sessions",
      summary:
        "Todos los lunes y jueves, 18:00 – 19:30 · 23 sesiones hasta el jue 17 dic",
    });
  });

  it("con un solo día y una sola sesión lo dice en singular", () => {
    const preview = previewWeeklySeries(
      english,
      {
        ...MONDAYS_AND_THURSDAYS,
        weekdays: new Set<IsoWeekday>([6]),
        endsOn: "2026-10-03",
      },
      BEFORE_THE_SERIES,
    );

    expect(preview).toEqual({
      kind: "sessions",
      summary: "Every Saturday, 6:00 pm – 7:30 pm · 1 session until Sat, 3 Oct",
      nextDates: ["Sat, 3 Oct"],
      moreCount: 0,
    });
  });

  it("con los siete días dice todos los días, no la lista", () => {
    const allWeek = {
      ...MONDAYS_AND_THURSDAYS,
      weekdays: new Set<IsoWeekday>([1, 2, 3, 4, 5, 6, 7]),
      endsOn: "2026-10-07",
    };

    const inEnglish = previewWeeklySeries(english, allWeek, BEFORE_THE_SERIES);
    const inSpanish = previewWeeklySeries(spanish, allWeek, BEFORE_THE_SERIES);

    expect(inEnglish).toMatchObject({
      summary: "Every day, 6:00 pm – 7:30 pm · 7 sessions until Wed, 7 Oct",
    });
    expect(inSpanish).toMatchObject({
      summary: "Todos los días, 18:00 – 19:30 · 7 sesiones hasta el mié 7 oct",
    });
  });

  it("enseña las cuatro primeras fechas y cuántas más quedan", () => {
    const preview = previewWeeklySeries(
      spanish,
      MONDAYS_AND_THURSDAYS,
      BEFORE_THE_SERIES,
    );

    expect(preview).toMatchObject({
      nextDates: ["jue 1 oct", "lun 5 oct", "jue 8 oct", "lun 12 oct"],
      moreCount: 19,
    });
  });

  it("cuenta lo mismo que la regla del servidor, sin las que ya empezaron", () => {
    const now = { date: "2026-10-05", time: "18:00" };

    const preview = previewWeeklySeries(english, MONDAYS_AND_THURSDAYS, now);

    const serverSessions = generateWeeklyOccurrences(
      { ...MONDAYS_AND_THURSDAYS, weekdays: [1, 4] },
      now,
    );
    expect(preview).toMatchObject({
      summary: `Every Monday and Thursday, 6:00 pm – 7:30 pm · ${serverSessions.length} sessions until Thu, 17 Dec`,
      nextDates: ["Thu, 8 Oct", "Mon, 12 Oct", "Thu, 15 Oct", "Mon, 19 Oct"],
    });
  });

  it("al cruzar el cambio de horario no pierde ni repite ninguna fecha", () => {
    // Melbourne pasa al horario de verano el domingo 4 de octubre de 2026.
    const preview = previewWeeklySeries(
      english,
      {
        weekdays: new Set<IsoWeekday>([6, 7]),
        startsOn: "2026-10-03",
        endsOn: "2026-10-04",
        startTime: "19:00",
        endTime: "20:00",
      },
      BEFORE_THE_SERIES,
    );

    expect(preview).toEqual({
      kind: "sessions",
      summary:
        "Every Saturday and Sunday, 7:00 pm – 8:00 pm · 2 sessions until Sun, 4 Oct",
      nextDates: ["Sat, 3 Oct", "Sun, 4 Oct"],
      moreCount: 0,
    });
  });

  it("sin días pide al menos uno, aunque falten las fechas", () => {
    const preview = previewWeeklySeries(
      english,
      { ...MONDAYS_AND_THURSDAYS, weekdays: new Set(), endsOn: "" },
      BEFORE_THE_SERIES,
    );

    expect(preview).toEqual({ kind: "noDays" });
  });

  it("si ningún día cae en el rango, no hay sesiones", () => {
    const preview = previewWeeklySeries(
      english,
      {
        ...MONDAYS_AND_THURSDAYS,
        weekdays: new Set<IsoWeekday>([3]),
        startsOn: "2026-10-01",
        endsOn: "2026-10-02",
      },
      BEFORE_THE_SERIES,
    );

    expect(preview).toEqual({ kind: "noSessions" });
  });

  it("con el fin antes del inicio no hay sesiones", () => {
    const preview = previewWeeklySeries(
      english,
      { ...MONDAYS_AND_THURSDAYS, endsOn: "2026-09-30" },
      BEFORE_THE_SERIES,
    );

    expect(preview).toEqual({ kind: "noSessions" });
  });

  it("sin la hora de fin dice sólo la de inicio", () => {
    const preview = previewWeeklySeries(
      english,
      { ...MONDAYS_AND_THURSDAYS, endsOn: "2026-10-01", endTime: "" },
      BEFORE_THE_SERIES,
    );

    expect(preview).toMatchObject({
      summary:
        "Every Monday and Thursday, 6:00 pm · 1 session until Thu, 1 Oct",
    });
  });

  it.each([
    ["el inicio", { startsOn: "" }],
    ["el fin", { endsOn: "" }],
    ["la hora de inicio", { startTime: "" }],
  ])("sin %s todavía no resume nada", (_missing, blank) => {
    const preview = previewWeeklySeries(
      english,
      { ...MONDAYS_AND_THURSDAYS, ...blank },
      BEFORE_THE_SERIES,
    );

    expect(preview).toEqual({ kind: "incomplete" });
  });
});
