import { describe, expect, it } from "vitest";
import {
  applyQuickLength,
  type EventWhen,
  evaluateEventEnd,
  QUICK_LENGTHS,
} from "@/components/calendar/event-end";

/**
 * El cuándo del diálogo de evento (#650, RF-9 del PRD de E24): las
 * duraciones rápidas ponen el fin, y el fin se juzga antes de mandar nada.
 */

const SINGLE: EventWhen = {
  startsOn: "2026-10-14",
  startTime: "18:00",
  endTime: "",
  endsAnotherDay: false,
  endDate: "",
};

describe("duraciones rápidas", () => {
  it("son 1 h, 1 h 30, 2 h y 3 h", () => {
    expect(QUICK_LENGTHS.map((length) => length.minutes)).toEqual([
      60, 90, 120, 180,
    ]);
  });

  it("ponen el fin en el inicio más la duración", () => {
    expect(applyQuickLength(SINGLE, 90, "event")).toEqual({
      endTime: "19:30",
      endsAnotherDay: false,
      endDate: "",
    });
  });

  it("apagan Termina otro día si el fin vuelve al mismo día", () => {
    const multiDay = { ...SINGLE, endsAnotherDay: true, endDate: "2026-10-16" };

    expect(applyQuickLength(multiDay, 60, "event")).toEqual({
      endTime: "19:00",
      endsAnotherDay: false,
      endDate: "",
    });
  });

  it("al cruzar la medianoche en un evento suelto encienden Termina otro día con la fecha siguiente", () => {
    const late = { ...SINGLE, startTime: "22:30" };

    expect(applyQuickLength(late, 120, "event")).toEqual({
      endTime: "00:30",
      endsAnotherDay: true,
      endDate: "2026-10-15",
    });
  });

  it("al cruzar la medianoche sin fecha encienden Termina otro día sin fecha", () => {
    const late = { ...SINGLE, startsOn: "", startTime: "23:00" };

    expect(applyQuickLength(late, 180, "event")).toEqual({
      endTime: "02:00",
      endsAnotherDay: true,
      endDate: "",
    });
  });

  it("al cruzar la medianoche en una serie dejan el fin antes del inicio", () => {
    const late = { ...SINGLE, startTime: "23:00" };

    const when = { ...late, ...applyQuickLength(late, 60, "series") };

    expect(when.endTime).toBe("00:00");
    expect(when.endsAnotherDay).toBe(false);
    expect(evaluateEventEnd(when, "series")).toEqual({ kind: "invalid" });
  });

  it("no hacen nada sin hora de inicio", () => {
    expect(applyQuickLength({ ...SINGLE, startTime: "" }, 60, "event")).toBe(
      null,
    );
  });
});

describe("el fin de un evento", () => {
  it("está a medias sin hora de fin", () => {
    expect(evaluateEventEnd(SINGLE, "event")).toEqual({ kind: "incomplete" });
  });

  it("vale si termina después de empezar el mismo día", () => {
    expect(evaluateEventEnd({ ...SINGLE, endTime: "19:30" }, "event")).toEqual({
      kind: "valid",
      span: {
        startsOn: "2026-10-14",
        startTime: "18:00",
        endsOn: null,
        endTime: "19:30",
      },
    });
  });

  it.each(["18:00", "17:00"])(
    "no vale si termina a las %s el mismo día",
    (endTime) => {
      expect(evaluateEventEnd({ ...SINGLE, endTime }, "event")).toEqual({
        kind: "invalid",
      });
    },
  );

  it("no vale con las horas al revés aunque falte la fecha", () => {
    const when = { ...SINGLE, startsOn: "", endTime: "17:00" };

    expect(evaluateEventEnd(when, "event")).toEqual({ kind: "invalid" });
  });

  it("está a medias con las horas bien pero sin fecha", () => {
    const when = { ...SINGLE, startsOn: "", endTime: "19:00" };

    expect(evaluateEventEnd(when, "event")).toEqual({ kind: "incomplete" });
  });

  it("vale de varios días aunque la hora de fin sea anterior", () => {
    const when = {
      ...SINGLE,
      endTime: "17:00",
      endsAnotherDay: true,
      endDate: "2026-10-15",
    };

    expect(evaluateEventEnd(when, "event")).toEqual({
      kind: "valid",
      span: {
        startsOn: "2026-10-14",
        startTime: "18:00",
        endsOn: "2026-10-15",
        endTime: "17:00",
      },
    });
  });

  it("no vale si la fecha de fin es anterior a la de inicio", () => {
    const when = {
      ...SINGLE,
      endTime: "19:00",
      endsAnotherDay: true,
      endDate: "2026-10-13",
    };

    expect(evaluateEventEnd(when, "event")).toEqual({ kind: "invalid" });
  });

  it("con la misma fecha de fin se juzga como de un día", () => {
    const when = {
      ...SINGLE,
      endTime: "17:00",
      endsAnotherDay: true,
      endDate: "2026-10-14",
    };

    expect(evaluateEventEnd(when, "event")).toEqual({ kind: "invalid" });
  });

  it("está a medias con Termina otro día y sin fecha de fin", () => {
    const when = { ...SINGLE, endTime: "17:00", endsAnotherDay: true };

    expect(evaluateEventEnd(when, "event")).toEqual({ kind: "incomplete" });
  });

  it("en una serie ignora Termina otro día", () => {
    const when = {
      ...SINGLE,
      endTime: "17:00",
      endsAnotherDay: true,
      endDate: "2026-10-15",
    };

    expect(evaluateEventEnd(when, "series")).toEqual({ kind: "invalid" });
  });
});
