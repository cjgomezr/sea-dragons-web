// @vitest-environment node
import { expect, it } from "vitest";
import { createSessionLedgerGateway } from "@/lib/membership/supabase-membership-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createRlsClient,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * Los movimientos del saldo de un Casual con su entrenamiento (#472) contra
 * `seadragons-dev`: el descuento de una asistencia lleva el título y el día
 * del entrenamiento, leídos con el cliente de la sesión. Si el socio ya no
 * puede ver el evento (era de un grupo del que salió), el movimiento sale
 * igual, sin entrenamiento.
 */

const SEEDED_CLUB = "victoria-seadragons";
const TRAINING_DAY = "2027-07-06";

async function seededClubId(serviceClient: ServiceRoleClient): Promise<string> {
  const { data, error } = await serviceClient.client
    .from("clubs")
    .select("id")
    .eq("slug", SEEDED_CLUB)
    .single();
  if (error) {
    throw new Error(`No se pudo leer el club sembrado: ${error.message}`);
  }
  return String(data.id);
}

/** Un Casual activo. La reserva le borra la fila de socio al terminar, y con
 * ella la membresía en cascada. */
async function seedCasual(
  serviceClient: ServiceRoleClient,
  input: { readonly clubId: string; readonly user: TestUser },
): Promise<void> {
  const { error: memberError } = await serviceClient.client
    .from("members")
    .insert({
      club_id: input.clubId,
      user_id: input.user.id,
      full_name: "Carla Casual",
      email: input.user.email,
      account_status: "active",
    });
  if (memberError) {
    throw new Error(`No se pudo sembrar el socio: ${memberError.message}`);
  }
  const { error } = await serviceClient.client.from("memberships").insert({
    user_id: input.user.id,
    club_id: input.clubId,
    plan: "Casual",
    status: "pending",
  });
  if (error) {
    throw new Error(`No se pudo sembrar la membresía: ${error.message}`);
  }
}

/** Un entrenamiento al que el Casual asistió: la base le descuenta la
 * sesión. Borrar el evento al terminar se lleva la asistencia y el
 * movimiento. */
async function withAttendedTraining(
  serviceClient: ServiceRoleClient,
  input: {
    readonly clubId: string;
    readonly user: TestUser;
    readonly audience: "all" | "groups";
  },
  run: () => Promise<void>,
): Promise<void> {
  await withSeededRows(
    serviceClient,
    "events",
    [
      {
        club_id: input.clubId,
        title: "Entrenamiento del martes",
        event_type: "training",
        starts_on: TRAINING_DAY,
        start_time: "19:00",
        location: "MSAC",
        audience: input.audience,
        author_id: input.user.id,
      },
    ],
    async ([event]) => {
      const { error } = await serviceClient.client
        .from("attendance_records")
        .insert({
          event_id: event?.id,
          user_id: input.user.id,
          club_id: input.clubId,
          status: "present",
        });
      if (error) {
        throw new Error(`No se pudo sembrar la asistencia: ${error.message}`);
      }
      await run();
    },
  );
}

async function withCasualWhoAttended(
  audience: "all" | "groups",
  run: (user: TestUser) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  const clubId = await seededClubId(serviceClient);
  await withTestUser(serviceClient, async (user) => {
    await seedCasual(serviceClient, { clubId, user });
    await withAttendedTraining(serviceClient, { clubId, user, audience }, () =>
      run(user),
    );
  });
}

async function readMovementsAs(user: TestUser): Promise<unknown> {
  const { client } = await createRlsClient(
    { role: "authenticated", email: user.email, password: user.password },
    process.env,
  );
  return createSessionLedgerGateway(client).listByUserId(user.id);
}

describeRls("los movimientos del saldo con su entrenamiento", () => {
  it(
    "el descuento de una asistencia lleva el título y el día del entrenamiento",
    () =>
      withCasualWhoAttended("all", async (user) => {
        const movements = await readMovementsAs(user);

        expect(movements).toEqual([
          expect.objectContaining({
            kind: "attendance",
            delta: -1,
            training: {
              title: "Entrenamiento del martes",
              startsOn: TRAINING_DAY,
            },
          }),
        ]);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "sale sin entrenamiento cuando el socio ya no puede ver el evento",
    () =>
      withCasualWhoAttended("groups", async (user) => {
        const movements = await readMovementsAs(user);

        expect(movements).toEqual([
          expect.objectContaining({
            kind: "attendance",
            delta: -1,
            training: null,
          }),
        ]);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
