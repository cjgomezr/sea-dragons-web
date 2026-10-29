import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeForSearch } from "@/lib/text/name-search";
import {
  type SampleCyclePlan,
  type SampleRoutine,
  SAMPLE_CYCLE_NAME,
  SWIM_SET_EXERCISE,
  ESC_INTERVAL_EXERCISE,
  buildSampleCyclePlan,
  rowNoteFor,
} from "@/lib/training/sample-cycle";
import { WEEK_NOTE_MAX_LENGTH } from "@/lib/training/club-cycle-input";
import { ROUTINE_NAME_MAX_LENGTH } from "@/lib/training/club-routines";
import {
  ITEM_NOTE_MAX_LENGTH,
  ITEM_REPS_MAX_LENGTH,
  ITEM_REST_MAX_LENGTH,
  LOAD_TEXT_MAX_LENGTH,
  ROUTINE_ITEMS_MAX,
  SECTION_TITLE_MAX_LENGTH,
} from "@/lib/training/routine-items";

/**
 * El plan de muestra pasado a un ciclo (#912, RF-13 y D16 del PRD de E35),
 * sin base: la conversión pura de `plan-uwr-sep-2026.json`.
 */

const SAMPLE_PATH = path.join(
  process.cwd(),
  "docs/design/design_handoff_training/muestra/plan-uwr-sep-2026.json",
);

function readSample(): unknown {
  return JSON.parse(readFileSync(SAMPLE_PATH, "utf8"));
}

const plan: SampleCyclePlan = buildSampleCyclePlan(readSample());

function routineNamed(name: string): SampleRoutine {
  const routine = plan.routines.find((entry) => entry.name === name);
  if (routine === undefined) {
    throw new Error(`No hay rutina "${name}"`);
  }
  return routine;
}

function routineOfDay(day: {
  readonly weekNo: number;
  readonly weekday: number;
  readonly slot: number;
}): SampleRoutine {
  const found = plan.days.find(
    (entry) =>
      entry.weekNo === day.weekNo &&
      entry.weekday === day.weekday &&
      entry.slot === day.slot,
  );
  if (found === undefined) {
    throw new Error(`No hay sesión en ${JSON.stringify(day)}`);
  }
  return plan.routines[found.routineIndex] as SampleRoutine;
}

describe("buildSampleCyclePlan: el ciclo", () => {
  it("se llama como la muestra, empieza el 14 de septiembre y cuenta 16 semanas por fecha", () => {
    expect(plan.cycle).toEqual({
      name: SAMPLE_CYCLE_NAME,
      startDate: "2026-09-14",
      weeks: 16,
    });
    expect(SAMPLE_CYCLE_NAME).toBe("UWR macrocycle Sep 2026");
  });

  it("crea las cuatro marcas de las filas de la dosis de la semana", () => {
    expect(plan.marks).toEqual([
      "Back squat",
      "Deadlift",
      "Bench press",
      "Pull-up",
    ]);
  });
});

