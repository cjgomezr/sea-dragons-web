// @vitest-environment node
// Los ficheros de jsdom no viajan en un `FormData` de undici: llegan como
// texto y la foto deja de ser una imagen.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  TRAINING_MANAGE_EXERCISES_API_PATH,
  trainingManageExerciseApiPath,
} from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import {
  type ClubExercisesGateways,
  EXERCISE_PHOTO_MAX_BYTES,
  type ExerciseRecord,
} from "@/lib/training/club-exercises";

/**
 * Los ejercicios de Planificar por API (#903, RF-10 y D13 del PRD de E35).
 * La petición entra por el proxy y sólo llega al handler si la frontera la
 * deja seguir. Crear y editar llegan como `multipart/form-data`, con las
 * fotos como ficheros.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const COACH_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const OTHER_CLUB_ID = "5c1ab000-0000-4000-8000-000000000002";
const LIBRARY_ID = "e0e0e0e0-0000-4000-8000-000000000001";
const CRAWL_ID = "e0e0e0e0-0000-4000-8000-000000000002";
const OTHER_CLUBS_ID = "e0e0e0e0-0000-4000-8000-000000000003";
const NEW_ID = "e0e0e0e0-0000-4000-8000-000000000004";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);

const readSessionState = vi.fn();
const readAuthenticatedUserId = vi.fn();
const insertAuditLogRow = vi.fn();
const upload = vi.fn();
const searchQueries = vi.fn();
let exercises: ExerciseRecord[];
let inUse: Set<string>;

function clubExercisesGateways(): ClubExercisesGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Cora Coach",
        role: "Coach",
      }),
    },
    exercises: {
      searchExercises: async (query) => {
        searchQueries(query);
        return exercises.filter(
          (exercise) =>
            exercise.clubId === null || exercise.clubId === query.clubId,
        );
      },
      findExercise: async (id) =>
        exercises.find((exercise) => exercise.id === id) ?? null,
      isNameTaken: async ({ name, exceptId }) =>
        exercises.some(
          (exercise) =>
            exercise.id !== exceptId &&
            exercise.name.toLowerCase() === name.toLowerCase(),
        ),
      listRoutineNames: async () => new Map([[LIBRARY_ID, ["Strength A"]]]),
      insertExercise: async (row) => {
        exercises.push(row);
        return { kind: "saved" };
      },
      updateExercise: async (row) => {
        exercises = exercises.map((exercise) =>
          exercise.id === row.id ? row : exercise,
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
      upload: async (photo) => {
        upload(photo);
      },
      remove: async () => undefined,
      publicUrl: (path) => `https://cdn.example.test/${path}`,
    },
    audit: {
      insertAuditLogRow: async (row) => {
        insertAuditLogRow(row);
        return { error: null };
      },
    },
    newExerciseId: () => NEW_ID,
  };
}

vi.mock("@/lib/supabase/session-client", () => ({
  readIncomingCookies: () => [],
  applySessionCookies: () => undefined,
  createSessionClient: () => ({
    kind: "ready",
    client: {},
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  }),
}));

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
  readAuthenticatedUserId: (...args: unknown[]) =>
    readAuthenticatedUserId(...args),
}));

vi.mock("@/lib/training/supabase-club-exercises-gateways", () => ({
  createSupabaseClubExercisesGateways: () => ({
    kind: "ready",
    gateways: clubExercisesGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const listRoute = await import("@/app/api/v1/training/manage/exercises/route");
const exerciseRoute =
  await import("@/app/api/v1/training/manage/exercises/[exerciseId]/route");

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

function givenCaller(role: Role): void {
  givenSession({ kind: "active", role, membershipCurrent: true });
}

async function throughProxy(
  request: NextRequest,
  handle: () => Promise<Response>,
): Promise<Response> {
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? handle()
    : boundaryResponse;
}

function photo(bytes: Uint8Array<ArrayBuffer>, name = "photo.jpg"): File {
  return new File([bytes], name, { type: "image/jpeg" });
}

function form(entries: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.append(key, value);
  }
  return data;
}

function searchExercises(query: string): Promise<Response> {
  const request = new NextRequest(
    new URL(`${TRAINING_MANAGE_EXERCISES_API_PATH}${query}`, ORIGIN),
  );
  return throughProxy(request, () => listRoute.GET(request));
}

function postExercise(body: FormData | string): Promise<Response> {
  const request = new NextRequest(
    new URL(TRAINING_MANAGE_EXERCISES_API_PATH, ORIGIN),
    { method: "POST", body },
  );
  return throughProxy(request, () => listRoute.POST(request));
}

function patchExercise(exerciseId: string, body: FormData): Promise<Response> {
  const request = new NextRequest(
    new URL(trainingManageExerciseApiPath(exerciseId), ORIGIN),
    { method: "PATCH", body },
  );
  return throughProxy(request, () =>
    exerciseRoute.PATCH(request, { params: Promise.resolve({ exerciseId }) }),
  );
}

function deleteExercise(exerciseId: string): Promise<Response> {
  const request = new NextRequest(
    new URL(trainingManageExerciseApiPath(exerciseId), ORIGIN),
    { method: "DELETE" },
  );
  return throughProxy(request, () =>
    exerciseRoute.DELETE(request, { params: Promise.resolve({ exerciseId }) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  readAuthenticatedUserId.mockResolvedValue(COACH_ID);
  givenCaller("Coach");
  inUse = new Set();
  exercises = [
    {
      id: LIBRARY_ID,
      clubId: null,
      name: "Barbell Squat",
      tips: [],
      youtube: null,
      imageStartPath: "library/Barbell_Squat/0.jpg",
      imageEndPath: null,
    },
    {
      id: CRAWL_ID,
      clubId: CLUB_ID,
      name: "Front crawl",
      tips: [],
      youtube: null,
      imageStartPath: null,
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
});

describe("GET /api/v1/training/manage/exercises", () => {
  it("busca hasta 20 con el texto recortado y responde origen, miniatura y rutinas", async () => {
    const response = await searchExercises("?q=%20squat%20");

    expect(response.status).toBe(200);
    expect(searchQueries).toHaveBeenCalledWith({
      clubId: CLUB_ID,
      text: "squat",
      limit: 20,
    });
    const body = await response.json();
    expect(body.data.exercises[0]).toMatchObject({
      id: LIBRARY_ID,
      source: "library",
      thumbnailUrl: "https://cdn.example.test/library/Barbell_Squat/0.jpg",
      routines: ["Strength A"],
    });
  });

  it("sin q busca todos", async () => {
    const response = await searchExercises("");

    expect(response.status).toBe(200);
    expect(searchQueries).toHaveBeenCalledWith(
      expect.objectContaining({ text: "" }),
    );
  });

  it("responde 400 a una búsqueda de más de 80 caracteres", async () => {
    const response = await searchExercises(`?q=${"x".repeat(81)}`);

    expect(response.status).toBe(400);
  });

  it("no se guarda en ninguna caché", () => {
    expect(listRoute.dynamic).toBe("force-dynamic");
    expect(exerciseRoute.dynamic).toBe("force-dynamic");
  });

  it.each<Role>(["Player", "Committee"])(
    "a un %s le responde 403",
    async (role) => {
      givenCaller(role);

      const response = await searchExercises("?q=squat");

      expect(response.status).toBe(403);
    },
  );

  it("sin sesión responde 401", async () => {
    givenSession({ kind: "anonymous" });
    readAuthenticatedUserId.mockResolvedValue(null);

    const response = await searchExercises("?q=squat");

    expect(response.status).toBe(401);
  });
});

describe("POST /api/v1/training/manage/exercises", () => {
  it("crea uno del club con nombre, consejos, YouTube y dos fotos", async () => {
    const response = await postExercise(
      form({
        name: "Fin kick",
        tips: "Long legs\nPoint your toes",
        youtube: "javascript:alert(1)",
        startPhoto: photo(JPEG),
        endPhoto: photo(JPEG),
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data).toMatchObject({
      id: NEW_ID,
      source: "club",
      tips: ["Long legs", "Point your toes"],
      youtube: { kind: "search", query: "javascript:alert(1)" },
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(insertAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "training_exercise.created" }),
    );
  });

  it("un fichero vacío es como no mandar foto", async () => {
    const response = await postExercise(
      form({ name: "Fin kick", startPhoto: photo(new Uint8Array(0), "") }),
    );

    expect(response.status).toBe(201);
    expect(upload).not.toHaveBeenCalled();
  });

  it("responde 409 a un nombre que ya existe", async () => {
    const response = await postExercise(form({ name: "barbell squat" }));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatchObject({
      code: "conflict",
      message: "There is already an exercise with that name.",
      reason: "exercise_name_taken",
    });
  });

  it("responde 400 a una foto de más de 5 MB", async () => {
    const huge = new Uint8Array(EXERCISE_PHOTO_MAX_BYTES + 1);
    huge.set(JPEG);

    const response = await postExercise(
      form({ name: "Fin kick", startPhoto: photo(huge) }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.reason).toBe("photo_too_large");
    expect(upload).not.toHaveBeenCalled();
  });

  it("responde 400 a una foto que no es JPEG, PNG ni WebP", async () => {
    const response = await postExercise(
      form({ name: "Fin kick", endPhoto: photo(GIF, "fin.jpg") }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.reason).toBe("photo_type_unsupported");
  });

  it.each([
    ["sin nombre", form({ tips: "Long legs" })],
    ["con el nombre como fichero", form({ name: photo(JPEG) })],
    ["con la foto como texto", form({ name: "Fin kick", startPhoto: "x" })],
    ["con un campo de más", form({ name: "Fin kick", source: "library" })],
    [
      "con un campo de quitar foto, que sólo vale al editar",
      form({ name: "Fin kick", removeStartPhoto: "true" }),
    ],
  ])("responde 400 a un formulario %s", async (_label, body) => {
    const response = await postExercise(body);

    expect(response.status).toBe(400);
    expect(insertAuditLogRow).not.toHaveBeenCalled();
  });

  it("responde 400 a un cuerpo que no es un formulario", async () => {
    const response = await postExercise("nombre=Fin");

    expect(response.status).toBe(400);
  });

  it("a un Player le responde 403 sin subir nada", async () => {
    givenCaller("Player");

    const response = await postExercise(
      form({ name: "Fin kick", startPhoto: photo(JPEG) }),
    );

    expect(response.status).toBe(403);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/training/manage/exercises/{exerciseId}", () => {
  it("edita uno del club y responde cómo quedó", async () => {
    const response = await patchExercise(
      CRAWL_ID,
      form({
        name: "Front crawl drill",
        tips: "",
        youtube: "https://youtu.be/crawl",
        startPhoto: photo(JPEG),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({
      name: "Front crawl drill",
      youtube: { kind: "link", url: "https://youtu.be/crawl" },
      thumbnailUrl: `https://cdn.example.test/club/${CLUB_ID}/${CRAWL_ID}/0.jpg`,
    });
  });

  it("quita una foto con removeStartPhoto", async () => {
    exercises[1] = {
      ...exercises[1]!,
      imageStartPath: `club/${CLUB_ID}/${CRAWL_ID}/0.jpg`,
    };

    const response = await patchExercise(
      CRAWL_ID,
      form({ name: "Front crawl", removeStartPhoto: "true" }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.thumbnailUrl).toBeNull();
  });

  it("responde 400 si pide a la vez quitar y poner la misma foto", async () => {
    const response = await patchExercise(
      CRAWL_ID,
      form({
        name: "Front crawl",
        removeStartPhoto: "true",
        startPhoto: photo(JPEG),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("responde 403 a uno de la biblioteca", async () => {
    const response = await patchExercise(
      LIBRARY_ID,
      form({ name: "My squat" }),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.reason).toBe("library_exercise");
  });

  it.each([
    ["de otro club", OTHER_CLUBS_ID],
    ["con un id que no es un uuid", "no-es-un-id"],
  ])("responde 404 a uno %s", async (_label, exerciseId) => {
    const response = await patchExercise(
      exerciseId,
      form({ name: "Squat jump" }),
    );

    expect(response.status).toBe(404);
  });

  it("a un Committee le responde 403", async () => {
    givenCaller("Committee");

    const response = await patchExercise(
      CRAWL_ID,
      form({ name: "Front crawl" }),
    );

    expect(response.status).toBe(403);
  });
});

describe("DELETE /api/v1/training/manage/exercises/{exerciseId}", () => {
  it("borra uno del club sin usar y responde 204", async () => {
    const response = await deleteExercise(CRAWL_ID);

    expect(response.status).toBe(204);
    expect(insertAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "training_exercise.deleted" }),
    );
  });

  it("responde 409 a uno usado en una rutina", async () => {
    inUse.add(CRAWL_ID);

    const response = await deleteExercise(CRAWL_ID);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.reason).toBe("exercise_in_use");
  });

  it("responde 403 a uno de la biblioteca", async () => {
    const response = await deleteExercise(LIBRARY_ID);

    expect(response.status).toBe(403);
  });

  it("responde 404 a uno de otro club", async () => {
    const response = await deleteExercise(OTHER_CLUBS_ID);

    expect(response.status).toBe(404);
  });

  it("a un Player le responde 403 sin borrar", async () => {
    givenCaller("Player");

    const response = await deleteExercise(CRAWL_ID);

    expect(response.status).toBe(403);
    expect(exercises).toHaveLength(3);
  });
});
