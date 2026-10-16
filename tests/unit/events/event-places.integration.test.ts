import { expect, it } from "vitest";
import type { NewEventSchedule } from "@/lib/events/event-creation";
import { createEventAgendaGateways } from "@/lib/events/supabase-event-agenda-gateways";
import { createEventGateways } from "@/lib/events/supabase-event-gateways";
import { createEventManagementGateways } from "@/lib/events/supabase-event-management-gateways";
import { createSeriesManagementGateways } from "@/lib/events/supabase-series-management-gateways";
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
 * El lugar estructurado con los adaptadores de verdad (#645, RF-4 del PRD de
 * E24) y `0069_event_places.sql` aplicada: lo que ningún doble dice es que
 * `create_events`, `update_event` y `update_series` guardan las columnas con
 * los nombres que manda el adaptador, que la agenda las lee de vuelta con las
 * coordenadas como números y que las sesiones de una serie heredan el lugar
 * de la serie.
 *
 * Los eventos y la serie no cuelgan en cascada de quien los crea, así que se
 * borran a mano antes de devolver al socio a la reserva.
 */

const FAR_DAY = "2099-07-10";

async function seededClubId(serviceClient: ServiceRoleClient): Promise<string> {
  const { data, error } = await serviceClient.client
    .from("clubs")
    .select("id")
    .eq("slug", "victoria-seadragons")
    .single();
  if (error) {
    throw new Error(`No se pudo leer el club sembrado: ${error.message}`);
  }
  return String(data.id);
}

async function deleteEventsBy(
  serviceClient: ServiceRoleClient,
  authorId: string,
): Promise<void> {
  for (const table of ["events", "event_series"]) {
    const { error } = await serviceClient.client
      .from(table)
      .delete()
      .eq("author_id", authorId);
    if (error) {
      throw new Error(`No se pudo limpiar ${table}: ${error.message}`);
    }
  }
}

async function withOrganizer(
  run: (world: {
    readonly serviceClient: ServiceRoleClient;
    readonly clubId: string;
    readonly organizer: TestUser;
  }) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  const clubId = await seededClubId(serviceClient);
  await withTestUser(serviceClient, (organizer) =>
    withSeededRows(
      serviceClient,
      "members",
      [
        {
          club_id: clubId,
          user_id: organizer.id,
          full_name: "Olga Organiza",
          email: organizer.email,
          account_status: "active",
          role: "Committee",
        },
      ],
      async () => {
        try {
          await run({ serviceClient, clubId, organizer });
        } finally {
          await deleteEventsBy(serviceClient, organizer.id);
        }
      },
    ),
  );
}

function scheduleOf(
  world: { readonly clubId: string; readonly organizer: TestUser },
  overrides: Partial<NewEventSchedule>,
): NewEventSchedule {
  return {
    clubId: world.clubId,
    authorId: world.organizer.id,
    fields: {
      title: "Lugar elegido",
      eventType: "competition",
      startTime: "18:00",
      endTime: "19:30",
      location: "MSAC",
      place: null,
      placeDetail: null,
      notes: null,
      audience: { kind: "club" },
    },
    endsOn: null,
    coverUploadId: null,
    occurrenceDates: [FAR_DAY],
    series: null,
    ...overrides,
  };
}

const MSAC_PLACE = {
  name: "MSAC",
  address: "Aughtie Dr, Albert Park VIC 3206",
  lat: -37.8423,
  lng: 144.9601,
} as const;

describeRls("el lugar estructurado contra la base (#645)", () => {
  it(
    "crea un evento con lugar, lo lee de vuelta y lo devuelve al texto libre",
    () =>
      withOrganizer(async (world) => {
        const { events } = createEventGateways(world.serviceClient.client);
        const { managedEvents } = createEventManagementGateways(
          world.serviceClient.client,
        );
        const { agenda } = createEventAgendaGateways(
          world.serviceClient.client,
        );
        const saved = await events.insertSchedule(
          scheduleOf(world, {
            fields: {
              ...scheduleOf(world, {}).fields,
              place: MSAC_PLACE,
              placeDetail: "Piscina de buceo",
            },
          }),
        );
        const eventId = String(saved.eventIds[0]);
        const read = () =>
          agenda.findEvent({
            clubId: world.clubId,
            callerId: world.organizer.id,
            eventId,
          });

        const created = await read();
        await managedEvents.updateEvent({
          clubId: world.clubId,
          eventId,
          changes: {
            location: "Piscina de Box Hill",
            place: null,
            placeDetail: null,
          },
        });

        expect(created).toMatchObject({
          location: "MSAC",
          place: MSAC_PLACE,
          placeDetail: "Piscina de buceo",
        });
        await expect(read()).resolves.toMatchObject({
          location: "Piscina de Box Hill",
          place: null,
          placeDetail: null,
        });
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "da a la serie y a cada sesión el lugar de la serie, y lo cambia en las dos",
    () =>
      withOrganizer(async (world) => {
        const { events } = createEventGateways(world.serviceClient.client);
        const { managedSeries } = createSeriesManagementGateways(
          world.serviceClient.client,
        );
        const { agenda } = createEventAgendaGateways(
          world.serviceClient.client,
        );
        const saved = await events.insertSchedule(
          scheduleOf(world, {
            occurrenceDates: ["2099-07-07", "2099-07-14"],
            series: {
              weekdays: [2],
              startsOn: "2099-07-07",
              endsOn: "2099-07-14",
            },
          }),
        );
        const seriesId = String(saved.seriesId);
        const sessionPlaces = async () =>
          Promise.all(
            saved.eventIds.map(async (eventId) => {
              const session = await agenda.findEvent({
                clubId: world.clubId,
                callerId: world.organizer.id,
                eventId,
              });
              if (session === null) {
                throw new Error(`La sesión ${eventId} no se pudo leer.`);
              }
              return session.place;
            }),
          );

        const createdPlaces = await sessionPlaces();
        await managedSeries.updateSeries({
          clubId: world.clubId,
          seriesId,
          changes: { location: "MSAC", place: MSAC_PLACE },
        });
        const series = await managedSeries.findSeries({
          clubId: world.clubId,
          seriesId,
        });

        expect(createdPlaces).toEqual([null, null]);
        expect(series?.place).toEqual(MSAC_PLACE);
        await expect(sessionPlaces()).resolves.toEqual([
          MSAC_PLACE,
          MSAC_PLACE,
        ]);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
