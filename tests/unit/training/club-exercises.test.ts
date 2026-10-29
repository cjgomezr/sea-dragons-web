import { beforeEach, describe, expect, it } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import {
  type ClubExerciseFields,
  type ClubExerciseRow,
  type ClubExercisesGateways,
  EXERCISE_PHOTO_MAX_BYTES,
  EXERCISE_OFFSET_MAX,
  EXERCISE_SEARCH_LIMIT,
  type ExerciseRecord,
  ExerciseInUseError,
  ExerciseNameTakenError,
  ExerciseNotFoundError,
  ExerciseValidationError,
  LibraryExerciseReadOnlyError,
  type PhotoChanges,
  classifyYoutube,
  createClubExercise,
  deleteClubExercise,
  searchExercises,
  updateClubExercise,
} from "@/lib/training/club-exercises";
import { TrainingPlannerForbiddenError } from "@/lib/training/training-planner";

/**
 * Los ejercicios del club en Planificar (#903, RF-10 y D13 del PRD de E35),
 * contados contra una base y un Storage en memoria. Que el nombre repetido y
 * la búsqueda no miren mayúsculas ni acentos lo prueba la migración.
 */

const COACH_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const OTHER_CLUB_ID = "5c1ab000-0000-4000-8000-000000000002";
const LIBRARY_ID = "e0e0e0e0-0000-4000-8000-000000000001";
const CRAWL_ID = "e0e0e0e0-0000-4000-8000-000000000002";
const OTHER_CLUBS_ID = "e0e0e0e0-0000-4000-8000-000000000003";
const NEW_ID = "e0e0e0e0-0000-4000-8000-000000000004";
const CDN = "https://cdn.example.test/";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);

const KEEP_BOTH: PhotoChanges = {
  start: { kind: "keep" },
  end: { kind: "keep" },
};

let callerRole: Role;
let exercises: ExerciseRecord[];
let routinesByExercise: Map<string, string[]>;
let uploaded: { storagePath: string; contentType: string }[];
let removed: string[];
let auditRows: AuditLogInsertRow[];
let inUse: Set<string>;
let failInsert: boolean;

function sameName(one: string, other: string): boolean {
  return one.trim().toLowerCase() === other.trim().toLowerCase();
}

function rowToRecord(row: ClubExerciseRow): ExerciseRecord {
  return { ...row };
}

function sourceOf(exercise: ExerciseRecord): "library" | "club" {
  return exercise.clubId === null ? "library" : "club";
}

function matching(clubId: string, text: string): ExerciseRecord[] {
  return exercises.filter(
    (exercise) =>
      (exercise.clubId === null || exercise.clubId === clubId) &&
      exercise.name.toLowerCase().includes(text.trim().toLowerCase()),
  );
}

function gateways(): ClubExercisesGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Cora Coach",
        role: callerRole,
      }),
    },
    exercises: {
      searchExercises: async ({ clubId, text, source, limit, offset }) =>
        matching(clubId, text)
          .filter(
            (exercise) => source === null || sourceOf(exercise) === source,
          )
          .slice(offset, offset + limit),
      countExercises: async ({ clubId, text }) => {
        const found = matching(clubId, text);
        return {
          library: found.filter((exercise) => exercise.clubId === null).length,
          club: found.filter((exercise) => exercise.clubId !== null).length,
        };
      },
      findExercise: async (id) =>
        exercises.find((exercise) => exercise.id === id) ?? null,
      isNameTaken: async ({ clubId, name, exceptId }) =>
        exercises.some(
          (exercise) =>
            (exercise.clubId === null || exercise.clubId === clubId) &&
            exercise.id !== exceptId &&
            sameName(exercise.name, name),
        ),
      listRoutineNames: async ({ exerciseIds }) =>
        new Map(
          exerciseIds.map((id) => [id, routinesByExercise.get(id) ?? []]),
        ),
      insertExercise: async (row) => {
        if (failInsert) {
          throw new Error("la base se cayó");
        }
        exercises.push(rowToRecord(row));
        return { kind: "saved" };
      },
      updateExercise: async (row) => {
        exercises = exercises.map((exercise) =>
          exercise.id === row.id ? rowToRecord(row) : exercise,
        );
        return { kind: "saved" };
      },
      deleteExercise: async ({ exerciseId }) => {
        if (inUse.has(exerciseId)) {
          return { kind: "in_use" };
        }
        exercises = exercises.filter((exercise) => exercise.id !== exerciseId);
        return { kind: "deleted" };
      },
    },
    photos: {
      upload: async ({ storagePath, contentType }) => {
        uploaded.push({ storagePath, contentType });
      },
      remove: async (paths) => {
        removed.push(...paths);
      },
      publicUrl: (path) => `${CDN}${path}`,
    },
    audit: {
      insertAuditLogRow: async (row) => {
        auditRows.push(row);
        return { error: null };
      },
    },
    newExerciseId: () => NEW_ID,
  };
}