describe("buildSampleCyclePlan: las rutinas", () => {
  it("carga una rutina por sesión usada: 7 de gimnasio, 25 de piscina y 16 de ESC", () => {
    const gym = plan.routines.filter((routine) =>
      routine.name.startsWith("Gym · "),
    );
    const esc = plan.routines.filter((routine) =>
      routine.name.startsWith("ESC · "),
    );

    expect(plan.routines).toHaveLength(48);
    expect(gym.map((routine) => routine.name)).toEqual([
      "Gym · Transmutation · 1",
      "Gym · Transmutation · 2",
      "Gym · Transmutation · 3",
      "Gym · Realization · 1",
      "Gym · Realization · 2",
      "Gym · Maintenance · 1",
      "Gym · Maintenance · 2",
    ]);
    expect(esc).toHaveLength(16);
  });

  it("no carga como rutina la sesión opcional que ningún día usa", () => {
    const names = plan.routines.map((routine) => routine.name);

    expect(names).toContain("Endurance Swim 1");
    expect(names).not.toContain("Endurance Swim 2");
  });

  it("pone los grupos del gimnasio como títulos y sus ejercicios como filas", () => {
    const items = routineNamed("Gym · Transmutation · 1").items;

    expect(items.slice(0, 3)).toEqual([
      { kind: "section", title: "Mobility and Strength Prep drills" },
      {
        kind: "exercise",
        exerciseName: "Deep squat hold to Thoracic rotations",
        sets: 3,
        reps: "10",
        rest: null,
        note: null,
        load: { kind: "none" },
      },
      {
        kind: "exercise",
        exerciseName: "Banded Side Steps",
        sets: 3,
        reps: "3x4 steps e.s.",
        rest: null,
        note: null,
        load: { kind: "none" },
      },
    ]);
  });

  it("deja la carga de texto como texto", () => {
    const items = routineNamed("Gym · Transmutation · 1").items;

    expect(items).toContainEqual({
      kind: "exercise",
      exerciseName: "Clean Pulls from the hang",
      sets: 4,
      reps: "3",
      rest: null,
      note: null,
      load: { kind: "text", text: "RPE 7" },
    });
  });

  it("usa la dosis de la semana sobre su marca en las filas Macro Vol y Macro %", () => {
    const items = routineNamed("Gym · Transmutation · 1").items;

    expect(items).toContainEqual({
      kind: "exercise",
      exerciseName: "Back Squat",
      sets: null,
      reps: null,
      rest: null,
      note: null,
      load: { kind: "week", markName: "Back squat" },
    });
  });

  it("lleva a la nota la intensidad de una fila Macro Vol que no es Macro %", () => {
    const items = routineNamed("Gym · Transmutation · 1").items;

    expect(items).toContainEqual({
      kind: "exercise",
      exerciseName: "Supinated Pull Up",
      sets: null,
      reps: null,
      rest: null,
      note: "RPE 9",
      load: { kind: "week", markName: "Pull-up" },
    });
  });

  it("escribe la piscina con Swim set: el volumen en repeticiones, el descanso y la descripción en la nota", () => {
    const items = routineNamed("Anaerobic Swim 1").items;

    expect(items.slice(0, 2)).toEqual([
      { kind: "section", title: "Warm up" },
      {
        kind: "exercise",
        exerciseName: SWIM_SET_EXERCISE,
        sets: null,
        reps: "4x 100 Alternating:",
        rest: "20-30 sec rest",
        note: "Kick / Bounce (up & down)/ Fs  / Quarters (uw/fs by 12.5) by 25 · Easy Pace",
        load: { kind: "none" },
      },
    ]);
  });

  it("lleva a la nota el volumen que no cabe en las repeticiones", () => {
    const items = routineNamed("Anaerobic Swim 1").items;

    expect(items).toContainEqual({
      kind: "exercise",
      exerciseName: SWIM_SET_EXERCISE,
      sets: null,
      reps: null,
      rest: null,
      note: "4x Rounds back to back:",
      load: { kind: "none" },
    });
  });

  it("escribe el ESC con ESC interval: las rondas en repeticiones y el trabajo en la nota", () => {
    const items = routineNamed("ESC · Anaerobic Session 1").items;

    expect(items).toEqual([
      {
        kind: "exercise",
        exerciseName: ESC_INTERVAL_EXERCISE,
        sets: null,
        reps: "10 Rounds",
        rest: null,
        note: "1min at 95%, 1min rest",
        load: { kind: "none" },
      },
    ]);
  });

  it("deja cada texto dentro de los topes de la base", () => {
    for (const routine of plan.routines) {
      expect([...routine.name].length).toBeLessThanOrEqual(
        ROUTINE_NAME_MAX_LENGTH,
      );
      expect(routine.items.length).toBeLessThanOrEqual(ROUTINE_ITEMS_MAX);
      for (const item of routine.items) {
        if (item.kind === "section") {
          expect([...item.title].length).toBeLessThanOrEqual(
            SECTION_TITLE_MAX_LENGTH,
          );
          continue;
        }
        expect([...(item.reps ?? "")].length).toBeLessThanOrEqual(
          ITEM_REPS_MAX_LENGTH,
        );
        expect([...(item.rest ?? "")].length).toBeLessThanOrEqual(
          ITEM_REST_MAX_LENGTH,
        );
        expect([...(item.note ?? "")].length).toBeLessThanOrEqual(
          ITEM_NOTE_MAX_LENGTH,
        );
        if (item.load.kind === "text") {
          expect([...item.load.text].length).toBeLessThanOrEqual(
            LOAD_TEXT_MAX_LENGTH,
          );
        }
      }
    }
  });

  it("nombra cada ejercicio de las filas una vez, sin contar mayúsculas ni tildes", () => {
    const named = new Set(
      plan.routines.flatMap((routine) =>
        routine.items.flatMap((item) =>
          item.kind === "exercise"
            ? [normalizeForSearch(item.exerciseName)]
            : [],
        ),
      ),
    );

    expect(
      plan.exercises.map((exercise) => normalizeForSearch(exercise.name)),
    ).toEqual([...named]);
  });

  it("trae los consejos y la búsqueda de YouTube de la guía de la muestra", () => {
    const squat = plan.exercises.find(
      (exercise) => exercise.name === "Back Squat",
    );

    expect(squat?.youtube).toBe("barbell back squat technique");
    expect(squat?.tips).toHaveLength(3);
  });
});

