import { describe, expect, it } from "vitest";
import {
  type EventSpan,
  describeEventDuration,
} from "@/lib/events/event-duration";

/**
 * Cuánto dura un evento, como lo lee quien lo mira (#642, RF-2 del PRD de
 * E24). Un evento de menos de un día se cuenta en horas y minutos reales de
 * Melbourne; uno más largo, en días de calendario.
 */

const ONE_DAY: EventSpan = {
  startsOn: "2027-07-14",
  startTime: "18:00",
  endsOn: null,
  endTime: "19:30",
};

describe("describeEventDuration", () => {
  it("cuenta horas y minutos en un evento de un día", () => {
    expect(describeEventDuration("en", ONE_DAY)).toBe("1 h 30 min");
  });

  it("cuenta sólo minutos en un evento de menos de una hora", () => {
    expect(describeEventDuration("es", { ...ONE_DAY, endTime: "18:45" })).toBe(
      "45 min",
    );
  });

  it("cuenta sólo horas cuando no sobran minutos", () => {
    expect(describeEventDuration("en", { ...ONE_DAY, endTime: "20:00" })).toBe(
      "2 h",
    );
  });

  it("cuenta en días de calendario un evento de varios días, en inglés", () => {
    const weekend: EventSpan = {
      startsOn: "2027-07-17",
      startTime: "08:30",
      endsOn: "2027-07-18",
      endTime: "17:00",
    };

    expect(describeEventDuration("en", weekend)).toBe("2 days");
  });

  it("cuenta en días de calendario un evento de varios días, en español", () => {
    const longWeekend: EventSpan = {
      startsOn: "2027-07-16",
      startTime: "18:00",
      endsOn: "2027-07-18",
      endTime: "12:00",
    };

    expect(describeEventDuration("es", longWeekend)).toBe("3 días");
  });

  it("cuenta en horas un evento que cruza la medianoche y dura menos de un día", () => {
    const lateNight: EventSpan = {
      startsOn: "2027-07-17",
      startTime: "22:00",
      endsOn: "2027-07-18",
      endTime: "01:00",
    };

    expect(describeEventDuration("en", lateNight)).toBe("3 h");
  });

  it("descuenta la hora que se salta al empezar el horario de verano", () => {
    // El 3 de octubre de 2027, en Melbourne, las 2:00 pasan a ser las 3:00.
    const springForward: EventSpan = {
      startsOn: "2027-10-03",
      startTime: "01:00",
      endsOn: null,
      endTime: "04:00",
    };

    expect(describeEventDuration("en", springForward)).toBe("2 h");
  });

  it("suma la hora que se repite al terminar el horario de verano", () => {
    // El 4 de abril de 2027, en Melbourne, las 3:00 vuelven a ser las 2:00.
    const fallBack: EventSpan = {
      startsOn: "2027-04-04",
      startTime: "01:00",
      endsOn: null,
      endTime: "04:00",
    };

    expect(describeEventDuration("es", fallBack)).toBe("4 h");
  });
});
