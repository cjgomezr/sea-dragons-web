import { describe, expect, it } from "vitest";
import {
  EMPTY_EVENT_FORM,
  type EventForm,
  listEventChanges,
  listSeriesChanges,
} from "@/components/calendar/event-form";

/**
 * Lo que manda el diálogo al editar (#316): sólo lo que cambió, para que una
 * serie no pise con un campo intacto lo que una ocurrencia tenía editado.
 */

const SENIOR_ID = "9a9a9a9a-0000-4000-8000-000000000009";
const MASTERS_ID = "8b8b8b8b-0000-4000-8000-000000000008";

const SAVED: EventForm = {
  ...EMPTY_EVENT_FORM,
  title: "Pool Training",
  startsOn: "2026-10-06",
  startTime: "19:00",
  location: "MSAC Dive Pool",
  notes: "",
  audience: { kind: "groups", groupIds: new Set([SENIOR_ID, MASTERS_ID]) },
};

describe("cambios al editar", () => {
  it("no manda nada si nada cambió", () => {
    expect(listEventChanges(SAVED, { ...SAVED })).toEqual({});
  });

  it("no cuenta como cambio unas notas que siguen en blanco", () => {
    const edited = { ...SAVED, notes: "   " };

    expect(listEventChanges(SAVED, edited)).toEqual({});
  });

  it("manda las notas borradas como ninguna", () => {
    const withNotes = { ...SAVED, notes: "Bring fins" };

    expect(listEventChanges(withNotes, SAVED)).toEqual({ notes: null });
  });

  it("no cuenta como cambio los mismos grupos marcados en otro orden", () => {
    const edited: EventForm = {
      ...SAVED,
      audience: { kind: "groups", groupIds: new Set([MASTERS_ID, SENIOR_ID]) },
    };

    expect(listEventChanges(SAVED, edited)).toEqual({});
  });

  it("manda la audiencia de todo el club sin grupos", () => {
    const edited: EventForm = {
      ...SAVED,
      audience: { kind: "club", groupIds: new Set() },
    };

    expect(listEventChanges(SAVED, edited)).toEqual({
      audience: { kind: "club" },
    });
  });

  it("manda la fecha nueva de un evento suelto", () => {
    const edited = { ...SAVED, startsOn: "2026-10-07" };

    expect(listEventChanges(SAVED, edited)).toEqual({
      startsOn: "2026-10-07",
    });
  });

  it("nunca manda la fecha de una serie", () => {
    const edited = { ...SAVED, startsOn: "2026-10-07", startTime: "19:30" };

    expect(listSeriesChanges(SAVED, edited)).toEqual({ startTime: "19:30" });
  });
});
