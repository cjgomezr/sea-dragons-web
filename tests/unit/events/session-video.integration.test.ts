import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { setSessionVideo } from "@/lib/events/session-video";
import {
  type SessionVideoGatewaysResult,
  createSupabaseSessionVideoGateways,
} from "@/lib/events/supabase-session-video-gateways";
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
 * El aviso del vídeo de una sesión contra `seadragons-dev` (#966), con los
 * adaptadores de verdad y `0093_event_video_notice.sql` aplicada. Lo que
 * ningún doble dice: que `set_event_video` responde lo que el adaptador
 * espera y que los avisos quedan en `notifications` para la audiencia y no
 * para quien puso el vídeo.
 *
 * Corre en un club propio y desechable: su audiencia "todo el club" son sólo
 * los dos socios del test. Borrarlos se lleva sus avisos.
 */

const VIDEO = "https://youtu.be/abc123";
const OTHER_VIDEO = "https://www.youtube.com/watch?v=xyz789";

type Scene = {
  readonly serviceClient: ServiceRoleClient;
  readonly clubId: string;
  readonly eventId: string;
  readonly coach: TestUser;
  readonly player: TestUser;
};

function withTemporaryClub<T>(
  serviceClient: ServiceRoleClient,
  run: (clubId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `video-${randomUUID()}`, name: "Club del vídeo" }],
    ([club]) => run(String(club?.id)),
  );
}

function withActiveMember<T>(
  serviceClient: ServiceRoleClient,
  seed: { readonly clubId: string; readonly role: Role },
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
          full_name: `Socio ${seed.role}`,
          email: user.email,
          account_status: "active",
          role: seed.role,
        },
      ],
      () => run(user),
    ),
  );
}

function withScene<T>(run: (scene: Scene) => Promise<T>): Promise<T> {
  const serviceClient = createServiceRoleTestClient(process.env);
  return withTemporaryClub(serviceClient, (clubId) =>
    withActiveMember(serviceClient, { clubId, role: "Coach" }, (coach) =>
      withActiveMember(serviceClient, { clubId, role: "Player" }, (player) =>
        withSeededRows(
          serviceClient,
          "events",
          [
            {
              club_id: clubId,
              title: "Entrenamiento con vídeo",
              event_type: "training",
              starts_on: "2026-07-07",
              start_time: "19:00",
              location: "MSAC",
              audience: "all",
              author_id: coach.id,
            },
          ],
          ([event]) =>
            run({
              serviceClient,
              clubId,
              eventId: String(event?.id),
              coach,
              player,
            }),
        ),
      ),
    ),
  );
}

function readyGateways(
  result: SessionVideoGatewaysResult,
): Extract<SessionVideoGatewaysResult, { kind: "ready" }>["gateways"] {
  if (result.kind !== "ready") {
    throw new Error(`Faltan variables: ${result.missingKeys.join(", ")}`);
  }
  return result.gateways;
}

async function noticesOf(
  scene: Scene,
): Promise<readonly { user_id: string; type: string; data: unknown }[]> {
  const { data, error } = await scene.serviceClient.client
    .from("notifications")
    .select("user_id, type, data")
    .eq("club_id", scene.clubId);
  if (error) {
    throw new Error(`No se pudieron leer los avisos: ${error.message}`);
  }
  return data;
}

describeRls("el aviso del vídeo de una sesión contra seadragons-dev", () => {
  it(
    "avisa a la audiencia y no a quien lo puso, y cambiar el enlace no vuelve a avisar",
    async () => {
      const gateways = readyGateways(
        createSupabaseSessionVideoGateways(process.env),
      );

      await withScene(async (scene) => {
        const request = { callerId: scene.coach.id, eventId: scene.eventId };

        await setSessionVideo(gateways, { ...request, url: VIDEO });
        await setSessionVideo(gateways, { ...request, url: OTHER_VIDEO });

        expect(await noticesOf(scene)).toEqual([
          {
            user_id: scene.player.id,
            type: "event_video_added",
            data: {
              eventId: scene.eventId,
              title: "Entrenamiento con vídeo",
              startsOn: "2026-07-07",
              startTime: "19:00",
            },
          },
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
