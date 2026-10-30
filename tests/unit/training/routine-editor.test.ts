import { describe, expect, it } from "vitest";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import type { RoutineEditorItem } from "@/lib/training/club-routines";
import {
  type EditorRow,
  SHARED_ROUTINES_FILTER,
  defaultRoutineFilter,
  loadOptionValue,
  moveRow,
  newExerciseRow,
  parseLoadOption,
  parseLoadPct,
  parseSets,
  routineFilterGroups,
  toEditorRows,
  toItemDrafts,
} from "@/lib/training/routine-editor";

/**
 * Lo que el editor de rutinas de Planificar (#908, RF-9, D9 y D10 del PRD de
 * E35) decide antes de pintar o de guardar: las filas con su clave, lo que se
 * manda a la API, el orden al mover, la carga del selector y el filtro.
 */

const EXERCISE_ID = "e0e0e0e0-0000-4000-8000-000000000001";
const MARK_ID = "1b2c3d4e-0000-4000-8000-000000000001";

const SQUAT: RoutineEditorItem = {
  kind: "exercise",
  exercise: { id: EXERCISE_ID, name: "Back squat", photoUrl: null },
  sets: 4,
  reps: "6",
  rest: "2:00",
  note: null,
  load: { kind: "pct", markId: MARK_ID, pct: 75 },
};

function cycle(
  id: string,
  status: ManagedCycle["status"],
  name = id,
): ManagedCycle {
  return {
    id,
    name,
    status,
    weeks: 8,
    startDate: "2026-11-02",
    event: null,
    ownRoutines: 0,
  };
}

function keyMaker(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `row-${next}`;
  };
}

describe("toEditorRows y toItemDrafts", () => {
  it("le da a cada fila su clave y vuelve a dar lo que la API guarda", () => {
    const rows = toEditorRows(
      [{ kind: "section", title: "Main" }, SQUAT],
      keyMaker(),
    );

    expect(rows.map((row) => row.key)).toEqual(["row-1", "row-2"]);
    expect(toItemDrafts(rows)).toEqual([
      { kind: "section", title: "Main" },
      {
        kind: "exercise",
        exerciseId: EXERCISE_ID,
        sets: 4,
        reps: "6",
        rest: "2:00",
        note: null,
        load: { kind: "pct", markId: MARK_ID, pct: 75 },
      },
    ]);
  });
});

describe("moveRow", () => {
  const rows: readonly EditorRow[] = toEditorRows(
    [
      { kind: "section", title: "Warm up" },
      SQUAT,
      { kind: "section", title: "Main" },
    ],
    keyMaker(),
  );

  it("sube una fila un puesto", () => {
    const moved = moveRow(rows, 1, "up");

    expect(moved?.map((row) => row.key)).toEqual(["row-2", "row-1", "row-3"]);
  });

  it("baja una fila un puesto", () => {
    const moved = moveRow(rows, 1, "down");

    expect(moved?.map((row) => row.key)).toEqual(["row-1", "row-3", "row-2"]);
  });

  it("no mueve la primera hacia arriba ni la última hacia abajo", () => {
    expect(moveRow(rows, 0, "up")).toBeNull();
    expect(moveRow(rows, 2, "down")).toBeNull();
  });
});

describe("la carga en el selector", () => {
  it.each([
    [{ kind: "none" } as const, "none"],
    [{ kind: "pct", markId: MARK_ID, pct: 70 } as const, `pct:${MARK_ID}`],
    [{ kind: "week", markId: MARK_ID } as const, `week:${MARK_ID}`],
    [{ kind: "text", text: "Bodyweight" } as const, "text"],
  ])("la carga %j es la opción %s", (load, value) => {
    expect(loadOptionValue(load)).toBe(value);
    expect(parseLoadOption(value)).toEqual(
      load.kind === "pct" || load.kind === "week"
        ? { kind: load.kind, markId: MARK_ID }
        : { kind: load.kind },
    );
  });

  it("no lee una opción que no conoce", () => {
    expect(() => parseLoadOption("kg:1")).toThrow();
  });
});

describe("parseSets", () => {
  it.each([
    ["", { kind: "value", value: null }],
    ["  ", { kind: "value", value: null }],
    ["4", { kind: "value", value: 4 }],
    ["99", { kind: "value", value: 99 }],
    ["0", { kind: "invalid" }],
    ["100", { kind: "invalid" }],
  ])("lee %j como %j", (text, expected) => {
    expect(parseSets(text)).toEqual(expected);
  });
});

describe("parseLoadPct", () => {
  it.each([
    ["75", 75],
    ["72.5", 72.5],
    ["72,5", 72.5],
    ["150", 150],
  ])("lee %j como %d", (text, expected) => {
    expect(parseLoadPct(text)).toBe(expected);
  });

  it.each(["", "0", "151", "72.25", "abc", "-5"])("no acepta %j", (text) => {
    expect(parseLoadPct(text)).toBeNull();
  });
});

describe("el filtro de las rutinas", () => {
  const cycles = [
    cycle("archived-1", "archived"),
    cycle("draft-1", "draft"),
    cycle("active-1", "active"),
  ];

  it("pone el activo y los borradores arriba y los archivados aparte", () => {
    const groups = routineFilterGroups(cycles);

    expect(groups.current.map((entry) => entry.id)).toEqual([
      "active-1",
      "draft-1",
    ]);
    expect(groups.archived.map((entry) => entry.id)).toEqual(["archived-1"]);
  });

  it("abre en el ciclo que se mira en la pestaña Ciclo", () => {
    expect(defaultRoutineFilter("draft-1")).toBe("draft-1");
  });

  it("sin ciclos abre en las compartidas", () => {
    expect(defaultRoutineFilter(null)).toBe(SHARED_ROUTINES_FILTER);
  });
});

describe("newExerciseRow", () => {
  const exercise = { id: EXERCISE_ID, name: "Back squat", photoUrl: null };

  it("copia la última dosis del club en la fila nueva, sin nota", () => {
    const dose = {
      sets: 4,
      reps: "6",
      rest: "2:00",
      load: { kind: "pct", markId: MARK_ID, pct: 75 },
    } as const;

    const row = newExerciseRow({ key: "row-9", exercise, dose });

    expect(row).toEqual({
      key: "row-9",
      kind: "exercise",
      exercise,
      sets: 4,
      reps: "6",
      rest: "2:00",
      note: null,
      load: { kind: "pct", markId: MARK_ID, pct: 75 },
    });
  });

  it("deja la fila vacía si el club nunca usó el ejercicio", () => {
    const row = newExerciseRow({
      key: "row-9",
      exercise,
      dose: null,
    });

    expect(row).toEqual({
      key: "row-9",
      kind: "exercise",
      exercise,
      sets: null,
      reps: null,
      rest: null,
      note: null,
      load: { kind: "none" },
    });
  });
});
