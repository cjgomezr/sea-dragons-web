import { randomUUID } from "node:crypto";
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
 * AC-050 y AC-052 probados contra `seadragons-dev` atacando la API con la
 * sesión de un miembro: la audiencia de un evento la aplica la base, no la
 * pantalla. Las reglas que una base puede afirmar sola (checks, claves,
 * cascadas, momento de inicio) están en
 * `tests/unit/supabase/events-migration.test.ts`.
 */

type AccountStatus = "active" | "inactive";

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

/** Crea una identidad con su fila de miembro, y deshace las dos al terminar. */
async function withMember<T>(
  serviceClient: ServiceRoleClient,
  options: { readonly clubId: string; readonly accountStatus: AccountStatus },
  run: (user: TestUser) => Promise<T>,
): Promise<T> {
  return withTestUser(serviceClient, (user) =>
    withSeededRows(
      serviceClient,
      "members",
      [
        {
          club_id: options.clubId,
          user_id: user.id,
          full_name: "Nerea Silva",
          email: user.email,
          account_status: options.accountStatus,
        },
      ],
      () => run(user),
    ),
  );
}

/** Siembra filas sin columna `id`: se limpian solas por la cascada de su
 * evento o de su grupo. */
async function insertRows(
  serviceClient: ServiceRoleClient,
  table: string,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  const { error } = await serviceClient.client.from(table).insert(rows);
  if (error) {
    throw new Error(`No se pudo sembrar ${table}: ${error.message}`);
  }
}

function idOf(row: Record<string, unknown> | undefined): string {
  if (!row) {
    throw new Error("el arnés no devolvió la fila que acababa de sembrar");
  }
  return row.id as string;
}

/** Lo que cada test necesita: los dos grupos del club y un evento por
 * audiencia, con títulos que dicen a quién van. */
type EventWorld = {
  readonly eventIds: readonly string[];
  readonly seriesId: string;
};

interface EventWorldOptions {
  readonly clubId: string;
  readonly author: TestUser;
  readonly members: readonly TestUser[];
}

function eventRow(
  clubId: string,
  authorId: string,
  audience: { readonly title: string; readonly audience: "all" | "groups" },
): Record<string, unknown> {
  return {
    club_id: clubId,
    title: audience.title,
    event_type: "training",
    starts_on: "2026-05-12",
    start_time: "19:00",
    location: "MSAC",
    audience: audience.audience,
    author_id: authorId,
  };
}

/** Siembra "Senior Squad" y "Junior Squad" (con un sufijo, porque el nombre es
 * único por club), mete a `members` en Senior, y crea un evento para todo el
 * club, uno para cada grupo, uno para los dos y una serie para Senior. */
async function withEventWorld<T>(
  serviceClient: ServiceRoleClient,
  options: EventWorldOptions,
  run: (world: EventWorld) => Promise<T>,
): Promise<T> {
  const { clubId, author, members } = options;
  const suffix = randomUUID().slice(0, 8);
  return withSeededRows(
    serviceClient,
    "groups",
    [
      { club_id: clubId, name: `Senior Squad ${suffix}` },
      { club_id: clubId, name: `Junior Squad ${suffix}` },
    ],
    async ([senior, junior]) => {
      const seniorId = idOf(senior);
      const juniorId = idOf(junior);
      await insertRows(
        serviceClient,
        "group_memberships",
        members.map((member) => ({
          group_id: seniorId,
          user_id: member.id,
          club_id: clubId,
        })),
      );
      return withSeededRows(
        serviceClient,
        "events",
        [
          eventRow(clubId, author.id, { title: "Al club", audience: "all" }),
          eventRow(clubId, author.id, {
            title: "Al Senior",
            audience: "groups",
          }),
          eventRow(clubId, author.id, {
            title: "Al Junior",
            audience: "groups",
          }),
          eventRow(clubId, author.id, {
            title: "A los dos",
            audience: "groups",
          }),
        ],
        async ([, alSenior, alJunior, aLosDos]) => {
          await insertRows(serviceClient, "event_groups", [
            { event_id: idOf(alSenior), group_id: seniorId, club_id: clubId },
            { event_id: idOf(alJunior), group_id: juniorId, club_id: clubId },
            { event_id: idOf(aLosDos), group_id: seniorId, club_id: clubId },
            { event_id: idOf(aLosDos), group_id: juniorId, club_id: clubId },
          ]);
          const eventIds = [alSenior, alJunior, aLosDos].map(idOf);
          return withSeededRows(
            serviceClient,
            "event_series",
            [
              {
                club_id: clubId,
                title: "Serie del Senior",
                event_type: "training",
                start_time: "19:00",
                location: "MSAC",
                audience: "groups",
                weekdays: [2, 4],
                starts_on: "2026-03-01",
                ends_on: "2026-06-30",
                author_id: author.id,
              },
            ],
            async ([series]) => {
              const seriesId = idOf(series);
              await insertRows(serviceClient, "event_series_groups", [
                { series_id: seriesId, group_id: seniorId, club_id: clubId },
              ]);
              return run({ eventIds, seriesId });
            },
          );
        },
      );
    },
  );
}

