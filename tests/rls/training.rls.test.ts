import { expect, it } from "vitest";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type RlsClient,
  type ServiceRoleClient,
  type TestUser,
  assertDenied,
  createRlsClient,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../support/rls";
import type { MembershipStatus } from "@/lib/membership/membership";

/**
 * Entrenamiento contra Supabase por PostgREST (#896, RF-1 y D2, D3 y D11 del
 * PRD de E35): las marcas sólo las lee su dueño, el ciclo activo quien está
 * al día, los borradores quien planifica, y nadie escribe con su sesión. La
 * forma de las filas y la regla de estar al día están en
 * `tests/unit/supabase/training-migration.test.ts`.
 */

type Role = "Admin" | "Coach" | "Committee" | "Player";

type MemberSpec = {
  readonly role: Role;
  /** Sin estado, el socio no tiene membresía. */
  readonly status?: MembershipStatus;
};

/** Un lunes, como pide el inicio de un ciclo (D5). */
const CYCLE_START = "2027-01-04";

async function seededClubId(serviceClient: ServiceRoleClient): Promise<string> {
  const { data, error } = await serviceClient.client
    .from("clubs")
    .select("id")
    .eq("slug", "victoria-seadragons")
    .single();
  if (error || !data) {
    throw new Error(
      `No se pudo leer el club sembrado: ${error?.message ?? "sin datos"}`,
    );
  }
  return data.id as string;
}

async function insertOrThrow(
  serviceClient: ServiceRoleClient,
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await serviceClient.client.from(table).insert(row);
  if (error) {
    throw new Error(`No se pudo sembrar ${table}: ${error.message}`);
  }
}

/** Un socio activo con su rol y su membresía. La reserva le borra la fila de
 * socio al terminar, y con ella se van su membresía y sus marcas. */
function withMember<T>(
  serviceClient: ServiceRoleClient,
  clubId: string,
  spec: MemberSpec,
  run: (user: TestUser) => Promise<T>,
): Promise<T> {
  return withTestUser(serviceClient, async (user) => {
    await insertOrThrow(serviceClient, "members", {
      club_id: clubId,
      user_id: user.id,
      full_name: "Tere Training",
      email: user.email,
      account_status: "active",
      role: spec.role,
    });
    if (spec.status !== undefined) {
      await insertOrThrow(serviceClient, "memberships", {
        user_id: user.id,
        club_id: clubId,
        plan: "Full",
        status: spec.status,
        waived_reason: spec.status === "waived" ? "Beca" : null,
      });
    }
    return run(user);
  });
}

function authenticatedClientFor(user: TestUser): Promise<RlsClient> {
  return createRlsClient(
    { role: "authenticated", email: user.email, password: user.password },
    process.env,
  );
}

/** Un ciclo con su rutina, que se borra en cascada con él. */
function withCycle<T>(
  serviceClient: ServiceRoleClient,
  input: { readonly clubId: string; readonly status: string },
  run: (cycleId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "training_cycles",
    [
      {
        club_id: input.clubId,
        name: `RLS ${input.status}`,
        start_date: CYCLE_START,
        weeks: 4,
        status: input.status,
      },
    ],
    async ([cycle]) => {
      const cycleId = cycle?.id as string;
      await insertOrThrow(serviceClient, "training_routines", {
        club_id: input.clubId,
        cycle_id: cycleId,
        name: "Strength A",
        color_index: 0,
      });
      return run(cycleId);
    },
  );
}

async function visibleRoutineCount(
  rlsClient: RlsClient,
  cycleId: string,
): Promise<number> {
  const { data, error } = await rlsClient.client
    .from("training_routines")
    .select("id")
    .eq("cycle_id", cycleId);
  if (error) {
    throw new Error(`No se pudieron leer las rutinas: ${error.message}`);
  }
  return data.length;
}

