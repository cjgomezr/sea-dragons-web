import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createTrainingPlanGateways } from "@/lib/training/supabase-training-plan-gateways";
import {
  TrainingPlanBlockedError,
  readTrainingPlan,
} from "@/lib/training/training-plan";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  seedCurrentMembership,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * La semana del socio contra Supabase (#898), con el adaptador de verdad y
 * `0083_training.sql` aplicada. Lo que ningún doble dice: que los embebidos
 * de PostgREST encuentran sus claves compuestas, que las filas casan con el
 * esquema y que la puerta lee la membresía de verdad.
 *
 * Corre en un club propio y desechable: un ciclo activo con un día de dos
 * rutinas, una de ellas con un título de sección.
 */

/** Un lunes, como pide el inicio de un ciclo (D5). */
const CYCLE_START = "2027-03-01";
/** El martes 2 de marzo de 2027 a las 11:00 de Melbourne: semana 1. */
const NOW = new Date("2027-03-02T00:00:00Z");
const TUESDAY = 1;

type Seed = {
  readonly serviceClient: ServiceRoleClient;
  readonly clubId: string;
  readonly player: TestUser;
};

async function succeed(
  action: string,
  query: PromiseLike<{ readonly error: { readonly message: string } | null }>,
): Promise<void> {
  const { error } = await query;
  if (error) {
    throw new Error(`No se pudo ${action}: ${error.message}`);
  }
}

function withClubAndPlayer<T>(
  serviceClient: ServiceRoleClient,
  run: (seed: Seed) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `entrenamiento-${randomUUID()}`, name: "Club del plan" }],
    ([club]) => {
      const clubId = String(club?.id);
      return withTestUser(serviceClient, (player) =>
        withSeededRows(
          serviceClient,
          "members",
          [
            {
              club_id: clubId,
              user_id: player.id,
              full_name: "Pía Player",
              email: player.email,
              account_status: "active",
              role: "Player",
            },
          ],
          async () => {
            await seedCurrentMembership(serviceClient, {
              clubId,
              userId: player.id,
            });
            return run({ serviceClient, clubId, player });
          },
        ),
      );
    },
  );
}

/** Un ejercicio y una marca del club, para la fila con carga. */
function withExerciseAndMark<T>(
  seed: Seed,
  run: (ids: { exerciseId: string; markId: string }) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    seed.serviceClient,
    "training_exercises",
    [
      {
        club_id: seed.clubId,
        name: "Back squat",
        tips: ["Brace"],
        source: "club",
        image_start_path: "club/squat-start.webp",
      },
    ],
    ([exercise]) =>
      withSeededRows(
        seed.serviceClient,
        "training_marks",
        [{ club_id: seed.clubId, name: "Back squat 1RM" }],
        ([mark]) =>
          run({ exerciseId: String(exercise?.id), markId: String(mark?.id) }),
      ),
  );
}

/** El ciclo activo con dos rutinas el martes de la semana 1. Todo lo demás
 * se va con el ciclo en cascada. */
