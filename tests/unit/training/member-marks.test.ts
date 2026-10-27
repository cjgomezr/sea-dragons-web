import { beforeEach, describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { Role } from "@/lib/auth/roles";
import type { MembershipStatus } from "@/lib/membership/membership";
import {
  type ClubMarkRecord,
  MemberMarkNotFoundError,
  type MemberMarksGateways,
  TrainingAccessBlockedError,
  clearMemberMark,
  isValidMarkValue,
  readMemberMarks,
  saveMemberMark,
} from "@/lib/training/member-marks";

/**
 * Las marcas de cada socio (#899, RF-5 y D11 del PRD de E35): las lee y las
 * escribe sólo su dueño, con la misma puerta de estar al día que el plan.
 */

const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-27T00:00:00Z");

const SQUAT: ClubMarkRecord = { id: "mark-squat", name: "Back squat 1RM" };
const DEADLIFT: ClubMarkRecord = { id: "mark-deadlift", name: "Deadlift 1RM" };

type StoredValue = {
  readonly userId: string;
  readonly clubId: string;
  readonly markId: string;
  readonly value: number;
};

let role: Role;
let membershipStatus: MembershipStatus;
let hasMember: boolean;
let stored: StoredValue[];

function memberMarksGateways(): MemberMarksGateways {
  return {
    members: {
      findRoleRequestMember: async () =>
        hasMember ? { clubId: CLUB_ID, fullName: "Alba Ferrer", role } : null,
    },
    membership: {
      findByUserId: async () => ({
        userId: USER_ID,
        clubId: CLUB_ID,
        plan: "Full",
        status: membershipStatus,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        currentPeriodEnd: null,
        trialEnd: null,
        card: null,
        waiver: null,
        scheduledChange: null,
      }),
    },
    marks: {
      listClubMarks: async (clubId) =>
        clubId === CLUB_ID ? [SQUAT, DEADLIFT] : [],
      listMemberValues: async (member) =>
        stored
          .filter(
            (entry) =>
              entry.userId === member.userId && entry.clubId === member.clubId,
          )
          .map(({ markId, value }) => ({ markId, value })),
      saveValue: async (entry) => {
        stored = [
          ...stored.filter(
            (row) =>
              !(row.userId === entry.userId && row.markId === entry.markId),
          ),
          entry,
        ];
      },
      clearValue: async (entry) => {
        stored = stored.filter(
          (row) =>
            !(row.userId === entry.userId && row.markId === entry.markId),
        );
      },
    },
  };
}

const caller = { callerId: USER_ID, now: NOW };

beforeEach(() => {
  role = "Player";
  membershipStatus = "active";
  hasMember = true;
  stored = [];
});

describe("isValidMarkValue", () => {
  it.each([0.5, 1, 82.5, 500])("acepta %s", (value) => {
    expect(isValidMarkValue(value)).toBe(true);
  });

  it.each([
    ["cero", 0],
    ["un negativo", -10],
    ["más de 500", 500.1],
    ["dos decimales", 82.55],
    ["un texto con número", "80"],
    ["vacío", undefined],
    ["nulo", null],
    ["un texto vacío", ""],
    ["infinito", Number.POSITIVE_INFINITY],
    ["NaN", Number.NaN],
  ])("rechaza %s", (_label, value) => {
    expect(isValidMarkValue(value)).toBe(false);
  });

  it("acepta un decimal que el punto flotante no representa exacto", () => {
    expect(isValidMarkValue(1.1)).toBe(true);
  });
});

describe("readMemberMarks", () => {
  it("devuelve las marcas del club en su orden, sin valor las que no tiene", async () => {
    stored = [
      { userId: USER_ID, clubId: CLUB_ID, markId: DEADLIFT.id, value: 120 },
    ];

    const marks = await readMemberMarks(memberMarksGateways(), caller);

    expect(marks).toEqual({
      marks: [
        { id: SQUAT.id, name: SQUAT.name, unit: "kg", value: null },
        { id: DEADLIFT.id, name: DEADLIFT.name, unit: "kg", value: 120 },
      ],
    });
  });

  it("no enseña los valores de otro socio", async () => {
    stored = [{ userId: "otro", clubId: CLUB_ID, markId: SQUAT.id, value: 90 }];

    const marks = await readMemberMarks(memberMarksGateways(), caller);

    expect(marks.marks.map((mark) => mark.value)).toEqual([null, null]);
  });

  it.each<MembershipStatus>(["pending", "past_due", "cancelled"])(
    "cierra la puerta a un socio %s con su motivo",
    async (status) => {
      membershipStatus = status;

      const reading = readMemberMarks(memberMarksGateways(), caller);

      await expect(reading).rejects.toThrow(TrainingAccessBlockedError);
      await expect(reading).rejects.toMatchObject({ block: status });
    },
  );

  it.each<Role>(["Admin", "Coach"])(
    "deja pasar a un %s sin la membresía al día (D3)",
    async (plannerRole) => {
      role = plannerRole;
      membershipStatus = "cancelled";

      const marks = await readMemberMarks(memberMarksGateways(), caller);

      expect(marks.marks).toHaveLength(2);
    },
  );

  it("rechaza a quien no es socio del club", async () => {
    hasMember = false;

    await expect(
      readMemberMarks(memberMarksGateways(), caller),
    ).rejects.toThrow(MemberNotFoundError);
  });
});

describe("saveMemberMark", () => {
  it("guarda el valor y devuelve la lista actualizada", async () => {
    const marks = await saveMemberMark(memberMarksGateways(), {
      ...caller,
      markId: SQUAT.id,
      value: 82.5,
    });

    expect(marks.marks[0]).toEqual({
      id: SQUAT.id,
      name: SQUAT.name,
      unit: "kg",
      value: 82.5,
    });
    expect(stored).toEqual([
      { userId: USER_ID, clubId: CLUB_ID, markId: SQUAT.id, value: 82.5 },
    ]);
  });

  it("responde que no existe una marca que no es del club, sin guardar", async () => {
    const saving = saveMemberMark(memberMarksGateways(), {
      ...caller,
      markId: "mark-de-otro-club",
      value: 80,
    });

    await expect(saving).rejects.toThrow(MemberMarkNotFoundError);
    expect(stored).toEqual([]);
  });

  it("no guarda nada si la puerta está cerrada", async () => {
    membershipStatus = "past_due";

    await expect(
      saveMemberMark(memberMarksGateways(), {
        ...caller,
        markId: SQUAT.id,
        value: 80,
      }),
    ).rejects.toThrow(TrainingAccessBlockedError);
    expect(stored).toEqual([]);
  });
});

describe("clearMemberMark", () => {
  it("deja la marca sin valor", async () => {
    stored = [
      { userId: USER_ID, clubId: CLUB_ID, markId: SQUAT.id, value: 90 },
    ];

    const marks = await clearMemberMark(memberMarksGateways(), {
      ...caller,
      markId: SQUAT.id,
    });

    expect(marks.marks[0]?.value).toBeNull();
    expect(stored).toEqual([]);
  });

  it("responde igual si la marca ya no tenía valor", async () => {
    const marks = await clearMemberMark(memberMarksGateways(), {
      ...caller,
      markId: SQUAT.id,
    });

    expect(marks.marks.map((mark) => mark.value)).toEqual([null, null]);
  });

  it("responde que no existe una marca que no es del club", async () => {
    await expect(
      clearMemberMark(memberMarksGateways(), {
        ...caller,
        markId: "mark-de-otro-club",
      }),
    ).rejects.toThrow(MemberMarkNotFoundError);
  });
});
