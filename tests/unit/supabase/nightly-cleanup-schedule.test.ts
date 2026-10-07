import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El horario de la limpieza nocturna (#523, RF-4 de
 * `docs/prd/e16b-scheduler-y-carga.md`). `pg_cron` lo lee en UTC y el club
 * vive en Melbourne: el mismo horario cae una hora más tarde en invierno que
 * en verano, y las dos tienen que quedar de madrugada y fuera de las franjas
 * de NFR-003.
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/0062_schedule_nightly_cleanup.sql",
);
const CLUB_TIME_ZONE = "Australia/Melbourne";
/** "De madrugada": antes de que nadie del club entrene ni mire la web. */
const LATEST_EARLY_MORNING_HOUR = 6;

interface ClubWindow {
  readonly weekday: string;
  readonly fromHour: number;
  readonly toHour: number;
}

/** Las franjas de NFR-003, en hora de Melbourne. */
const NFR_003_WINDOWS: readonly ClubWindow[] = [
  { weekday: "Tue", fromHour: 18, toHour: 22 },
  { weekday: "Thu", fromHour: 18, toHour: 22 },
  { weekday: "Sat", fromHour: 8, toHour: 13 },
];

/** Una semana entera de cada horario, empezando un lunes. */
const SEASONS = {
  "verano (AEDT, UTC+11)": "2027-01-11",
  "invierno (AEST, UTC+10)": "2027-07-12",
} as const;
const DAYS_IN_WEEK = 7;

function readSchedule(): string {
  const sql = readFileSync(MIGRATION, "utf8");
  const match =
    /nightly_cleanup_schedule\s+constant\s+text\s*:=\s*'([^']+)'/.exec(sql);
  if (!match) {
    throw new Error("la migración no declara nightly_cleanup_schedule");
  }
  const [, schedule = ""] = match;
  return schedule;
}

interface ClubMoment {
  readonly weekday: string;
  readonly hour: number;
  readonly minute: number;
}

function toClubMoment(instant: Date): ClubMoment {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: CLUB_TIME_ZONE,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return {
    weekday: String(parts.weekday),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function isInsideClubWindow(moment: ClubMoment): boolean {
  return NFR_003_WINDOWS.some(
    (window) =>
      window.weekday === moment.weekday &&
      moment.hour >= window.fromHour &&
      moment.hour < window.toHour,
  );
}

/** Cada corrida de una semana, como hora de Melbourne. */
function weekOfRuns(mondayIso: string, schedule: string): ClubMoment[] {
  const [minute = Number.NaN, hour = Number.NaN] = schedule
    .split(" ")
    .map(Number);
  return Array.from({ length: DAYS_IN_WEEK }, (_, offset) => {
    const run = new Date(`${mondayIso}T00:00:00Z`);
    run.setUTCDate(run.getUTCDate() + offset);
    run.setUTCHours(hour, minute);
    return toClubMoment(run);
  });
}

describe("horario de la limpieza nocturna", () => {
  it("corre todos los días a una hora fija", () => {
    const fields = readSchedule().split(" ");

    expect(fields).toHaveLength(5);
    expect(fields.slice(0, 2).every((field) => /^\d+$/.test(field))).toBe(true);
    expect(fields.slice(2)).toEqual(["*", "*", "*"]);
  });

  it.each(Object.entries(SEASONS))(
    "en %s cae de madrugada en Melbourne",
    (_season, monday) => {
      const runs = weekOfRuns(monday, readSchedule());

      expect(runs.every((run) => run.hour < LATEST_EARLY_MORNING_HOUR)).toBe(
        true,
      );
    },
  );

  it.each(Object.entries(SEASONS))(
    "en %s no cae en ninguna franja de NFR-003",
    (_season, monday) => {
      const runs = weekOfRuns(monday, readSchedule());

      expect(runs.filter(isInsideClubWindow)).toEqual([]);
    },
  );

  it("detecta una corrida dentro de una franja de NFR-003", () => {
    const saturdayMorning = toClubMoment(new Date("2027-07-16T23:30:00Z"));

    expect(saturdayMorning).toEqual({ weekday: "Sat", hour: 9, minute: 30 });
    expect(isInsideClubWindow(saturdayMorning)).toBe(true);
  });
});
