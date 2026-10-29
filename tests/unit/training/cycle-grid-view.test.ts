import { describe, expect, it } from "vitest";
import type { CycleDayRecord, ManagedCycle } from "@/lib/training/club-cycles";
import {
  applyDayChange,
  canCopyWeekOne,
  currentGridWeek,
  dayRoutines,
  draftOfWeek,
  initialPhoneWeek,
  lastCopyTarget,
  readWeekDraft,
  weekRecordOf,
} from "@/lib/training/cycle-grid-view";

/** Lo que la cuadrícula de Planificar calcula antes de pintar (#907, D6, D7). */

const ACTIVE: ManagedCycle = {
  id: "active",
  name: "Road to Nationals 2027",
  status: "active",
  weeks: 28,
  startDate: "2026-10-12",
  event: { name: "UWR Nationals", date: "2027-04-22" },
  ownRoutines: 4,
};

/** Las 12:00 del miércoles 28 de octubre de 2026 en Melbourne: semana 3. */
const NOW = new Date("2026-10-28T01:00:00.000Z");

const MONDAY_OF_WEEK_1 = { weekNo: 1, weekday: 0 } as const;

function slot(
  slotNo: 1 | 2,
  routineId: string,
  day: { readonly weekNo: number; readonly weekday: number } = MONDAY_OF_WEEK_1,
): CycleDayRecord {
  return { ...day, slot: slotNo, routineId };
}

describe("dayRoutines", () => {
  it("dice descanso en un día sin filas", () => {
    expect(dayRoutines([], MONDAY_OF_WEEK_1)).toEqual({
      first: null,
      second: null,
    });
  });

  it("lee las dos ranuras de su día y no las de otro", () => {
    const days = [
      slot(1, "gym"),
      slot(2, "pool"),
      slot(1, "other", { weekNo: 1, weekday: 1 }),
    ];

    expect(dayRoutines(days, MONDAY_OF_WEEK_1)).toEqual({
      first: "gym",
      second: "pool",
    });
  });
});

describe("applyDayChange", () => {
  it("pone la primera rutina en un día de descanso", () => {
    const days = applyDayChange([], {
      ...MONDAY_OF_WEEK_1,
      slot: 1,
      routineId: "gym",
    });

    expect(dayRoutines(days, MONDAY_OF_WEEK_1)).toEqual({
      first: "gym",
      second: null,
    });
  });

  it("añade la segunda sin tocar la primera", () => {
    const days = applyDayChange([slot(1, "gym")], {
      ...MONDAY_OF_WEEK_1,
      slot: 2,
      routineId: "pool",
    });

    expect(dayRoutines(days, MONDAY_OF_WEEK_1)).toEqual({
      first: "gym",
      second: "pool",
    });
  });

  it("sube la segunda al vaciar la primera, como la base", () => {
    const days = applyDayChange([slot(1, "gym"), slot(2, "pool")], {
      ...MONDAY_OF_WEEK_1,
      slot: 1,
      routineId: null,
    });

    expect(days).toEqual([slot(1, "pool")]);
  });

  it("quita la segunda al vaciarla y deja los otros días", () => {
    const tuesday = slot(1, "other", { weekNo: 1, weekday: 1 });

    const days = applyDayChange([slot(1, "gym"), slot(2, "pool"), tuesday], {
      ...MONDAY_OF_WEEK_1,
      slot: 2,
      routineId: null,
    });

    expect(days).toEqual([tuesday, slot(1, "gym")]);
  });
});

describe("weekRecordOf", () => {
  it("da una semana vacía cuando la base no tiene su fila", () => {
    expect(weekRecordOf([], 4)).toEqual({ weekNo: 4, note: null, dose: null });
  });
});

describe("copiar la semana 1", () => {
  it("no se puede con 3 semanas y sí con 4", () => {
    expect(canCopyWeekOne(3)).toBe(false);
    expect(canCopyWeekOne(4)).toBe(true);
  });

  it("llega hasta la semana N − 2", () => {
    expect(lastCopyTarget(4)).toBe(2);
    expect(lastCopyTarget(28)).toBe(26);
  });
});

describe("currentGridWeek", () => {
  it("da la semana de hoy en el activo", () => {
    expect(currentGridWeek(ACTIVE, NOW)).toBe(3);
  });

  it("no tiñe ninguna en un borrador", () => {
    expect(currentGridWeek({ ...ACTIVE, status: "draft" }, NOW)).toBeNull();
  });

  it("no tiñe ninguna antes de que empiece el activo", () => {
    expect(
      currentGridWeek({ ...ACTIVE, startDate: "2026-11-02" }, NOW),
    ).toBeNull();
  });
});

describe("initialPhoneWeek", () => {
  it("abre el activo en la semana de hoy", () => {
    expect(initialPhoneWeek(ACTIVE, NOW)).toBe(3);
  });

  it("abre un borrador en la semana 1 aunque sus fechas lleguen a hoy", () => {
    expect(initialPhoneWeek({ ...ACTIVE, status: "draft" }, NOW)).toBe(1);
  });
});

describe("el editor de la semana", () => {
  it("escribe la nota y la dosis guardadas en sus campos", () => {
    expect(
      draftOfWeek({
        weekNo: 2,
        note: "Test 3RM",
        dose: { sets: 4, reps: "5", intensity: { kind: "pct", pct: 80 } },
      }),
    ).toEqual({
      note: "Test 3RM",
      sets: "4",
      reps: "5",
      intensityKind: "pct",
      intensityValue: "80",
    });
  });

  it("manda la semana con la nota recortada y la dosis entera", () => {
    expect(
      readWeekDraft(2, {
        note: "  Camp  ",
        sets: "4",
        reps: "5",
        intensityKind: "pct",
        intensityValue: "82,5",
      }),
    ).toEqual({
      kind: "ready",
      week: {
        weekNo: 2,
        note: "Camp",
        dose: { sets: 4, reps: "5", intensity: { kind: "pct", pct: 82.5 } },
      },
    });
  });

  it("manda una dosis nula cuando todos sus campos están vacíos", () => {
    expect(
      readWeekDraft(2, {
        note: "",
        sets: "",
        reps: " ",
        intensityKind: "none",
        intensityValue: "",
      }),
    ).toEqual({ kind: "ready", week: { weekNo: 2, note: null, dose: null } });
  });

  it("espera al valor cuando se eligió % o texto y falta escribirlo", () => {
    expect(
      readWeekDraft(2, {
        note: "",
        sets: "4",
        reps: "",
        intensityKind: "text",
        intensityValue: "",
      }),
    ).toEqual({ kind: "incomplete" });
  });

  it("no manda series que no son un número entero", () => {
    expect(
      readWeekDraft(2, {
        note: "",
        sets: "4.5",
        reps: "",
        intensityKind: "none",
        intensityValue: "",
      }),
    ).toEqual({ kind: "invalid", reason: "dose_sets_out_of_range" });
  });

  it("no manda un % que no es un número", () => {
    expect(
      readWeekDraft(2, {
        note: "",
        sets: "",
        reps: "",
        intensityKind: "pct",
        intensityValue: "mucho",
      }),
    ).toEqual({ kind: "invalid", reason: "dose_pct_out_of_range" });
  });
});
