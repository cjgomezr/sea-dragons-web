import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";
import { subtractClubDays } from "@/lib/time/club-calendar";
import {
  CLUB_RATE_WINDOW_DAYS,
  type ClubAttendanceRate,
} from "./attendance-stats";

/**
 * La tasa de asistencia del club (#394, RF-7 del PRD de E8), que servirá la
 * tesela del dashboard de E14 (FR-076): `(present + late) / filas` de los
 * entrenamientos con hoja de los últimos 30 días.
 *
 * La piden Admin y Coach, los que pasan lista. `RESTRICTED_ROUTES` ya reserva
 * el camino, y el dominio lo vuelve a comprobar para no depender de él. El
 * club sale de la fila de quien pregunta, nunca de un parámetro (NFR-009).
 */

export type ClubAttendanceRateGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly clubRate: {
    /** Las filas de los entrenamientos no cancelados desde `since`. */
    findClubAttendanceRate(
      clubId: string,
      since: string,
    ): Promise<ClubAttendanceRate>;
  };
};

export class AttendanceForbiddenError extends Error {
  constructor() {
    super("Sólo un Admin o un Coach pueden ver la asistencia del club.");
    this.name = "AttendanceForbiddenError";
  }
}

export type ClubAttendanceRateRequest = {
  readonly callerId: string;
  /** El día del club (NFR-003) desde el que se cuentan los 30 días. Lo pone
   * quien llama para que este módulo no dependa del reloj. */
  readonly todayInClub: string;
};

export async function readClubAttendanceRate(
  gateways: ClubAttendanceRateGateways,
  request: ClubAttendanceRateRequest,
): Promise<ClubAttendanceRate> {
  const caller = await gateways.members.findRoleRequestMember(request.callerId);
  if (caller === null) {
    throw new MemberNotFoundError(request.callerId);
  }
  if (!hasCapability(caller.role, "buildTeamsAndTrackAttendance")) {
    throw new AttendanceForbiddenError();
  }
  return gateways.clubRate.findClubAttendanceRate(
    caller.clubId,
    subtractClubDays(request.todayInClub, CLUB_RATE_WINDOW_DAYS),
  );
}
