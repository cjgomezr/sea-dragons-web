import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { buildSampleCyclePlan } from "@/lib/training/sample-cycle";
import {
  createSampleCycleGateways,
  loadSampleCycle,
} from "@/lib/training/sample-cycle-loader";
import {
  type ServiceRoleClient,
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * El ciclo de muestra cargado contra Supabase (#912, RF-13 del PRD de E35),
 * con los dominios de #903, #904 y #905 y sus adaptadores de verdad. Lo que
 * la conversión pura no dice: que todo entra con sus validaciones, y que
 * correrlo otra vez no duplica nada.
 *
 * Corre en un club propio y desechable con un Admin.
 */

/** Cientos de llamadas a la base: cada día y cada fila pasa por su dominio. */
const LOAD_TEST_TIMEOUT_MS = 10 * 60 * 1000;

const SAMPLE_PATH = path.join(
  process.cwd(),
  "docs/design/design_handoff_training/muestra/plan-uwr-sep-2026.json",
);

type Seed = {
  readonly serviceClient: ServiceRoleClient;
  readonly clubId: string;
  readonly admin: TestUser;
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

/** Lo que deja la carga, antes de que se vaya el club, que no se puede
 * borrar mientras algo lo nombre. */
async function cleanUpTraining(seed: Seed): Promise<void> {
  const client = seed.serviceClient.client;
  for (const table of [
    "training_cycle_days",
    "training_cycle_weeks",
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
    [{ slug: `muestra-${randomUUID()}`, name: "Club de la muestra" }],
    ([club]) => {
      const clubId = String(club?.id);
      return withTestUser(serviceClient, (admin) =>
        withSeededRows(
          serviceClient,
          "members",
          [
            {
              club_id: clubId,
              user_id: admin.id,
              full_name: "Ada",
              email: admin.email,
              account_status: "active",
              role: "Admin",
            },
          ],
          async () => {
            const seed = { serviceClient, clubId, admin };
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

async function countRows(
  seed: Seed,
  table: string,
  filter: Readonly<Record<string, string>> = {},
): Promise<number> {
  let query = seed.serviceClient.client
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("club_id", seed.clubId);
  for (const [column, value] of Object.entries(filter)) {
    query = query.eq(column, value);
  }
  const { count, error } = await query;
  if (error || count === null) {
    throw new Error(`No se pudo contar ${table}: ${error?.message}`);
  }
  return count;
}

describeRls("El ciclo de muestra contra Supabase (#912)", () => {
  it(
    "carga el ciclo en borrador con sus rutinas y días, y la segunda vez no duplica nada",
    async () => {
      await withClub(async (seed) => {
        const plan = buildSampleCyclePlan(
          JSON.parse(readFileSync(SAMPLE_PATH, "utf8")),
        );
        const gateways = createSampleCycleGateways(seed.serviceClient.client);
        const request = { callerId: seed.admin.id, plan };

        const first = await loadSampleCycle(gateways, request);
        const second = await loadSampleCycle(gateways, request);

        if (first.kind !== "loaded") {
          throw new Error(`La primera carga respondió ${first.kind}`);
        }
        expect(first).toMatchObject({
          routines: 48,
          days: 95,
          marksCreated: 4,
        });
        expect(second).toEqual({
          kind: "already_loaded",
          cycleId: first.cycleId,
        });
        const { data: cycles, error } = await seed.serviceClient.client
          .from("training_cycles")
          .select("id, name, status, start_date, weeks")
          .eq("club_id", seed.clubId);
        expect(error).toBeNull();
        expect(cycles).toEqual([
          {
            id: first.cycleId,
            name: "UWR macrocycle Sep 2026",
            status: "draft",
            start_date: "2026-09-14",
            weeks: 16,
          },
        ]);
        expect(
          await countRows(seed, "training_routines", {
            cycle_id: first.cycleId,
          }),
        ).toBe(48);
        expect(await countRows(seed, "training_cycle_days")).toBe(100);
        expect(await countRows(seed, "training_cycle_weeks")).toBe(15);
        expect(await countRows(seed, "training_marks")).toBe(4);
        expect(await countRows(seed, "training_exercises")).toBe(
          first.exercisesCreated,
        );
      });
    },
    LOAD_TEST_TIMEOUT_MS,
  );
});
