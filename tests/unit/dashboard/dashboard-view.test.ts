import { describe, expect, it } from "vitest";
import {
  type GreetingPeriod,
  type NextUpDistance,
  firstNameOf,
  greetingPeriodAt,
  nextUpDistance,
} from "@/lib/dashboard/dashboard-view";

/**
 * Lo que la pantalla de inicio (#426, RF-1 y RF-4 del PRD de E14) calcula
 * sobre la hora del club: la franja del saludo y cuánto falta para el
 * próximo evento. Todo sobre fecha y hora de pared de Melbourne. También a
 * quién saluda.
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

describe("el nombre del saludo (#752)", () => {
  it.each([
    ["Alba Ferrer", "Alba"],
    ["  Alba   Ferrer  ", "Alba"],
    ["Alba", "Alba"],
  ])("de %j saluda a %j", (fullName, firstName) => {
    expect(firstNameOf(fullName)).toBe(firstName);
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
