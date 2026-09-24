import { expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_CLUB_SLUG } from "@/lib/auth/supabase-auth-gateways";
import {
  type NotificationMarker,
  type NotificationReader,
  RECENT_NOTIFICATIONS_LIMIT,
} from "@/lib/notifications/member-notifications";
import {
  type NotificationWriter,
  notifyMember,
} from "@/lib/notifications/notify-member";
import {
  createNotificationMarker,
  createSupabaseNotificationReader,
  createSupabaseNotificationWriter,
} from "@/lib/notifications/supabase-notification-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createRlsClient,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * Los avisos contra `seadragons-dev` (#265): se crean por la puerta única con
 * la llave de servicio, se leen con la sesión del socio y se marcan con la
 * llave de servicio filtrando por él. Lo que ningún doble puede afirmar: que
 * otro socio no los ve ni los marca, y que el conteo cuadra con la base.
 */

type SeededMembers = {
  readonly member: TestUser;
  readonly otherMember: TestUser;
  readonly clubId: string;
};

async function readClubId(serviceClient: ServiceRoleClient): Promise<string> {
  const { data, error } = await serviceClient.client
    .from("clubs")
    .select("id")
    .eq("slug", DEFAULT_CLUB_SLUG)
    .single();
  if (error || !data) {
    throw new Error(
      `No se pudo leer el club sembrado: ${error?.message ?? "sin datos"}`,
    );
  }
  return data.id as string;
}

function memberRow(
  clubId: string,
  user: TestUser,
  accountStatus: "active" | "inactive",
): Record<string, unknown> {
  return {
    club_id: clubId,
    user_id: user.id,
    full_name: "Socio con avisos",
    email: user.email,
    account_status: accountStatus,
  };
}

/** Dos socios activos del club. Borrarlos se lleva sus avisos. */
async function withTwoMembers<T>(
  serviceClient: ServiceRoleClient,
  run: (seeded: SeededMembers) => Promise<T>,
): Promise<T> {
  const clubId = await readClubId(serviceClient);
  return withTestUser(serviceClient, (member) =>
    withTestUser(serviceClient, (otherMember) =>
      withSeededRows(
        serviceClient,
        "members",
        [
          memberRow(clubId, member, "active"),
          memberRow(clubId, otherMember, "active"),
        ],
        () => run({ member, otherMember, clubId }),
      ),
    ),
  );
}

async function readerFor(user: TestUser): Promise<NotificationReader> {
  const session = await createRlsClient(
    { role: "authenticated", email: user.email, password: user.password },
    process.env,
  );
  return createSupabaseNotificationReader(session.client);
}

function markerFor(serviceClient: ServiceRoleClient): NotificationMarker {
  return createNotificationMarker(serviceClient.client);
}

type WriterWithDeferredWork = {
  readonly writer: NotificationWriter;
  /** Corre lo que `after` habría dejado para después de responder. */
  readonly runDeferredWork: () => Promise<void>;
};

/** Fuera de una petición de Next.js no hay `after`: el trabajo se guarda y el
 * test lo corre cuando quiere verlo terminado. */
function writerWithDeferredWork(
  serviceClient: ServiceRoleClient,
): WriterWithDeferredWork {
  const deferred: (() => Promise<void>)[] = [];
  return {
    writer: createSupabaseNotificationWriter(serviceClient.client, (work) => {
      deferred.push(work);
    }),
    async runDeferredWork() {
      for (const work of deferred.splice(0)) {
        await work();
      }
    },
  };
}

