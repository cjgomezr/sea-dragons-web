import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import {
  type MemberAttendance,
  type MemberAttendanceGateway,
  attendanceOf,
} from "./attendance-stats";
import {
  type SeasonAttendance,
  type SeasonAttendanceGateway,
  readSeasonAttendance,
} from "./season-attendance";

/**
 * El porcentaje y el total de asistencia de quien pregunta (#394, RF-6 del
 * PRD de E8, FR-022): lo que enseña su perfil. Lo lee cualquier cuenta
 * activa, sobre sí misma y en su club (NFR-009).
 */

export type OwnAttendanceGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly attendance: MemberAttendanceGateway;
};

export async function readOwnAttendance(
  gateways: OwnAttendanceGateways,
  userId: string,
): Promise<MemberAttendance> {
  const member = await gateways.members.findRoleRequestMember(userId);
  if (member === null) {
    throw new MemberNotFoundError(userId);
  }
  const attendance = await gateways.attendance.findMemberAttendance(
    member.clubId,
    [userId],
  );
  return attendanceOf(attendance, userId);
}

export type OwnSeasonAttendanceGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly season: SeasonAttendanceGateway;
};

/** La de la temporada con las últimas 10 que enseña el perfil propio (#774,
 * D9 del PRD de E30): el cálculo del inicio (#746), sobre quien pregunta y
 * en su club. Null sin sesiones esta temporada. */
export async function readOwnSeasonAttendance(
  gateways: OwnSeasonAttendanceGateways,
  request: { readonly userId: string; readonly today: string },
): Promise<SeasonAttendance | null> {
  const member = await gateways.members.findRoleRequestMember(request.userId);
  if (member === null) {
    throw new MemberNotFoundError(request.userId);
  }
  return readSeasonAttendance(gateways.season, {
    clubId: member.clubId,
    userId: request.userId,
    today: request.today,
  });
}
