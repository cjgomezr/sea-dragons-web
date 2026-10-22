import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import {
  type GroupAudienceGateways,
  listGroupAudience,
} from "@/lib/groups/group-audience";
import {
  GroupNotFoundError,
  type GroupsGateways,
  listGroups,
} from "@/lib/groups/groups";
import {
  createGroupAudienceGateways,
  createGroupsGateways,
} from "@/lib/groups/supabase-groups-gateways";
import { PROFILE_PHOTO_BUCKET } from "@/lib/members/supabase-profile-photo-gateways";
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
 * El uso y la vista previa de la lista de grupos (#826, D4 de E32) contra
 * `seadragons-dev`, con el adaptador real. Lo que sólo una base de verdad
 * puede afirmar: que las consultas acotan al club, que una serie cuenta una
 * vez aunque cada sesión lleve su copia de la audiencia, y que la foto de la
 * vista previa sale firmada.
 *
 * Todo vive en un club de usar y tirar, y "hoy" es un día de 2099: nada de
 * lo que ya tenga dev se cuela en los números. Las filas se borran en orden
 * inverso al sembrado (las sesiones antes que sus series, las audiencias con
 * su evento o su noticia, todo antes que el club).
 */

const TODAY = "2099-03-10";
// Mediodía en Melbourne de ese día.
const NOW = new Date("2099-03-10T01:00:00Z");
const YESTERDAY = "2099-03-09";
const TOMORROW = "2099-03-11";
const NEXT_WEEK = "2099-03-17";
const MONTH_END = "2099-03-31";

const CALLER_ID = randomUUID();

type SeedMember = {
  readonly fullName: string;
  readonly accountStatus: AccountStatus;
};

type Club = { readonly clubId: string; readonly otherClubId: string };

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

async function withClubs<T>(
  serviceClient: ServiceRoleClient,
  run: (club: Club) => Promise<T>,
): Promise<T> {
  const club = (name: string) => ({ slug: `uso-grupos-${randomUUID()}`, name });
  return withSeededRows(
    serviceClient,
    "clubs",
    [club("Club del uso"), club("Club vecino")],
    ([own, other]) =>
      run({ clubId: own!.id as string, otherClubId: other!.id as string }),
  );
}

async function withMembers<T>(
  serviceClient: ServiceRoleClient,
  clubId: string,
  seeds: readonly SeedMember[],
  run: (members: readonly TestUser[]) => Promise<T>,
): Promise<T> {
  const [first, ...rest] = seeds;
  if (first === undefined) {
    return run([]);
  }
  return withTestUser(serviceClient, async (user) => {
    await insertRows(serviceClient, "members", [
      {
        club_id: clubId,
        user_id: user.id,
        full_name: first.fullName,
        email: user.email,
        account_status: first.accountStatus,
        role: "Committee",
      },
    ]);
    return withMembers(serviceClient, clubId, rest, (others) =>
      run([user, ...others]),
    );
  });
}

/** Sube una foto mínima a la carpeta del socio y la apunta en su ficha. */
async function withPhoto<T>(
  serviceClient: ServiceRoleClient,
  userId: string,
  run: (photoPath: string) => Promise<T>,
): Promise<T> {
  const photoPath = `${userId}/${randomUUID()}.webp`;
  const storage = serviceClient.client.storage.from(PROFILE_PHOTO_BUCKET);
  const { error } = await storage.upload(photoPath, new Uint8Array([0]), {
    contentType: "image/webp",
  });
  if (error) {
    throw new Error(`No se pudo subir la foto: ${error.message}`);
  }
  try {
    await serviceClient.client
      .from("members")
      .update({ photo_path: photoPath })
      .eq("user_id", userId)
      .throwOnError();
    return await run(photoPath);
  } finally {
    await storage.remove([photoPath]);
  }
}

function asCoachOf<Gateways extends Pick<GroupsGateways, "members">>(
  gateways: Gateways,
  clubId: string,
): Gateways {
  return {
    ...gateways,
    members: {
      findRoleRequestMember: async () => ({
        clubId,
        fullName: "Carla Coach",
        role: "Coach",
      }),
    },
  };
}

type Author = { readonly clubId: string; readonly userId: string };

function eventFields(
  author: Author,
  startsOn: string,
): Record<string, unknown> {
  return {
    club_id: author.clubId,
    title: `Uso ${startsOn}`,
    event_type: "training",
    starts_on: startsOn,
    start_time: "19:00",
    location: "MSAC",
    audience: "groups",
    author_id: author.userId,
    // Explícitos en todas las filas: en un insert de varias, PostgREST pone
    // null en la columna que falta en alguna, no su valor por defecto.
    status: "scheduled",
    cancelled_at: null,
  };
}

function seriesFields(author: Author, endsOn: string): Record<string, unknown> {
  return {
    club_id: author.clubId,
    title: `Serie hasta ${endsOn}`,
    event_type: "training",
    start_time: "19:00",
    location: "MSAC",
    audience: "groups",
    weekdays: [3],
    starts_on: "2099-03-01",
    ends_on: endsOn,
    author_id: author.userId,
  };
}

function postFields(
  author: Author,
  status: "published" | "withdrawn",
): Record<string, unknown> {
  return {
    club_id: author.clubId,
    category: "news",
    title: `Noticia ${status}`,
    body: "Cuerpo",
    audience: "groups",
    status,
    author_id: author.userId,
  };
}

type Scene = Author & { readonly groupId: string };

function audienceRows(
  scene: Scene,
  key: "event_id" | "series_id" | "post_id",
  rows: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map((row) => ({
    [key]: row.id,
    group_id: scene.groupId,
    club_id: scene.clubId,
  }));
}

/** Tres series: en pie, terminada y cancelada, cada una con una sesión que
 * lleva su copia de la audiencia, como las crea `0036_create_events.sql`. */
async function withSeries(
  scene: Scene,
  serviceClient: ServiceRoleClient,
  run: () => Promise<void>,
): Promise<void> {
  await withSeededRows(
    serviceClient,
    "event_series",
    [
      seriesFields(scene, MONTH_END),
      seriesFields(scene, YESTERDAY),
      seriesFields(scene, MONTH_END),
    ],
    async (series) => {
      await insertRows(
        serviceClient,
        "event_series_groups",
        audienceRows(scene, "series_id", series),
      );
      const [ongoing, ended, cancelled] = series;
      const session = (
        owner: Record<string, unknown> | undefined,
        startsOn: string,
        isCancelled: boolean,
      ) => ({
        ...eventFields(scene, startsOn),
        series_id: owner?.id,
        status: isCancelled ? "cancelled" : "scheduled",
        cancelled_at: isCancelled ? NOW.toISOString() : null,
      });
      await withSeededRows(
        serviceClient,
        "events",
        [
          session(ongoing, NEXT_WEEK, false),
          session(ended, YESTERDAY, false),
          session(cancelled, NEXT_WEEK, true),
        ],
        async (sessions) => {
          await insertRows(
            serviceClient,
            "event_groups",
            audienceRows(scene, "event_id", sessions),
          );
          await run();
        },
      );
    },
  );
}

/** Tres eventos sueltos (de ayer, de hoy y uno cancelado de mañana) y dos
 * noticias (publicada y retirada), todos para el grupo. */
async function withStandaloneUses(
  scene: Scene,
  serviceClient: ServiceRoleClient,
  run: () => Promise<void>,
): Promise<void> {
  await withSeededRows(
    serviceClient,
    "events",
    [
      eventFields(scene, YESTERDAY),
      eventFields(scene, TODAY),
      {
        ...eventFields(scene, TOMORROW),
        status: "cancelled",
        cancelled_at: NOW.toISOString(),
      },
    ],
    async (events) => {
      await insertRows(
        serviceClient,
        "event_groups",
        audienceRows(scene, "event_id", events),
      );
      await withSeededRows(
        serviceClient,
        "news_posts",
        [postFields(scene, "published"), postFields(scene, "withdrawn")],
        async (posts) => {
          await insertRows(
            serviceClient,
            "news_post_groups",
            audienceRows(scene, "post_id", posts),
          );
          await run();
        },
      );
    },
  );
}

describeRls(
  "el uso y la vista previa de los grupos contra seadragons-dev",
  () => {
    it(
      "cuentan sólo lo vigente del club y enseñan a tres activos con su foto firmada",
      async () => {
        const serviceClient = createServiceRoleTestClient(process.env);
        const gateways = createGroupsGateways(serviceClient.client);

        await withClubs(serviceClient, ({ clubId, otherClubId }) =>
          withMembers(
            serviceClient,
            clubId,
            [
              { fullName: "Dani Diaz", accountStatus: "active" },
              { fullName: "ana Alba", accountStatus: "active" },
              { fullName: "Ivan Incomplete", accountStatus: "incomplete" },
              { fullName: "Carla Cruz", accountStatus: "active" },
              { fullName: "Bea Baja", accountStatus: "inactive" },
              { fullName: "Eva Extra", accountStatus: "active" },
            ],
            (members) =>
              withSeededRows(
                serviceClient,
                "groups",
                [
                  { club_id: clubId, name: "Senior Squad" },
                  { club_id: clubId, name: "Masters Squad" },
                  { club_id: otherClubId, name: "Senior Squad" },
                ],
                async ([senior, masters]) => {
                  const [dani, ana, ivan, carla, bea] = members;
                  const groupId = senior!.id as string;
                  await insertRows(
                    serviceClient,
                    "group_memberships",
                    [dani!, ana!, ivan!, carla!, bea!].map((member) => ({
                      group_id: groupId,
                      user_id: member.id,
                      club_id: clubId,
                    })),
                  );
                  const scene = { clubId, userId: dani!.id, groupId };

                  await withPhoto(serviceClient, ana!.id, (photoPath) =>
                    withSeries(scene, serviceClient, () =>
                      withStandaloneUses(scene, serviceClient, async () => {
                        const groups = await listGroups(
                          asCoachOf(gateways, clubId),
                          { callerId: CALLER_ID, now: NOW },
                        );

                        expect(groups.map(({ name }) => name)).toEqual([
                          "Masters Squad",
                          "Senior Squad",
                        ]);
                        const [mastersGroup, seniorGroup] = groups;
                        expect(mastersGroup).toMatchObject({
                          id: masters!.id,
                          usage: { events: 0, posts: 0 },
                          previewMembers: [],
                        });
                        // El suelto de hoy y la serie en pie; la publicada.
                        expect(seniorGroup?.usage).toEqual({
                          events: 2,
                          posts: 1,
                        });
                        expect(seniorGroup?.previewMembers).toEqual([
                          {
                            id: ana!.id,
                            fullName: "ana Alba",
                            photoUrl: expect.stringContaining(photoPath),
                          },
                          {
                            id: carla!.id,
                            fullName: "Carla Cruz",
                            photoUrl: null,
                          },
                          {
                            id: dani!.id,
                            fullName: "Dani Diaz",
                            photoUrl: null,
                          },
                        ]);
                      }),
                    ),
                  );
                },
              ),
          ),
        );
      },
      RLS_NETWORK_TEST_TIMEOUT_MS,
    );

    it(
      "la audiencia de un grupo trae lo vigente de ese grupo con sus datos, y responde 404 al de otro club",
      async () => {
        const serviceClient = createServiceRoleTestClient(process.env);

        await withClubs(serviceClient, ({ clubId, otherClubId }) =>
          withMembers(
            serviceClient,
            clubId,
            [{ fullName: "Dani Diaz", accountStatus: "active" }],
            ([dani]) =>
              withSeededRows(
                serviceClient,
                "groups",
                [
                  { club_id: clubId, name: "Senior Squad" },
                  { club_id: clubId, name: "Masters Squad" },
                  { club_id: otherClubId, name: "Senior Squad" },
                ],
                async ([senior, masters, otherClubGroup]) => {
                  const scene = {
                    clubId,
                    userId: dani!.id,
                    groupId: senior!.id as string,
                  };
                  const gateways: GroupAudienceGateways = asCoachOf(
                    createGroupAudienceGateways(serviceClient.client),
                    clubId,
                  );
                  const audienceOf = (groupId: unknown) =>
                    listGroupAudience(gateways, {
                      callerId: CALLER_ID,
                      groupId: groupId as string,
                      now: NOW,
                    });

                  await withSeries(scene, serviceClient, () =>
                    withStandaloneUses(scene, serviceClient, async () => {
                      const audience = await audienceOf(senior!.id);

                      expect(audience.events.total).toBe(2);
                      expect(audience.events.items).toEqual([
                        {
                          kind: "event",
                          id: expect.any(String),
                          title: `Uso ${TODAY}`,
                          startsOn: TODAY,
                          startTime: "19:00",
                        },
                        {
                          kind: "series",
                          id: expect.any(String),
                          title: `Serie hasta ${MONTH_END}`,
                          weekdays: [3],
                          startTime: "19:00",
                          nextSession: {
                            id: expect.any(String),
                            startsOn: NEXT_WEEK,
                          },
                        },
                      ]);
                      expect(audience.posts).toEqual({
                        total: 1,
                        items: [
                          {
                            id: expect.any(String),
                            title: "Noticia published",
                            publishedAt: expect.stringMatching(/Z$/),
                          },
                        ],
                      });
                      await expect(audienceOf(masters!.id)).resolves.toEqual({
                        events: { items: [], total: 0 },
                        posts: { items: [], total: 0 },
                      });
                      await expect(
                        audienceOf(otherClubGroup!.id),
                      ).rejects.toBeInstanceOf(GroupNotFoundError);
                    }),
                  );
                },
              ),
          ),
        );
      },
      RLS_NETWORK_TEST_TIMEOUT_MS,
    );
  },
);
