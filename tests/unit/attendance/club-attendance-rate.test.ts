import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { Role } from "@/lib/auth/roles";
import type { ClubAttendanceRate } from "@/lib/attendance/attendance-stats";
import {
  AttendanceForbiddenError,
  type ClubAttendanceRateGateways,
  readClubAttendanceRate,
} from "@/lib/attendance/club-attendance-rate";

/**
 * La tasa de asistencia del club (#394, RF-7 del PRD de E8, para FR-076): la
 * piden Admin y Coach, del club de quien pregunta, sobre los últimos 30 días
 * del calendario del club.
 */

const CALLER_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const TODAY = "2026-10-05";
const RATE: ClubAttendanceRate = { kind: "rate", percent: 75, records: 4 };

type RateRequest = { readonly clubId: string; readonly since: string };

function gatewaysFor(role: Role | null): {
  readonly gateways: ClubAttendanceRateGateways;
  readonly requests: RateRequest[];
} {
  const requests: RateRequest[] = [];
  return {
    requests,
    gateways: {
      members: {
        findRoleRequestMember: async () =>
          role === null
            ? null
            : { clubId: CLUB_ID, fullName: "Carla Coach", role },
      },
      clubRate: {
        findClubAttendanceRate: async (clubId, since) => {
          requests.push({ clubId, since });
          return RATE;
        },
      },
    },
  };
}

describe("la tasa de asistencia del club", () => {
  it.each<Role>(["Admin", "Coach"])(
    "se la da a un %s, del club de quien pregunta y desde hace 30 días",
    async (role) => {
      const { gateways, requests } = gatewaysFor(role);

      const rate = await readClubAttendanceRate(gateways, {
        callerId: CALLER_ID,
        todayInClub: TODAY,
      });

      expect(rate).toEqual(RATE);
      expect(requests).toEqual([{ clubId: CLUB_ID, since: "2026-09-05" }]);
    },
  );

  it.each<Role>(["Committee", "Player"])(
    "se la niega a un %s sin leerla",
    async (role) => {
      const { gateways, requests } = gatewaysFor(role);

      await expect(
        readClubAttendanceRate(gateways, {
          callerId: CALLER_ID,
          todayInClub: TODAY,
        }),
      ).rejects.toBeInstanceOf(AttendanceForbiddenError);
      expect(requests).toEqual([]);
    },
  );

  it("falla con miembro no encontrado si quien pregunta no tiene fila", async () => {
    const { gateways } = gatewaysFor(null);

    await expect(
      readClubAttendanceRate(gateways, {
        callerId: CALLER_ID,
        todayInClub: TODAY,
      }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});
