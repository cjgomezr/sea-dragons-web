import { describe, expect, it } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import {
  EvaluatedMemberInactiveError,
  EvaluatedMemberNotFoundError,
  EvaluationAlreadyExistsError,
  EvaluationChangedError,
  EvaluationForbiddenError,
  EvaluationNotFoundError,
  EvaluationValidationError,
  type MemberEvaluationGateways,
  NoActiveCategoriesError,
  type RatingsSave,
  type StoredEvaluation,
  createMemberEvaluation,
  readMemberEvaluation,
  saveEvaluationRatings,
} from "@/lib/evaluations/member-evaluation";

/**
 * La evaluación de un miembro (#319, RF-1, RF-2 y RF-5 del PRD de E9),
 * contada sin Supabase delante: quién puede, qué se valida antes de escribir,
 * cómo se responde a cada cosa que dice la base y qué queda en la bitácora.
 */

const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const COACH_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const MEMBER_ID = "4e4e4e4e-0000-4000-8000-000000000001";
const FITNESS_ID = "ca7e0000-0000-4000-8000-000000000001";
const SPEED_ID = "ca7e0000-0000-4000-8000-000000000002";
const READ_AT = "2026-09-27T01:02:03.123456+00:00";
const SAVED_AT = "2026-09-27T01:05:00.654321+00:00";

const TWO_CATEGORIES: StoredEvaluation = {
  updatedAt: READ_AT,
  ratings: [
    { categoryId: FITNESS_ID, name: "Fitness", rating: 7, isRetired: false },
    { categoryId: SPEED_ID, name: "Speed", rating: 8, isRetired: true },
  ],
};

type Fake = {
  readonly gateways: MemberEvaluationGateways;
  readonly writes: string[];
  readonly auditRows: AuditLogInsertRow[];
};

type FakeOptions = {
  readonly role?: Role;
  readonly memberStatus?: AccountStatus | null;
  readonly stored?: StoredEvaluation | null;
  readonly creation?: Awaited<
    ReturnType<MemberEvaluationGateways["evaluations"]["createEvaluation"]>
  >;
  readonly save?: RatingsSave;
};

function fakeGateways(options: FakeOptions = {}): Fake {
  const writes: string[] = [];
  const auditRows: AuditLogInsertRow[] = [];
  let stored = options.stored === undefined ? null : options.stored;
  const gateways: MemberEvaluationGateways = {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Carla Coach",
        role: options.role ?? "Coach",
      }),
    },
    evaluations: {
      findMemberStatus: async () =>
        options.memberStatus === undefined ? "active" : options.memberStatus,
      findEvaluation: async () => stored,
      createEvaluation: async (scope) => {
        writes.push(`create ${scope.userId}`);
        stored = {
          updatedAt: READ_AT,
          ratings: [
            {
              categoryId: FITNESS_ID,
              name: "Fitness",
              rating: 5,
              isRetired: false,
            },
          ],
        };
        return options.creation ?? { kind: "created" };
      },
      saveRatings: async (scope, save) => {
        writes.push(
          `save ${scope.userId} ${save.expectedUpdatedAt} ${save.ratings
            .map((change) => `${change.categoryId}=${change.rating}`)
            .join(",")}`,
        );
        const result = options.save ?? { kind: "saved" };
        if (result.kind === "saved") {
          stored = { ...TWO_CATEGORIES, updatedAt: SAVED_AT };
        }
        return result;
      },
    },
    audit: {
      insertAuditLogRow: async (row) => {
        auditRows.push(row);
        return { error: null };
      },
    },
  };
  return { gateways, writes, auditRows };
}

const SAVE_REQUEST = {
  callerId: COACH_ID,
  memberId: MEMBER_ID,
  expectedUpdatedAt: READ_AT,
  ratings: [{ categoryId: FITNESS_ID, rating: 9 }],
} as const;

