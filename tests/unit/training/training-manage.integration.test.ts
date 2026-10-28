import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  createClubExercise,
  deleteClubExercise,
  ExerciseInUseError,
  ExerciseNameTakenError,
  searchExercises,
  updateClubExercise,
} from "@/lib/training/club-exercises";
import {
  createClubMark,
  deleteClubMark,
  listClubMarks,
  MarkHasValuesError,
  MarkInUseError,
  MarkNameTakenError,
  renameClubMark,
} from "@/lib/training/club-marks";
import { createClubExercisesGateways } from "@/lib/training/supabase-club-exercises-gateways";
import { createClubMarksGateways } from "@/lib/training/supabase-club-marks-gateways";
import { TRAINING_EXERCISE_IMAGES_BUCKET } from "@/lib/training/supabase-training-plan-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * Planificar contra Supabase (#903), con los adaptadores de verdad y
 * `0084_training_manage.sql` aplicada. Lo que ningún doble dice: que el
 * nombre repetido se mide sin mayúsculas ni acentos, que las cuentas de una
 * marca no traen valores, que la búsqueda junta biblioteca y club, que la
 * clave de una fila de rutina impide borrar y que las fotos llegan a Storage.
 *
 * Corre en un club propio y desechable con un Coach y un Player.
 */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const SQUAT_VALUE = 82.5;

type Seed = {
  readonly serviceClient: ServiceRoleClient;
  readonly clubId: string;
  readonly coach: TestUser;
  readonly player: TestUser;
};

async function expectNoError(
  label: string,
  query: PromiseLike<{ readonly error: { message: string } | null }>,
): Promise<void> {
  const { error } = await query;
  if (error) {
    throw new Error(`No se pudo ${label}: ${error.message}`);
  }
}

async function removeClubPhotos(seed: Seed): Promise<void> {
  const bucket = seed.serviceClient.client.storage.from(
    TRAINING_EXERCISE_IMAGES_BUCKET,
  );
  const { data: folders, error } = await bucket.list(`club/${seed.clubId}`);
  if (error) {
    throw new Error(`No se pudieron listar las fotos: ${error.message}`);
  }
  for (const folder of folders) {
    const prefix = `club/${seed.clubId}/${folder.name}`;
    const { data: files, error: listError } = await bucket.list(prefix);
    if (listError) {
      throw new Error(`No se pudieron listar ${prefix}: ${listError.message}`);
    }
    if (files.length > 0) {
      await expectNoError(
        `borrar ${prefix}`,
        bucket.remove(files.map((file) => `${prefix}/${file.name}`)),
      );
    }
  }
}

/** Lo que dejan los tests, antes de que se vaya el club, que no se puede
 * borrar mientras algo lo nombre. */
async function cleanUpTraining(seed: Seed): Promise<void> {
  const client = seed.serviceClient.client;
  for (const table of [
    "training_routine_items",
    "training_routines",
    "training_member_marks",
    "training_marks",
    "training_exercises",
    "audit_log",
  ]) {
    await expectNoError(
      `limpiar ${table}`,
      client.from(table).delete().eq("club_id", seed.clubId),
    );
  }
  await removeClubPhotos(seed);
}

function memberRow(
  clubId: string,
  user: TestUser,
  options: { readonly fullName: string; readonly role: string },
) {
  return {
    club_id: clubId,
    user_id: user.id,
    full_name: options.fullName,
    email: user.email,
    account_status: "active",
    role: options.role,
  };
}

function withClub<T>(run: (seed: Seed) => Promise<T>): Promise<T> {
  const serviceClient = createServiceRoleTestClient(process.env);
  return withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `planificar-${randomUUID()}`, name: "Club de planificar" }],
    ([club]) => {
      const clubId = String(club?.id);
      return withTestUser(serviceClient, (coach) =>
        withTestUser(serviceClient, (player) =>
          withSeededRows(
            serviceClient,
            "members",
            [
              memberRow(clubId, coach, { fullName: "Cora", role: "Coach" }),
              memberRow(clubId, player, { fullName: "Pía", role: "Player" }),
            ],
            async () => {
              const seed = { serviceClient, clubId, coach, player };
              try {
                return await run(seed);
              } finally {
                await cleanUpTraining(seed);
              }
            },
          ),
        ),
      );
    },
  );
}