async function notifyRoleChanged(
  serviceClient: ServiceRoleClient,
  recipientUserId: string,
): Promise<void> {
  const { writer, runDeferredWork } = writerWithDeferredWork(serviceClient);
  const outcome = await notifyMember(writer, {
    recipientUserId,
    type: "role_changed",
    data: { newRole: "Coach" },
  });
  expect(outcome).toEqual({ kind: "saved" });
  await runDeferredWork();
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Pasado el plazo de 90 días de `0023_prune_notifications.sql`. */
const EXPIRED_AGE_DAYS = 100;
const RECENT_AGE_DAYS = 1;

type SeededNotification = {
  readonly clubId: string;
  readonly userId: string;
  readonly ageDays: number;
  readonly isRead: boolean;
};

async function seedNotifications(
  serviceClient: ServiceRoleClient,
  notifications: readonly SeededNotification[],
): Promise<void> {
  const now = Date.now();
  const rows = notifications.map((notification) => {
    const createdAt = new Date(now - notification.ageDays * DAY_MS);
    return {
      club_id: notification.clubId,
      user_id: notification.userId,
      type: "role_changed",
      data: { newRole: "Coach", ageDays: notification.ageDays },
      created_at: createdAt.toISOString(),
      read_at: notification.isRead ? createdAt.toISOString() : null,
    };
  });
  const { error } = await serviceClient.client
    .from("notifications")
    .insert(rows);
  if (error) {
    throw new Error(`No se pudieron sembrar avisos: ${error.message}`);
  }
}

/** Los avisos sembrados llevan su edad en los datos; el nuevo, no. */
const seededDataSchema = z.object({ ageDays: z.number().optional() });

async function readAgesOf(
  serviceClient: ServiceRoleClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await serviceClient.client
    .from("notifications")
    .select("read_at, data")
    .eq("user_id", userId)
    .order("created_at");
  if (error) {
    throw new Error(`No se pudieron leer los avisos: ${error.message}`);
  }
  return data.map((row) => {
    const age = seededDataSchema.parse(row.data).ageDays;
    const state = row.read_at === null ? "sin leer" : "leído";
    return age === undefined ? `nuevo ${state}` : `${age}d ${state}`;
  });
}

async function readReadAt(
  serviceClient: ServiceRoleClient,
  notificationId: string,
): Promise<string | null> {
  const { data, error } = await serviceClient.client
    .from("notifications")
    .select("read_at")
    .eq("id", notificationId)
    .single();
  if (error) {
    throw new Error(`No se pudo leer el aviso: ${error.message}`);
  }
  return data.read_at as string | null;
}

describeRls("avisos contra seadragons-dev", () => {
  it(
    "crea avisos, los cuenta, los marca y otro socio no los ve",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withTwoMembers(serviceClient, async ({ member, otherMember }) => {
        await notifyRoleChanged(serviceClient, member.id);
        await notifyRoleChanged(serviceClient, member.id);
        const reader = await readerFor(member);
        const otherReader = await readerFor(otherMember);
        const marker = markerFor(serviceClient);

        expect(await reader.countUnread(member.id)).toBe(2);
        expect(await otherReader.countUnread(otherMember.id)).toBe(0);
        expect(
          await otherReader.listRecent(member.id, RECENT_NOTIFICATIONS_LIMIT),
        ).toEqual([]);

        const [first] = await reader.listRecent(
          member.id,
          RECENT_NOTIFICATIONS_LIMIT,
        );
        if (first === undefined) {
          throw new Error("el socio no ve el aviso que se le acaba de crear");
        }
        expect(first).toMatchObject({
          type: "role_changed",
          data: { newRole: "Coach" },
          isRead: false,
        });

        await expect(
          marker.markRead({
            userId: otherMember.id,
            notificationId: first.id,
          }),
        ).resolves.toBe("not_found");
        expect(await reader.countUnread(member.id)).toBe(2);

        await expect(
          marker.markRead({ userId: member.id, notificationId: first.id }),
        ).resolves.toBe("marked");
        expect(await reader.countUnread(member.id)).toBe(1);

        const firstReadAt = await readReadAt(serviceClient, first.id);
        await expect(
          marker.markRead({ userId: member.id, notificationId: first.id }),
        ).resolves.toBe("already_read");
        expect(await readReadAt(serviceClient, first.id)).toBe(firstReadAt);

        await marker.markAllRead(member.id);
        expect(await reader.countUnread(member.id)).toBe(0);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "lista sólo los 50 más recientes, de más nuevo a más viejo",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withTwoMembers(serviceClient, async ({ member, clubId }) => {
        const total = RECENT_NOTIFICATIONS_LIMIT + 1;
        const rows = Array.from({ length: total }, (_, index) => ({
          club_id: clubId,
          user_id: member.id,
          type: "role_changed",
          data: { newRole: "Coach" },
          created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        }));
        const { error } = await serviceClient.client
          .from("notifications")
          .insert(rows);
        if (error) {
          throw new Error(`No se pudieron sembrar avisos: ${error.message}`);
        }
        const reader = await readerFor(member);

        const listed = await reader.listRecent(
          member.id,
          RECENT_NOTIFICATIONS_LIMIT,
        );

        expect(listed).toHaveLength(RECENT_NOTIFICATIONS_LIMIT);
        // Postgres devuelve los instantes con su propio formato: se comparan
        // como instantes, no como texto.
        const instants = listed.map((notification) =>
          Date.parse(notification.createdAt),
        );
        const newestFirst = rows
          .map((row) => Date.parse(row.created_at))
          .reverse()
          .slice(0, RECENT_NOTIFICATIONS_LIMIT);
        expect(instants).toEqual(newestFirst);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "no guarda nada para un socio dado de baja",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await readClubId(serviceClient);

      await withTestUser(serviceClient, (member) =>
        withSeededRows(
          serviceClient,
          "members",
          [memberRow(clubId, member, "inactive")],
          async () => {
            const outcome = await notifyMember(
              createSupabaseNotificationWriter(serviceClient.client),
              {
                recipientUserId: member.id,
                type: "role_changed",
                data: { newRole: "Coach" },
              },
            );

            expect(outcome).toEqual({ kind: "recipient_ineligible" });
            const { count, error } = await serviceClient.client
              .from("notifications")
              .select("id", { count: "exact", head: true })
              .eq("user_id", member.id);
            expect(error).toBeNull();
            expect(count).toBe(0);
          },
        ),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "al crear un aviso borra los leídos caducados de ese socio y de nadie más",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withTwoMembers(
        serviceClient,
        async ({ member, otherMember, clubId }) => {
          await seedNotifications(serviceClient, [
            { clubId, userId: member.id, ageDays: 110, isRead: true },
            { clubId, userId: member.id, ageDays: 105, isRead: false },
            {
              clubId,
              userId: member.id,
              ageDays: EXPIRED_AGE_DAYS,
              isRead: true,
            },
            {
              clubId,
              userId: member.id,
              ageDays: RECENT_AGE_DAYS,
              isRead: true,
            },
            {
              clubId,
              userId: otherMember.id,
              ageDays: EXPIRED_AGE_DAYS,
              isRead: true,
            },
          ]);

          await notifyRoleChanged(serviceClient, member.id);

          expect(await readAgesOf(serviceClient, member.id)).toEqual([
            "105d sin leer",
            "1d leído",
            "nuevo sin leer",
          ]);
          expect(await readAgesOf(serviceClient, otherMember.id)).toEqual([
            "100d leído",
          ]);
        },
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