function fields(
  overrides: Partial<ClubExerciseFields> = {},
): ClubExerciseFields {
  return { name: "Fin kick", tips: "", youtube: "", ...overrides };
}

beforeEach(() => {
  callerRole = "Coach";
  exercises = [
    {
      id: LIBRARY_ID,
      clubId: null,
      name: "Barbell Squat",
      tips: ["Keep your back straight."],
      youtube: null,
      imageStartPath: "library/Barbell_Squat/0.jpg",
      imageEndPath: "library/Barbell_Squat/1.jpg",
    },
    {
      id: CRAWL_ID,
      clubId: CLUB_ID,
      name: "Front crawl",
      tips: [],
      youtube: "https://youtu.be/crawl",
      imageStartPath: `club/${CLUB_ID}/${CRAWL_ID}/0.jpg`,
      imageEndPath: null,
    },
    {
      id: OTHER_CLUBS_ID,
      clubId: OTHER_CLUB_ID,
      name: "Squat jump",
      tips: [],
      youtube: null,
      imageStartPath: null,
      imageEndPath: null,
    },
  ];
  routinesByExercise = new Map([[LIBRARY_ID, ["Strength A", "Strength B"]]]);
  uploaded = [];
  removed = [];
  auditRows = [];
  inUse = new Set();
  failInsert = false;
});

