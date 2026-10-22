import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { listAgenda, openEvent } from "@/lib/events/event-agenda";
import { EventNotFoundError } from "@/lib/events/event-rsvp";
import { createEventAgendaGateways } from "@/lib/events/supabase-event-agenda-gateways";
import { listNewsFeed } from "@/lib/news/news-feed";
import { NewsPostNotFoundError, openNewsPost } from "@/lib/news/news-posts";
import { createNewsGateways } from "@/lib/news/supabase-news-gateways";
import { createGroupsGateways } from "@/lib/groups/supabase-groups-gateways";
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
 * La pregunta abierta de D11 (E32, #826): cuando se borra el único grupo de
 * la audiencia de un evento o de una noticia, ¿quién los sigue viendo?
 *
 * La respuesta sale de las reglas de lectura del servidor, que va con la
 * llave de servicio, y no de las policies: `event-agenda.ts` deja ver el
 * calendario entero a quien crea eventos (Admin y Committee), y
 * `news-posts.ts` enseña a cada lector lo que le llega más lo que él mismo
 * publicó. Aquí se prueba con el borrado real y las lecturas reales:
 *
 * - el evento lo siguen viendo el Admin y el Committee; el Coach y el Player,
 *   aunque fuera de ese grupo, no;
 * - la noticia sólo la ve quien la publicó; ni el Admin ni el resto del
 *   Committee.
 *
 * Todo vive en un club de usar y tirar y en 2099, para que nada de dev se
 * cuele en la agenda ni en el feed.
 */

const EVENT_DAY = "2099-05-05";
const NOW = new Date("2099-05-01T01:00:00Z");

type Cast = {
  readonly admin: TestUser;
  readonly author: TestUser;
  readonly committee: TestUser;
  readonly coach: TestUser;
  readonly player: TestUser;
};

const CAST_ROLES: readonly (readonly [keyof Cast, Role])[] = [
  ["admin", "Admin"],
  ["author", "Committee"],
  ["committee", "Committee"],
  ["coach", "Coach"],
  ["player", "Player"],
];

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

async function withClub<T>(
  serviceClient: ServiceRoleClient,
  run: (clubId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `grupo-borrado-${randomUUID()}`, name: "Club del grupo borrado" }],
    ([club]) => run(club!.id as string),
  );
}

async function withCast<T>(
  serviceClient: ServiceRoleClient,
  clubId: string,
  run: (cast: Cast) => Promise<T>,
  seeded: Partial<Record<keyof Cast, TestUser>> = {},
): Promise<T> {
  const next = CAST_ROLES.find(([name]) => seeded[name] === undefined);
  if (next === undefined) {
    return run(seeded as Cast);
  }
  const [name, role] = next;
  return withTestUser(serviceClient, async (user) => {
    await insertRows(serviceClient, "members", [
      {
        club_id: clubId,
        user_id: user.id,
        full_name: `${role} ${name}`,
        email: user.email,
        account_status: "active",
        role,
      },
    ]);
    return withCast(serviceClient, clubId, run, { ...seeded, [name]: user });
  });
}

type Audience = {
  readonly clubId: string;
  readonly cast: Cast;
  readonly eventId: string;
  readonly postId: string;
};

/** Un grupo con el Player y el Coach dentro, y un evento y una noticia del
 * autor que sólo van a ese grupo. Al final se borra el grupo por el
 * adaptador de la pantalla de Grupos. */
async function withOrphanedAudience(
  serviceClient: ServiceRoleClient,
  run: (audience: Audience) => Promise<void>,
): Promise<void> {
  await withClub(serviceClient, (clubId) =>
    withCast(serviceClient, clubId, async (cast) => {
      const groups = createGroupsGateways(serviceClient.client);
      const created = await groups.groups.insertGroup({
        clubId,
        name: "Único grupo",
      });
      if (created.kind !== "created") {
        throw new Error(`No se pudo crear el grupo: ${created.kind}`);
      }
      const groupId = created.group.id;
      await insertRows(
        serviceClient,
        "group_memberships",
        [cast.player, cast.coach].map((user) => ({
          group_id: groupId,
          user_id: user.id,
          club_id: clubId,
        })),
      );
      const authorId = cast.author.id;
      await withSeededRows(
        serviceClient,
        "events",
        [
          {
            club_id: clubId,
            title: "Del grupo borrado",
            event_type: "training",
            starts_on: EVENT_DAY,
            start_time: "19:00",
            location: "MSAC",
            audience: "groups",
            author_id: authorId,
          },
        ],
        ([event]) =>
          withSeededRows(
            serviceClient,
            "news_posts",
            [
              {
                club_id: clubId,
                category: "news",
                title: "Del grupo borrado",
                body: "Cuerpo",
                audience: "groups",
                author_id: authorId,
              },
            ],
            async ([post]) => {
              const eventId = event!.id as string;
              const postId = post!.id as string;
              await insertRows(serviceClient, "event_groups", [
                { event_id: eventId, group_id: groupId, club_id: clubId },
              ]);
              await insertRows(serviceClient, "news_post_groups", [
                { post_id: postId, group_id: groupId, club_id: clubId },
              ]);
              await expect(
                groups.groups.deleteGroup({ clubId, groupId }),
              ).resolves.toEqual({ kind: "deleted" });
              await run({ clubId, cast, eventId, postId });
            },
          ),
      );
    }),
  );
}

async function seesEvent(
  serviceClient: ServiceRoleClient,
  request: { readonly callerId: string; readonly eventId: string },
): Promise<boolean> {
  const gateways = createEventAgendaGateways(serviceClient.client);
  const page = await listAgenda(gateways, {
    callerId: request.callerId,
    period: "upcoming",
    now: NOW,
  });
  const isListed = page.events.some(({ id }) => id === request.eventId);
  const opened = await openEvent(gateways, { ...request, now: NOW }).then(
    () => true,
    (error: unknown) => {
      if (error instanceof EventNotFoundError) {
        return false;
      }
      throw error;
    },
  );
  expect(isListed).toBe(opened);
  return opened;
}

async function seesPost(
  serviceClient: ServiceRoleClient,
  request: { readonly callerId: string; readonly postId: string },
): Promise<boolean> {
  const gateways = createNewsGateways(serviceClient.client);
  const feed = await listNewsFeed(gateways, {
    callerId: request.callerId,
    now: NOW,
  });
  const isListed = feed.posts.some(({ id }) => id === request.postId);
  const opened = await openNewsPost(gateways, { ...request, now: NOW }).then(
    () => true,
    (error: unknown) => {
      if (error instanceof NewsPostNotFoundError) {
        return false;
      }
      throw error;
    },
  );
  expect(isListed).toBe(opened);
  return opened;
}

describeRls("quién ve lo que se queda sin grupos (D11 de E32)", () => {
  it(
    "un evento sin grupos lo ven el Admin y el Committee, y una noticia sólo su autor",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withOrphanedAudience(
        serviceClient,
        async ({ cast, eventId, postId }) => {
          const viewers = async (
            sees: (callerId: string) => Promise<boolean>,
          ): Promise<readonly string[]> => {
            const results = await Promise.all(
              CAST_ROLES.map(async ([name]) =>
                (await sees(cast[name].id)) ? [name] : [],
              ),
            );
            return results.flat();
          };

          await expect(
            viewers((callerId) =>
              seesEvent(serviceClient, { callerId, eventId }),
            ),
          ).resolves.toEqual(["admin", "author", "committee"]);
          await expect(
            viewers((callerId) =>
              seesPost(serviceClient, { callerId, postId }),
            ),
          ).resolves.toEqual(["author"]);
        },
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