function authenticatedClientFor(user: TestUser): Promise<RlsClient> {
  return createRlsClient(
    { role: "authenticated", email: user.email, password: user.password },
    process.env,
  );
}

/** Los títulos, en orden, de los eventos de `authorId` que `rlsClient`
 * recibe. El filtro por autor deja fuera lo que otros tests tengan sembrado a
 * la vez en `seadragons-dev`. */
async function visibleTitles(
  rlsClient: RlsClient,
  authorId: string,
): Promise<string[]> {
  const { data, error } = await rlsClient.client
    .from("events")
    .select("title")
    .eq("author_id", authorId);
  if (error || !data) {
    throw new Error(
      `No se pudieron leer los eventos con la sesión del miembro: ${error?.message ?? "sin datos"}`,
    );
  }
  return data.map((row) => row.title as string).sort();
}

describeRls("RLS de eventos", () => {
  it(
    "un miembro de Senior Squad ve los del club y los de Senior Squad, y no los de otros grupos (AC-050)",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await seededClubId(serviceClient);

      await withMember(
        serviceClient,
        { clubId, accountStatus: "active" },
        (socio) =>
          withEventWorld(
            serviceClient,
            { clubId, author: socio, members: [socio] },
            async ({ seriesId }) => {
              const rlsClient = await authenticatedClientFor(socio);

              const titles = await visibleTitles(rlsClient, socio.id);
              const series = await rlsClient.client
                .from("event_series")
                .select("id")
                .eq("id", seriesId);

              expect(titles).toEqual(["A los dos", "Al Senior", "Al club"]);
              expect(series.error).toBeNull();
              expect(series.data).toEqual([{ id: seriesId }]);
            },
          ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un miembro inactive no ve ninguno, ni los de su grupo",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await seededClubId(serviceClient);

      await withMember(
        serviceClient,
        { clubId, accountStatus: "inactive" },
        (baja) =>
          withEventWorld(
            serviceClient,
            { clubId, author: baja, members: [baja] },
            async ({ seriesId }) => {
              const rlsClient = await authenticatedClientFor(baja);

              await assertDenied(rlsClient, (client) =>
                client.from("events").select("id").eq("club_id", clubId),
              );
              await assertDenied(rlsClient, (client) =>
                client.from("event_series").select("id").eq("id", seriesId),
              );
            },
          ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un cliente anónimo no ve eventos, series ni audiencias",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await seededClubId(serviceClient);

      await withMember(
        serviceClient,
        { clubId, accountStatus: "active" },
        (socio) =>
          withEventWorld(
            serviceClient,
            { clubId, author: socio, members: [socio] },
            async () => {
              const rlsClient = await createRlsClient(
                { role: "anon" },
                process.env,
              );

              for (const table of [
                "events",
                "event_groups",
                "event_series",
                "event_series_groups",
              ]) {
                await assertDenied(rlsClient, (client) =>
                  client.from(table).select("*"),
                );
              }
            },
          ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un miembro no puede crear, cambiar ni borrar eventos, series ni audiencias",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await seededClubId(serviceClient);

      await withMember(
        serviceClient,
        { clubId, accountStatus: "active" },
        (socio) =>
          withEventWorld(
            serviceClient,
            { clubId, author: socio, members: [socio] },
            async ({ eventIds, seriesId }) => {
              const rlsClient = await authenticatedClientFor(socio);
              const [alSenior] = eventIds;

              await assertDenied(rlsClient, (client) =>
                client
                  .from("events")
                  .insert(
                    eventRow(clubId, socio.id, {
                      title: "Colado",
                      audience: "all",
                    }),
                  )
                  .select(),
              );
              await assertDenied(rlsClient, (client) =>
                client
                  .from("events")
                  .update({ title: "Cambiado" })
                  .eq("id", alSenior)
                  .select(),
              );
              await assertDenied(rlsClient, (client) =>
                client.from("events").delete().eq("id", alSenior).select(),
              );
              await assertDenied(rlsClient, (client) =>
                client
                  .from("event_series")
                  .update({ title: "Cambiada" })
                  .eq("id", seriesId)
                  .select(),
              );
              await assertDenied(rlsClient, (client) =>
                client
                  .from("event_series_groups")
                  .delete()
                  .eq("series_id", seriesId)
                  .select(),
              );
              await assertDenied(rlsClient, (client) =>
                client
                  .from("event_groups")
                  .delete()
                  .eq("event_id", alSenior)
                  .select(),
              );

              // Con la llave de servicio: nada de lo intentado cambió.
              const { data, error } = await serviceClient.client
                .from("events")
                .select("title")
                .eq("id", alSenior)
                .single();
              expect(error).toBeNull();
              expect(data).toEqual({ title: "Al Senior" });
            },
          ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
