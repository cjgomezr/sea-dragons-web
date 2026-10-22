import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { AttendanceStatus } from "@/lib/attendance/attendance-status";
import { type DashboardSource, readDashboard } from "@/lib/dashboard/dashboard";
import { createDashboardGateways } from "@/lib/dashboard/supabase-dashboard-gateways";
import { markNewsSeen } from "@/lib/news/news-seen";
import { createNewsSeenGateway } from "@/lib/news/supabase-news-seen-gateway";
import { DEFAULT_TEAM_LABELS } from "@/lib/teams/team-builder";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  seedCurrentMembership,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * El dashboard contra `seadragons-dev` (#424), con los adaptadores de verdad
 * y `0048_news_seen_at.sql` aplicada. Lo que ningún doble dice: que las dos
 * cuentas de `members` casan con el esquema, que cada fuente se cablea con el
 * adaptador de su sección y que la marca de visita se escribe y se lee.
 *
 * Corre en un club propio y desechable: un socio, un entrenamiento y una
 * noticia, para que cada número sea exacto.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

type Home = {
  readonly serviceClient: ServiceRoleClient;
  readonly player: TestUser;
  readonly trainingId: string;
  readonly postId: string;
};

function withTemporaryClub<T>(
  serviceClient: ServiceRoleClient,
  run: (clubId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `inicio-${randomUUID()}`, name: "Club del inicio" }],
    ([club]) => run(String(club?.id)),
  );
}

function withPlayer<T>(
  serviceClient: ServiceRoleClient,
  clubId: string,
  run: (player: TestUser) => Promise<T>,
): Promise<T> {
  return withTestUser(serviceClient, (user) =>
    withSeededRows(
      serviceClient,
      "members",
      [
        {
          club_id: clubId,
          user_id: user.id,
          full_name: "Pía Player",
          email: user.email,
          account_status: "active",
          role: "Player",
        },
      ],
      async () => {
        await seedCurrentMembership(serviceClient, { clubId, userId: user.id });
        return run(user);
      },
    ),
  );
}

/** Un entrenamiento de mañana y una noticia de hace una hora, los dos para
 * todo el club. */
function withTrainingAndPost<T>(
  serviceClient: ServiceRoleClient,
  seed: { readonly clubId: string; readonly authorId: string },
  run: (ids: { trainingId: string; postId: string }) => Promise<T>,
): Promise<T> {
  const tomorrow = clubCalendarDate(new Date(Date.now() + DAY_MS));
  return withSeededRows(
    serviceClient,
    "events",
    [
      {
        club_id: seed.clubId,
        title: "Entrenamiento del inicio",
        event_type: "training",
        starts_on: tomorrow,
        start_time: "19:00",
        location: "MSAC",
        audience: "all",
        author_id: seed.authorId,
      },
    ],
    ([training]) =>
      withSeededRows(
        serviceClient,
        "news_posts",
        [
          {
            club_id: seed.clubId,
            category: "announcement",
            title: "Cambio de piscina",
            body: "Esta semana entrenamos en Oakleigh.",
            author_id: seed.authorId,
            audience: "club",
            published_at: new Date(Date.now() - HOUR_MS).toISOString(),
          },
        ],
        ([post]) =>
          run({ trainingId: String(training?.id), postId: String(post?.id) }),
      ),
  );
}

async function succeed(
  action: string,
  query: PromiseLike<{ readonly error: { readonly message: string } | null }>,
): Promise<void> {
  const { error } = await query;
  if (error) {
    throw new Error(`No se pudo ${action}: ${error.message}`);
  }
}

/** Un grupo sin nadie dentro y un evento de pasado mañana sólo para él:
 * no va dirigido a Pía, así que no sale ni en el próximo ni en la semana. */
