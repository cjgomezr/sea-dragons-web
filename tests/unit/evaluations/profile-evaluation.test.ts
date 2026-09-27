import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import type {
  MemberEvaluationGateways,
  StoredEvaluation,
} from "@/lib/evaluations/member-evaluation";
import { readProfileEvaluation } from "@/lib/evaluations/profile-evaluation";

/**
 * Lo que el perfil de un miembro enseña de su evaluación (#324, RF-5 del PRD
 * de E9). Un Player o un Committee no ven ninguna nota, ni las suyas
 * (FR-055, AC-023), y en su lugar el perfil explica por qué (FR-056). Un
 * Coach o un Admin sí la ven.
 */

const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const CALLER_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const READ_AT = "2026-09-27T01:02:03.123456+00:00";

const STORED: StoredEvaluation = {
  updatedAt: READ_AT,
  ratings: [
    {
      categoryId: "ca7e0000-0000-4000-8000-000000000001",
      name: "Fitness",
      rating: 8,
      isRetired: false,
    },
    {
      categoryId: "ca7e0000-0000-4000-8000-000000000002",
      name: "Speed",
      rating: 7,
      isRetired: false,
    },
  ],
};

type Fake = {
  readonly gateways: MemberEvaluationGateways;
  readonly evaluationsRead: string[];
};

function unexpectedWrite(): never {
  throw new Error("Leer el perfil no escribe ninguna evaluación.");
}

function fakeGateways(
  role: Role,
  stored: StoredEvaluation | null = STORED,
): Fake {
  const evaluationsRead: string[] = [];
  return {
    evaluationsRead,
    gateways: {
      members: {
        findRoleRequestMember: async () => ({
          clubId: CLUB_ID,
          fullName: "Quien mira",
          role,
        }),
      },
      evaluations: {
        findMemberStatus: async () => "active",
        findEvaluation: async (scope) => {
          evaluationsRead.push(scope.userId);
          return stored;
        },
        createEvaluation: unexpectedWrite,
        saveRatings: unexpectedWrite,
        refreshEvaluation: unexpectedWrite,
      },
      audit: { insertAuditLogRow: unexpectedWrite },
    },
  };
}

describe("notas privadas", () => {
  it.each<Role>(["Player", "Committee"])(
    "a un %s en su propio perfil no le da ninguna nota, sólo el aviso",
    async (role) => {
      const { gateways } = fakeGateways(role);

      const evaluation = await readProfileEvaluation(gateways, {
        callerId: CALLER_ID,
        memberId: CALLER_ID,
      });

      expect(evaluation).toEqual({ visibility: "staff_only" });
    },
  );

  it.each<Role>(["Player", "Committee"])(
    "a un %s ni siquiera se le lee la evaluación",
    async (role) => {
      const fake = fakeGateways(role);

      await readProfileEvaluation(fake.gateways, {
        callerId: CALLER_ID,
        memberId: CALLER_ID,
      });

      expect(fake.evaluationsRead).toEqual([]);
    },
  );

  it.each<Role>(["Coach", "Admin"])(
    "a un %s le da el OVR y las categorías",
    async (role) => {
      const { gateways } = fakeGateways(role);

      const evaluation = await readProfileEvaluation(gateways, {
        callerId: CALLER_ID,
        memberId: CALLER_ID,
      });

      expect(evaluation).toEqual({
        visibility: "visible",
        evaluation: {
          status: "evaluated",
          memberId: CALLER_ID,
          updatedAt: READ_AT,
          overallRating: 7.5,
          ratings: STORED.ratings,
        },
      });
    },
  );

  it("a un Coach sin evaluación le dice que no la tiene, sin inventar un OVR", async () => {
    const { gateways } = fakeGateways("Coach", null);

    const evaluation = await readProfileEvaluation(gateways, {
      callerId: CALLER_ID,
      memberId: CALLER_ID,
    });

    expect(evaluation).toEqual({
      visibility: "visible",
      evaluation: { status: "not_evaluated", memberId: CALLER_ID },
    });
  });
});
