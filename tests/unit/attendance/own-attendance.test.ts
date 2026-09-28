import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { MemberAttendance } from "@/lib/attendance/attendance-stats";
import {
  type OwnAttendanceGateways,
  readOwnAttendance,
} from "@/lib/attendance/own-attendance";

/**
 * La asistencia propia (#394, RF-6 del PRD de E8, FR-022): el porcentaje y
 * el total de quien pregunta, contados en su club.
 */

const USER_ID = "4e4e4e4e-0000-4000-8000-000000000001";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

type AttendanceRequest = {
  readonly clubId: string;
  readonly userIds: readonly string[];
};

function gatewaysWith(
  attendance: MemberAttendance,
  options: { readonly member?: null } = {},
): {
  readonly gateways: OwnAttendanceGateways;
  readonly requests: AttendanceRequest[];
} {
  const requests: AttendanceRequest[] = [];
  return {
    requests,
    gateways: {
      members: {
        findRoleRequestMember: async () =>
          options.member === null
            ? null
            : { clubId: CLUB_ID, fullName: "Pía Player", role: "Player" },
      },
      attendance: {
        findMemberAttendance: async (clubId, userIds) => {
          requests.push({ clubId, userIds });
          return new Map(userIds.map((userId) => [userId, attendance]));
        },
      },
    },
  };
}

describe("la asistencia propia", () => {
  it("trae el porcentaje y el total de quien pregunta, en su club", async () => {
    const { gateways, requests } = gatewaysWith({
      kind: "rate",
      percent: 90,
      sessions: 9,
    });

    const attendance = await readOwnAttendance(gateways, USER_ID);

    expect(attendance).toEqual({ kind: "rate", percent: 90, sessions: 9 });
    expect(requests).toEqual([{ clubId: CLUB_ID, userIds: [USER_ID] }]);
  });

  it("dice sin datos a quien no tiene sesiones elegibles (AC-017b)", async () => {
    const { gateways } = gatewaysWith({ kind: "no_data" });

    await expect(readOwnAttendance(gateways, USER_ID)).resolves.toEqual({
      kind: "no_data",
    });
  });

  it("falla con miembro no encontrado sin fila de socio", async () => {
    const { gateways, requests } = gatewaysWith(
      { kind: "no_data" },
      { member: null },
    );

    await expect(readOwnAttendance(gateways, USER_ID)).rejects.toBeInstanceOf(
      MemberNotFoundError,
    );
    expect(requests).toEqual([]);
  });
});