type MutableSample = {
  guide: Record<string, { img: string[] }>;
  gmap: Record<string, string>;
};

function sampleWithImg(exerciseName: string, img: string[]): unknown {
  const sample = readSample() as MutableSample;
  const guideKey = sample.gmap[exerciseName];
  const guide = guideKey === undefined ? undefined : sample.guide[guideKey];
  if (guide === undefined) {
    throw new Error(`La muestra cambió: "${exerciseName}" no tiene guía`);
  }
  guide.img = img;
  return sample;
}

function exerciseNamed(
  source: SampleCyclePlan,
  name: string,
): SampleCyclePlan["exercises"][number] {
  const found = source.exercises.find((exercise) => exercise.name === name);
  if (found === undefined) {
    throw new Error(`No hay ejercicio "${name}"`);
  }
  return found;
}

describe("buildSampleCyclePlan: la clave de la biblioteca", () => {
  it("saca la clave de la foto de la guía: img/Barbell_Squat-0.jpg es Barbell_Squat", () => {
    expect(exerciseNamed(plan, "Back Squat").libraryKey).toBe("Barbell_Squat");
  });

  it("da la misma clave a dos ejercicios cuya guía trae la misma foto", () => {
    const keys = plan.exercises.flatMap((exercise) =>
      exercise.libraryKey === null ? [] : [exercise.libraryKey],
    );

    expect(keys.length).toBeGreaterThan(new Set(keys).size);
  });

  it("deja la clave nula al ejercicio sin foto en la guía", () => {
    expect(exerciseNamed(plan, SWIM_SET_EXERCISE).libraryKey).toBeNull();
    expect(exerciseNamed(plan, ESC_INTERVAL_EXERCISE).libraryKey).toBeNull();
  });

  it("deja la clave nula, sin romper, a una foto con otra forma de ruta", () => {
    const changed = buildSampleCyclePlan(
      sampleWithImg("Back Squat", ["photos/squat.png"]),
    );

    expect(exerciseNamed(changed, "Back Squat").libraryKey).toBeNull();
  });

  it("enlaza por la guía 38 de los 82 ejercicios del plan real, con 29 claves", () => {
    const linked = plan.exercises.filter(
      (exercise) => exercise.libraryKey !== null,
    );

    expect(plan.exercises).toHaveLength(82);
    expect(linked).toHaveLength(38);
    expect(new Set(linked.map((exercise) => exercise.libraryKey)).size).toBe(
      29,
    );
  });
});

