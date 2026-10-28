import { describe, expect, it } from "vitest";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import {
  defaultCycleId,
  newCycleInput,
  scheduleForDate,
  scheduleForEventName,
  sortCycles,
  summarizeCycle,
} from "@/lib/training/cycle-planner-view";

/** Lo que Planificar → Ciclo calcula antes de pintar (#906, D5). */

const ACTIVE: ManagedCycle = {
  id: "active",
  name: "Road to Nationals 2027",
  status: "active",
  weeks: 28,
  startDate: "2026-10-12",
  event: { name: "UWR Nationals", date: "2027-04-22" },
  ownRoutines: 4,
};

const DRAFT: ManagedCycle = {
  id: "draft",
  name: "Summer base 2027",
  status: "draft",
  weeks: 8,
  startDate: "2027-06-07",
  event: null,
  ownRoutines: 1,
};

const ARCHIVED: ManagedCycle = {
  ...DRAFT,
  id: "archived",
  name: "Winter 2026",
  status: "archived",
  weeks: 10,
  startDate: "2026-05-04",
};

/** Las 12:00 del 28 de octubre de 2026 en Melbourne. */
const NOW = new Date("2026-10-28T01:00:00.000Z");

describe("el orden y el ciclo que se abre", () => {
  it("pone el activo, luego los borradores y al final los archivados", () => {
    expect(sortCycles([ARCHIVED, DRAFT, ACTIVE]).map((c) => c.id)).toEqual([
      "active",
      "draft",
      "archived",
    ]);
  });

  it("abre el activo, o el primer borrador si no lo hay", () => {
    expect(defaultCycleId([ARCHIVED, DRAFT, ACTIVE])).toBe("active");
    expect(defaultCycleId([ARCHIVED, DRAFT])).toBe("draft");
  });

  it("no abre nada sin ciclos", () => {
    expect(defaultCycleId([])).toBeNull();
  });
});

describe("la línea calculada", () => {
  it("del activo dice su inicio, la semana del evento y la de hoy", () => {
    expect(summarizeCycle(ACTIVE, NOW)).toEqual({
      kind: "active",
      startDate: "2026-10-12",
      eventWeek: 28,
      endDate: "2027-04-25",
      currentWeek: 3,
    });
  });

  it("de un activo sin evento no tiene semana del evento", () => {
    expect(summarizeCycle({ ...ACTIVE, event: null }, NOW)).toMatchObject({
      eventWeek: null,
    });
  });

  it("del borrador dice cuándo empezaría", () => {
    expect(summarizeCycle(DRAFT, NOW)).toEqual({
      kind: "draft",
      startDate: "2027-06-07",
    });
  });

  it("del archivado dice de cuándo a cuándo corrió", () => {
    expect(summarizeCycle(ARCHIVED, NOW)).toEqual({
      kind: "archived",
      startDate: "2026-05-04",
      endDate: "2026-07-12",
    });
  });
});

describe("el calendario al cambiar el evento o su fecha", () => {
  it("quitar el evento deja la semana 1 donde estaba", () => {
    expect(scheduleForEventName(ACTIVE, "  ")).toEqual({
      kind: "start",
      startDate: "2026-10-12",
    });
  });

  it("poner un evento a un ciclo sin él lo pone el lunes de su última semana", () => {
    expect(scheduleForEventName(DRAFT, " State Cup ")).toEqual({
      kind: "event",
      eventName: "State Cup",
      eventDate: "2027-07-26",
    });
  });

  it("renombrar el evento conserva su fecha", () => {
    expect(scheduleForEventName(ACTIVE, "Nationals")).toEqual({
      kind: "event",
      eventName: "Nationals",
      eventDate: "2027-04-22",
    });
  });

  it("no cambia nada si el evento es el mismo", () => {
    expect(scheduleForEventName(ACTIVE, "UWR Nationals ")).toBeNull();
    expect(scheduleForEventName(DRAFT, "")).toBeNull();
  });

  it("la fecha es la del evento si lo hay y la de inicio si no", () => {
    expect(scheduleForDate(ACTIVE, "2027-04-29")).toEqual({
      kind: "event",
      eventName: "UWR Nationals",
      eventDate: "2027-04-29",
    });
    expect(scheduleForDate(DRAFT, "2027-06-14")).toEqual({
      kind: "start",
      startDate: "2027-06-14",
    });
    expect(scheduleForDate(DRAFT, "2027-06-07")).toBeNull();
  });
});

describe("un ciclo nuevo", () => {
  it("es un borrador de 8 semanas que empieza hoy", () => {
    expect(newCycleInput("New cycle", "2026-10-28")).toEqual({
      name: "New cycle",
      weeks: 8,
      schedule: { kind: "start", startDate: "2026-10-28" },
    });
  });
});
