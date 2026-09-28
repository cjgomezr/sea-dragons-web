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
 * Los repartos de equipos contra `seadragons-dev` (#399, RF-1 del PRD de
 * E10): un reparto publicado se lee con la sesión, un borrador no, y nadie
 * escribe salvo el servidor. Las reglas que una base puede afirmar sola
 * (club, cascadas, quién de la audiencia lee) están en
 * `tests/unit/supabase/team-splits-migration.test.ts`.
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
 * terminar. Borrar la identidad se lleva su fila de equipo. */
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
          full_name: "Tomás Team",
          email: user.email,
          account_status: "active",
        },
      ],
      () => run(user),
    ),
  );
}

/** Un evento para todo el club con su reparto, que se borran al terminar. */
async function withSplit<T>(
  serviceClient: ServiceRoleClient,
  split: {
    readonly clubId: string;
    readonly coachId: string;
    readonly publishedAt: string | null;
  },
  run: (splitId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "events",
    [
      {
        club_id: split.clubId,
        title: "Partido con equipos",
        event_type: "training",
        starts_on: "2027-07-06",
        start_time: "19:00",
        location: "MSAC",
        audience: "all",
        author_id: split.coachId,
      },
    ],
    ([event]) =>
      withSeededRows(
        serviceClient,
        "team_splits",
        [
          {
            event_id: event?.id,
            club_id: split.clubId,
            team_a_name: "Team Kelp",
            team_a_color: "#1d4ed8",
            team_b_name: "Team Tide",
            team_b_color: "#facc15",
            mode: "manual",
            published_at: split.publishedAt,
            created_by: split.coachId,
          },
        ],
        ([row]) => run(row?.id as string),
      ),
  );
}

async function assignPlayers(
  serviceClient: ServiceRoleClient,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  const { error } = await serviceClient.client
    .from("team_split_members")
    .insert(rows);
  if (error) {
    throw new Error(`No se pudo sembrar el reparto: ${error.message}`);
  }
}

function authenticatedClientFor(user: TestUser): Promise<RlsClient> {
  return createRlsClient(
    { role: "authenticated", email: user.email, password: user.password },
    process.env,
  );
}

/** Un coach en el equipo B, un jugador en el A y un reparto del evento. */
async function withAssignedSplit(
  publishedAt: string | null,
  run: (world: {
    readonly serviceClient: ServiceRoleClient;
    readonly clubId: string;
    readonly splitId: string;
    readonly player: TestUser;
  }) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  const clubId = await seededClubId(serviceClient);
  await withMember(serviceClient, clubId, (coach) =>
    withMember(serviceClient, clubId, (player) =>
      withSplit(
        serviceClient,
        { clubId, coachId: coach.id, publishedAt },
        async (splitId) => {
          await assignPlayers(serviceClient, [
            {
              split_id: splitId,
              user_id: player.id,
              club_id: clubId,
              team: "a",
            },
            {
              split_id: splitId,
              user_id: coach.id,
              club_id: clubId,
              team: "b",
            },
          ]);
          await run({ serviceClient, clubId, splitId, player });
        },
      ),
    ),
  );
}

describeRls("RLS de los repartos de equipos", () => {
  it(
    "un jugador asignado lee el reparto publicado y los dos equipos",
    () =>
      withAssignedSplit(
        new Date().toISOString(),
        async ({ splitId, player }) => {
          const rlsClient = await authenticatedClientFor(player);

          const split = await rlsClient.client
            .from("team_splits")
            .select("team_a_name, team_b_name")
            .eq("id", splitId);
          const teams = await rlsClient.client
            .from("team_split_members")
            .select("team")
            .eq("split_id", splitId)
            .order("team");

          expect(split.error).toBeNull();
          expect(split.data).toEqual([
            { team_a_name: "Team Kelp", team_b_name: "Team Tide" },
          ]);
          expect(teams.error).toBeNull();
          expect(teams.data).toEqual([{ team: "a" }, { team: "b" }]);
        },
      ),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un jugador asignado no lee un borrador",
    () =>
      withAssignedSplit(null, async ({ splitId, player }) => {
        const rlsClient = await authenticatedClientFor(player);

        const split = await rlsClient.client
          .from("team_splits")
          .select("id")
          .eq("id", splitId);
        const teams = await rlsClient.client
          .from("team_split_members")
          .select("team")
          .eq("split_id", splitId);

        expect(split.error).toBeNull();
        expect(split.data).toEqual([]);
        expect(teams.error).toBeNull();
        expect(teams.data).toEqual([]);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un jugador no puede crear, cambiar ni borrar el reparto ni su equipo",
    () =>
      withAssignedSplit(
        new Date().toISOString(),
        async ({ serviceClient, clubId, splitId, player }) => {
          const rlsClient = await authenticatedClientFor(player);

          await assertDenied(rlsClient, (client) =>
            client
              .from("team_splits")
              .update({ mode: "auto" })
              .eq("id", splitId)
              .select(),
          );
          await assertDenied(rlsClient, (client) =>
            client.from("team_splits").delete().eq("id", splitId).select(),
          );
          await assertDenied(rlsClient, (client) =>
            client
              .from("team_split_members")
              .upsert({
                split_id: splitId,
                user_id: player.id,
                club_id: clubId,
                team: "b",
              })
              .select(),
          );
          await assertDenied(rlsClient, (client) =>
            client
              .from("team_split_members")
              .delete()
              .eq("split_id", splitId)
              .select(),
          );

          // Con la llave de servicio: nada de lo intentado cambió.
          const { data, error } = await serviceClient.client
            .from("team_split_members")
            .select("user_id, team")
            .eq("split_id", splitId)
            .eq("user_id", player.id);
          expect(error).toBeNull();
          expect(data).toEqual([{ user_id: player.id, team: "a" }]);
        },
      ),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un cliente anónimo no ve repartos",
    () =>
      withAssignedSplit(new Date().toISOString(), async () => {
        const rlsClient = await createRlsClient({ role: "anon" }, process.env);

        await assertDenied(rlsClient, (client) =>
          client.from("team_splits").select("*"),
        );
        await assertDenied(rlsClient, (client) =>
          client.from("team_split_members").select("*"),
        );
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