describe("rowNoteFor", () => {
  const row = {
    exerciseName: "Paused Deadlift",
    note: "RPE 8 · 2 sec pause",
  };

  it("pone delante de la nota el nombre del plan cuando el ejercicio enlazado se llama de otra forma", () => {
    expect(rowNoteFor(row, "Barbell Deadlift")).toBe(
      "Paused Deadlift · RPE 8 · 2 sec pause",
    );
  });

  it("deja la nota sólo con el nombre del plan si la fila no traía nota", () => {
    expect(rowNoteFor({ ...row, note: null }, "Barbell Deadlift")).toBe(
      "Paused Deadlift",
    );
  });

  it("no repite el nombre cuando se lee igual sin mayúsculas ni tildes", () => {
    expect(rowNoteFor(row, "paused deadlíft")).toBe("RPE 8 · 2 sec pause");
    expect(rowNoteFor({ ...row, note: null }, "PAUSED DEADLIFT")).toBeNull();
  });

  it("recorta la nota con el nombre al máximo de la nota", () => {
    const note = rowNoteFor(
      { ...row, note: "x".repeat(ITEM_NOTE_MAX_LENGTH) },
      "Barbell Deadlift",
    );

    expect([...(note ?? "")]).toHaveLength(ITEM_NOTE_MAX_LENGTH);
    expect(note?.startsWith("Paused Deadlift · x")).toBe(true);
    expect(note?.endsWith("…")).toBe(true);
  });
});

describe("buildSampleCyclePlan: las semanas y los días", () => {
  it("guarda la dosis 4x 5 con 0,8 como 4 series de 5 al 80 %", () => {
    expect(plan.weeks.find((week) => week.weekNo === 2)?.dose).toEqual({
      sets: 4,
      reps: "5",
      intensity: { kind: "pct", pct: 80 },
    });
  });

  it("guarda la dosis 3x 10 con RPE 7 como texto", () => {
    expect(plan.weeks.find((week) => week.weekNo === 13)?.dose).toEqual({
      sets: 3,
      reps: "10",
      intensity: { kind: "text", text: "RPE 7" },
    });
  });

  it("escribe en la nota la fase y el hito, en 140 caracteres como mucho", () => {
    expect(plan.weeks.find((week) => week.weekNo === 5)?.note).toBe(
      "Transmutation · Training Camp 3",
    );
    expect(plan.weeks.find((week) => week.weekNo === 1)?.note).toBe(
      "Transmutation",
    );
    for (const week of plan.weeks) {
      expect([...(week.note ?? "")].length).toBeLessThanOrEqual(
        WEEK_NOTE_MAX_LENGTH,
      );
    }
  });

  it("no guarda la semana que la muestra salta", () => {
    expect(plan.weeks.map((week) => week.weekNo)).not.toContain(11);
    expect(plan.days.some((day) => day.weekNo === 11)).toBe(false);
  });

  it("pone las dos sesiones de un día en las ranuras 1 y 2", () => {
    expect(routineOfDay({ weekNo: 1, weekday: 2, slot: 1 }).name).toBe(
      "Gym · Transmutation · 2",
    );
    expect(routineOfDay({ weekNo: 1, weekday: 2, slot: 2 }).name).toBe(
      "ESC · Anaerobic Session 1",
    );
  });

  it("cuenta 95 días con sesión, cinco de ellos con dos", () => {
    const daysWithSession = new Set(
      plan.days.map((day) => `${day.weekNo}:${day.weekday}`),
    );

    expect(daysWithSession.size).toBe(95);
    expect(plan.days.filter((day) => day.slot === 2)).toHaveLength(5);
  });
});

describe("buildSampleCyclePlan: lo que no vale", () => {
  it("rechaza una muestra sin semanas", () => {
    expect(() => buildSampleCyclePlan({ weeks: [] })).toThrow();
  });

  it("rechaza una fila Macro Vol de un ejercicio sin marca conocida", () => {
    const sample = readSample() as {
      lib: { gym: { transmutation: { ex: string; sets: string }[][] } };
    };
    const row = sample.lib.gym.transmutation[0]?.find(
      (entry) => entry.ex === "Back Squat",
    );
    if (row === undefined) {
      throw new Error("La muestra cambió: no hay Back Squat");
    }
    row.ex = "Front Squat";

    expect(() => buildSampleCyclePlan(sample)).toThrow(/Front Squat/);
  });
});
