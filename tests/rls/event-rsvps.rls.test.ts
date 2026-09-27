import { expect, it } from "vitest";
import { createEventRsvpGateways } from "@/lib/events/supabase-event-rsvp-gateways";
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
 * Las respuestas a eventos contra `seadragons-dev` (#308, RF-5 del PRD de E7):
 * cada miembro lee sólo las suyas y nadie escribe salvo el servidor. Además,
 * el adaptador real: dos respuestas simultáneas dejan una sola fila. Las
 * reglas que una base puede afirmar sola (valor, club, cascadas) están en
 * `tests/unit/supabase/event-rsvps-migration.test.ts`.
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
 * terminar. Borrar la identidad se lleva sus respuestas por la cascada. */
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
          full_name: "Rita Respuesta",
          email: user.email,
          account_status: "active",
        },
      ],
      () => run(user),
    ),
  );
}

/** Un entrenamiento para todo el club, que se borra al terminar con sus
 * respuestas. */
async function withEvent<T>(
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
        title: "Entrenamiento con RSVP",
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

async function insertRsvps(
  serviceClient: ServiceRoleClient,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  const { error } = await serviceClient.client.from("event_rsvps").insert(rows);
  if (error) {
    throw new Error(`No se pudieron sembrar respuestas: ${error.message}`);
  }
}

function authenticatedClientFor(user: TestUser): Promise<RlsClient> {
  return createRlsClient(
    { role: "authenticated", email: user.email, password: user.password },
    process.env,
  );
}

/** Dos miembros del club y un evento al que los dos respondieron. */
async function withTwoAnswers(
  run: (world: {
    readonly serviceClient: ServiceRoleClient;
    readonly clubId: string;
    readonly eventId: string;
    readonly socia: TestUser;
    readonly otro: TestUser;
  }) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  const clubId = await seededClubId(serviceClient);
  await withMember(serviceClient, clubId, (socia) =>
    withMember(serviceClient, clubId, (otro) =>
      withEvent(
        serviceClient,
        { clubId, userId: socia.id },
        async (eventId) => {
          await insertRsvps(serviceClient, [
            {
              event_id: eventId,
              user_id: socia.id,
              club_id: clubId,
              response: "yes",
            },
            {
              event_id: eventId,
              user_id: otro.id,
              club_id: clubId,
              response: "no",
            },
          ]);
          await run({ serviceClient, clubId, eventId, socia, otro });
        },
      ),
    ),
  );
}

describeRls("RLS de respuestas a eventos", () => {
  it(
    "un miembro ve sólo sus respuestas",
    () =>
      withTwoAnswers(async ({ eventId, socia }) => {
        const rlsClient = await authenticatedClientFor(socia);

        const { data, error } = await rlsClient.client
          .from("event_rsvps")
          .select("user_id, response")
          .eq("event_id", eventId);

        expect(error).toBeNull();
        expect(data).toEqual([{ user_id: socia.id, response: "yes" }]);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un miembro no puede crear, cambiar ni borrar respuestas, ni las suyas",
    () =>
      withTwoAnswers(async ({ serviceClient, clubId, eventId, socia }) => {
        const rlsClient = await authenticatedClientFor(socia);

        await assertDenied(rlsClient, (client) =>
          client
            .from("event_rsvps")
            .upsert({
              event_id: eventId,
              user_id: socia.id,
              club_id: clubId,
              response: "maybe",
            })
            .select(),
        );
        await assertDenied(rlsClient, (client) =>
          client
            .from("event_rsvps")
            .update({ response: "maybe" })
            .eq("event_id", eventId)
            .select(),
        );
        await assertDenied(rlsClient, (client) =>
          client.from("event_rsvps").delete().eq("event_id", eventId).select(),
        );

        // Con la llave de servicio: nada de lo intentado cambió.
        const { data, error } = await serviceClient.client
          .from("event_rsvps")
          .select("response")
          .eq("event_id", eventId)
          .order("response");
        expect(error).toBeNull();
        expect(data).toEqual([{ response: "no" }, { response: "yes" }]);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un cliente anónimo no ve respuestas",
    () =>
      withTwoAnswers(async () => {
        const rlsClient = await createRlsClient({ role: "anon" }, process.env);

        await assertDenied(rlsClient, (client) =>
          client.from("event_rsvps").select("*"),
        );
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "dos respuestas simultáneas por el adaptador dejan una sola fila",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await seededClubId(serviceClient);
      const { rsvps } = createEventRsvpGateways(serviceClient.client);

      await withMember(serviceClient, clubId, (socia) =>
        withEvent(
          serviceClient,
          { clubId, userId: socia.id },
          async (eventId) => {
            const rsvp = {
              clubId,
              eventId,
              userId: socia.id,
              response: "yes",
              respondedAt: new Date(),
            } as const;

            await Promise.all([
              rsvps.saveResponse(rsvp),
              rsvps.saveResponse(rsvp),
            ]);

            const { data, error } = await serviceClient.client
              .from("event_rsvps")
              .select("response")
              .eq("event_id", eventId);
            expect(error).toBeNull();
            expect(data).toEqual([{ response: "yes" }]);
          },
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