describeRls("RLS de entrenamiento", () => {
  it(
    "las marcas las lee su dueño; otro socio, el Coach y el Admin no",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await seededClubId(serviceClient);
      await withSeededRows(
        serviceClient,
        "training_marks",
        [{ club_id: clubId, name: `RLS mark ${crypto.randomUUID()}` }],
        ([mark]) =>
          withMember(serviceClient, clubId, { role: "Player" }, (owner) =>
            withMember(serviceClient, clubId, { role: "Player" }, (other) =>
              withMember(serviceClient, clubId, { role: "Coach" }, (coach) =>
                withMember(
                  serviceClient,
                  clubId,
                  { role: "Admin" },
                  async (admin) => {
                    await insertOrThrow(
                      serviceClient,
                      "training_member_marks",
                      {
                        user_id: owner.id,
                        club_id: clubId,
                        mark_id: mark?.id,
                        value: 82.5,
                      },
                    );
                    const ownerClient = await authenticatedClientFor(owner);

                    const own = await ownerClient.client
                      .from("training_member_marks")
                      .select("value")
                      .eq("mark_id", mark?.id as string);

                    expect(own.error).toBeNull();
                    expect(own.data).toEqual([{ value: 82.5 }]);
                    for (const reader of [other, coach, admin]) {
                      await assertDenied(
                        await authenticatedClientFor(reader),
                        (client) =>
                          client
                            .from("training_member_marks")
                            .select("value")
                            .eq("mark_id", mark?.id as string),
                      );
                    }
                  },
                ),
              ),
            ),
          ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "el ciclo activo y sus rutinas los lee quien está al día; quien no, no",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await seededClubId(serviceClient);
      const { data: previous, error } = await serviceClient.client
        .from("training_cycles")
        .select("id")
        .eq("club_id", clubId)
        .eq("status", "active");
      if (error) {
        throw new Error(`No se pudo leer el ciclo activo: ${error.message}`);
      }
      // Un solo activo por club: si dev ya tiene uno, no se puede sembrar.
      expect(previous).toEqual([]);
      await withCycle(serviceClient, { clubId, status: "active" }, (cycleId) =>
        withMember(
          serviceClient,
          clubId,
          { role: "Player", status: "active" },
          (current) =>
            withMember(
              serviceClient,
              clubId,
              { role: "Committee", status: "past_due" },
              async (behind) => {
                const currentClient = await authenticatedClientFor(current);
                const behindClient = await authenticatedClientFor(behind);

                const cycle = await currentClient.client
                  .from("training_cycles")
                  .select("status")
                  .eq("id", cycleId);

                expect(cycle.error).toBeNull();
                expect(cycle.data).toEqual([{ status: "active" }]);
                expect(await visibleRoutineCount(currentClient, cycleId)).toBe(
                  1,
                );
                await assertDenied(behindClient, (client) =>
                  client.from("training_cycles").select("id").eq("id", cycleId),
                );
                expect(await visibleRoutineCount(behindClient, cycleId)).toBe(
                  0,
                );
              },
            ),
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un borrador lo leen el Admin y el Coach, aunque no estén al día; un Player al día, no",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await seededClubId(serviceClient);
      await withCycle(serviceClient, { clubId, status: "draft" }, (cycleId) =>
        withMember(
          serviceClient,
          clubId,
          { role: "Coach", status: "past_due" },
          (coach) =>
            withMember(serviceClient, clubId, { role: "Admin" }, (admin) =>
              withMember(
                serviceClient,
                clubId,
                { role: "Player", status: "active" },
                async (player) => {
                  for (const planner of [coach, admin]) {
                    const plannerClient = await authenticatedClientFor(planner);
                    expect(
                      await visibleRoutineCount(plannerClient, cycleId),
                    ).toBe(1);
                  }

                  await assertDenied(
                    await authenticatedClientFor(player),
                    (client) =>
                      client
                        .from("training_cycles")
                        .select("id")
                        .eq("id", cycleId),
                  );
                },
              ),
            ),
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "authenticated recibe permission denied al escribir, aunque sea Admin",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await seededClubId(serviceClient);
      await withMember(
        serviceClient,
        clubId,
        { role: "Admin", status: "active" },
        async (admin) => {
          const adminClient = await authenticatedClientFor(admin);

          const writes = await Promise.all([
            adminClient.client.from("training_marks").insert({
              club_id: clubId,
              name: "Power clean",
            }),
            adminClient.client.from("training_cycles").insert({
              club_id: clubId,
              name: "Sin permiso",
              start_date: CYCLE_START,
              weeks: 4,
            }),
            adminClient.client
              .from("training_exercises")
              .update({ name: "Renombrado" })
              .eq("club_id", clubId),
            adminClient.client
              .from("training_member_marks")
              .delete()
              .eq("user_id", admin.id),
          ]);

          for (const write of writes) {
            expect(write.error?.code).toBe("42501");
          }
        },
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
