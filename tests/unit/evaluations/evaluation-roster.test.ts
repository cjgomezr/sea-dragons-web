import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { EvaluationForbiddenError } from "@/lib/evaluations/member-evaluation";
import {
  type EvaluationRosterGateways,
  type RosterMemberRecord,
  listEvaluationRoster,
} from "@/lib/evaluations/evaluation-roster";

/**
 * La lista de la pantalla de Evaluaciones (#322, RF-6 del PRD de E9): los
 * miembros del club con su OVR, y quién está sin evaluar. Contada sin
 * Supabase delante.
 */

const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const COACH_ID = "c0c0c0c0-0000-4000-8000-00000000000c";

const ZOE: RosterMemberRecord = {
  userId: "dddddddd-0000-4000-8000-00000000000d",
  fullName: "Zoe Zapata",
  status: "active",
  ratings: [8, 9],
};

const ALBA: RosterMemberRecord = {
  userId: "aaaaaaaa-0000-4000-8000-00000000000a",
  fullName: "Álvaro Alba",
  status: "incomplete",
  ratings: null,
};

const MARIA: RosterMemberRecord = {
  userId: "bbbbbbbb-0000-4000-8000-00000000000b",
  fullName: "maría Ruiz",
  status: "active",
  ratings: [],
};

const RETIRED: RosterMemberRecord = {
  userId: "eeeeeeee-0000-4000-8000-00000000000e",
  fullName: "Beto Baja",
  status: "inactive",
  ratings: [7],
};

function fakeGateways(
  role: Role,
  records: readonly RosterMemberRecord[],
): EvaluationRosterGateways & { readonly askedClubs: string[] } {
  const askedClubs: string[] = [];
  return {
    askedClubs,
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Carla Coach",
        role,
      }),
    },
    roster: {
      findRosterMembers: async (clubId) => {
        askedClubs.push(clubId);
        return records;
      },
    },
  };
}

describe("lista de evaluaciones", () => {
  it("devuelve a cada miembro con su OVR y marca a quien no tiene evaluación", async () => {
    const gateways = fakeGateways("Coach", [ZOE, ALBA]);

    const roster = await listEvaluationRoster(gateways, COACH_ID);

    expect(roster.members).toEqual([
      { status: "not_evaluated", userId: ALBA.userId, fullName: ALBA.fullName },
      {
        status: "evaluated",
        userId: ZOE.userId,
        fullName: ZOE.fullName,
        overallRating: 8.5,
      },
    ]);
  });

  it("ordena por nombre sin distinguir mayúsculas ni acentos", async () => {
    const gateways = fakeGateways("Admin", [ZOE, MARIA, ALBA]);

    const roster = await listEvaluationRoster(gateways, COACH_ID);

    expect(roster.members.map((member) => member.fullName)).toEqual([
      "Álvaro Alba",
      "maría Ruiz",
      "Zoe Zapata",
    ]);
  });

  it("da un OVR nulo a una evaluación sin categorías, en vez de un cero", async () => {
    const gateways = fakeGateways("Coach", [MARIA]);

    const roster = await listEvaluationRoster(gateways, COACH_ID);

    expect(roster.members).toEqual([
      expect.objectContaining({ status: "evaluated", overallRating: null }),
    ]);
  });

  it("deja fuera a los dados de baja, que no se pueden evaluar", async () => {
    const gateways = fakeGateways("Coach", [ZOE, RETIRED]);

    const roster = await listEvaluationRoster(gateways, COACH_ID);

    expect(roster.members.map((member) => member.userId)).toEqual([ZOE.userId]);
  });

  it("lee sólo el club de quien pregunta", async () => {
    const gateways = fakeGateways("Coach", []);

    const roster = await listEvaluationRoster(gateways, COACH_ID);

    expect(roster.members).toEqual([]);
    expect(gateways.askedClubs).toEqual([CLUB_ID]);
  });

  it.each<Role>(["Player", "Committee"])(
    "niega la lista a un %s sin leer a nadie",
    async (role) => {
      const gateways = fakeGateways(role, [ZOE]);

      await expect(
        listEvaluationRoster(gateways, COACH_ID),
      ).rejects.toBeInstanceOf(EvaluationForbiddenError);
      expect(gateways.askedClubs).toEqual([]);
    },
  );
});