/** Una rutina con una fila del ejercicio y, si se da, "% de" la marca. */
async function seedRoutineRow(
  seed: Seed,
  row: { readonly exerciseId: string; readonly markId: string | null },
): Promise<string> {
  const client = seed.serviceClient.client;
  const { data: routine, error } = await client
    .from("training_routines")
    .insert({ club_id: seed.clubId, name: "Strength A", color_index: 0 })
    .select("id")
    .single();
  if (error) {
    throw new Error(`No se pudo sembrar la rutina: ${error.message}`);
  }
  const { data: item, error: itemError } = await client
    .from("training_routine_items")
    .insert({
      club_id: seed.clubId,
      routine_id: routine.id,
      position: 0,
      kind: "exercise",
      exercise_id: row.exerciseId,
      ...(row.markId === null
        ? {}
        : { load_kind: "pct", load_mark_id: row.markId, load_pct: 75 }),
    })
    .select("id")
    .single();
  if (itemError) {
    throw new Error(`No se pudo sembrar la fila: ${itemError.message}`);
  }
  return String(item.id);
}

async function deleteRoutineRow(seed: Seed, itemId: string): Promise<void> {
  await expectNoError(
    "borrar la fila de rutina",
    seed.serviceClient.client
      .from("training_routine_items")
      .delete()
      .eq("id", itemId),
  );
}

async function auditActions(seed: Seed): Promise<unknown[]> {
  const { data, error } = await seed.serviceClient.client
    .from("audit_log")
    .select("action, entity_type, metadata")
    .eq("club_id", seed.clubId)
    .order("created_at");
  if (error) {
    throw new Error(`No se pudo leer la bitácora: ${error.message}`);
  }
  return data;
}

const NO_PHOTOS = {
  start: { kind: "keep" },
  end: { kind: "keep" },
} as const;

