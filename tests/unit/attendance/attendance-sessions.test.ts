import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  type AttendanceSessionsGateways,
  type RecentTraining,
  listAttendanceSessions,
} from "@/lib/attendance/attendance-sessions";
import { AttendanceForbiddenError } from "@/lib/attendance/attendance-sheet";
import type { EventType } from "@/lib/events/event-creation";

/**
 * Las sesiones para pasar lista (#393, RF-4 del PRD de E8). El doble cumple
 * el contrato del adaptador: de todos los eventos del club, sólo los
 * entrenamientos programados que empiezan dentro de la ventana que se le
 * pide.
 */

const CALLER_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const DAY_MS = 86_400_000;
const NOW = new Date("2027-06-15T10:00:00Z");

type StoredEvent = RecentTraining & {
  readonly eventType: EventType;
  readonly status: "scheduled" | "cancelled";
};

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function storedEvent(
  id: string,
  startsAt: Date,
  change: Partial<StoredEvent> = {},
): StoredEvent {
  return {
    eventId: id,
    title: `Sesión ${id}`,
    startsAt,
    statuses: [],
    eventType: "training",
    status: "scheduled",
    ...change,
  };
}

function gatewaysFor(
  events: readonly StoredEvent[],
  callerRole: Role = "Coach",
): AttendanceSessionsGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Carla Coach",
        role: callerRole,
      }),
    },
    sessions: {
      findRecentTrainings: async ({ since, until }) =>
        events
          .filter(
            (event) =>
              event.eventType === "training" &&
              event.status === "scheduled" &&
              event.startsAt >= since &&
              event.startsAt <= until,
          )
          .map(({ eventId, title, startsAt, statuses }) => ({
            eventId,
            title,
            startsAt,
            statuses,
          })),
    },
  };
}

async function listIds(events: readonly StoredEvent[]): Promise<string[]> {
  const { sessions } = await listAttendanceSessions(gatewaysFor(events), {
    callerId: CALLER_ID,
    now: NOW,
  });
  return sessions.map((session) => session.eventId);
}

describe("las sesiones recientes", () => {
  it("lista solo los entrenamientos ya empezados y no cancelados", async () => {
    const ids = await listIds([
      storedEvent("pasado", daysBefore(1)),
      storedEvent("futuro", new Date(NOW.getTime() + 60_000)),
      storedEvent("cancelado", daysBefore(2), { status: "cancelled" }),
      storedEvent("social", daysBefore(3), { eventType: "social" }),
    ]);

    expect(ids).toEqual(["pasado"]);
  });

  it("incluye los de hace 30 días y deja fuera los anteriores", async () => {
    const ids = await listIds([
      storedEvent("limite", daysBefore(30)),
      storedEvent("viejo", new Date(daysBefore(30).getTime() - 1)),
    ]);

    expect(ids).toEqual(["limite"]);
  });

  it("ordena del más reciente al más antiguo", async () => {
    const ids = await listIds([
      storedEvent("hace-10", daysBefore(10)),
      storedEvent("hoy", NOW),
      storedEvent("hace-3", daysBefore(3)),
    ]);

    expect(ids).toEqual(["hoy", "hace-3", "hace-10"]);
  });

  it("dice si cada sesión tiene hoja guardada y cuenta sus estados", async () => {
    const { sessions } = await listAttendanceSessions(
      gatewaysFor([
        storedEvent("guardada", daysBefore(1), {
          statuses: ["present", "late", "present", "absent"],
        }),
        storedEvent("sin-hoja", daysBefore(2)),
      ]),
      { callerId: CALLER_ID, now: NOW },
    );

    expect(sessions).toEqual([
      {
        eventId: "guardada",
        title: "Sesión guardada",
        startsAt: daysBefore(1).toISOString(),
        hasSheet: true,
        totals: { present: 2, late: 1, absent: 1 },
      },
      {
        eventId: "sin-hoja",
        title: "Sesión sin-hoja",
        startsAt: daysBefore(2).toISOString(),
        hasSheet: false,
        totals: { present: 0, late: 0, absent: 0 },
      },
    ]);
  });

  it.each<Role>(["Committee", "Player"])(
    "niega las sesiones a un %s",
    async (role) => {
      await expect(
        listAttendanceSessions(gatewaysFor([], role), {
          callerId: CALLER_ID,
          now: NOW,
        }),
      ).rejects.toBeInstanceOf(AttendanceForbiddenError);
    },
  );
});