function withActiveCycle<T>(
  seed: Seed,
  ids: { readonly exerciseId: string; readonly markId: string },
  run: () => Promise<T>,
): Promise<T> {
  const { serviceClient, clubId } = seed;
  return withSeededRows(
    serviceClient,
    "training_cycles",
    [
      {
        club_id: clubId,
        name: "Integración",
        event_name: "Nationals",
        event_date: "2027-04-10",
        start_date: CYCLE_START,
        weeks: 6,
        status: "active",
      },
    ],
    async ([cycle]) => {
      const cycleId = String(cycle?.id);
      const { data: routines, error } = await serviceClient.client
        .from("training_routines")
        .insert([
          { club_id: clubId, cycle_id: cycleId, name: "Pool", color_index: 0 },
          { club_id: clubId, cycle_id: cycleId, name: "Gym", color_index: 1 },
        ])
        .select("id, name");
      if (error) {
        throw new Error(`No se pudieron sembrar las rutinas: ${error.message}`);
      }
      const routineId = (name: string) =>
        String(routines.find((routine) => routine.name === name)?.id);
      await succeed(
        "sembrar las filas",
        serviceClient.client.from("training_routine_items").insert([
          {
            club_id: clubId,
            routine_id: routineId("Gym"),
            position: 1,
            kind: "exercise",
            exercise_id: ids.exerciseId,
            sets: 3,
            reps: "5",
            load_kind: "pct",
            load_mark_id: ids.markId,
            load_pct: 75,
          },
          {
            club_id: clubId,
            routine_id: routineId("Gym"),
            position: 0,
            kind: "section",
            section_title: "Main 1",
            // Un insert de varias filas manda NULL en las columnas que una
            // fila no trae, aunque la tabla tenga valor por defecto.
            load_kind: "none",
          },
        ]),
      );
      await succeed(
        "sembrar la cuadrícula",
        serviceClient.client.from("training_cycle_days").insert([
          {
            club_id: clubId,
            cycle_id: cycleId,
            week_no: 1,
            weekday: TUESDAY,
            slot: 2,
            routine_id: routineId("Gym"),
          },
          {
            club_id: clubId,
            cycle_id: cycleId,
            week_no: 1,
            weekday: TUESDAY,
            slot: 1,
            routine_id: routineId("Pool"),
          },
        ]),
      );
      await succeed(
        "sembrar la semana",
        serviceClient.client.from("training_cycle_weeks").insert({
          club_id: clubId,
          cycle_id: cycleId,
          week_no: 1,
          note: "Training Camp",
          dose_sets: 4,
          dose_reps: "5",
          dose_intensity_kind: "text",
          dose_text: "RPE 7",
        }),
      );
      return run();
    },
  );
}

describeRls("La semana del socio contra Supabase", () => {
  it(
    "sirve un día de dos rutinas con su sección, y cierra la puerta a quien no está al día",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      await withClubAndPlayer(serviceClient, (seed) =>
        withExerciseAndMark(seed, (ids) =>
          withActiveCycle(seed, ids, async () => {
            const gateways = createTrainingPlanGateways(serviceClient.client);
            const request = { callerId: seed.player.id, now: NOW, week: null };

            const plan = await readTrainingPlan(gateways, request);

            expect(plan).toMatchObject({
              cycle: {
                name: "Integración",
                event: { name: "Nationals", date: "2027-04-10" },
                endDate: "2027-04-11",
                weeks: 6,
              },
              current: { week: 1, phase: "running", today: "2027-03-02" },
              week: {
                number: 1,
                note: "Training Camp",
                dose: {
                  sets: 4,
                  reps: "5",
                  intensity: { kind: "text", text: "RPE 7" },
                },
              },
            });
            if (plan.cycle === null) {
              throw new Error("se esperaba un ciclo activo");
            }
            const tuesday = plan.week.days[TUESDAY];
            expect(tuesday?.routines.map((routine) => routine.name)).toEqual([
              "Pool",
              "Gym",
            ]);
            expect(tuesday?.routines[0]?.items).toEqual([]);
            const gymItems = tuesday?.routines[1]?.items;
            expect(gymItems?.[0]).toMatchObject({
              kind: "section",
              title: "Main 1",
            });
            expect(gymItems?.[1]).toMatchObject({
              kind: "exercise",
              exercise: {
                name: "Back squat",
                tips: ["Brace"],
                photoUrls: [
                  expect.stringMatching(
                    /\/storage\/v1\/object\/public\/training-exercise-images\/club\/squat-start\.webp$/,
                  ),
                ],
              },
              sets: 3,
              reps: "5",
              load: {
                kind: "pct",
                mark: { id: ids.markId, name: "Back squat 1RM" },
                pct: 75,
              },
            });

            await succeed(
              "cancelar la membresía",
              serviceClient.client
                .from("memberships")
                .update({ status: "cancelled" })
                .eq("user_id", seed.player.id),
            );
            const blocked = await readTrainingPlan(gateways, request).catch(
              (caught: unknown) => caught,
            );

            expect(blocked).toBeInstanceOf(TrainingPlanBlockedError);
            expect(blocked).toMatchObject({
              block: "cancelled",
              cycle: { name: "Integración" },
            });
          }),
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
