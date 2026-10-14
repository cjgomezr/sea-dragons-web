import { expect, it } from "vitest";
import type { NewEventSchedule } from "@/lib/events/event-creation";
import { createEventAgendaGateways } from "@/lib/events/supabase-event-agenda-gateways";
import { createEventGateways } from "@/lib/events/supabase-event-gateways";
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
 * La hora y la fecha de fin con los adaptadores de verdad (#642, RF-2 del PRD
 * de E24) y `0066_event_end_times.sql` aplicada: lo que ningún doble dice es
 * que `create_events` las guarda con los nombres que manda el adaptador, que
 * la agenda las lee de vuelta en `HH:MM` y que las sesiones de una serie
 * heredan la hora de fin de la serie.
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
      title: "Hora de fin",
      eventType: "competition",
      startTime: "18:00",
      endTime: "19:30",
      location: "MSAC",
      notes: null,
      audience: { kind: "club" },
    },
    endsOn: null,
    occurrenceDates: [FAR_DAY],
    series: null,
    ...overrides,
  };
}

describeRls("la hora y la fecha de fin contra la base (#642)", () => {
  it(
    "crea y lee un evento de un día y otro de varios días con su fin",
    () =>
      withOrganizer(async (world) => {
        const { events } = createEventGateways(world.serviceClient.client);
        const { agenda } = createEventAgendaGateways(
          world.serviceClient.client,
        );
        const oneDay = await events.insertSchedule(scheduleOf(world, {}));
        const weekend = await events.insertSchedule(
          scheduleOf(world, {
            fields: {
              ...scheduleOf(world, {}).fields,
              startTime: "08:30",
              endTime: "17:00",
            },
            endsOn: "2099-07-11",
          }),
        );
        const read = (eventId: string | undefined) =>
          agenda.findEvent({
            clubId: world.clubId,
            callerId: world.organizer.id,
            eventId: String(eventId),
          });

        await expect(read(oneDay.eventIds[0])).resolves.toMatchObject({
          startTime: "18:00",
          endTime: "19:30",
          endsOn: null,
        });
        await expect(read(weekend.eventIds[0])).resolves.toMatchObject({
          startTime: "08:30",
          endTime: "17:00",
          endsOn: "2099-07-11",
        });
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "da a la serie y a cada sesión la hora de fin, y la cambia en las dos",
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
        const sessionEnds = async (): Promise<(string | null)[]> =>
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
              return session.endTime;
            }),
          );

        const created = await managedSeries.findSeries({
          clubId: world.clubId,
          seriesId,
        });
        const createdEnds = await sessionEnds();
        await managedSeries.updateSeries({
          clubId: world.clubId,
          seriesId,
          changes: { endTime: "20:00" },
        });

        expect(created?.endTime).toBe("19:30");
        expect(createdEnds).toEqual(["19:30", "19:30"]);
        await expect(sessionEnds()).resolves.toEqual(["20:00", "20:00"]);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