describe("classifyYoutube", () => {
  it("toma como enlace lo que empieza por https://", () => {
    expect(classifyYoutube("https://youtu.be/abc")).toEqual({
      kind: "link",
      url: "https://youtu.be/abc",
    });
  });

  it.each([
    ["http://", "http://youtu.be/abc"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,hola"],
    ["un texto", "fin kick technique"],
  ])("toma %s como una búsqueda, nunca como enlace", (_label, text) => {
    expect(classifyYoutube(text)).toEqual({ kind: "search", query: text });
  });

  it("sin nada no busca nada propio: busca el nombre", () => {
    expect(classifyYoutube(null)).toBeNull();
  });
});

describe("searchExercises", () => {
  it("devuelve la biblioteca y el club, cada uno con su origen, su miniatura y sus rutinas", async () => {
    const result = await searchExercises(gateways(), {
      callerId: COACH_ID,
      query: "squat",
    });

    expect(result.exercises).toEqual([
      {
        id: LIBRARY_ID,
        name: "Barbell Squat",
        source: "library",
        tips: ["Keep your back straight."],
        youtube: null,
        thumbnailUrl: `${CDN}library/Barbell_Squat/0.jpg`,
        photoUrls: {
          start: `${CDN}library/Barbell_Squat/0.jpg`,
          end: `${CDN}library/Barbell_Squat/1.jpg`,
        },
        routines: ["Strength A", "Strength B"],
      },
    ]);
  });

  it("marca los del club como del club, sin miniatura si no tienen foto", async () => {
    exercises[1] = { ...exercises[1]!, imageStartPath: null };

    const result = await searchExercises(gateways(), {
      callerId: COACH_ID,
      query: "crawl",
    });

    expect(result.exercises[0]).toMatchObject({
      source: "club",
      thumbnailUrl: null,
      youtube: { kind: "link", url: "https://youtu.be/crawl" },
      routines: [],
    });
  });

  it("pide como mucho el tope de resultados", async () => {
    exercises = Array.from({ length: EXERCISE_SEARCH_LIMIT + 5 }, (_, i) => ({
      ...exercises[0]!,
      id: `e0e0e0e0-0000-4000-8000-${String(i).padStart(12, "0")}`,
      name: `Squat ${i}`,
    }));

    const result = await searchExercises(gateways(), {
      callerId: COACH_ID,
      query: "squat",
    });

    expect(result.exercises).toHaveLength(EXERCISE_SEARCH_LIMIT);
  });

  it("cuenta cuántos casan de la biblioteca y del club", async () => {
    const result = await searchExercises(gateways(), {
      callerId: COACH_ID,
      query: "",
    });

    expect(result.counts).toEqual({ library: 1, club: 1 });
  });

  it("con un origen sólo devuelve los de ese origen, y cuenta los dos", async () => {
    const result = await searchExercises(gateways(), {
      callerId: COACH_ID,
      query: "",
      source: "club",
    });

    expect(result.exercises.map((exercise) => exercise.id)).toEqual([CRAWL_ID]);
    expect(result.counts).toEqual({ library: 1, club: 1 });
  });

  it("dice desde dónde sigue la página siguiente, o nulo si no hay más", async () => {
    exercises = Array.from({ length: EXERCISE_SEARCH_LIMIT + 5 }, (_, i) => ({
      ...exercises[0]!,
      id: `e0e0e0e0-0000-4000-8000-${String(i).padStart(12, "0")}`,
      name: `Squat ${i}`,
    }));

    const first = await searchExercises(gateways(), {
      callerId: COACH_ID,
      query: "squat",
    });
    const second = await searchExercises(gateways(), {
      callerId: COACH_ID,
      query: "squat",
      offset: EXERCISE_SEARCH_LIMIT,
    });

    expect(first.nextOffset).toBe(EXERCISE_SEARCH_LIMIT);
    expect(second.exercises).toHaveLength(5);
    expect(second.nextOffset).toBeNull();
  });

  it.each([-1, 1.5, EXERCISE_OFFSET_MAX + 1])("rechaza el desplazamiento %s", async (offset) => {
    await expect(
      searchExercises(gateways(), { callerId: COACH_ID, query: "", offset }),
    ).rejects.toThrow(ExerciseValidationError);
  });

  it.each<Role>(["Player", "Committee"])(
    "a un %s se lo niega",
    async (role) => {
      callerRole = role;

      await expect(
        searchExercises(gateways(), { callerId: COACH_ID, query: "squat" }),
      ).rejects.toThrow(TrainingPlannerForbiddenError);
    },
  );
});

describe("createClubExercise", () => {
  it("lo crea con consejos por línea, YouTube y dos fotos, y lo anota", async () => {
    const result = await createClubExercise(gateways(), {
      callerId: COACH_ID,
      fields: fields({
        name: "  Fin kick ",
        tips: "Long legs\n\n  Point your toes  \r\nKick from the hips",
        youtube: " fin kick drill ",
      }),
      photos: {
        start: { kind: "replace", bytes: JPEG },
        end: { kind: "replace", bytes: WEBP },
      },
    });

    const startPath = `club/${CLUB_ID}/${NEW_ID}/0.jpg`;
    const endPath = `club/${CLUB_ID}/${NEW_ID}/1.webp`;
    expect(result).toEqual({
      id: NEW_ID,
      name: "Fin kick",
      source: "club",
      tips: ["Long legs", "Point your toes", "Kick from the hips"],
      youtube: { kind: "search", query: "fin kick drill" },
      thumbnailUrl: `${CDN}${startPath}`,
      photoUrls: { start: `${CDN}${startPath}`, end: `${CDN}${endPath}` },
      routines: [],
    });
    expect(uploaded).toEqual([
      { storagePath: startPath, contentType: "image/jpeg" },
      { storagePath: endPath, contentType: "image/webp" },
    ]);
    expect(auditRows).toEqual([
      expect.objectContaining({
        club_id: CLUB_ID,
        actor_id: COACH_ID,
        action: "training_exercise.created",
        entity_type: "training_exercise",
        entity_id: NEW_ID,
        metadata: null,
      }),
    ]);
  });

  it("lo crea sólo con el nombre", async () => {
    const result = await createClubExercise(gateways(), {
      callerId: COACH_ID,
      fields: fields(),
      photos: KEEP_BOTH,
    });

    expect(result).toMatchObject({
      tips: [],
      youtube: null,
      photoUrls: { start: null, end: null },
    });
    expect(uploaded).toEqual([]);
  });

  it.each([
    ["de la biblioteca", "barbell squat"],
    ["del club", "FRONT CRAWL"],
  ])(
    "rechaza un nombre que ya existe %s, sin subir nada",
    async (_label, name) => {
      await expect(
        createClubExercise(gateways(), {
          callerId: COACH_ID,
          fields: fields({ name }),
          photos: {
            start: { kind: "replace", bytes: PNG },
            end: { kind: "keep" },
          },
        }),
      ).rejects.toThrow("There is already an exercise with that name.");
      expect(uploaded).toEqual([]);
      expect(auditRows).toEqual([]);
    },
  );

  it("deja el nombre de un ejercicio de otro club", async () => {
    await expect(
      createClubExercise(gateways(), {
        callerId: COACH_ID,
        fields: fields({ name: "Squat jump" }),
        photos: KEEP_BOTH,
      }),
    ).resolves.toMatchObject({ name: "Squat jump" });
  });

  it("rechaza una foto de más de 5 MB", async () => {
    const huge = new Uint8Array(EXERCISE_PHOTO_MAX_BYTES + 1);
    huge.set(JPEG);

    await expect(
      createClubExercise(gateways(), {
        callerId: COACH_ID,
        fields: fields(),
        photos: {
          start: { kind: "replace", bytes: huge },
          end: { kind: "keep" },
        },
      }),
    ).rejects.toMatchObject(new ExerciseValidationError("photo_too_large"));
    expect(uploaded).toEqual([]);
  });

  it("acepta una foto de 5 MB justos", async () => {
    const exact = new Uint8Array(EXERCISE_PHOTO_MAX_BYTES);
    exact.set(PNG);

    await expect(
      createClubExercise(gateways(), {
        callerId: COACH_ID,
        fields: fields(),
        photos: {
          start: { kind: "replace", bytes: exact },
          end: { kind: "keep" },
        },
      }),
    ).resolves.toBeDefined();
  });

  it("rechaza una foto que no es JPEG, PNG ni WebP", async () => {
    await expect(
      createClubExercise(gateways(), {
        callerId: COACH_ID,
        fields: fields(),
        photos: {
          start: { kind: "keep" },
          end: { kind: "replace", bytes: GIF },
        },
      }),
    ).rejects.toMatchObject(
      new ExerciseValidationError("photo_type_unsupported"),
    );
  });

  it.each([
    ["sin nombre", { name: "   " }, "name_required"],
    ["con un nombre de 81", { name: "x".repeat(81) }, "name_too_long"],
    ["con un consejo de 301", { tips: "x".repeat(301) }, "tip_too_long"],
    [
      "con 21 consejos",
      { tips: Array.from({ length: 21 }, () => "tip").join("\n") },
      "too_many_tips",
    ],
    ["con un YouTube de 301", { youtube: "x".repeat(301) }, "youtube_too_long"],
  ])("rechaza un ejercicio %s", async (_label, overrides, code) => {
    await expect(
      createClubExercise(gateways(), {
        callerId: COACH_ID,
        fields: fields(overrides),
        photos: KEEP_BOTH,
      }),
    ).rejects.toMatchObject(
      new ExerciseValidationError(code as "name_required"),
    );
  });

  it("si la fila no entra, borra las fotos que subió", async () => {
    failInsert = true;

    await expect(
      createClubExercise(gateways(), {
        callerId: COACH_ID,
        fields: fields(),
        photos: {
          start: { kind: "replace", bytes: JPEG },
          end: { kind: "keep" },
        },
      }),
    ).rejects.toThrow("la base se cayó");
    expect(removed).toEqual([`club/${CLUB_ID}/${NEW_ID}/0.jpg`]);
  });

  it("a un Player se lo niega sin subir nada", async () => {
    callerRole = "Player";

    await expect(
      createClubExercise(gateways(), {
        callerId: COACH_ID,
        fields: fields(),
        photos: {
          start: { kind: "replace", bytes: JPEG },
          end: { kind: "keep" },
        },
      }),
    ).rejects.toThrow(TrainingPlannerForbiddenError);
    expect(uploaded).toEqual([]);
  });
});

describe("updateClubExercise", () => {
  it("cambia los datos, sustituye una foto por otra de otro tipo y borra la vieja", async () => {
    const result = await updateClubExercise(gateways(), {
      callerId: COACH_ID,
      exerciseId: CRAWL_ID,
      fields: fields({ name: "Front crawl drill", youtube: "" }),
      photos: {
        start: { kind: "replace", bytes: PNG },
        end: { kind: "keep" },
      },
    });

    const newStart = `club/${CLUB_ID}/${CRAWL_ID}/0.png`;
    expect(result).toMatchObject({
      name: "Front crawl drill",
      youtube: null,
      photoUrls: { start: `${CDN}${newStart}`, end: null },
    });
    expect(uploaded).toEqual([
      { storagePath: newStart, contentType: "image/png" },
    ]);
    expect(removed).toEqual([`club/${CLUB_ID}/${CRAWL_ID}/0.jpg`]);
    expect(auditRows).toEqual([
      expect.objectContaining({
        action: "training_exercise.updated",
        entity_id: CRAWL_ID,
      }),
    ]);
  });

  it("quita una foto sin poner otra", async () => {
    const result = await updateClubExercise(gateways(), {
      callerId: COACH_ID,
      exerciseId: CRAWL_ID,
      fields: fields({ name: "Front crawl" }),
      photos: { start: { kind: "remove" }, end: { kind: "keep" } },
    });

    expect(result.photoUrls.start).toBeNull();
    expect(removed).toEqual([`club/${CLUB_ID}/${CRAWL_ID}/0.jpg`]);
  });

  it("deja conservar su propio nombre", async () => {
    await expect(
      updateClubExercise(gateways(), {
        callerId: COACH_ID,
        exerciseId: CRAWL_ID,
        fields: fields({ name: "front crawl" }),
        photos: KEEP_BOTH,
      }),
    ).resolves.toMatchObject({ name: "front crawl" });
  });

  it("rechaza el nombre de uno de la biblioteca", async () => {
    await expect(
      updateClubExercise(gateways(), {
        callerId: COACH_ID,
        exerciseId: CRAWL_ID,
        fields: fields({ name: "Barbell squat" }),
        photos: KEEP_BOTH,
      }),
    ).rejects.toThrow(ExerciseNameTakenError);
  });

  it("no deja tocar uno de la biblioteca", async () => {
    await expect(
      updateClubExercise(gateways(), {
        callerId: COACH_ID,
        exerciseId: LIBRARY_ID,
        fields: fields({ name: "My squat" }),
        photos: KEEP_BOTH,
      }),
    ).rejects.toThrow(LibraryExerciseReadOnlyError);
  });

  it.each([
    ["de otro club", OTHER_CLUBS_ID],
    ["que no existe", NEW_ID],
  ])("no encuentra uno %s", async (_label, exerciseId) => {
    await expect(
      updateClubExercise(gateways(), {
        callerId: COACH_ID,
        exerciseId,
        fields: fields(),
        photos: KEEP_BOTH,
      }),
    ).rejects.toThrow(ExerciseNotFoundError);
  });
});

describe("deleteClubExercise", () => {
  it("borra uno del club sin usar, con sus fotos, y lo anota", async () => {
    await deleteClubExercise(gateways(), {
      callerId: COACH_ID,
      exerciseId: CRAWL_ID,
    });

    expect(exercises.map((exercise) => exercise.id)).not.toContain(CRAWL_ID);
    expect(removed).toEqual([`club/${CLUB_ID}/${CRAWL_ID}/0.jpg`]);
    expect(auditRows).toEqual([
      expect.objectContaining({
        action: "training_exercise.deleted",
        entity_id: CRAWL_ID,
      }),
    ]);
  });

  it("no borra uno usado en una rutina", async () => {
    inUse.add(CRAWL_ID);

    await expect(
      deleteClubExercise(gateways(), {
        callerId: COACH_ID,
        exerciseId: CRAWL_ID,
      }),
    ).rejects.toThrow(ExerciseInUseError);
    expect(removed).toEqual([]);
    expect(auditRows).toEqual([]);
  });

  it("no deja borrar uno de la biblioteca", async () => {
    await expect(
      deleteClubExercise(gateways(), {
        callerId: COACH_ID,
        exerciseId: LIBRARY_ID,
      }),
    ).rejects.toThrow(LibraryExerciseReadOnlyError);
  });

  it("no encuentra uno de otro club", async () => {
    await expect(
      deleteClubExercise(gateways(), {
        callerId: COACH_ID,
        exerciseId: OTHER_CLUBS_ID,
      }),
    ).rejects.toThrow(ExerciseNotFoundError);
  });
});
