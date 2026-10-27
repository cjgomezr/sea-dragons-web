import { describe, expect, it } from "vitest";
import type {
  LibraryExercise,
  StoredLibraryExercise,
} from "@/lib/training/exercise-library";
import {
  type LibrarySource,
  type LibraryStore,
  PHOTO_CONCURRENCY,
  loadExerciseLibrary,
} from "@/lib/training/exercise-library-loader";

/**
 * La carga de la biblioteca de free-exercise-db (#897) con dobles del origen
 * y de la base: qué sube, qué guarda, qué salta y cómo falla.
 */

type SourceEntry = {
  readonly id: string;
  readonly name: string;
  readonly instructions: readonly string[];
  readonly images: readonly string[];
};

function entry(id: string, name = id.replace(/_/g, " ")): SourceEntry {
  return {
    id,
    name,
    instructions: [`Do ${name}.`],
    images: [`${id}/0.jpg`, `${id}/1.jpg`],
  };
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

type FakeSource = LibrarySource & {
  readonly photos: Map<string, Uint8Array>;
};

function fakeSource(entries: readonly SourceEntry[]): FakeSource {
  const photos = new Map(
    entries.flatMap((source) =>
      source.images.map((path) => [path, bytesOf(`photo of ${path}`)] as const),
    ),
  );
  return {
    photos,
    fetchEntries: async () => entries,
    fetchPhoto: async (sourcePath) => {
      const bytes = photos.get(sourcePath);
      if (!bytes) {
        throw new Error(`404 ${sourcePath}`);
      }
      return bytes;
    },
  };
}

type FakeStore = LibraryStore & {
  readonly rows: Map<string, StoredLibraryExercise>;
  readonly fingerprints: Map<string, string>;
  readonly uploads: string[];
  readonly saves: string[];
};

function fakeStore(): FakeStore {
  const rows = new Map<string, StoredLibraryExercise>();
  const fingerprints = new Map<string, string>();
  const uploads: string[] = [];
  const saves: string[] = [];
  return {
    rows,
    fingerprints,
    uploads,
    saves,
    readExercises: async () => [...rows.values()],
    readPhotoFingerprint: async (storagePath) =>
      fingerprints.get(storagePath) ?? null,
    uploadPhoto: async ({ storagePath, fingerprint }) => {
      uploads.push(storagePath);
      fingerprints.set(storagePath, fingerprint);
    },
    saveExercise: async (exercise: LibraryExercise) => {
      saves.push(exercise.libraryKey);
      rows.set(exercise.libraryKey, {
        libraryKey: exercise.libraryKey,
        name: exercise.name,
        tips: exercise.tips,
        imageStartPath: exercise.photos[0]?.storagePath ?? null,
        imageEndPath: exercise.photos[1]?.storagePath ?? null,
      });
    },
  };
}

function silentLog(): {
  readonly lines: string[];
  log: (line: string) => void;
} {
  const lines: string[] = [];
  return { lines, log: (line) => lines.push(line) };
}

describe("loadExerciseLibrary", () => {
  it("guarda cada ejercicio y sube sus dos fotos en la primera carga", async () => {
    const store = fakeStore();
    const source = fakeSource([entry("Barbell_Squat"), entry("Plank")]);

    const report = await loadExerciseLibrary({ source, store, ...silentLog() });

    expect(store.rows.get("Barbell_Squat")).toEqual({
      libraryKey: "Barbell_Squat",
      name: "Barbell Squat",
      tips: ["Do Barbell Squat."],
      imageStartPath: "library/Barbell_Squat/0.jpg",
      imageEndPath: "library/Barbell_Squat/1.jpg",
    });
    expect(store.uploads.sort()).toEqual([
      "library/Barbell_Squat/0.jpg",
      "library/Barbell_Squat/1.jpg",
      "library/Plank/0.jpg",
      "library/Plank/1.jpg",
    ]);
    expect(report).toMatchObject({
      inserted: 2,
      updated: 0,
      unchanged: 0,
      photosUploaded: 4,
      photosKept: 0,
    });
  });

  it("no guarda ni sube nada al repetir la misma versión", async () => {
    const store = fakeStore();
    const source = fakeSource([entry("Barbell_Squat"), entry("Plank")]);
    await loadExerciseLibrary({ source, store, ...silentLog() });
    store.uploads.length = 0;
    store.saves.length = 0;

    const report = await loadExerciseLibrary({ source, store, ...silentLog() });

    expect(store.saves).toEqual([]);
    expect(store.uploads).toEqual([]);
    expect(report).toMatchObject({
      inserted: 0,
      updated: 0,
      unchanged: 2,
      photosUploaded: 0,
      photosKept: 4,
    });
  });

  it("con una versión nueva actualiza el nombre y vuelve a subir la foto que cambió", async () => {
    const store = fakeStore();
    await loadExerciseLibrary({
      source: fakeSource([entry("Barbell_Squat")]),
      store,
      ...silentLog(),
    });
    store.uploads.length = 0;
    const newVersion = fakeSource([entry("Barbell_Squat", "Back Squat")]);
    newVersion.photos.set("Barbell_Squat/1.jpg", bytesOf("a better photo"));

    const report = await loadExerciseLibrary({
      source: newVersion,
      store,
      ...silentLog(),
    });

    expect(store.rows.get("Barbell_Squat")?.name).toBe("Back Squat");
    expect(store.uploads).toEqual(["library/Barbell_Squat/1.jpg"]);
    expect(report).toMatchObject({ updated: 1, photosUploaded: 1 });
  });

  it("no borra un ejercicio que ya no está en el origen", async () => {
    const store = fakeStore();
    await loadExerciseLibrary({
      source: fakeSource([entry("Barbell_Squat"), entry("Plank")]),
      store,
      ...silentLog(),
    });

    await loadExerciseLibrary({
      source: fakeSource([entry("Plank")]),
      store,
      ...silentLog(),
    });

    expect([...store.rows.keys()].sort()).toEqual(["Barbell_Squat", "Plank"]);
  });

  it("carga el primero de dos nombres repetidos y avisa del segundo", async () => {
    const store = fakeStore();
    const output = silentLog();

    await loadExerciseLibrary({
      source: fakeSource([
        entry("Barbell_Squat"),
        entry("Squat_Copy", "barbell squat"),
      ]),
      store,
      ...output,
    });

    expect([...store.rows.keys()]).toEqual(["Barbell_Squat"]);
    expect(output.lines.join("\n")).toMatch(/Squat_Copy.*Barbell_Squat/);
  });

  it("si falla una foto, termina con error, la nombra y no guarda la fila", async () => {
    const store = fakeStore();
    const source = fakeSource([entry("Barbell_Squat")]);
    source.photos.delete("Barbell_Squat/1.jpg");

    const load = loadExerciseLibrary({ source, store, ...silentLog() });

    await expect(load).rejects.toThrow(/Barbell_Squat.*Barbell_Squat\/1\.jpg/);
    expect(store.rows.size).toBe(0);
  });

  it("vuelve a subir la foto que cambió aunque la fila siga igual", async () => {
    const store = fakeStore();
    const source = fakeSource([entry("Barbell_Squat")]);
    await loadExerciseLibrary({ source, store, ...silentLog() });
    store.uploads.length = 0;
    source.photos.set("Barbell_Squat/0.jpg", bytesOf("a sharper photo"));

    const report = await loadExerciseLibrary({ source, store, ...silentLog() });

    expect(store.uploads).toEqual(["library/Barbell_Squat/0.jpg"]);
    expect(report).toMatchObject({ unchanged: 1, photosUploaded: 1 });
  });

  it("si falla la subida de una foto, termina con error y no guarda la fila", async () => {
    const store: FakeStore = {
      ...fakeStore(),
      uploadPhoto: async ({ storagePath }) => {
        throw new Error(`No se pudo subir la foto ${storagePath}: 413`);
      },
    };

    const load = loadExerciseLibrary({
      source: fakeSource([entry("Barbell_Squat")]),
      store,
      ...silentLog(),
    });

    await expect(load).rejects.toThrow("library/Barbell_Squat/0.jpg");
    expect(store.rows.size).toBe(0);
  });

  it("si falla la descarga del origen, termina con error sin tocar la base", async () => {
    const store = fakeStore();
    const source: LibrarySource = {
      fetchEntries: async () => {
        throw new Error("502 Bad Gateway");
      },
      fetchPhoto: async () => bytesOf("never"),
    };

    const load = loadExerciseLibrary({ source, store, ...silentLog() });

    await expect(load).rejects.toThrow(/origen.*502 Bad Gateway/);
    expect(store.saves).toEqual([]);
    expect(store.uploads).toEqual([]);
  });

  it(`no trabaja más de ${PHOTO_CONCURRENCY} ejercicios a la vez`, async () => {
    const store = fakeStore();
    const base = fakeSource(
      Array.from({ length: 12 }, (_, index) => entry(`Exercise_${index}`)),
    );
    let inFlight = 0;
    let maxInFlight = 0;
    const source: LibrarySource = {
      fetchEntries: base.fetchEntries,
      fetchPhoto: async (sourcePath) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return base.fetchPhoto(sourcePath);
      },
    };

    await loadExerciseLibrary({ source, store, ...silentLog() });

    expect(maxInFlight).toBe(PHOTO_CONCURRENCY);
  });
});