describe("leer una evaluación", () => {
  it("devuelve las categorías con su valoración y el OVR a un Coach", async () => {
    const { gateways } = fakeGateways({ stored: TWO_CATEGORIES });

    const evaluation = await readMemberEvaluation(gateways, {
      callerId: COACH_ID,
      memberId: MEMBER_ID,
    });

    expect(evaluation).toEqual({
      status: "evaluated",
      memberId: MEMBER_ID,
      updatedAt: READ_AT,
      overallRating: 7.5,
      ratings: TWO_CATEGORIES.ratings,
    });
  });

  it("también se la devuelve a un Admin", async () => {
    const { gateways } = fakeGateways({
      role: "Admin",
      stored: TWO_CATEGORIES,
    });

    const evaluation = await readMemberEvaluation(gateways, {
      callerId: COACH_ID,
      memberId: MEMBER_ID,
    });

    expect(evaluation.status).toBe("evaluated");
  });

  it("dice explícitamente que el miembro no tiene evaluación, sin OVR", async () => {
    const { gateways } = fakeGateways({ stored: null });

    const evaluation = await readMemberEvaluation(gateways, {
      callerId: COACH_ID,
      memberId: MEMBER_ID,
    });

    expect(evaluation).toEqual({
      status: "not_evaluated",
      memberId: MEMBER_ID,
    });
  });

  it("da un OVR nulo, no cero, a una evaluación sin categorías", async () => {
    const { gateways } = fakeGateways({
      stored: { updatedAt: READ_AT, ratings: [] },
    });

    const evaluation = await readMemberEvaluation(gateways, {
      callerId: COACH_ID,
      memberId: MEMBER_ID,
    });

    expect(evaluation).toMatchObject({
      status: "evaluated",
      overallRating: null,
    });
  });

  it.each<Role>(["Player", "Committee"])(
    "rechaza a un %s, aunque pida la suya",
    async (role) => {
      const { gateways } = fakeGateways({ role, stored: TWO_CATEGORIES });

      await expect(
        readMemberEvaluation(gateways, {
          callerId: MEMBER_ID,
          memberId: MEMBER_ID,
        }),
      ).rejects.toBeInstanceOf(EvaluationForbiddenError);
    },
  );

  it("no encuentra a quien no es miembro del club", async () => {
    const { gateways } = fakeGateways({ memberStatus: null });

    await expect(
      readMemberEvaluation(gateways, {
        callerId: COACH_ID,
        memberId: MEMBER_ID,
      }),
    ).rejects.toBeInstanceOf(EvaluatedMemberNotFoundError);
  });
});

describe("crear una evaluación", () => {
  it("nace con lo que la base sembró y la devuelve", async () => {
    const { gateways, writes } = fakeGateways();

    const evaluation = await createMemberEvaluation(gateways, {
      callerId: COACH_ID,
      memberId: MEMBER_ID,
    });

    expect(writes).toEqual([`create ${MEMBER_ID}`]);
    expect(evaluation).toMatchObject({ status: "evaluated", overallRating: 5 });
  });

  it("falla si el club no tiene categorías activas", async () => {
    const { gateways } = fakeGateways({
      creation: { kind: "no_active_categories" },
    });

    await expect(
      createMemberEvaluation(gateways, {
        callerId: COACH_ID,
        memberId: MEMBER_ID,
      }),
    ).rejects.toBeInstanceOf(NoActiveCategoriesError);
  });

  it("falla con un miembro dado de baja sin llegar a escribir", async () => {
    const { gateways, writes } = fakeGateways({ memberStatus: "inactive" });

    await expect(
      createMemberEvaluation(gateways, {
        callerId: COACH_ID,
        memberId: MEMBER_ID,
      }),
    ).rejects.toBeInstanceOf(EvaluatedMemberInactiveError);
    expect(writes).toEqual([]);
  });

  it("falla si la baja llega mientras se crea", async () => {
    const { gateways } = fakeGateways({
      creation: { kind: "member_inactive" },
    });

    await expect(
      createMemberEvaluation(gateways, {
        callerId: COACH_ID,
        memberId: MEMBER_ID,
      }),
    ).rejects.toBeInstanceOf(EvaluatedMemberInactiveError);
  });

  it("falla si el miembro ya tiene evaluación", async () => {
    const { gateways } = fakeGateways({ creation: { kind: "already_exists" } });

    await expect(
      createMemberEvaluation(gateways, {
        callerId: COACH_ID,
        memberId: MEMBER_ID,
      }),
    ).rejects.toBeInstanceOf(EvaluationAlreadyExistsError);
  });

  it.each<Role>(["Player", "Committee"])(
    "no deja crearla a un %s",
    async (role) => {
      const { gateways, writes } = fakeGateways({ role });

      await expect(
        createMemberEvaluation(gateways, {
          callerId: COACH_ID,
          memberId: MEMBER_ID,
        }),
      ).rejects.toBeInstanceOf(EvaluationForbiddenError);
      expect(writes).toEqual([]);
    },
  );
});

