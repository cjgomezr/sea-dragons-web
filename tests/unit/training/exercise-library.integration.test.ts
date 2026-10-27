// @vitest-environment node
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, it } from "vitest";
import {
  type LibrarySource,
  loadExerciseLibrary,
} from "@/lib/training/exercise-library-loader";
import {
  EXERCISE_IMAGES_BUCKET,
  createSupabaseExerciseLibraryStore,
} from "@/lib/training/supabase-exercise-library-gateways";
import { runWithCleanup } from "../../support/run-with-cleanup";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  createServiceRoleTestClient,
  describeRls,
} from "../../support/rls";

/**
 * La carga de la biblioteca contra Supabase (#897), con `0083_training.sql`
 * aplicada y un origen de dos ejercicios en vez de GitHub. Lo que ningún
 * doble dice: que el `upsert` encuentra `library_key`, que la huella vuelve
 * en los metadatos de Storage y que repetir la carga deja las mismas filas.
 *
 * Las claves y los nombres llevan un sufijo propio, para no chocar con la
 * biblioteca de verdad si ya está cargada.
 */

const RUN_ID = randomUUID().slice(0, 8);
const WITH_PHOTOS = `Test_Squat_${RUN_ID}`;
const WITHOUT_PHOTOS = `Test_Plank_${RUN_ID}`;
const PHOTO_SIDE_PX = 4;

async function tinyJpeg(red: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: {
        width: PHOTO_SIDE_PX,
        height: PHOTO_SIDE_PX,
        channels: 3,
        background: { r: red, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer(),
  );
}

async function fixtureSource(): Promise<LibrarySource> {
  const photos = new Map([
    [`${WITH_PHOTOS}/0.jpg`, await tinyJpeg(10)],
    [`${WITH_PHOTOS}/1.jpg`, await tinyJpeg(200)],
  ]);
  const entries = [
    {
      id: WITH_PHOTOS,
      name: `Test squat ${RUN_ID}`,
      instructions: ["Stand tall.", "Squat down."],
      images: [...photos.keys()],
    },
    {
      id: WITHOUT_PHOTOS,
      name: `Test plank ${RUN_ID}`,
      instructions: ["Hold it."],
      images: [],
    },
  ];
  return {
    fetchEntries: async () => entries,
    fetchPhoto: async (sourcePath) => {
      const bytes = photos.get(sourcePath);
      if (!bytes) {
        throw new Error(`no hay foto ${sourcePath}`);
      }
      return bytes;
    },
  };
}

async function readFixtureRows(
  serviceClient: ServiceRoleClient,
): Promise<readonly Record<string, unknown>[]> {
  const { data, error } = await serviceClient.client
    .from("training_exercises")
    .select(
      "id, library_key, source, club_id, name, tips, youtube, image_start_path, image_end_path",
    )
    .in("library_key", [WITH_PHOTOS, WITHOUT_PHOTOS])
    .order("library_key");
  if (error) {
    throw new Error(`No se pudieron leer las filas: ${error.message}`);
  }
  return data;
}

/** El mensaje del fallo, o `null` si limpió (`runWithCleanup`). */
async function removeFixture(
  serviceClient: ServiceRoleClient,
): Promise<string | null> {
  const { error: storageError } = await serviceClient.client.storage
    .from(EXERCISE_IMAGES_BUCKET)
    .remove([`library/${WITH_PHOTOS}/0.jpg`, `library/${WITH_PHOTOS}/1.jpg`]);
  const { error } = await serviceClient.client
    .from("training_exercises")
    .delete()
    .in("library_key", [WITH_PHOTOS, WITHOUT_PHOTOS]);
  const failures = [storageError?.message, error?.message].filter(
    (message) => message !== undefined,
  );
  return failures.length === 0 ? null : failures.join("; ");
}

describeRls("carga de la biblioteca de ejercicios", () => {
  it(
    "cargar el mismo origen dos veces deja las mismas filas y no vuelve a subir fotos",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const store = createSupabaseExerciseLibraryStore(serviceClient.client);
      const source = await fixtureSource();
      const log = (): void => {};

      await runWithCleanup(
        async () => {
          await loadExerciseLibrary({ source, store, log });
          const firstRows = await readFixtureRows(serviceClient);

          const second = await loadExerciseLibrary({ source, store, log });

          expect(await readFixtureRows(serviceClient)).toEqual(firstRows);
          expect(firstRows).toEqual([
            expect.objectContaining({
              library_key: WITHOUT_PHOTOS,
              source: "library",
              club_id: null,
              tips: ["Hold it."],
              youtube: null,
              image_start_path: null,
              image_end_path: null,
            }),
            expect.objectContaining({
              library_key: WITH_PHOTOS,
              name: `Test squat ${RUN_ID}`,
              image_start_path: `library/${WITH_PHOTOS}/0.jpg`,
              image_end_path: `library/${WITH_PHOTOS}/1.jpg`,
            }),
          ]);
          expect(second).toMatchObject({ photosUploaded: 0, photosKept: 2 });
        },
        () => removeFixture(serviceClient),
        "No se pudo limpiar la biblioteca de prueba",
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
