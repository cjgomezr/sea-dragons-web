import { expect, it } from "vitest";
import { DEFAULT_CLUB_SLUG } from "@/lib/auth/supabase-auth-gateways";
import {
  type NotificationMarker,
  type NotificationReader,
  RECENT_NOTIFICATIONS_LIMIT,
} from "@/lib/notifications/member-notifications";
import { notifyMember } from "@/lib/notifications/notify-member";
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

async function notifyRoleChanged(
  serviceClient: ServiceRoleClient,
  recipientUserId: string,
): Promise<void> {
  const outcome = await notifyMember(
    createSupabaseNotificationWriter(serviceClient.client),
    { recipientUserId, type: "role_changed", data: { newRole: "Coach" } },
  );
  expect(outcome).toEqual({ kind: "saved" });
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
});
