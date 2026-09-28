import { expect, it } from "vitest";
import { createSeriesManagementGateways } from "@/lib/events/supabase-series-management-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../support/rls";

/**
 * Cancelar una serie por el adaptador real contra `seadragons-dev` (#315,
 * RF-12 del PRD de E7): un solo `update` por PostgREST cancela las
 * ocurrencias futuras, deja la pasada y conserva las respuestas. Editar pasa
 * por `update_series`, que se prueba contra un Postgres desechable en
 * `tests/unit/supabase/update-series-migration.test.ts`.
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

type SeriesWorld = {
  readonly serviceClient: ServiceRoleClient;
  readonly clubId: string;
  readonly seriesId: string;
  readonly pastId: string;
  readonly upcomingIds: readonly string[];
};

function occurrenceRow(
  world: { readonly clubId: string; readonly seriesId: string },
  author: TestUser,
  startsOn: string,
): Record<string, unknown> {
  return {
    club_id: world.clubId,
    series_id: world.seriesId,
    title: "Entrenamiento en serie",
    event_type: "training",
    starts_on: startsOn,
    start_time: "19:00",
    location: "MSAC",
    audience: "all",
    author_id: author.id,
  };
}

/** Una serie con una ocurrencia pasada y dos futuras, y una respuesta en la
 * primera futura. Todo se borra al terminar. */
async function withSeries(
  run: (world: SeriesWorld) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  const clubId = await seededClubId(serviceClient);
  await withTestUser(serviceClient, (author) =>
    withSeededRows(
      serviceClient,
      "members",
      [
        {
          club_id: clubId,
          user_id: author.id,
          full_name: "Carla Committee",
          email: author.email,
          account_status: "active",
        },
      ],
      () =>
        withSeededRows(
          serviceClient,
          "event_series",
          [
            {
              club_id: clubId,
              title: "Entrenamiento en serie",
              event_type: "training",
              start_time: "19:00",
              location: "MSAC",
              audience: "all",
              weekdays: [2],
              starts_on: "2020-01-07",
              ends_on: "2020-12-29",
              author_id: author.id,
            },
          ],
          ([series]) => {
            const seriesId = series?.id as string;
            const world = { clubId, seriesId };
            return withSeededRows(
              serviceClient,
              "events",
              [
                occurrenceRow(world, author, "2020-01-07"),
                occurrenceRow(world, author, "2099-01-06"),
                occurrenceRow(world, author, "2099-01-13"),
              ],
              async ([past, first, second]) => {
                const { error } = await serviceClient.client
                  .from("event_rsvps")
                  .insert({
                    event_id: first?.id,
                    user_id: author.id,
                    club_id: clubId,
                    response: "yes",
                  });
                if (error) {
                  throw new Error(
                    `No se pudo sembrar la respuesta: ${error.message}`,
                  );
                }
                await run({
                  serviceClient,
                  clubId,
                  seriesId,
                  pastId: past?.id as string,
                  upcomingIds: [first?.id as string, second?.id as string],
                });
              },
            );
          },
        ),
    ),
  );
}

async function readStatuses(
  world: SeriesWorld,
): Promise<readonly { id: string; status: string }[]> {
  const { data, error } = await world.serviceClient.client
    .from("events")
    .select("id, status")
    .eq("series_id", world.seriesId);
  if (error) {
    throw new Error(`No se pudieron leer las ocurrencias: ${error.message}`);
  }
  return data;
}

describeRls("cancelar una serie contra la base", () => {
  it(
    "cancela las dos futuras, deja la pasada y conserva la respuesta (#315)",
    () =>
      withSeries(async (world) => {
        const { managedSeries } = createSeriesManagementGateways(
          world.serviceClient.client,
        );

        const cancelled = await managedSeries.cancelSeries({
          clubId: world.clubId,
          seriesId: world.seriesId,
          cancelledAt: new Date(),
        });

        expect(cancelled).toBe(2);
        await expect(readStatuses(world)).resolves.toEqual(
          expect.arrayContaining([
            { id: world.pastId, status: "scheduled" },
            ...world.upcomingIds.map((id) => ({ id, status: "cancelled" })),
          ]),
        );
        const { data, error } = await world.serviceClient.client
          .from("event_rsvps")
          .select("response")
          .in("event_id", world.upcomingIds);
        expect(error).toBeNull();
        expect(data).toEqual([{ response: "yes" }]);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "cancelarla otra vez no cancela nada más (#315)",
    () =>
      withSeries(async (world) => {
        const { managedSeries } = createSeriesManagementGateways(
          world.serviceClient.client,
        );
        const target = { clubId: world.clubId, seriesId: world.seriesId };
        await managedSeries.cancelSeries({
          ...target,
          cancelledAt: new Date(),
        });

        const again = await managedSeries.cancelSeries({
          ...target,
          cancelledAt: new Date(),
        });

        expect(again).toBe(0);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "lee la serie con sus días y sus fechas, y no la encuentra en otro club (#315)",
    () =>
      withSeries(async (world) => {
        const { managedSeries } = createSeriesManagementGateways(
          world.serviceClient.client,
        );

        const found = await managedSeries.findSeries(world);
        const foreign = await managedSeries.findSeries({
          clubId: "00000000-0000-4000-8000-000000000000",
          seriesId: world.seriesId,
        });

        expect(found).toMatchObject({
          id: world.seriesId,
          startTime: "19:00",
          audience: { kind: "club" },
          weekdays: [2],
          startsOn: "2020-01-07",
          endsOn: "2020-12-29",
        });
        expect(foreign).toBeNull();
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
