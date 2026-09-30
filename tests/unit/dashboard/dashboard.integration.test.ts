import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { type DashboardSource, readDashboard } from "@/lib/dashboard/dashboard";
import { createDashboardGateways } from "@/lib/dashboard/supabase-dashboard-gateways";
import { markNewsSeen } from "@/lib/news/news-seen";
import { createNewsSeenGateway } from "@/lib/news/supabase-news-seen-gateway";
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
      () => run(user),
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
    "junta las cuatro teselas, el entrenamiento, la noticia y la marca de visita",
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
        expect(fresh.tiles).toEqual({
          attendance: {
            kind: "own_attendance",
            attendance: { kind: "no_data" },
          },
          members: { kind: "members", active: 1, joinedRecently: 1 },
          nextTraining: {
            kind: "training",
            training: expect.objectContaining({
              id: home.trainingId,
              title: "Entrenamiento del inicio",
              startTime: "19:00",
              location: "MSAC",
              myResponse: null,
            }),
          },
          unreadNews: { kind: "unread", count: 1, announcements: 1 },
        });
        expect(fresh.upcomingEvents).toEqual({
          kind: "events",
          events: [expect.objectContaining({ id: home.trainingId })],
        });
        expect(fresh.latestNews).toEqual({
          kind: "news",
          posts: [
            expect.objectContaining({
              id: home.postId,
              category: "announcement",
              title: "Cambio de piscina",
            }),
          ],
        });

        await markNewsSeen(createNewsSeenGateway(home.serviceClient.client), {
          userId: home.player.id,
          now: new Date(),
        });
        const afterVisit = await readDashboard(gateways, request);

        expect(afterVisit.tiles.unreadNews).toEqual({
          kind: "unread",
          count: 0,
          announcements: 0,
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
