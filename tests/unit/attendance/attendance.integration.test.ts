import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { listAttendanceSessions } from "@/lib/attendance/attendance-sessions";
import {
  type AttendanceRecord,
  openAttendanceSheet,
  saveAttendanceSheet,
} from "@/lib/attendance/attendance-sheet";
import {
  createAttendanceGateways,
  createAttendanceSessionsGateways,
} from "@/lib/attendance/supabase-attendance-gateways";
import type { Role } from "@/lib/auth/roles";
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
 * Pasar lista contra `seadragons-dev` (#393), con los adaptadores de verdad y
 * `0044_save_attendance_sheet.sql` aplicada. Lo que ningún doble dice: que la
 * lectura de la audiencia, de las respuestas y de las filas guardadas casa con
 * el esquema, que la función se llama con lo que espera, y que dos guardados
 * a la vez dejan una hoja entera.
 *
 * Cada caso corre en un club propio y desechable, para que la audiencia
 * "todo el club" sean sólo sus dos miembros.
 */

const AUDIT_LOG_TABLE = "audit_log";
const DAY_MS = 86_400_000;

type Roll = {
  readonly serviceClient: ServiceRoleClient;
  readonly clubId: string;
  readonly eventId: string;
  readonly coach: TestUser;
  readonly player: TestUser;
};

async function deleteAuditEntries(
  serviceClient: ServiceRoleClient,
  clubId: string,
): Promise<void> {
  const { error } = await serviceClient.client
    .from(AUDIT_LOG_TABLE)
    .delete()
    .eq("club_id", clubId);
  if (error) {
    throw new Error(`No se pudo limpiar la bitácora: ${error.message}`);
  }
}

/** La bitácora se borra antes que el club, que no se puede borrar mientras
 * alguna entrada lo nombre. */
async function withTemporaryClub<T>(
  serviceClient: ServiceRoleClient,
  run: (clubId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `asistencia-${randomUUID()}`, name: "Club de asistencia" }],
    async ([club]) => {
      const clubId = String(club?.id);
      try {
        return await run(clubId);
      } finally {
        await deleteAuditEntries(serviceClient, clubId);
      }
    },
  );
}

/** Un socio activo, al día con su membresía salvo que se diga (#453). */
async function withActiveMember<T>(
  serviceClient: ServiceRoleClient,
  seed: {
    readonly clubId: string;
    readonly role: Role;
    readonly name: string;
    readonly isMembershipCurrent?: boolean;
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
          full_name: seed.name,
          email: user.email,
          account_status: "active",
          role: seed.role,
        },
      ],
      async () => {
        if (seed.isMembershipCurrent ?? true) {
          await seedCurrentMembership(serviceClient, {
            clubId: seed.clubId,
            userId: user.id,
          });
        }
        return run(user);
      },
    ),
  );
}

/** Un entrenamiento de ayer para todo el club, que se borra al terminar con
 * su asistencia. */
async function withStartedTraining<T>(
  serviceClient: ServiceRoleClient,
  author: { readonly clubId: string; readonly userId: string },
  run: (eventId: string) => Promise<T>,
): Promise<T> {
  const yesterday = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
  return withSeededRows(
    serviceClient,
    "events",
    [
      {
        club_id: author.clubId,
        title: "Entrenamiento para pasar lista",
        event_type: "training",
        starts_on: yesterday,
        start_time: "19:00",
        location: "MSAC",
        audience: "all",
        author_id: author.userId,
      },
    ],
    ([event]) => run(String(event?.id)),
  );
}

async function withRoll(run: (roll: Roll) => Promise<void>): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  await withTemporaryClub(serviceClient, (clubId) =>
    withActiveMember(
      serviceClient,
      { clubId, role: "Coach", name: "Carla Coach" },
      (coach) =>
        withActiveMember(
          serviceClient,
          { clubId, role: "Player", name: "Pía Player" },
          (player) =>
            withStartedTraining(
              serviceClient,
              { clubId, userId: coach.id },
              (eventId) =>
                run({ serviceClient, clubId, eventId, coach, player }),
            ),
        ),
    ),
  );
}

