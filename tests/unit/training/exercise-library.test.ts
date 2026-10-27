import { describe, expect, it } from "vitest";
import {
  type LibraryExercise,
  type StoredLibraryExercise,
  parseLibrarySource,
  planLibraryLoad,
  toLibraryExercises,
} from "@/lib/training/exercise-library";

/**
 * La biblioteca de free-exercise-db (#897, RF-2 y D12 del PRD de E35): cómo
 * una entrada del origen se vuelve un ejercicio y qué hace la carga con lo
 * que ya hay en la base.
 */

/** Tres entradas del origen: con fotos, sin fotos y con nombre repetido. */
const SOURCE = [
  {
    id: "Barbell_Squat",
    name: "Barbell Squat",
    force: "push",
    instructions: ["Stand under the bar.", "  ", "Squat down. "],
    images: ["Barbell_Squat/0.jpg", "Barbell_Squat/1.jpg", "extra/2.jpg"],
  },
  {
    id: "Plank",
    name: " Plank ",
    instructions: [],
    images: [],
  },
  {
    id: "Barbell_Squat_Copy",
    name: "barbell squat",
    instructions: ["Same thing."],
    images: ["Barbell_Squat_Copy/0.jpg", "Barbell_Squat_Copy/1.jpg"],
  },
];

const SQUAT: LibraryExercise = {
  libraryKey: "Barbell_Squat",
  name: "Barbell Squat",
  tips: ["Stand under the bar.", "Squat down."],
  photos: [
    {
      sourcePath: "Barbell_Squat/0.jpg",
      storagePath: "library/Barbell_Squat/0.jpg",
    },
    {
      sourcePath: "Barbell_Squat/1.jpg",
      storagePath: "library/Barbell_Squat/1.jpg",
    },
  ],
};

const PLANK: LibraryExercise = {
  libraryKey: "Plank",
  name: "Plank",
  tips: [],
  photos: [],
};

function storedFrom(exercise: LibraryExercise): StoredLibraryExercise {
  return {
    libraryKey: exercise.libraryKey,
    name: exercise.name,
    tips: exercise.tips,
    imageStartPath: exercise.photos[0]?.storagePath ?? null,
    imageEndPath: exercise.photos[1]?.storagePath ?? null,
  };
}

describe("parseLibrarySource", () => {
  it("lee las entradas del origen y descarta los campos que no se usan", () => {
    const entries = parseLibrarySource(SOURCE);

    expect(entries[0]).toEqual({
      id: "Barbell_Squat",
      name: "Barbell Squat",
      instructions: ["Stand under the bar.", "  ", "Squat down. "],
      images: ["Barbell_Squat/0.jpg", "Barbell_Squat/1.jpg", "extra/2.jpg"],
    });
  });

  it("falla diciendo qué entrada no tiene la forma esperada", () => {
    const broken = [SOURCE[0], { id: "No_Name", instructions: [], images: [] }];

    expect(() => parseLibrarySource(broken)).toThrow(/1.*name/);
  });

  it("falla si el origen no es una lista", () => {
    expect(() => parseLibrarySource({ exercises: SOURCE })).toThrow(
      /free-exercise-db/,
    );
  });
});

describe("toLibraryExercises", () => {
  it("convierte una entrada con fotos: nombre, consejos y sus dos primeras fotos", () => {
    const { exercises } = toLibraryExercises(parseLibrarySource(SOURCE));

    expect(exercises[0]).toEqual(SQUAT);
  });

  it("convierte una entrada sin fotos ni consejos", () => {
    const { exercises } = toLibraryExercises(parseLibrarySource(SOURCE));

    expect(exercises[1]).toEqual(PLANK);
  });

  it("carga el primero de dos nombres iguales y avisa del segundo", () => {
    const { exercises, duplicates } = toLibraryExercises(
      parseLibrarySource(SOURCE),
    );

    expect(exercises.map((exercise) => exercise.libraryKey)).toEqual([
      "Barbell_Squat",
      "Plank",
    ]);
    expect(duplicates).toEqual([
      { libraryKey: "Barbell_Squat_Copy", sameNameAs: "Barbell_Squat" },
    ]);
  });

  it("trata como iguales dos nombres que sólo difieren en tildes", () => {
    const entries = parseLibrarySource([
      { id: "Cafe", name: "Café Press", instructions: [], images: [] },
      { id: "Cafe_2", name: "cafe press", instructions: [], images: [] },
    ]);

    const { duplicates } = toLibraryExercises(entries);

    expect(duplicates).toEqual([{ libraryKey: "Cafe_2", sameNameAs: "Cafe" }]);
  });
});

describe("planLibraryLoad", () => {
  it("inserta lo que la base no tiene", () => {
    const plan = planLibraryLoad([SQUAT, PLANK], []);

    expect(plan.steps).toEqual([
      { kind: "insert", exercise: SQUAT },
      { kind: "insert", exercise: PLANK },
    ]);
  });

  it("deja igual lo que ya está tal cual", () => {
    const plan = planLibraryLoad([SQUAT], [storedFrom(SQUAT)]);

    expect(plan.steps).toEqual([{ kind: "unchanged", exercise: SQUAT }]);
  });

  it("actualiza un ejercicio cuyo nombre cambió", () => {
    const renamed = { ...SQUAT, name: "Back Squat" };

    const plan = planLibraryLoad([renamed], [storedFrom(SQUAT)]);

    expect(plan.steps).toEqual([{ kind: "update", exercise: renamed }]);
  });

  it("actualiza un ejercicio cuyos consejos cambiaron", () => {
    const retipped = { ...SQUAT, tips: ["Brace first.", "Squat down."] };

    const plan = planLibraryLoad([retipped], [storedFrom(SQUAT)]);

    expect(plan.steps).toEqual([{ kind: "update", exercise: retipped }]);
  });

  it("actualiza un ejercicio que ganó fotos", () => {
    const withoutPhotos = { ...SQUAT, photos: [] };

    const plan = planLibraryLoad([SQUAT], [storedFrom(withoutPhotos)]);

    expect(plan.steps).toEqual([{ kind: "update", exercise: SQUAT }]);
  });

  it("no toca los que ya no están en el origen", () => {
    const plan = planLibraryLoad([PLANK], [storedFrom(SQUAT)]);

    expect(plan.steps).toEqual([{ kind: "insert", exercise: PLANK }]);
  });

  it("salta y avisa de uno nuevo cuyo nombre ya usa otro de la base", () => {
    const newSquat = { ...SQUAT, libraryKey: "Squat_2", name: "barbell squat" };

    const plan = planLibraryLoad([newSquat], [storedFrom(SQUAT)]);

    expect(plan.steps).toEqual([]);
    expect(plan.nameClashes).toEqual([
      { libraryKey: "Squat_2", sameNameAs: "Barbell_Squat" },
    ]);
  });
});
