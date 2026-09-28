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

/**
 * La asistencia contra `seadragons-dev` (#392, RF-1 del PRD de E8): cada
 * miembro lee sólo sus filas y nadie escribe salvo el servidor. Las reglas que
 * una base puede afirmar sola (estado, tipo de evento, club, cascadas) están
 * en `tests/unit/supabase/attendance-migration.test.ts`.
 */

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

/** Crea una identidad activa con su fila de miembro, y deshace las dos al
 * terminar. Borrar la identidad se lleva sus filas de asistencia. */
async function withMember<T>(
  serviceClient: ServiceRoleClient,
  clubId: string,
  run: (user: TestUser) => Promise<T>,
): Promise<T> {
  return withTestUser(serviceClient, (user) =>
    withSeededRows(
      serviceClient,
      "members",
      [
        {
          club_id: clubId,
          user_id: user.id,
          full_name: "Ana Asistencia",
          email: user.email,
          account_status: "active",
        },
      ],
      () => run(user),
    ),
  );
}

/** Un entrenamiento para todo el club, que se borra al terminar con su
 * asistencia. */
async function withTraining<T>(
  serviceClient: ServiceRoleClient,
  author: { readonly clubId: string; readonly userId: string },
  run: (eventId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "events",
    [
      {
        club_id: author.clubId,
        title: "Entrenamiento con asistencia",
        event_type: "training",
        starts_on: "2027-07-06",
        start_time: "19:00",
        location: "MSAC",
        audience: "all",
        author_id: author.userId,
      },
    ],
    ([event]) => run(event?.id as string),
  );
}

async function insertAttendance(
  serviceClient: ServiceRoleClient,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  const { error } = await serviceClient.client
    .from("attendance_records")
    .insert(rows);
  if (error) {
    throw new Error(`No se pudo sembrar la asistencia: ${error.message}`);
  }
}

function authenticatedClientFor(user: TestUser): Promise<RlsClient> {
  return createRlsClient(
    { role: "authenticated", email: user.email, password: user.password },
    process.env,
  );
}

/** Una coach que pasa lista, una socia que llegó tarde y un entrenamiento. */
async function withTakenRoll(
  run: (world: {
    readonly serviceClient: ServiceRoleClient;
    readonly clubId: string;
    readonly eventId: string;
    readonly coach: TestUser;
    readonly socia: TestUser;
  }) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  const clubId = await seededClubId(serviceClient);
  await withMember(serviceClient, clubId, (coach) =>
    withMember(serviceClient, clubId, (socia) =>
      withTraining(
        serviceClient,
        { clubId, userId: coach.id },
        async (eventId) => {
          await insertAttendance(serviceClient, [
            {
              event_id: eventId,
              user_id: socia.id,
              club_id: clubId,
              status: "late",
              recorded_by: coach.id,
            },
            {
              event_id: eventId,
              user_id: coach.id,
              club_id: clubId,
              status: "present",
              recorded_by: coach.id,
            },
          ]);
          await run({ serviceClient, clubId, eventId, coach, socia });
        },
      ),
    ),
  );
}

describeRls("RLS de la asistencia", () => {
  it(
    "un miembro ve sólo sus filas",
    () =>
      withTakenRoll(async ({ eventId, socia }) => {
        const rlsClient = await authenticatedClientFor(socia);

        const { data, error } = await rlsClient.client
          .from("attendance_records")
          .select("user_id, status")
          .eq("event_id", eventId);

        expect(error).toBeNull();
        expect(data).toEqual([{ user_id: socia.id, status: "late" }]);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un miembro no puede crear, cambiar ni borrar asistencia, ni la suya",
    () =>
      withTakenRoll(async ({ serviceClient, clubId, eventId, socia }) => {
        const rlsClient = await authenticatedClientFor(socia);

        await assertDenied(rlsClient, (client) =>
          client
            .from("attendance_records")
            .upsert({
              event_id: eventId,
              user_id: socia.id,
              club_id: clubId,
              status: "present",
              recorded_by: socia.id,
            })
            .select(),
        );
        await assertDenied(rlsClient, (client) =>
          client
            .from("attendance_records")
            .update({ status: "present" })
            .eq("event_id", eventId)
            .select(),
        );
        await assertDenied(rlsClient, (client) =>
          client
            .from("attendance_records")
            .delete()
            .eq("event_id", eventId)
            .select(),
        );

        // Con la llave de servicio: nada de lo intentado cambió.
        const { data, error } = await serviceClient.client
          .from("attendance_records")
          .select("status")
          .eq("event_id", eventId)
          .order("status");
        expect(error).toBeNull();
        expect(data).toEqual([{ status: "late" }, { status: "present" }]);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un cliente anónimo no ve asistencia",
    () =>
      withTakenRoll(async () => {
        const rlsClient = await createRlsClient({ role: "anon" }, process.env);

        await assertDenied(rlsClient, (client) =>
          client.from("attendance_records").select("*"),
        );
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
