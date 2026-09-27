import { describe, expect, it } from "vitest";
import {
  countRangeDays,
  generateWeeklyOccurrences,
} from "@/lib/events/event-occurrences";
import { type ClubMoment, clubMoment } from "@/lib/time/club-calendar";

/**
 * Las fechas de una serie semanal (#307, RF-3 del PRD de E7). Son días de
 * calendario de Melbourne: la hora la combina la base con cada fecha, así que
 * aquí no puede colarse ningún desfase de horario de verano.
 */

const TUESDAY = 2;
const THURSDAY = 4;
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7] as const;

/** Un momento del club muy anterior a cualquier fecha de estos casos. */
const LONG_AGO: ClubMoment = { date: "2020-01-01", time: "00:00" };

describe("generar ocurrencias", () => {
  it("da cada martes y cada jueves de julio y agosto, extremos incluidos", () => {
    const dates = generateWeeklyOccurrences(
      {
        weekdays: [TUESDAY, THURSDAY],
        startsOn: "2027-07-01",
        endsOn: "2027-08-31",
        startTime: "19:00",
      },
      LONG_AGO,
    );

    expect(dates).toEqual([
      "2027-07-01",
      "2027-07-06",
      "2027-07-08",
      "2027-07-13",
      "2027-07-15",
      "2027-07-20",
      "2027-07-22",
      "2027-07-27",
      "2027-07-29",
      "2027-08-03",
      "2027-08-05",
      "2027-08-10",
      "2027-08-12",
      "2027-08-17",
      "2027-08-19",
      "2027-08-24",
      "2027-08-26",
      "2027-08-31",
    ]);
  });

  it("da una sola fecha en un rango de un día que cae en un día elegido", () => {
    const dates = generateWeeklyOccurrences(
      {
        weekdays: [TUESDAY],
        startsOn: "2027-07-06",
        endsOn: "2027-07-06",
        startTime: "19:00",
      },
      LONG_AGO,
    );

    expect(dates).toEqual(["2027-07-06"]);
  });

  it("no da ninguna fecha si el rango no contiene ninguno de los días elegidos", () => {
    const dates = generateWeeklyOccurrences(
      {
        weekdays: [TUESDAY],
        startsOn: "2027-07-07",
        endsOn: "2027-07-12",
        startTime: "19:00",
      },
      LONG_AGO,
    );

    expect(dates).toEqual([]);
  });

  it("salta la de hoy si su hora ya pasó y deja las siguientes", () => {
    const dates = generateWeeklyOccurrences(
      {
        weekdays: [TUESDAY],
        startsOn: "2027-07-06",
        endsOn: "2027-07-20",
        startTime: "19:00",
      },
      { date: "2027-07-06", time: "19:30" },
    );

    expect(dates).toEqual(["2027-07-13", "2027-07-20"]);
  });

  it("mantiene la de hoy si su hora todavía no llegó", () => {
    const dates = generateWeeklyOccurrences(
      {
        weekdays: [TUESDAY],
        startsOn: "2027-07-06",
        endsOn: "2027-07-13",
        startTime: "19:00",
      },
      { date: "2027-07-06", time: "18:59" },
    );

    expect(dates).toEqual(["2027-07-06", "2027-07-13"]);
  });

  it("no da fechas anteriores a hoy aunque el rango empiece antes", () => {
    const dates = generateWeeklyOccurrences(
      {
        weekdays: [TUESDAY],
        startsOn: "2027-06-29",
        endsOn: "2027-07-13",
        startTime: "19:00",
      },
      { date: "2027-07-01", time: "08:00" },
    );

    expect(dates).toEqual(["2027-07-06", "2027-07-13"]);
  });

  it.each([
    // El horario de verano termina el primer domingo de abril de 2027 (el 4)
    // y empieza el primer domingo de octubre (el 3).
    ["abril", "2027-03-29", "2027-04-12", ["2027-03-30", "2027-04-06"]],
    ["octubre", "2027-09-27", "2027-10-11", ["2027-09-28", "2027-10-05"]],
  ])(
    "no mueve ninguna fecha al cruzar el cambio de horario de %s",
    (_month, startsOn, endsOn, expected) => {
      const dates = generateWeeklyOccurrences(
        { weekdays: [TUESDAY], startsOn, endsOn, startTime: "19:00" },
        LONG_AGO,
      );

      expect(dates).toEqual(expected);
    },
  );

  it("da como mucho 366 fechas en un año entero de lunes a domingo", () => {
    const dates = generateWeeklyOccurrences(
      {
        weekdays: EVERY_DAY,
        startsOn: "2026-10-01",
        endsOn: "2027-10-01",
        startTime: "19:00",
      },
      LONG_AGO,
    );

    expect(dates).toHaveLength(366);
    expect(new Set(dates).size).toBe(366);
  });
});

describe("contar los días de un rango", () => {
  it("cuenta los dos extremos", () => {
    expect(countRangeDays("2027-07-01", "2027-07-01")).toBe(1);
    expect(countRangeDays("2026-10-01", "2027-10-01")).toBe(366);
  });

  it("da cero o menos cuando el fin va antes del inicio", () => {
    expect(countRangeDays("2027-07-02", "2027-07-01")).toBeLessThan(1);
  });
});

describe("el momento del club", () => {
  it.each([
    // 2027-04-04 08:30Z: ya es hora estándar (UTC+10).
    ["2027-04-04T08:30:00Z", { date: "2027-04-04", time: "18:30" }],
    // 2027-04-03 08:30Z: todavía horario de verano (UTC+11).
    ["2027-04-03T08:30:00Z", { date: "2027-04-03", time: "19:30" }],
    // Medianoche de Melbourne es la tarde anterior en UTC.
    ["2027-07-05T14:00:00Z", { date: "2027-07-06", time: "00:00" }],
  ])("lee %s como la fecha y la hora de Melbourne", (instant, expected) => {
    expect(clubMoment(new Date(instant))).toEqual(expected);
  });
});
