import { describe, expect, it } from "vitest";
import {
  ROUTINE_ITEMS_MAX,
  RoutineItemsValidationError,
  readRoutineItems,
  referencedIds,
} from "@/lib/training/routine-items";

/**
 * Las filas de una rutina tal como llegan a la API (#905, D9 y D10 del PRD
 * de E35): un título de sección o un ejercicio con una de cuatro cargas.
 */

const EXERCISE_ID = "e0e0e0e0-0000-4000-8000-000000000001";
const OTHER_EXERCISE_ID = "e0e0e0e0-0000-4000-8000-000000000002";
const MARK_ID = "1b2c3d4e-0000-4000-8000-000000000001";

function exercise(load: unknown, extra: Record<string, unknown> = {}) {
  return { kind: "exercise", exerciseId: EXERCISE_ID, load, ...extra };
}

function expectRejected(raw: readonly unknown[], code: string): void {
  let caught: unknown = null;
  try {
    readRoutineItems(raw);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(RoutineItemsValidationError);
  expect((caught as RoutineItemsValidationError).code).toBe(code);
}

describe("readRoutineItems: un título de sección", () => {
  it("lo guarda recortado, sin ejercicio ni dosis", () => {
    expect(
      readRoutineItems([{ kind: "section", title: "  Warm up " }]),
    ).toEqual([{ kind: "section", title: "Warm up" }]);
  });

  it.each([
    ["sin título", { kind: "section" }],
    ["con el título en blanco", { kind: "section", title: "   " }],
    ["con un título de 61", { kind: "section", title: "x".repeat(61) }],
    [
      "con un ejercicio",
      { kind: "section", title: "Main", exerciseId: EXERCISE_ID },
    ],
    ["con series", { kind: "section", title: "Main", sets: 3 }],
    ["con carga", { kind: "section", title: "Main", load: { kind: "none" } }],
  ])("lo rechaza %s", (_label, item) => {
    expectRejected([item], "invalid_item");
  });

  it("acepta un título de 60 contando un emoji como un carácter", () => {
    const title = `${"x".repeat(59)}🏊`;

    expect(readRoutineItems([{ kind: "section", title }])).toEqual([
      { kind: "section", title },
    ]);
  });
});

describe("readRoutineItems: un ejercicio", () => {
  it("sin carga guarda la dosis recortada y deja en nulo lo vacío", () => {
    const items = readRoutineItems([
      exercise(
        { kind: "none" },
        { sets: 3, reps: " 8-10 ", rest: "", note: "  Slow down " },
      ),
    ]);

    expect(items).toEqual([
      {
        kind: "exercise",
        exerciseId: EXERCISE_ID,
        sets: 3,
        reps: "8-10",
        rest: null,
        note: "Slow down",
        load: { kind: "none" },
      },
    ]);
  });

  it("sin dosis deja series, repeticiones, descanso y nota en nulo", () => {
    expect(readRoutineItems([exercise({ kind: "none" })])).toEqual([
      {
        kind: "exercise",
        exerciseId: EXERCISE_ID,
        sets: null,
        reps: null,
        rest: null,
        note: null,
        load: { kind: "none" },
      },
    ]);
  });

  it("con % de una marca guarda la marca y el porcentaje", () => {
    const [item] = readRoutineItems([
      exercise({ kind: "pct", markId: MARK_ID, pct: 72.5 }),
    ]);

    expect(item).toMatchObject({
      load: { kind: "pct", markId: MARK_ID, pct: 72.5 },
    });
  });

  it.each([1.1, 33.3, 150])("acepta un porcentaje de un decimal: %s", (pct) => {
    const [item] = readRoutineItems([
      exercise({ kind: "pct", markId: MARK_ID, pct }),
    ]);

    expect(item).toMatchObject({ load: { kind: "pct", pct } });
  });

  it("con la dosis de la semana guarda la marca", () => {
    const [item] = readRoutineItems([
      exercise({ kind: "week", markId: MARK_ID }),
    ]);

    expect(item).toMatchObject({ load: { kind: "week", markId: MARK_ID } });
  });

  it("con texto lo guarda recortado", () => {
    const [item] = readRoutineItems([
      exercise({ kind: "text", text: " Bodyweight " }),
    ]);

    expect(item).toMatchObject({ load: { kind: "text", text: "Bodyweight" } });
  });

  it.each([
    ["pct sin marca", { kind: "pct", pct: 70 }],
    ["pct sin porcentaje", { kind: "pct", markId: MARK_ID }],
    ["pct de 0", { kind: "pct", markId: MARK_ID, pct: 0 }],
    ["pct de más de 150", { kind: "pct", markId: MARK_ID, pct: 150.5 }],
    ["pct con dos decimales", { kind: "pct", markId: MARK_ID, pct: 70.25 }],
    ["pct con texto", { kind: "pct", markId: MARK_ID, pct: 70, text: "x" }],
    ["week sin marca", { kind: "week" }],
    ["week con porcentaje", { kind: "week", markId: MARK_ID, pct: 70 }],
    ["text sin texto", { kind: "text" }],
    ["text en blanco", { kind: "text", text: "  " }],
    ["text de 31", { kind: "text", text: "x".repeat(31) }],
    ["text con marca", { kind: "text", text: "RPE 7", markId: MARK_ID }],
    ["none con marca", { kind: "none", markId: MARK_ID }],
    ["de un tipo que no existe", { kind: "rpe" }],
    ["con una marca que no es un id", { kind: "week", markId: "squat" }],
  ])("rechaza la carga %s", (_label, load) => {
    expectRejected([exercise(load)], "invalid_item");
  });

  it.each([
    ["sin ejercicio", { kind: "exercise", load: { kind: "none" } }],
    [
      "con un ejercicio que no es un id",
      { kind: "exercise", exerciseId: "squat", load: { kind: "none" } },
    ],
    ["sin carga", { kind: "exercise", exerciseId: EXERCISE_ID }],
    ["con título", exercise({ kind: "none" }, { title: "Main" })],
    ["con 0 series", exercise({ kind: "none" }, { sets: 0 })],
    ["con 100 series", exercise({ kind: "none" }, { sets: 100 })],
    ["con series no enteras", exercise({ kind: "none" }, { sets: 2.5 })],
    [
      "con repeticiones de 21",
      exercise({ kind: "none" }, { reps: "x".repeat(21) }),
    ],
    [
      "con descanso de 21",
      exercise({ kind: "none" }, { rest: "x".repeat(21) }),
    ],
    [
      "con una nota de 201",
      exercise({ kind: "none" }, { note: "x".repeat(201) }),
    ],
    ["de un tipo que no existe", { kind: "text", text: "400 m" }],
  ])("rechaza la fila %s", (_label, item) => {
    expectRejected([item], "invalid_item");
  });
});

describe("readRoutineItems: la lista", () => {
  it("guarda las filas en el orden en que llegan", () => {
    const items = readRoutineItems([
      { kind: "section", title: "Main" },
      exercise({ kind: "none" }),
      { kind: "section", title: "Cool down" },
    ]);

    expect(items.map((item) => item.kind)).toEqual([
      "section",
      "exercise",
      "section",
    ]);
  });

  it("acepta una lista vacía", () => {
    expect(readRoutineItems([])).toEqual([]);
  });

  it(`acepta ${ROUTINE_ITEMS_MAX} filas`, () => {
    const raw = Array.from({ length: ROUTINE_ITEMS_MAX }, () =>
      exercise({ kind: "none" }),
    );

    expect(readRoutineItems(raw)).toHaveLength(ROUTINE_ITEMS_MAX);
  });

  it(`rechaza más de ${ROUTINE_ITEMS_MAX} filas`, () => {
    const raw = Array.from({ length: ROUTINE_ITEMS_MAX + 1 }, () =>
      exercise({ kind: "none" }),
    );

    expectRejected(raw, "too_many_items");
  });

  it("dice qué fila falló", () => {
    expect(() =>
      readRoutineItems([
        { kind: "section", title: "Main" },
        exercise({ kind: "pct", markId: MARK_ID }),
      ]),
    ).toThrow(expect.objectContaining({ index: 1 }));
  });
});

describe("referencedIds", () => {
  it("devuelve los ejercicios y las marcas que nombran las filas, sin repetir", () => {
    const items = readRoutineItems([
      { kind: "section", title: "Main" },
      exercise({ kind: "pct", markId: MARK_ID, pct: 70 }),
      exercise({ kind: "week", markId: MARK_ID }),
      {
        kind: "exercise",
        exerciseId: OTHER_EXERCISE_ID,
        load: { kind: "text", text: "Bodyweight" },
      },
    ]);

    expect(referencedIds(items)).toEqual({
      exerciseIds: [EXERCISE_ID, OTHER_EXERCISE_ID],
      markIds: [MARK_ID],
    });
  });
});