function withOtherGroupEvent<T>(
  home: Home,
  clubId: string,
  run: () => Promise<T>,
): Promise<T> {
  const inTwoDays = clubCalendarDate(new Date(Date.now() + 2 * DAY_MS));
  return withSeededRows(
    home.serviceClient,
    "groups",
    [{ club_id: clubId, name: "Senior" }],
    ([group]) =>
      withSeededRows(
        home.serviceClient,
        "events",
        [
          {
            club_id: clubId,
            title: "Sólo para Senior",
            event_type: "competition",
            starts_on: inTwoDays,
            start_time: "10:00",
            location: "MSAC",
            audience: "groups",
            author_id: home.player.id,
          },
        ],
        async ([event]) => {
          await succeed(
            "dirigir el evento al grupo",
            home.serviceClient.client.from("event_groups").insert({
              event_id: event?.id,
              group_id: group?.id,
              club_id: clubId,
            }),
          );
          return run();
        },
      ),
  );
}

/** El reparto publicado del entrenamiento, con Pía en el equipo B. Sus
 * filas se van con el reparto en cascada. */
function withPublishedSplit<T>(
  home: Home,
  clubId: string,
  run: () => Promise<T>,
): Promise<T> {
  return withSeededRows(
    home.serviceClient,
    "team_splits",
    [
      {
        event_id: home.trainingId,
        club_id: clubId,
        team_a_name: DEFAULT_TEAM_LABELS.a.name,
        team_a_color: DEFAULT_TEAM_LABELS.a.color,
        team_b_name: DEFAULT_TEAM_LABELS.b.name,
        team_b_color: DEFAULT_TEAM_LABELS.b.color,
        mode: "manual",
        published_at: new Date().toISOString(),
      },
    ],
    async ([split]) => {
      await succeed(
        "poner a Pía en el reparto",
        home.serviceClient.client.from("team_split_members").insert({
          split_id: split?.id,
          user_id: home.player.id,
          club_id: clubId,
          team: "b",
        }),
      );
      return run();
    },
  );
}

async function clubIdOf(home: Home): Promise<string> {
  const { data, error } = await home.serviceClient.client
    .from("members")
    .select("club_id")
    .eq("user_id", home.player.id)
    .single();
  if (error) {
    throw new Error(`No se encontró el club de Pía: ${error.message}`);
  }
  return String(data.club_id);
}

async function withHome(run: (home: Home) => Promise<void>): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  await withTemporaryClub(serviceClient, (clubId) =>
    withPlayer(serviceClient, clubId, (player) =>
      withTrainingAndPost(
        serviceClient,
        { clubId, authorId: player.id },
        ({ trainingId, postId }) =>
          run({ serviceClient, player, trainingId, postId }),
      ),
    ),
  );
}

