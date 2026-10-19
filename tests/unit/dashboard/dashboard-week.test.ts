import { describe, expect, it } from "vitest";
import type { WeekEvent } from "@/lib/dashboard/dashboard";
import {
  pickDefaultWeekDay,
  spreadWeekByDay,
} from "@/lib/dashboard/dashboard-week";

/**
 * "Esta semana" del inicio (#748, RF-4 y D14 del PRD de E27): los eventos de
 * `week` repartidos en los siete días de hoy a hoy + 6, con un punto por tipo
 * presente, y el día que sale marcado sin elegir.
 */

const TODAY = "2026-10-15";

function weekEvent(
  overrides: Partial<WeekEvent> & Pick<WeekEvent, "id">,
): WeekEvent {
  return {
    title: "Pool Training",
    eventType: "training",
    startsOn: TODAY,
    endsOn: null,
    startTime: "19:00",
    endTime: "21:00",
    location: "MSAC",
    myResponse: null,
    ...overrides,
  };
}

describe("el reparto de la semana por días", () => {
  it("devuelve los siete días de hoy a hoy + 6", () => {
    const days = spreadWeekByDay([], TODAY);

    expect(days.map((day) => day.date)).toEqual([
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
    ]);
  });

  it("pone cada evento de un día en el día en que empieza", () => {
    const training = weekEvent({ id: "a", startsOn: "2026-10-17" });

    const days = spreadWeekByDay([training], TODAY);

    expect(days[2]?.events).toEqual([training]);
    expect(days.filter((day) => day.events.length > 0)).toHaveLength(1);
  });

  it("cuenta un evento de varios días en cada día que ocupa", () => {
    const camp = weekEvent({
      id: "camp",
      startsOn: "2026-10-17",
      endsOn: "2026-10-19",
    });

    const days = spreadWeekByDay([camp], TODAY);

    expect(
      days.filter((day) => day.events.includes(camp)).map((day) => day.date),
    ).toEqual(["2026-10-17", "2026-10-18", "2026-10-19"]);
  });

  it("cuenta desde hoy un evento que empezó antes de hoy", () => {
    const camp = weekEvent({
      id: "camp",
      startsOn: "2026-10-13",
      endsOn: "2026-10-16",
    });

    const days = spreadWeekByDay([camp], TODAY);

    expect(
      days.filter((day) => day.events.includes(camp)).map((day) => day.date),
    ).toEqual(["2026-10-15", "2026-10-16"]);
  });

  it("corta en hoy + 6 un evento que acaba después", () => {
    const tour = weekEvent({
      id: "tour",
      startsOn: "2026-10-20",
      endsOn: "2026-10-25",
    });

    const days = spreadWeekByDay([tour], TODAY);

    expect(
      days.filter((day) => day.events.includes(tour)).map((day) => day.date),
    ).toEqual(["2026-10-20", "2026-10-21"]);
  });

  it("da un punto por tipo presente, sin repetir", () => {
    const days = spreadWeekByDay(
      [
        weekEvent({ id: "a", eventType: "training" }),
        weekEvent({ id: "b", eventType: "competition" }),
        weekEvent({ id: "c", eventType: "training" }),
      ],
      TODAY,
    );

    expect(days[0]?.eventTypes).toEqual(["training", "competition"]);
  });

  it("da como mucho tres puntos aunque haya los cuatro tipos", () => {
    const days = spreadWeekByDay(
      [
        weekEvent({ id: "a", eventType: "training" }),
        weekEvent({ id: "b", eventType: "competition" }),
        weekEvent({ id: "c", eventType: "social" }),
        weekEvent({ id: "d", eventType: "meeting" }),
      ],
      TODAY,
    );

    expect(days[0]?.eventTypes).toEqual(["training", "competition", "social"]);
    expect(days[0]?.events).toHaveLength(4);
  });
});

describe("el día marcado sin elegir", () => {
  const days = spreadWeekByDay([], TODAY);

  it("es el del evento Próximo cuando cae en la franja", () => {
    expect(pickDefaultWeekDay(days, "2026-10-17")).toBe("2026-10-17");
  });

  it("es hoy cuando el Próximo cae fuera de la franja", () => {
    expect(pickDefaultWeekDay(days, "2026-10-30")).toBe(TODAY);
  });

  it("es hoy cuando el Próximo empezó antes de hoy", () => {
    expect(pickDefaultWeekDay(days, "2026-10-13")).toBe(TODAY);
  });

  it("es hoy cuando no hay Próximo", () => {
    expect(pickDefaultWeekDay(days, null)).toBe(TODAY);
  });
});
