import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  activateManagedCycle,
  copyManagedCycleWeekOne,
  createManagedCycle,
  CycleDaysWouldBeRemovedError,
  duplicateManagedCycle,
  readManagedCycle,
  saveManagedCycleWeek,
  setManagedCycleDay,
  updateManagedCycle,
} from "@/lib/training/club-cycles";
import { createClubCyclesGateways } from "@/lib/training/supabase-club-cycles-gateways";
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
 * Los ciclos de Planificar contra Supabase (#904), con los adaptadores de
 * verdad y `0085_training_cycles_manage.sql` aplicada. Lo que ningún doble
 * dice: que activar archiva el anterior en la base, que duplicar copia las
 * rutinas propias con sus filas y reapunta la cuadrícula dejando las
 * compartidas, y que el conteo de rutinas propias sale del embebido.
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
 * borrar mientras algo lo nombre. Borrar los ciclos se lleva sus semanas,
 * días y rutinas propias. */
async function cleanUpTraining(seed: Seed): Promise<void> {
  const client = seed.serviceClient.client;
  for (const table of [
    "training_cycle_days",
    "training_routine_items",
    "training_routines",
    "training_cycles",
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
    [{ slug: `ciclos-${randomUUID()}`, name: "Club de ciclos" }],
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

/** Una rutina del ciclo con un título y una fila, y una compartida. */
async function seedRoutines(seed: Seed, cycleId: string) {
  const own = await insertReturningId(seed, "training_routines", {
    cycle_id: cycleId,
    name: "Strength A",
    color_index: 1,
  });
  const shared = await insertReturningId(seed, "training_routines", {
    name: "Pool",
    color_index: 4,
  });
  const exerciseId = await insertReturningId(seed, "training_exercises", {
    name: `Back squat ${randomUUID()}`,
    source: "club",
  });
  await expectNoError(
    "sembrar las filas",
    seed.serviceClient.client.from("training_routine_items").insert([
      {
        club_id: seed.clubId,
        routine_id: own,
        position: 0,
        kind: "section",
        section_title: "Main 1",
      },
      {
        club_id: seed.clubId,
        routine_id: own,
        position: 1,
        kind: "exercise",
        exercise_id: exerciseId,
        sets: 4,
        reps: "5",
      },
    ]),
  );
  return { own, shared };
}

async function routineItemsOf(seed: Seed, routineId: string) {
  const { data, error } = await seed.serviceClient.client
    .from("training_routine_items")
    .select("position, kind, section_title, sets, reps")
    .eq("routine_id", routineId)
    .order("position");
  if (error) {
    throw new Error(`No se pudieron leer las filas: ${error.message}`);
  }
  return data;
}

async function routineCycleOf(seed: Seed, routineId: string) {
  const { data, error } = await seed.serviceClient.client
    .from("training_routines")
    .select("cycle_id, name, color_index")
    .eq("id", routineId)
    .single();
  if (error) {
    throw new Error(`No se pudo leer la rutina: ${error.message}`);
  }
  return data;
}

const EVENT_SCHEDULE = {
  kind: "event",
  eventName: "Nationals",
  eventDate: "2026-12-13",
} as const;

describeRls("Planificar: los ciclos contra Supabase (#904)", () => {
  it(
    "crear calcula el inicio y activar archiva el activo anterior",
    async () => {
      await withClub(async (seed) => {
        const gateways = createClubCyclesGateways(seed.serviceClient.client);
        const callerId = seed.coach.id;
        const winter = await createManagedCycle(gateways, {
          callerId,
          input: { name: "Winter", weeks: 16, schedule: EVENT_SCHEDULE },
        });
        const summer = await createManagedCycle(gateways, {
          callerId,
          input: {
            name: "Summer",
            weeks: 8,
            schedule: { kind: "start", startDate: "2027-01-06" },
          },
        });
        expect(winter.cycle).toMatchObject({
          status: "draft",
          startDate: "2026-08-24",
          ownRoutines: 0,
        });
        expect(summer.cycle.startDate).toBe("2027-01-04");

        await activateManagedCycle(gateways, {
          callerId,
          cycleId: winter.cycle.id,
        });
        const result = await activateManagedCycle(gateways, {
          callerId,
          cycleId: summer.cycle.id,
        });

        const statuses = Object.fromEntries(
          result.cycles.map((cycle) => [cycle.id, cycle.status]),
        );
        expect(statuses).toEqual({
          [winter.cycle.id]: "archived",
          [summer.cycle.id]: "active",
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "duplicar copia las rutinas propias con sus filas, reapunta los días y deja las compartidas",
    async () => {
      await withClub(async (seed) => {
        const gateways = createClubCyclesGateways(seed.serviceClient.client);
        const callerId = seed.coach.id;
        const source = await createManagedCycle(gateways, {
          callerId,
          input: { name: "Winter", weeks: 4, schedule: EVENT_SCHEDULE },
        });
        const cycleId = source.cycle.id;
        const { own, shared } = await seedRoutines(seed, cycleId);
        await setManagedCycleDay(gateways, {
          callerId,
          cycleId,
          day: { weekNo: 1, weekday: 0, slot: 1, routineId: own },
        });
        await setManagedCycleDay(gateways, {
          callerId,
          cycleId,
          day: { weekNo: 1, weekday: 0, slot: 2, routineId: shared },
        });
        await saveManagedCycleWeek(gateways, {
          callerId,
          cycleId,
          week: {
            weekNo: 1,
            note: "Camp",
            dose: { sets: 4, reps: "5", intensity: { kind: "pct", pct: 82.5 } },
          },
        });

        const result = await duplicateManagedCycle(gateways, {
          callerId,
          cycleId,
        });

        expect(result.routinesCopied).toBe(1);
        const copy = await readManagedCycle(gateways, {
          callerId,
          cycleId: result.duplicatedCycleId,
        });
        expect(copy.cycle).toMatchObject({
          name: "Winter (copy)",
          status: "draft",
          startDate: source.cycle.startDate,
          ownRoutines: 1,
        });
        expect(copy.weeks[0]).toEqual({
          weekNo: 1,
          note: "Camp",
          dose: { sets: 4, reps: "5", intensity: { kind: "pct", pct: 82.5 } },
        });
        const [slotOne, slotTwo] = copy.days;
        expect(slotTwo?.routineId).toBe(shared);
        const copiedRoutineId = String(slotOne?.routineId);
        expect(copiedRoutineId).not.toBe(own);
        await expect(routineCycleOf(seed, copiedRoutineId)).resolves.toEqual({
          cycle_id: result.duplicatedCycleId,
          name: "Strength A",
          color_index: 1,
        });
        expect(await routineItemsOf(seed, copiedRoutineId)).toEqual(
          await routineItemsOf(seed, own),
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "vaciar la ranura 1 sube la 2, copiar la semana 1 la reparte y bajar semanas pide confirmar",
    async () => {
      await withClub(async (seed) => {
        const gateways = createClubCyclesGateways(seed.serviceClient.client);
        const callerId = seed.coach.id;
        const created = await createManagedCycle(gateways, {
          callerId,
          input: { name: "Winter", weeks: 5, schedule: EVENT_SCHEDULE },
        });
        const cycleId = created.cycle.id;
        const { own, shared } = await seedRoutines(seed, cycleId);
        for (const [slot, routineId] of [
          [1, own],
          [2, shared],
        ] as const) {
          await setManagedCycleDay(gateways, {
            callerId,
            cycleId,
            day: { weekNo: 1, weekday: 2, slot, routineId },
          });
        }

        await setManagedCycleDay(gateways, {
          callerId,
          cycleId,
          day: { weekNo: 1, weekday: 2, slot: 1, routineId: null },
        });
        const copied = await copyManagedCycleWeekOne(gateways, {
          callerId,
          cycleId,
        });

        expect(copied.days).toEqual(
          [1, 2, 3].map((weekNo) => ({
            weekNo,
            weekday: 2,
            slot: 1,
            routineId: shared,
          })),
        );
        await expect(
          updateManagedCycle(gateways, {
            callerId,
            cycleId,
            changes: { weeks: 2 },
            confirmRemoval: false,
          }),
        ).rejects.toThrow(CycleDaysWouldBeRemovedError);
        const shortened = await updateManagedCycle(gateways, {
          callerId,
          cycleId,
          changes: { weeks: 2 },
          confirmRemoval: true,
        });
        expect(shortened.days.map((day) => day.weekNo)).toEqual([1, 2]);
        expect(shortened.cycle.startDate).toBe("2026-11-30");
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