describeRls("el dashboard en Supabase", () => {
  it(
    "junta el próximo, la semana, la noticia y la marca de visita",
    async () => {
      await withHome(async (home) => {
        const reported: DashboardSource[] = [];
        const gateways = {
          ...createDashboardGateways(home.serviceClient.client),
          failures: {
            report: (source: DashboardSource) => {
              reported.push(source);
            },
          },
        };
        const request = { callerId: home.player.id, now: new Date() };

        const fresh = await readDashboard(gateways, request);

        expect(reported).toEqual([]);
        if (fresh.kind !== "member") {
          throw new Error("Un socio al día recibe el inicio de socio.");
        }
        expect(fresh.nextUp).toMatchObject({
          kind: "event",
          id: home.trainingId,
          title: "Entrenamiento del inicio",
          startTime: "19:00",
          location: "MSAC",
          myResponse: null,
        });
        expect(fresh).not.toHaveProperty("tiles");
        expect(fresh).not.toHaveProperty("upcomingEvents");
        expect(fresh.latestNews).toEqual({
          kind: "news",
          posts: [
            expect.objectContaining({
              id: home.postId,
              category: "announcement",
              title: "Cambio de piscina",
              isUnread: true,
            }),
          ],
        });

        await markNewsSeen(createNewsSeenGateway(home.serviceClient.client), {
          userId: home.player.id,
          now: new Date(),
        });
        const afterVisit = await readDashboard(gateways, request);

        expect(afterVisit).toMatchObject({
          kind: "member",
          latestNews: {
            kind: "news",
            posts: [expect.objectContaining({ isUnread: false })],
          },
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "pide el contacto mientras falte y deja de pedirlo cuando se guarda (#498)",
    async () => {
      await withHome(async (home) => {
        const gateways = createDashboardGateways(home.serviceClient.client);
        const request = { callerId: home.player.id, now: new Date() };

        const before = await readDashboard(gateways, request);

        expect(before.contactReminder).toEqual({
          kind: "reminder",
          reminder: "both",
        });

        const { error } = await home.serviceClient.client
          .from("members")
          .update({
            phone: "0412 345 678",
            emergency_contact_name: "Pablo Player",
            emergency_contact_phone: "0412 999 888",
            emergency_contact_relationship: "Hermano",
          })
          .eq("user_id", home.player.id);
        if (error) {
          throw new Error(`No se pudo guardar el contacto: ${error.message}`);
        }
        const after = await readDashboard(gateways, request);

        expect(after.contactReminder).toEqual({
          kind: "reminder",
          reminder: "none",
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "sirve el inicio reducido a quien dejó de estar al día (#453)",
    async () => {
      await withHome(async (home) => {
        const { error } = await home.serviceClient.client
          .from("memberships")
          .update({ status: "past_due" })
          .eq("user_id", home.player.id);
        if (error) {
          throw new Error(`No se pudo mover la membresía: ${error.message}`);
        }

        const result = await readDashboard(
          createDashboardGateways(home.serviceClient.client),
          { callerId: home.player.id, now: new Date() },
        );

        expect(result).toEqual({
          kind: "restricted",
          viewer: { firstName: "Pía" },
          block: "past_due",
          contactReminder: { kind: "reminder", reminder: "both" },
          me: { attendance: null },
          nextUp: expect.objectContaining({ id: home.trainingId }),
          week: {
            kind: "week",
            events: [expect.objectContaining({ id: home.trainingId })],
          },
          membership: expect.objectContaining({
            status: "restricted",
            block: "past_due",
          }),
          latestNews: expect.anything(),
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "el próximo y la semana siguen la audiencia, y el reparto publicado da mi equipo (#745)",
    async () => {
      await withHome(async (home) => {
        const clubId = await clubIdOf(home);
        await withOtherGroupEvent(home, clubId, () =>
          withPublishedSplit(home, clubId, async () => {
            const reported: DashboardSource[] = [];
            const gateways = {
              ...createDashboardGateways(home.serviceClient.client),
              failures: {
                report: (source: DashboardSource) => {
                  reported.push(source);
                },
              },
            };

            const result = await readDashboard(gateways, {
              callerId: home.player.id,
              now: new Date(),
            });

            expect(reported).toEqual([]);
            expect(result.nextUp).toMatchObject({
              kind: "event",
              id: home.trainingId,
              eventType: "training",
              audience: { kind: "club" },
              coverUrl: null,
              myTeam: {
                name: DEFAULT_TEAM_LABELS.b.name,
                color: DEFAULT_TEAM_LABELS.b.color,
                position: null,
              },
            });
            expect(result.nextUp).not.toHaveProperty("teamsStatus");
            expect(result.week).toEqual({
              kind: "week",
              events: [
                expect.objectContaining({
                  id: home.trainingId,
                  title: "Entrenamiento del inicio",
                }),
              ],
            });
          }),
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "al socio restringido no le manda ni el extracto ni la portada, ni su equipo (#745, D2)",
    async () => {
      await withHome(async (home) => {
        const clubId = await clubIdOf(home);
        await withPublishedSplit(home, clubId, async () => {
          await succeed(
            "mover la membresía",
            home.serviceClient.client
              .from("memberships")
              .update({ status: "cancelled" })
              .eq("user_id", home.player.id),
          );

          const result = await readDashboard(
            createDashboardGateways(home.serviceClient.client),
            { callerId: home.player.id, now: new Date() },
          );

          expect(result.latestNews).toEqual({
            kind: "news",
            posts: [
              {
                id: home.postId,
                category: "announcement",
                title: "Cambio de piscina",
                publishedAt: expect.any(String),
              },
            ],
          });
          expect(result.nextUp).toMatchObject({
            id: home.trainingId,
            myTeam: null,
          });
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
/** El día del club de hace `days` días; negativo, en el futuro. */
function clubDaysAgo(days: number): string {
  return clubCalendarDate(new Date(Date.now() - days * DAY_MS));
}

type PastTraining = {
  readonly daysAgo: number;
  /** La fila de Pía en la hoja, o null si nadie la guardó. */
  readonly sheet: AttendanceStatus | null;
  readonly isCancelled?: boolean;
};

/** Entrenamientos a las 7:00 de días ya pasados, para todo el club. Las
 * filas de las hojas se van con los eventos en cascada. */
function withPastTrainings<T>(
  home: Home,
  clubId: string,
  trainings: readonly PastTraining[],
  run: (eventIds: readonly string[]) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    home.serviceClient,
    "events",
    trainings.map((training) => ({
      club_id: clubId,
      title: `Hace ${training.daysAgo} días`,
      event_type: "training",
      starts_on: clubDaysAgo(training.daysAgo),
      start_time: "07:00",
      location: "MSAC",
      audience: "all",
      author_id: home.player.id,
      status: training.isCancelled === true ? "cancelled" : "scheduled",
      cancelled_at:
        training.isCancelled === true ? new Date().toISOString() : null,
    })),
    async (rows) => {
      const eventIds = rows.map((row) => String(row.id));
      const records = trainings.flatMap((training, index) =>
        training.sheet === null
          ? []
          : [
              {
                event_id: eventIds[index],
                user_id: home.player.id,
                club_id: clubId,
                status: training.sheet,
              },
            ],
      );
      if (records.length > 0) {
        await succeed(
          "guardar las hojas",
          home.serviceClient.client.from("attendance_records").insert(records),
        );
      }
      return run(eventIds);
    },
  );
}

async function updateRow(
  home: Home,
  table: "members" | "clubs",
  changes: Record<string, unknown>,
  match: { readonly column: string; readonly value: string },
): Promise<void> {
  await succeed(
    `cambiar ${table}`,
    home.serviceClient.client
      .from(table)
      .update(changes)
      .eq(match.column, match.value),
  );
}

async function ownSeasonAttendance(home: Home): Promise<unknown> {
  const result = await readDashboard(
    createDashboardGateways(home.serviceClient.client),
    { callerId: home.player.id, now: new Date() },
  );
  return result.me.attendance;
}

describeRls("la columna del inicio en Supabase (#746)", () => {
  it(
    "cuenta la temporada desde la fecha guardada, sin fecha o con fecha futura desde el 1 de enero, y da las últimas sesiones",
    async () => {
      await withHome(async (home) => {
        const clubId = await clubIdOf(home);
        const member = { column: "user_id", value: home.player.id };
        const club = { column: "id", value: clubId };
        await updateRow(
          home,
          "members",
          { joined_on: clubDaysAgo(90) },
          member,
        );
        const trainings: readonly PastTraining[] = [
          { daysAgo: 60, sheet: "present" },
          { daysAgo: 20, sheet: "absent" },
          { daysAgo: 10, sheet: "late" },
          { daysAgo: 5, sheet: null },
        ];
        await withPastTrainings(home, clubId, trainings, async (ids) => {
          const last10 = [
            { eventId: ids[0], startsOn: clubDaysAgo(60), status: "present" },
            { eventId: ids[1], startsOn: clubDaysAgo(20), status: "absent" },
            { eventId: ids[2], startsOn: clubDaysAgo(10), status: "late" },
          ];

          await updateRow(
            home,
            "clubs",
            { season_starts_on: clubDaysAgo(30) },
            club,
          );
          await expect(ownSeasonAttendance(home)).resolves.toEqual({
            percent: 50,
            attended: 1,
            sessions: 2,
            last10,
          });

          const firstOfJanuary = `${clubDaysAgo(0).slice(0, 4)}-01-01`;
          const sinceJanuary = last10.filter(
            ({ startsOn }) => startsOn >= firstOfJanuary,
          );
          for (const seasonStartsOn of [null, clubDaysAgo(-10)]) {
            await updateRow(
              home,
              "clubs",
              { season_starts_on: seasonStartsOn },
              club,
            );
            await expect(ownSeasonAttendance(home)).resolves.toMatchObject({
              sessions: sinceJanuary.length,
              last10,
            });
          }

          await updateRow(
            home,
            "members",
            { joined_on: clubDaysAgo(15) },
            member,
          );
          await updateRow(
            home,
            "clubs",
            { season_starts_on: clubDaysAgo(30) },
            club,
          );
          await expect(ownSeasonAttendance(home)).resolves.toEqual({
            percent: 100,
            attended: 1,
            sessions: 1,
            last10: [last10[2]],
          });
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "da a un Admin los asignados que ya no vienen de un reparto publicado sin quien lo publicó (#838)",
    async () => {
      await withHome(async (home) => {
        const clubId = await clubIdOf(home);
        const { client } = home.serviceClient;
        await updateRow(
          home,
          "members",
          { role: "Admin" },
          { column: "user_id", value: home.player.id },
        );
        await withPublishedSplit(home, clubId, async () => {
          await withPlayer(home.serviceClient, clubId, async (gone) => {
            const { data: split, error } = await client
              .from("team_splits")
              .select("id")
              .eq("event_id", home.trainingId)
              .single();
            expect(error).toBeNull();
            await succeed(
              "poner en el reparto a quien ya no viene",
              client.from("team_split_members").insert({
                split_id: split?.id,
                user_id: gone.id,
                club_id: clubId,
                team: "a",
              }),
            );
            await succeed(
              "responder que no",
              client.from("event_rsvps").insert({
                event_id: home.trainingId,
                club_id: clubId,
                user_id: gone.id,
                response: "no",
              }),
            );

            const result = await readDashboard(
              createDashboardGateways(client),
              { callerId: home.player.id, now: new Date() },
            );

            expect(result).toMatchObject({
              todos: expect.arrayContaining([
                {
                  kind: "teams_dropped",
                  eventId: home.trainingId,
                  title: "Entrenamiento del inicio",
                  count: 1,
                },
              ]),
            });
          });
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "da a un Admin la asistencia por tomar, quién no respondió y los números del club",
    async () => {
      await withHome(async (home) => {
        const clubId = await clubIdOf(home);
        await updateRow(
          home,
          "members",
          { role: "Admin" },
          { column: "user_id", value: home.player.id },
        );
        const trainings: readonly PastTraining[] = [
          { daysAgo: 40, sheet: null },
          { daysAgo: 3, sheet: null },
          { daysAgo: 2, sheet: null, isCancelled: true },
          { daysAgo: 1, sheet: "present" },
        ];
        await withPastTrainings(home, clubId, trainings, async (ids) => {
          const reported: DashboardSource[] = [];
          const result = await readDashboard(
            {
              ...createDashboardGateways(home.serviceClient.client),
              failures: {
                report: (source: DashboardSource) => {
                  reported.push(source);
                },
              },
            },
            { callerId: home.player.id, now: new Date() },
          );

          expect(reported).toEqual([]);
          expect(result).toMatchObject({
            kind: "member",
            column: "management",
            todos: [
              {
                kind: "attendance_missing",
                eventId: ids[1],
                title: "Hace 3 días",
                startsOn: clubDaysAgo(3),
              },
              {
                kind: "no_reply",
                eventId: home.trainingId,
                title: "Entrenamiento del inicio",
                count: 1,
              },
            ],
            club: {
              attendance: { percent: 100, previousPercent: null },
              members: { active: 1, joinedThisMonth: 1 },
              unreadNews: { count: 1, announcements: 1 },
            },
          });
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
