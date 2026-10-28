import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  RoutineInUseError,
  RoutineItemReferenceError,
  createClubRoutine,
  deleteClubRoutine,
  findLastExerciseDose,
  listClubRoutines,
  saveRoutineItems,
} from "@/lib/training/club-routines";
import { createClubRoutinesGateways } from "@/lib/training/supabase-club-routines-gateways";
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
 * Las rutinas de Planificar contra Supabase (#905), con los adaptadores de
 * verdad y `0086_training_routines_manage.sql` aplicada. Lo que ningún doble
 * dice: que las filas se guardan en su orden con la carga en sus columnas,
 * que las cuentas salen de la base, que borrar con confirmación deja los
 * días en descanso, y que la última dosis es la de la fila guardada más
 * reciente.
 *
 * Corre en un club propio y desechable con un Coach.
 */

type Seed = {
  readonly serviceClient: ServiceRoleClient;
  readonly clubId: string;
  readonly coach: TestUser;
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

/** Lo que dejan los tests, antes de que se vaya el club, que no se puede
 * borrar mientras algo lo nombre. */
async function cleanUpTraining(seed: Seed): Promise<void> {
  const client = seed.serviceClient.client;
  for (const table of [
    "training_cycle_days",
    "training_routine_items",
    "training_routines",
    "training_cycles",
    "training_marks",
    "training_exercises",
    "audit_log",
  ]) {
    await expectNoError(
      `limpiar ${table}`,
      client.from(table).delete().eq("club_id", seed.clubId),
    );
  }
}

function withClub<T>(run: (seed: Seed) => Promise<T>): Promise<T> {
  const serviceClient = createServiceRoleTestClient(process.env);
  return withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `rutinas-${randomUUID()}`, name: "Club de rutinas" }],
    ([club]) => {
      const clubId = String(club?.id);
      return withTestUser(serviceClient, (coach) =>
        withSeededRows(
          serviceClient,
          "members",
          [
            {
              club_id: clubId,
              user_id: coach.id,
              full_name: "Cora",
              email: coach.email,
              account_status: "active",
              role: "Coach",
            },
          ],
          async () => {
            const seed = { serviceClient, clubId, coach };
            try {
              return await run(seed);
            } finally {
              await cleanUpTraining(seed);
            }
          },
        ),
      );
    },
  );
}

async function insertReturningId(
  seed: Seed,
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await seed.serviceClient.client
    .from(table)
    .insert({ club_id: seed.clubId, ...row })
    .select("id")
    .single();
  if (error) {
    throw new Error(`No se pudo sembrar ${table}: ${error.message}`);
  }
  return String(data.id);
}

async function seedCatalog(seed: Seed) {
  const tag = randomUUID().slice(0, 8);
  const exerciseId = await insertReturningId(seed, "training_exercises", {
    name: `Back squat ${tag}`,
    source: "club",
  });
  const markId = await insertReturningId(seed, "training_marks", {
    name: `Back squat ${tag}`,
  });
  const cycleId = await insertReturningId(seed, "training_cycles", {
    name: "Winter",
    start_date: "2026-11-16",
    weeks: 4,
  });
  return { exerciseId, markId, cycleId };
}

async function seedDay(
  seed: Seed,
  day: { readonly cycleId: string; readonly routineId: string },
): Promise<void> {
  await expectNoError(
    "sembrar el día",
    seed.serviceClient.client.from("training_cycle_days").insert({
      club_id: seed.clubId,
      cycle_id: day.cycleId,
      week_no: 1,
      weekday: 0,
      slot: 1,
      routine_id: day.routineId,
    }),
  );
}

