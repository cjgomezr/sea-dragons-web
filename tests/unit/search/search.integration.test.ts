import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import { searchClub } from "@/lib/search/search";
import { createSearchGateways } from "@/lib/search/supabase-search-gateways";
import { clubCalendarDate } from "@/lib/time/club-calendar";
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
 * La búsqueda global contra `seadragons-dev` (#425), con los adaptadores de
 * verdad y `0049_search.sql` aplicada. Lo que ningún doble dice: que las
 * funciones de búsqueda casan con PostgREST, que la audiencia de la agenda
 * y del feed se aplica sobre ellas, y que la base ignora acentos y
 * mayúsculas.
 *
 * Corre en un club propio y desechable, para que cada total sea exacto.
 */

const DAY_MS = 86_400_000;

type SearchClub = {
  readonly serviceClient: ServiceRoleClient;
  readonly player: TestUser;
  readonly scrimmageId: string;
  readonly postId: string;
};

function withTemporaryClub<T>(
  serviceClient: ServiceRoleClient,
  run: (clubId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `busqueda-${randomUUID()}`, name: "Club de la búsqueda" }],
    ([club]) => run(String(club?.id)),
  );
}

function withMember<T>(
  serviceClient: ServiceRoleClient,
  seed: {
    readonly clubId: string;
    readonly fullName: string;
    readonly role: Role;
    readonly status: AccountStatus;
  },
  run: (member: TestUser) => Promise<T>,
): Promise<T> {
  return withTestUser(serviceClient, (user) =>
    withSeededRows(
      serviceClient,
      "members",
      [
        {
          club_id: seed.clubId,
          user_id: user.id,
          full_name: seed.fullName,
          email: user.email,
          account_status: seed.status,
          role: seed.role,
        },
      ],
      () => run(user),
    ),
  );
}

/** El scrimmage va a todo el club; el de un grupo sin socios no le llega a
 * nadie que no organice. */
function withEvents<T>(
  serviceClient: ServiceRoleClient,
  seed: { readonly clubId: string; readonly authorId: string },
  run: (scrimmageId: string) => Promise<T>,
): Promise<T> {
  const nextWeek = clubCalendarDate(new Date(Date.now() + 7 * DAY_MS));
  const event = (title: string, audience: "all" | "groups") => ({
    club_id: seed.clubId,
    title,
    event_type: "competition",
    starts_on: nextWeek,
    start_time: "10:00",
    location: "Piscina de Geelong",
    audience,
    author_id: seed.authorId,
  });
  return withSeededRows(
    serviceClient,
    "events",
    [event("Scrimmage vs Geelong", "all"), event("Selección", "groups")],
    ([scrimmage]) => run(String(scrimmage?.id)),
  );
}

function withPost<T>(
  serviceClient: ServiceRoleClient,
  seed: { readonly clubId: string; readonly authorId: string },
  run: (postId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "news_posts",
    [
      {
        club_id: seed.clubId,
        category: "news",
        title: "Viaje a GEELONG",
        body: "Salimos el sábado temprano.",
        author_id: seed.authorId,
        audience: "club",
      },
    ],
    ([post]) => run(String(post?.id)),
  );
}

async function withSearchClub(
  run: (club: SearchClub) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  await withTemporaryClub(serviceClient, (clubId) =>
    withMember(
      serviceClient,
      { clubId, fullName: "Pía Muñoz", role: "Player", status: "active" },
      (player) =>
        withMember(
          serviceClient,
          {
            clubId,
            fullName: "Geelong De Baja",
            role: "Player",
            status: "inactive",
          },
          (retired) =>
            withEvents(
              serviceClient,
              { clubId, authorId: retired.id },
              (scrimmageId) =>
                withPost(
                  serviceClient,
                  { clubId, authorId: retired.id },
                  (postId) =>
                    run({ serviceClient, player, scrimmageId, postId }),
                ),
            ),
        ),
    ),
  );
}

describeRls("la búsqueda global en Supabase", () => {
  it(
    "'geelong' encuentra el scrimmage y la noticia, y a un Player no le enseña al socio dado de baja",
    async () => {
      await withSearchClub(async (club) => {
        const results = await searchClub(
          createSearchGateways(club.serviceClient.client),
          { callerId: club.player.id, text: "geelong", now: new Date() },
        );

        expect(results.members).toEqual({ total: 0, items: [] });
        expect(results.events).toEqual({
          total: 1,
          items: [
            expect.objectContaining({
              kind: "event",
              id: club.scrimmageId,
              title: "Scrimmage vs Geelong",
              startTime: "10:00",
              isCancelled: false,
            }),
          ],
        });
        expect(results.news).toEqual({
          total: 1,
          items: [
            expect.objectContaining({
              kind: "news",
              id: club.postId,
              title: "Viaje a GEELONG",
              category: "news",
            }),
          ],
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "'munoz' encuentra a Muñoz e 'isc' encuentra la piscina",
    async () => {
      await withSearchClub(async (club) => {
        const gateways = createSearchGateways(club.serviceClient.client);
        const request = { callerId: club.player.id, now: new Date() };

        const byName = await searchClub(gateways, {
          ...request,
          text: "munoz",
        });
        const byPlace = await searchClub(gateways, { ...request, text: "isc" });

        expect(byName.members.items).toEqual([
          {
            kind: "member",
            userId: club.player.id,
            fullName: "Pía Muñoz",
            position: null,
            photoUrl: null,
          },
        ]);
        expect(byPlace.events.items.map((item) => item.id)).toEqual([
          club.scrimmageId,
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
