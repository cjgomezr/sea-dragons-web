import { describe, expect, it } from "vitest";
import {
  classifyAgendaDay,
  groupAgendaByDay,
} from "@/components/calendar/agenda-days";

/**
 * Los grupos por día de la agenda (#647, RF-6 del PRD de E24): "TODAY" para
 * hoy y "This weekend" para el sábado y el domingo de la semana en curso.
 */

// Un viernes: el fin de semana en curso es el 17 y el 18.
const FRIDAY = "2026-10-16";

describe("groupAgendaByDay", () => {
  it("junta los eventos seguidos del mismo día en el orden del servidor", () => {
    const events = [
      { id: "a", startsOn: "2026-10-16" },
      { id: "b", startsOn: "2026-10-16" },
      { id: "c", startsOn: "2026-10-17" },
    ];

    expect(groupAgendaByDay(events)).toEqual([
      { date: "2026-10-16", events: [events[0], events[1]] },
      { date: "2026-10-17", events: [events[2]] },
    ]);
  });

  it("no tiene grupos sin eventos", () => {
    expect(groupAgendaByDay([])).toEqual([]);
  });
});

describe("classifyAgendaDay", () => {
  it("dice que hoy es hoy", () => {
    expect(classifyAgendaDay(FRIDAY, FRIDAY)).toBe("today");
  });

  it.each(["2026-10-17", "2026-10-18"])(
    "dice que %s es el fin de semana en curso",
    (date) => {
      expect(classifyAgendaDay(date, FRIDAY)).toBe("thisWeekend");
    },
  );

  it("no cuenta el fin de semana de la semana siguiente", () => {
    expect(classifyAgendaDay("2026-10-24", FRIDAY)).toBe("otherDay");
  });

  it("no cuenta el fin de semana de la semana anterior", () => {
    expect(classifyAgendaDay("2026-10-11", FRIDAY)).toBe("otherDay");
  });

  it("un domingo, el sábado de ayer sigue siendo el fin de semana en curso", () => {
    expect(classifyAgendaDay("2026-10-17", "2026-10-18")).toBe("thisWeekend");
  });

  it("un día entre semana es otro día", () => {
    expect(classifyAgendaDay("2026-10-20", FRIDAY)).toBe("otherDay");
  });
});