describeRls("Planificar: las rutinas contra Supabase (#905)", () => {
  it(
    "crea con el color siguiente, guarda las filas en orden y cuenta filas y días",
    async () => {
      await withClub(async (seed) => {
        const gateways = createClubRoutinesGateways(seed.serviceClient.client);
        const callerId = seed.coach.id;
        const { exerciseId, markId, cycleId } = await seedCatalog(seed);

        const first = await createClubRoutine(gateways, {
          callerId,
          cycleId,
          name: "Strength A",
        });
        const second = await createClubRoutine(gateways, {
          callerId,
          cycleId,
          name: "Strength B",
        });
        const shared = await createClubRoutine(gateways, {
          callerId,
          cycleId: null,
          name: "Mobility",
        });
        expect(
          [first, second, shared].map((entry) => entry.routine.colorIndex),
        ).toEqual([0, 1, 0]);

        const routineId = first.routine.id;
        const saved = await saveRoutineItems(gateways, {
          callerId,
          routineId,
          items: [
            { kind: "section", title: "Main" },
            {
              kind: "exercise",
              exerciseId,
              sets: 5,
              reps: "5",
              rest: "3'",
              load: { kind: "pct", markId, pct: 72.5 },
            },
            {
              kind: "exercise",
              exerciseId,
              load: { kind: "text", text: "Bodyweight" },
            },
          ],
        });
        expect(saved.routine.itemCount).toBe(3);
        await seedDay(seed, { cycleId, routineId });

        const listed = await listClubRoutines(gateways, {
          callerId,
          scope: { kind: "cycle", cycleId },
        });
        expect(
          listed.routines.map((entry) => [
            entry.name,
            entry.itemCount,
            entry.daysUsed,
          ]),
        ).toEqual([
          ["Strength A", 3, 1],
          ["Strength B", 0, 0],
          ["Mobility", 0, 0],
        ]);

        const { data: rows, error } = await seed.serviceClient.client
          .from("training_routine_items")
          .select("position, kind, section_title, load_kind, load_pct")
          .eq("routine_id", routineId)
          .order("position");
        expect(error).toBeNull();
        expect(rows).toEqual([
          {
            position: 0,
            kind: "section",
            section_title: "Main",
            load_kind: "none",
            load_pct: null,
          },
          {
            position: 1,
            kind: "exercise",
            section_title: null,
            load_kind: "pct",
            load_pct: 72.5,
          },
          {
            position: 2,
            kind: "exercise",
            section_title: null,
            load_kind: "text",
            load_pct: null,
          },
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "rechaza una marca de otro club sin tocar las filas",
    async () => {
      await withClub(async (seed) => {
        const gateways = createClubRoutinesGateways(seed.serviceClient.client);
        const callerId = seed.coach.id;
        const { exerciseId } = await seedCatalog(seed);
        const { routine } = await createClubRoutine(gateways, {
          callerId,
          cycleId: null,
          name: "Core",
        });

        await expect(
          saveRoutineItems(gateways, {
            callerId,
            routineId: routine.id,
            items: [
              {
                kind: "exercise",
                exerciseId,
                load: { kind: "week", markId: randomUUID() },
              },
            ],
          }),
        ).rejects.toThrow(RoutineItemReferenceError);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "borra una usada sólo confirmando y deja sus días en descanso",
    async () => {
      await withClub(async (seed) => {
        const gateways = createClubRoutinesGateways(seed.serviceClient.client);
        const callerId = seed.coach.id;
        const { cycleId } = await seedCatalog(seed);
        const { routine } = await createClubRoutine(gateways, {
          callerId,
          cycleId,
          name: "Strength A",
        });
        await seedDay(seed, { cycleId, routineId: routine.id });

        await expect(
          deleteClubRoutine(gateways, {
            callerId,
            routineId: routine.id,
            confirm: false,
          }),
        ).rejects.toThrow(RoutineInUseError);
        const deleted = await deleteClubRoutine(gateways, {
          callerId,
          routineId: routine.id,
          confirm: true,
        });

        expect(deleted).toEqual({ routineId: routine.id, daysCleared: 1 });
        const { data: days, error } = await seed.serviceClient.client
          .from("training_cycle_days")
          .select("routine_id")
          .eq("cycle_id", cycleId);
        expect(error).toBeNull();
        expect(days).toEqual([]);
        const { data: events, error: auditError } =
          await seed.serviceClient.client
            .from("audit_log")
            .select("action, metadata")
            .eq("club_id", seed.clubId)
            .eq("action", "training_routine.deleted");
        expect(auditError).toBeNull();
        expect(events).toEqual([
          {
            action: "training_routine.deleted",
            metadata: { daysCleared: 1 },
          },
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "la última dosis es la de la fila guardada más reciente, o nula",
    async () => {
      await withClub(async (seed) => {
        const gateways = createClubRoutinesGateways(seed.serviceClient.client);
        const callerId = seed.coach.id;
        const { exerciseId, markId } = await seedCatalog(seed);
        const before = await findLastExerciseDose(gateways, {
          callerId,
          exerciseId,
        });
        expect(before).toEqual({ dose: null });

        const older = await createClubRoutine(gateways, {
          callerId,
          cycleId: null,
          name: "Strength A",
        });
        await saveRoutineItems(gateways, {
          callerId,
          routineId: older.routine.id,
          items: [
            {
              kind: "exercise",
              exerciseId,
              sets: 3,
              reps: "10",
              load: { kind: "none" },
            },
          ],
        });
        const newer = await createClubRoutine(gateways, {
          callerId,
          cycleId: null,
          name: "Strength B",
        });
        await saveRoutineItems(gateways, {
          callerId,
          routineId: newer.routine.id,
          items: [
            {
              kind: "exercise",
              exerciseId,
              sets: 5,
              reps: "5",
              rest: "3'",
              load: { kind: "week", markId },
            },
          ],
        });

        const after = await findLastExerciseDose(gateways, {
          callerId,
          exerciseId,
        });

        expect(after).toEqual({
          dose: {
            sets: 5,
            reps: "5",
            rest: "3'",
            load: { kind: "week", markId },
          },
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