describe("guardar valoraciones", () => {
  it("guarda contra la fecha leída y devuelve la evaluación recalculada", async () => {
    const { gateways, writes } = fakeGateways({ stored: TWO_CATEGORIES });

    const evaluation = await saveEvaluationRatings(gateways, SAVE_REQUEST);

    expect(writes).toEqual([`save ${MEMBER_ID} ${READ_AT} ${FITNESS_ID}=9`]);
    expect(evaluation).toMatchObject({
      status: "evaluated",
      updatedAt: SAVED_AT,
      overallRating: 7.5,
    });
  });

  it.each([
    { rating: 0, code: "rating_out_of_range" },
    { rating: 11, code: "rating_out_of_range" },
    { rating: 5.5, code: "rating_not_integer" },
  ])("rechaza $rating sin escribir nada", async ({ rating, code }) => {
    const { gateways, writes } = fakeGateways({ stored: TWO_CATEGORIES });

    const saving = saveEvaluationRatings(gateways, {
      ...SAVE_REQUEST,
      ratings: [{ categoryId: FITNESS_ID, rating }],
    });

    await expect(saving).rejects.toMatchObject({
      name: "EvaluationValidationError",
      issues: [{ categoryId: FITNESS_ID, code }],
    });
    expect(writes).toEqual([]);
  });

  it("rechaza a un Player antes de mirar sus valoraciones", async () => {
    const { gateways } = fakeGateways({ role: "Player" });

    const saving = saveEvaluationRatings(gateways, {
      ...SAVE_REQUEST,
      ratings: [{ categoryId: FITNESS_ID, rating: 11 }],
    });

    await expect(saving).rejects.toBeInstanceOf(EvaluationForbiddenError);
  });

  it("rechaza la misma categoría dos veces", async () => {
    const { gateways, writes } = fakeGateways({ stored: TWO_CATEGORIES });

    const saving = saveEvaluationRatings(gateways, {
      ...SAVE_REQUEST,
      ratings: [
        { categoryId: FITNESS_ID, rating: 6 },
        { categoryId: FITNESS_ID, rating: 7 },
      ],
    });

    await expect(saving).rejects.toMatchObject({
      issues: [{ categoryId: FITNESS_ID, code: "duplicate_category" }],
    });
    expect(writes).toEqual([]);
  });

  it("rechaza una petición sin ninguna valoración", async () => {
    const { gateways } = fakeGateways({ stored: TWO_CATEGORIES });

    await expect(
      saveEvaluationRatings(gateways, { ...SAVE_REQUEST, ratings: [] }),
    ).rejects.toBeInstanceOf(EvaluationValidationError);
  });

  it("rechaza una categoría que no es de esta evaluación", async () => {
    const { gateways } = fakeGateways({
      stored: TWO_CATEGORIES,
      save: { kind: "unknown_category", categoryId: FITNESS_ID },
    });

    await expect(
      saveEvaluationRatings(gateways, SAVE_REQUEST),
    ).rejects.toMatchObject({
      issues: [{ categoryId: FITNESS_ID, code: "unknown_category" }],
    });
  });

  it("es un conflicto si la evaluación cambió desde que se leyó", async () => {
    const { gateways } = fakeGateways({
      stored: TWO_CATEGORIES,
      save: { kind: "evaluation_changed" },
    });

    await expect(
      saveEvaluationRatings(gateways, SAVE_REQUEST),
    ).rejects.toBeInstanceOf(EvaluationChangedError);
  });

  it("no encuentra la evaluación de quien no tiene", async () => {
    const { gateways } = fakeGateways({
      save: { kind: "evaluation_not_found" },
    });

    await expect(
      saveEvaluationRatings(gateways, SAVE_REQUEST),
    ).rejects.toBeInstanceOf(EvaluationNotFoundError);
  });

  it("falla con un miembro dado de baja sin llegar a escribir", async () => {
    const { gateways, writes } = fakeGateways({
      memberStatus: "inactive",
      stored: TWO_CATEGORIES,
    });

    await expect(
      saveEvaluationRatings(gateways, SAVE_REQUEST),
    ).rejects.toBeInstanceOf(EvaluatedMemberInactiveError);
    expect(writes).toEqual([]);
  });
});

describe("bitácora", () => {
  it("deja una entrada al crear, con quién evaluó y sobre quién", async () => {
    const { gateways, auditRows } = fakeGateways();

    await createMemberEvaluation(gateways, {
      callerId: COACH_ID,
      memberId: MEMBER_ID,
    });

    expect(auditRows).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: COACH_ID,
        action: "member_evaluation.created",
        entity_type: "member",
        entity_id: MEMBER_ID,
        result: "success",
        metadata: null,
      },
    ]);
  });

  it("deja una entrada al guardar, sin las notas", async () => {
    const { gateways, auditRows } = fakeGateways({ stored: TWO_CATEGORIES });

    await saveEvaluationRatings(gateways, SAVE_REQUEST);

    expect(auditRows).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: COACH_ID,
        action: "member_evaluation.ratings_saved",
        entity_type: "member",
        entity_id: MEMBER_ID,
        result: "success",
        metadata: null,
      },
    ]);
  });

  it("no deja entrada de un guardado que la base no aplicó", async () => {
    const { gateways, auditRows } = fakeGateways({
      stored: TWO_CATEGORIES,
      save: { kind: "evaluation_changed" },
    });

    await saveEvaluationRatings(gateways, SAVE_REQUEST).catch(() => undefined);

    expect(auditRows).toEqual([]);
  });
});
