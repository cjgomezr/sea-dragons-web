import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { EventPlace } from "@/lib/events/event-place";
import { toPlaceColumns } from "@/lib/events/supabase-event-place";
import { createSupabaseClubPlacesGateway } from "@/lib/events/supabase-club-places";
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
 * Los lugares del club con el adaptador de verdad (#646, RF-5 del PRD de
 * E24) y `0071_club_places.sql` aplicada: lo que ningún doble dice es que
 * `club_places` cuenta por eventos, que el adaptador lee las coordenadas como
 * números y que nunca trae los lugares de otro club.
 *
 * Cada club es temporal, para que los eventos de verdad de `seadragons-dev`
 * no entren en la cuenta. Los eventos no cuelgan en cascada de nada, así que
 * se borran a mano antes de soltar al socio y los clubes.
 */

const MSAC: EventPlace = {
  name: "MSAC",
  address: "Aughtie Dr, Albert Park VIC 3206",
  lat: -37.8423,
  lng: 144.9601,
};
const BOX_HILL: EventPlace = {
  name: "Box Hill Aquatic Centre",
  address: null,
  lat: -37.8189,
  lng: 145.1223,
};
const CLUBHOUSE: EventPlace = {
  name: "Clubhouse",
  address: "1 Club St",
  lat: null,
  lng: null,
};

async function deleteEventsIn(
  serviceClient: ServiceRoleClient,
  clubIds: readonly string[],
): Promise<void> {
  const { error } = await serviceClient.client
    .from("events")
    .delete()
    .in("club_id", clubIds);
  if (error) {
    throw new Error(`No se pudieron limpiar los eventos: ${error.message}`);
  }
}

async function seedEvents(
  serviceClient: ServiceRoleClient,
  seed: {
    readonly clubId: string;
    readonly author: TestUser;
    readonly place: EventPlace;
    readonly count: number;
  },
): Promise<void> {
  const rows = Array.from({ length: seed.count }, () => ({
    club_id: seed.clubId,
    title: "Entrenamiento",
    event_type: "training",
    starts_on: "2099-07-10",
    start_time: "19:00",
    end_time: "20:30",
    location: seed.place.name,
    audience: "all",
    author_id: seed.author.id,
    ...toPlaceColumns(seed.place),
  }));
  const { error } = await serviceClient.client.from("events").insert(rows);
  if (error) {
    throw new Error(`No se pudieron sembrar los eventos: ${error.message}`);
  }
}

function memberRow(clubId: string, user: TestUser): Record<string, unknown> {
  return {
    club_id: clubId,
    user_id: user.id,
    full_name: "Olga Organiza",
    email: user.email,
    account_status: "active",
    role: "Committee",
  };
}

/** Un socio sólo es de un club, así que cada club tiene el suyo. */
async function withTwoClubs(
  run: (world: {
    readonly serviceClient: ServiceRoleClient;
    readonly ownClubId: string;
    readonly otherClubId: string;
    readonly ownAuthor: TestUser;
    readonly otherAuthor: TestUser;
  }) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  await withSeededRows(
    serviceClient,
    "clubs",
    [
      { slug: `lugares-${randomUUID()}`, name: "Club de lugares" },
      { slug: `lugares-otro-${randomUUID()}`, name: "Otro club" },
    ],
    async ([ownClub, otherClub]) => {
      const ownClubId = String(ownClub?.id);
      const otherClubId = String(otherClub?.id);
      await withTestUser(serviceClient, (ownAuthor) =>
        withTestUser(serviceClient, (otherAuthor) =>
          withSeededRows(
            serviceClient,
            "members",
            [
              memberRow(ownClubId, ownAuthor),
              memberRow(otherClubId, otherAuthor),
            ],
            async () => {
              try {
                await run({
                  serviceClient,
                  ownClubId,
                  otherClubId,
                  ownAuthor,
                  otherAuthor,
                });
              } finally {
                await deleteEventsIn(serviceClient, [ownClubId, otherClubId]);
              }
            },
          ),
        ),
      );
    },
  );
}

describeRls("los lugares del club contra la base (#646)", () => {
  it(
    "lista los lugares del club ordenados por uso, sin los de otro club",
    () =>
      withTwoClubs(
        async ({
          serviceClient,
          ownClubId,
          otherClubId,
          ownAuthor,
          otherAuthor,
        }) => {
          await seedEvents(serviceClient, {
            clubId: ownClubId,
            author: ownAuthor,
            place: CLUBHOUSE,
            count: 1,
          });
          await seedEvents(serviceClient, {
            clubId: ownClubId,
            author: ownAuthor,
            place: MSAC,
            count: 2,
          });
          await seedEvents(serviceClient, {
            clubId: otherClubId,
            author: otherAuthor,
            place: BOX_HILL,
            count: 5,
          });
          const gateway = createSupabaseClubPlacesGateway(serviceClient.client);

          const places = await gateway.listClubPlaces(ownClubId);

          expect(places).toEqual([
            { ...MSAC, eventCount: 2 },
            { ...CLUBHOUSE, eventCount: 1 },
          ]);
        },
      ),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
