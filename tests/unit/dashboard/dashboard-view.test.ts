import { describe, expect, it } from "vitest";
import {
  type GreetingPeriod,
  type NextUpDistance,
  type TimeUntil,
  greetingPeriodAt,
  nextUpDistance,
  timeUntil,
} from "@/lib/dashboard/dashboard-view";

/**
 * Lo que la pantalla de inicio (#426, RF-1 y RF-4 del PRD de E14) calcula
 * sobre la hora del club: la franja del saludo y cuánto falta para el
 * próximo entrenamiento. Todo sobre fecha y hora de pared de Melbourne.
 */

describe("la franja del saludo", () => {
  it.each<[string, GreetingPeriod]>([
    ["05:00", "morning"],
    ["11:59", "morning"],
    ["12:00", "afternoon"],
    ["18:59", "afternoon"],
    ["19:00", "evening"],
    ["23:59", "evening"],
    ["00:00", "evening"],
    ["04:59", "evening"],
  ])("a las %s es %s", (time, period) => {
    expect(greetingPeriodAt({ date: "2026-09-30", time })).toBe(period);
  });
});

describe("el tiempo hasta el entrenamiento", () => {
  const NOW = { date: "2026-09-30", time: "10:00" };

  it("dice hoy y la hora cuando es el mismo día del club", () => {
    expect(
      timeUntil({ date: "2026-09-30", time: "19:00" }, NOW),
    ).toEqual<TimeUntil>({ kind: "today", time: "19:00" });
  });

  it("cuenta horas cuando es mañana pero faltan menos de 24", () => {
    const lateNight = { date: "2026-09-30", time: "22:00" };

    expect(
      timeUntil({ date: "2026-10-01", time: "03:00" }, lateNight),
    ).toEqual<TimeUntil>({ kind: "hours", hours: 5 });
  });

  it("redondea hacia arriba lo que no llega a una hora", () => {
    const almostMidnight = { date: "2026-09-30", time: "23:50" };

    expect(
      timeUntil({ date: "2026-10-01", time: "00:30" }, almostMidnight),
    ).toEqual<TimeUntil>({ kind: "hours", hours: 1 });
  });

  it("cuenta días de calendario a partir de 24 horas", () => {
    expect(
      timeUntil({ date: "2026-10-02", time: "19:00" }, NOW),
    ).toEqual<TimeUntil>({ kind: "days", days: 2 });
  });

  it("cuenta un día cuando es mañana y faltan más de 24 horas", () => {
    expect(
      timeUntil({ date: "2026-10-01", time: "19:00" }, NOW),
    ).toEqual<TimeUntil>({ kind: "days", days: 1 });
  });

  it("cruza un cambio de mes sin perder días", () => {
    const endOfMonth = { date: "2026-09-29", time: "08:00" };

    expect(
      timeUntil({ date: "2026-10-03", time: "09:00" }, endOfMonth),
    ).toEqual<TimeUntil>({ kind: "days", days: 4 });
  });
});

describe("la distancia hasta el próximo evento (#747)", () => {
  it.each<[string, NextUpDistance]>([
    ["2026-09-30", { kind: "today" }],
    ["2026-10-01", { kind: "tomorrow" }],
    ["2026-10-02", { kind: "days", days: 2 }],
    ["2026-10-12", { kind: "days", days: 12 }],
  ])("del 30 de septiembre al %s es %o", (startsOn, distance) => {
    expect(nextUpDistance(startsOn, "2026-09-30")).toEqual(distance);
  });

  it("un evento que empezó ayer y sigue en curso es de hoy", () => {
    expect(nextUpDistance("2026-09-29", "2026-09-30")).toEqual({
      kind: "today",
    });
  });

  it("cuenta días de calendario aunque cruce el cambio de horario", () => {
    expect(nextUpDistance("2026-10-05", "2026-10-03")).toEqual({
      kind: "days",
      days: 2,
    });
  });
});
