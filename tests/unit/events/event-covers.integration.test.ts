// @vitest-environment node
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, it } from "vitest";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import type { NewEventSchedule } from "@/lib/events/event-creation";
import {
  type EventCoverRef,
  eventCoverPathsOf,
  stageEventCover,
} from "@/lib/events/event-covers";
import { createEventAgendaGateways } from "@/lib/events/supabase-event-agenda-gateways";
import { createSupabaseEventCoversGateway } from "@/lib/events/supabase-event-covers-gateway";
import { createEventGateways } from "@/lib/events/supabase-event-gateways";
import { createEventManagementGateways } from "@/lib/events/supabase-event-management-gateways";
import { createSeriesManagementGateways } from "@/lib/events/supabase-series-management-gateways";
import { shrinkNewsCover } from "@/lib/news/shrink-news-cover";
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
 * La imagen de eventos con los adaptadores de verdad (#644, RF-3 y D7 del PRD
 * de E24) y `0072_event_covers.sql` aplicada: lo que ningún doble dice es que
 * las dos versiones llegan al bucket privado y se firman, que
 * `create_events` copia la imagen a cada sesión, y que editar la serie no
 * pisa la de una sesión que la cambió sola.
 *
 * Los eventos no cuelgan en cascada de quien los crea, y las subidas tampoco:
 * se borran a mano, con sus ficheros, antes de devolver al socio a la reserva.
 */

const COVERS_BUCKET = "event-covers";
const COVERS_TABLE = "event_cover_uploads";

type World = {
  readonly serviceClient: ServiceRoleClient;
  readonly clubId: string;
  readonly organizer: TestUser;
};

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

async function deleteRowsBy(
  serviceClient: ServiceRoleClient,
  organizerId: string,
): Promise<void> {
  for (const [table, column] of [
    ["events", "author_id"],
    ["event_series", "author_id"],
    [COVERS_TABLE, "uploaded_by"],
  ] as const) {
    const { error } = await serviceClient.client
      .from(table)
      .delete()
      .eq(column, organizerId);
    if (error) {
      throw new Error(`No se pudo limpiar ${table}: ${error.message}`);
    }
  }
}

async function removeCoverFiles(
  serviceClient: ServiceRoleClient,
  covers: readonly EventCoverRef[],
): Promise<void> {
  const paths = covers.flatMap((cover) => {
    const { thumbnail, large } = eventCoverPathsOf(cover);
    return [thumbnail, large];
  });
  if (paths.length > 0) {
    await serviceClient.client.storage.from(COVERS_BUCKET).remove(paths);
  }
}

async function withOrganizer(
  run: (world: World, staged: EventCoverRef[]) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  const clubId = await seededClubId(serviceClient);
  const staged: EventCoverRef[] = [];
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
          await run({ serviceClient, clubId, organizer }, staged);
        } finally {
          await deleteRowsBy(serviceClient, organizer.id);
          await removeCoverFiles(serviceClient, staged);
        }
      },
    ),
  );
}

async function aPng(): Promise<Uint8Array> {
  const png = await sharp({
    create: { width: 40, height: 30, channels: 3, background: "#1c6ea4" },
  })
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

async function stageCover(
  world: World,
  staged: EventCoverRef[],
): Promise<string> {
  const client = world.serviceClient.client;
  const { id } = await stageEventCover(
    {
      members: createRoleRequestGateways(client).members,
      eventCovers: createSupabaseEventCoversGateway(client),
      images: { shrinkCover: shrinkNewsCover },
      newFileId: randomUUID,
    },
    { callerId: world.organizer.id, bytes: await aPng() },
  );
  staged.push({ id, clubId: world.clubId });
  return id;
}

function weeklySchedule(world: World, coverUploadId: string): NewEventSchedule {
  return {
    clubId: world.clubId,
    authorId: world.organizer.id,
    fields: {
      title: "Con imagen",
      eventType: "training",
      startTime: "19:00",
      endTime: "20:30",
      location: "MSAC",
      place: null,
      placeDetail: null,
      notes: null,
      audience: { kind: "club" },
    },
    endsOn: null,
    coverUploadId,
    occurrenceDates: ["2099-07-07", "2099-07-14"],
    series: { weekdays: [2], startsOn: "2099-07-07", endsOn: "2099-07-14" },
  };
}

describeRls("la imagen de los eventos contra la base (#644)", () => {
  it(
    "guarda las dos versiones en el bucket privado y las firma",
    () =>
      withOrganizer(async (world, staged) => {
        const coverId = await stageCover(world, staged);
        const covers = createSupabaseEventCoversGateway(
          world.serviceClient.client,
        );
        const paths = eventCoverPathsOf({ id: coverId, clubId: world.clubId });

        const signed = await covers.signUrls([paths.thumbnail, paths.large]);

        await expect(covers.findCover(coverId)).resolves.toEqual({
          id: coverId,
          clubId: world.clubId,
          uploadedBy: world.organizer.id,
        });
        expect([...signed.keys()].sort()).toEqual(
          [paths.large, paths.thumbnail].sort(),
        );
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "copia la imagen a las sesiones y no pisa la de una sesión editada sola",
    () =>
      withOrganizer(async (world, staged) => {
        const client = world.serviceClient.client;
        const seriesCover = await stageCover(world, staged);
        const newCover = await stageCover(world, staged);
        const saved = await createEventGateways(client).events.insertSchedule(
          weeklySchedule(world, seriesCover),
        );
        const [alone, inheriting] = saved.eventIds.map(String);
        const { agenda } = createEventAgendaGateways(client);
        const sessionCovers = () =>
          Promise.all(
            [alone, inheriting].map(async (eventId) => {
              const session = await agenda.findEvent({
                clubId: world.clubId,
                callerId: world.organizer.id,
                eventId: String(eventId),
              });
              return session?.coverUploadId;
            }),
          );

        const created = await sessionCovers();
        await createEventManagementGateways(client).managedEvents.updateEvent({
          clubId: world.clubId,
          eventId: String(alone),
          changes: { coverUploadId: null },
        });
        await createSeriesManagementGateways(client).managedSeries.updateSeries(
          {
            clubId: world.clubId,
            seriesId: String(saved.seriesId),
            changes: { coverUploadId: newCover },
          },
        );

        expect(created).toEqual([seriesCover, seriesCover]);
        await expect(sessionCovers()).resolves.toEqual([null, newCover]);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