describeRls("Planificar: las marcas del club contra Supabase (#903)", () => {
  it(
    "crea, rechaza el nombre repetido sin acentos, renombra, cuenta sin valores y borra",
    async () => {
      await withClub(async (seed) => {
        const gateways = createClubMarksGateways(seed.serviceClient.client);
        const callerId = seed.coach.id;

        await createClubMark(gateways, { callerId, name: "Back squat" });
        const created = await createClubMark(gateways, {
          callerId,
          name: "Power clean",
        });
        await expect(
          createClubMark(gateways, { callerId, name: " PÓWER CLEAN " }),
        ).rejects.toThrow(MarkNameTakenError);

        const powerClean = created.marks.at(-1);
        expect(created.marks.map((mark) => mark.name)).toEqual([
          "Back squat",
          "Power clean",
        ]);
        const markId = String(powerClean?.id);

        const exercise = await createClubExercise(
          createClubExercisesGateways(seed.serviceClient.client),
          {
            callerId,
            fields: { name: `Clean ${randomUUID()}`, tips: "", youtube: "" },
            photos: NO_PHOTOS,
          },
        );
        const itemId = await seedRoutineRow(seed, {
          exerciseId: exercise.id,
          markId,
        });
        await expectNoError(
          "sembrar el valor del socio",
          seed.serviceClient.client.from("training_member_marks").insert({
            user_id: seed.player.id,
            club_id: seed.clubId,
            mark_id: markId,
            value: SQUAT_VALUE,
          }),
        );

        const renamed = await renameClubMark(gateways, {
          callerId,
          markId,
          name: "Hang clean",
        });
        expect(renamed.marks[1]).toEqual({
          id: markId,
          name: "Hang clean",
          unit: "kg",
          routineRows: 1,
          membersRecorded: 1,
        });
        expect(
          JSON.stringify(await listClubMarks(gateways, callerId)),
        ).not.toContain(String(SQUAT_VALUE));

        await expect(
          deleteClubMark(gateways, { callerId, markId, confirm: true }),
        ).rejects.toThrow(MarkInUseError);
        await deleteRoutineRow(seed, itemId);
        await expect(
          deleteClubMark(gateways, { callerId, markId, confirm: false }),
        ).rejects.toThrow(MarkHasValuesError);

        const afterDelete = await deleteClubMark(gateways, {
          callerId,
          markId,
          confirm: true,
        });
        expect(afterDelete.marks.map((mark) => mark.name)).toEqual([
          "Back squat",
        ]);
        const { data: values, error } = await seed.serviceClient.client
          .from("training_member_marks")
          .select("mark_id")
          .eq("mark_id", markId);
        expect(error).toBeNull();
        expect(values).toEqual([]);

        const markEvents = (await auditActions(seed)).filter((row) =>
          String((row as { action: string }).action).startsWith(
            "training_mark.",
          ),
        );
        expect(markEvents).toEqual([
          {
            action: "training_mark.created",
            entity_type: "training_mark",
            metadata: null,
          },
          {
            action: "training_mark.created",
            entity_type: "training_mark",
            metadata: null,
          },
          {
            action: "training_mark.renamed",
            entity_type: "training_mark",
            metadata: null,
          },
          {
            action: "training_mark.deleted",
            entity_type: "training_mark",
            metadata: { valuesDeleted: 1 },
          },
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});

describeRls(
  "Planificar: los ejercicios del club contra Supabase (#903)",
  () => {
    it(
      "crea con foto, busca sin acentos, rechaza el nombre de la biblioteca, edita y borra",
      async () => {
        await withClub(async (seed) => {
          const gateways = createClubExercisesGateways(
            seed.serviceClient.client,
          );
          const callerId = seed.coach.id;
          const tag = randomUUID().slice(0, 8);
          const libraryName = `Zercher squat ${tag}`;

          await withSeededRows(
            seed.serviceClient,
            "training_exercises",
            [
              {
                name: libraryName,
                source: "library",
                library_key: `planificar-${tag}`,
              },
            ],
            async () => {
              const created = await createClubExercise(gateways, {
                callerId,
                fields: {
                  name: `Fin kíck ${tag}`,
                  tips: "Long legs\nPoint your toes",
                  youtube: "javascript:alert(1)",
                },
                photos: {
                  start: { kind: "replace", bytes: JPEG },
                  end: { kind: "keep" },
                },
              });
              expect(created).toMatchObject({
                source: "club",
                tips: ["Long legs", "Point your toes"],
                youtube: { kind: "search", query: "javascript:alert(1)" },
              });
              const photoResponse = await fetch(String(created.thumbnailUrl));
              expect(photoResponse.status).toBe(200);

              await expect(
                createClubExercise(gateways, {
                  callerId,
                  fields: {
                    name: libraryName.toUpperCase(),
                    tips: "",
                    youtube: "",
                  },
                  photos: NO_PHOTOS,
                }),
              ).rejects.toThrow(ExerciseNameTakenError);

              const found = await searchExercises(gateways, {
                callerId,
                query: `FIN KICK ${tag}`,
              });
              expect(found.exercises.map((exercise) => exercise.id)).toEqual([
                created.id,
              ]);
              const library = await searchExercises(gateways, {
                callerId,
                query: `zercher squat ${tag}`,
              });
              expect(library.exercises).toEqual([
                expect.objectContaining({
                  name: libraryName,
                  source: "library",
                }),
              ]);

              const itemId = await seedRoutineRow(seed, {
                exerciseId: created.id,
                markId: null,
              });
              const inRoutine = await searchExercises(gateways, {
                callerId,
                query: `fin kick ${tag}`,
              });
              expect(inRoutine.exercises[0]?.routines).toEqual(["Strength A"]);

              const updated = await updateClubExercise(gateways, {
                callerId,
                exerciseId: created.id,
                fields: {
                  name: `Fin kick drill ${tag}`,
                  tips: "",
                  youtube: "",
                },
                photos: { start: { kind: "remove" }, end: { kind: "keep" } },
              });
              expect(updated).toMatchObject({
                name: `Fin kick drill ${tag}`,
                thumbnailUrl: null,
              });

              await expect(
                deleteClubExercise(gateways, {
                  callerId,
                  exerciseId: created.id,
                }),
              ).rejects.toThrow(ExerciseInUseError);
              await deleteRoutineRow(seed, itemId);
              await deleteClubExercise(gateways, {
                callerId,
                exerciseId: created.id,
              });

              const exerciseEvents = (await auditActions(seed)).map(
                (row) => (row as { action: string }).action,
              );
              expect(exerciseEvents).toEqual([
                "training_exercise.created",
                "training_exercise.updated",
                "training_exercise.deleted",
              ]);
            },
          );
        });
      },
      RLS_NETWORK_TEST_TIMEOUT_MS,
    );
  },
);
