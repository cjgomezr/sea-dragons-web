import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import {
  type MemberAttendance,
  type MemberAttendanceGateway,
  attendanceOf,
} from "./attendance-stats";

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
