import {
  type AttendanceGateways,
  type AttendanceStatus,
  type AttendanceTotals,
  countAttendance,
  findAttendanceTaker,
} from "./attendance-sheet";

/**
 * Las sesiones para pasar lista (#393, RF-4 del PRD de E8): los
 * entrenamientos del club ya empezados y no cancelados de los últimos 30
 * días, del más reciente al más antiguo. Uno más viejo se corrige llegando
 * por su id, no desde aquí.
 */

const RECENT_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/** Un entrenamiento de la ventana, con los estados de su hoja: ninguno si
 * nadie la guardó. */
export type RecentTraining = {
  readonly eventId: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly statuses: readonly AttendanceStatus[];
};

export type AttendanceSessionsGateways = Pick<AttendanceGateways, "members"> & {
  readonly sessions: {
    /** Los entrenamientos programados del club que empiezan entre `since` y
     * `until`, ambos incluidos. */
    findRecentTrainings(query: {
      readonly clubId: string;
      readonly since: Date;
      readonly until: Date;
    }): Promise<readonly RecentTraining[]>;
  };
};

export type AttendanceSession = {
  readonly eventId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly hasSheet: boolean;
  readonly totals: AttendanceTotals;
};

export type AttendanceSessions = {
  readonly sessions: readonly AttendanceSession[];
};

export async function listAttendanceSessions(
  gateways: AttendanceSessionsGateways,
  request: { readonly callerId: string; readonly now: Date },
): Promise<AttendanceSessions> {
  const actor = await findAttendanceTaker(gateways, request.callerId);
  const trainings = await gateways.sessions.findRecentTrainings({
    clubId: actor.clubId,
    since: new Date(request.now.getTime() - RECENT_WINDOW_DAYS * DAY_MS),
    until: request.now,
  });
  return {
    sessions: [...trainings]
      .sort((first, second) => +second.startsAt - +first.startsAt)
      .map((training) => ({
        eventId: training.eventId,
        title: training.title,
        startsAt: training.startsAt.toISOString(),
        hasSheet: training.statuses.length > 0,
        totals: countAttendance(training.statuses),
      })),
  };
}