function save(roll: Roll, records: readonly AttendanceRecord[]) {
  return saveAttendanceSheet(
    createAttendanceGateways(roll.serviceClient.client),
    {
      callerId: roll.coach.id,
      eventId: roll.eventId,
      records,
      now: new Date(),
    },
  );
}

describeRls("la hoja de asistencia en Supabase", () => {
  it(
    "un Coach abre la hoja, la guarda y la ve en las sesiones recientes",
    async () => {
      await withRoll(async (roll) => {
        const gateways = createAttendanceGateways(roll.serviceClient.client);
        const request = {
          callerId: roll.coach.id,
          eventId: roll.eventId,
          now: new Date(),
        };

        const fresh = await openAttendanceSheet(gateways, request);
        expect(fresh.isSaved).toBe(false);
        expect(
          fresh.members.map((entry) => [entry.fullName, entry.status]),
        ).toEqual([
          ["Carla Coach", "absent"],
          ["Pía Player", "absent"],
        ]);

        await expect(
          save(roll, [
            { userId: roll.coach.id, status: "present" },
            { userId: roll.player.id, status: "late" },
          ]),
        ).resolves.toEqual({
          eventId: roll.eventId,
          totals: { present: 1, late: 1, absent: 0 },
        });

        const saved = await openAttendanceSheet(gateways, request);
        expect(saved.isSaved).toBe(true);
        expect(saved.members.map((entry) => entry.status)).toEqual([
          "present",
          "late",
        ]);

        const { sessions } = await listAttendanceSessions(
          createAttendanceSessionsGateways(roll.serviceClient.client),
          { callerId: roll.coach.id, now: new Date() },
        );
        expect(sessions).toEqual([
          expect.objectContaining({
            eventId: roll.eventId,
            hasSheet: true,
            totals: { present: 1, late: 1, absent: 0 },
          }),
        ]);

        const { data, error } = await roll.serviceClient.client
          .from(AUDIT_LOG_TABLE)
          .select("actor_id, action, entity_type, entity_id, metadata")
          .eq("club_id", roll.clubId);
        expect(error).toBeNull();
        expect(data).toEqual([
          {
            actor_id: roll.coach.id,
            action: "attendance.saved",
            entity_type: "event",
            entity_id: roll.eventId,
            metadata: null,
          },
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "dos guardados a la vez dejan una de las dos hojas, entera",
    async () => {
      await withRoll(async (roll) => {
        const first: readonly AttendanceRecord[] = [
          { userId: roll.coach.id, status: "absent" },
          { userId: roll.player.id, status: "absent" },
        ];
        const second: readonly AttendanceRecord[] = [
          { userId: roll.player.id, status: "late" },
        ];

        await Promise.all([save(roll, first), save(roll, second)]);

        const { data, error } = await roll.serviceClient.client
          .from("attendance_records")
          .select("user_id, status")
          .eq("event_id", roll.eventId)
          .order("user_id");
        if (error) {
          throw new Error(`No se pudo leer la hoja: ${error.message}`);
        }
        const stored = data.map((row) => ({
          userId: String(row.user_id),
          status: String(row.status),
        }));
        const sorted = (records: readonly AttendanceRecord[]) =>
          [...records].sort((a, b) => a.userId.localeCompare(b.userId));
        expect([sorted(first), sorted(second)]).toContainEqual(stored);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "deja fuera de la hoja nueva a quien no tiene la membresía al día (#453)",
    async () => {
      await withRoll(async (roll) => {
        await withActiveMember(
          roll.serviceClient,
          {
            clubId: roll.clubId,
            role: "Player",
            name: "Nico Sin Pagar",
            isMembershipCurrent: false,
          },
          async () => {
            const sheet = await openAttendanceSheet(
              createAttendanceGateways(roll.serviceClient.client),
              {
                callerId: roll.coach.id,
                eventId: roll.eventId,
                now: new Date(),
              },
            );

            expect(sheet.members.map((entry) => entry.fullName)).toEqual([
              "Carla Coach",
              "Pía Player",
            ]);
          },
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
