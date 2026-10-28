import { beforeEach, describe, expect, it } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { Role } from "@/lib/auth/roles";
import {
  type ClubMarkRecord,
  type ClubMarksGateways,
  MARK_NAME_MAX_LENGTH,
  MarkHasValuesError,
  MarkInUseError,
  MarkNameTakenError,
  MarkNotFoundError,
  MarkValidationError,
  createClubMark,
  deleteClubMark,
  listClubMarks,
  renameClubMark,
} from "@/lib/training/club-marks";
import { TrainingPlannerForbiddenError } from "@/lib/training/training-planner";

/**
 * Las marcas del club en Planificar (#903, RF-11 y D11 del PRD de E35),
 * contadas contra un catálogo en memoria. Que el nombre repetido se mida sin
 * mayúsculas ni acentos y que las cuentas no lleven valores lo prueban la
 * migración y el test de integración.
 */

const COACH_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const SQUAT_ID = "1b2c3d4e-0000-4000-8000-000000000001";
const BENCH_ID = "1b2c3d4e-0000-4000-8000-000000000002";
const NEW_MARK_ID = "1b2c3d4e-0000-4000-8000-000000000003";
const UNKNOWN_MARK_ID = "1b2c3d4e-0000-4000-8000-0000000000ff";

let callerRole: Role;
let marks: ClubMarkRecord[];
let auditRows: AuditLogInsertRow[];
let insertedSortOrders: number[];
let raceOnDelete: boolean;

function sameName(one: string, other: string): boolean {
  const normalize = (text: string) =>
    text
      .trim()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  return normalize(one) === normalize(other);
}

function isTaken(name: string, exceptId: string | null): boolean {
  return marks.some(
    (mark) => mark.id !== exceptId && sameName(mark.name, name),
  );
}

function gateways(): ClubMarksGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Cora Coach",
        role: callerRole,
      }),
    },
    marks: {
      listMarks: async (clubId) => (clubId === CLUB_ID ? [...marks] : []),
      insertMark: async ({ name, sortOrder }) => {
        if (isTaken(name, null)) {
          return { kind: "name_taken" };
        }
        insertedSortOrders.push(sortOrder);
        marks.push({
          id: NEW_MARK_ID,
          name,
          sortOrder,
          routineRows: 0,
          membersRecorded: 0,
        });
        return { kind: "created", markId: NEW_MARK_ID };
      },
      renameMark: async ({ markId }, name) => {
        const mark = marks.find((candidate) => candidate.id === markId);
        if (mark === undefined) {
          return { kind: "not_found" };
        }
        if (isTaken(name, markId)) {
          return { kind: "name_taken" };
        }
        marks = marks.map((candidate) =>
          candidate.id === markId ? { ...candidate, name } : candidate,
        );
        return { kind: "renamed" };
      },
      deleteMark: async ({ markId }) => {
        if (raceOnDelete) {
          return { kind: "in_use" };
        }
        marks = marks.filter((candidate) => candidate.id !== markId);
        return { kind: "deleted" };
      },
    },
    audit: {
      insertAuditLogRow: async (row) => {
        auditRows.push(row);
        return { error: null };
      },
    },
  };
}

beforeEach(() => {
  callerRole = "Coach";
  marks = [
    {
      id: SQUAT_ID,
      name: "Back squat",
      sortOrder: 0,
      routineRows: 2,
      membersRecorded: 5,
    },
    // Hubo otras antes que se borraron: el orden no es seguido.
    {
      id: BENCH_ID,
      name: "Bench press",
      sortOrder: 3,
      routineRows: 0,
      membersRecorded: 0,
    },
  ];
  auditRows = [];
  insertedSortOrders = [];
  raceOnDelete = false;
});

describe("listClubMarks", () => {
  it("devuelve cada marca con sus cuentas, sin valores", async () => {
    const result = await listClubMarks(gateways(), COACH_ID);

    expect(result).toEqual({
      marks: [
        {
          id: SQUAT_ID,
          name: "Back squat",
          unit: "kg",
          routineRows: 2,
          membersRecorded: 5,
        },
        {
          id: BENCH_ID,
          name: "Bench press",
          unit: "kg",
          routineRows: 0,
          membersRecorded: 0,
        },
      ],
    });
  });

  it.each<Role>(["Player", "Committee"])(
    "a un %s se lo niega",
    async (role) => {
      callerRole = role;

      await expect(listClubMarks(gateways(), COACH_ID)).rejects.toThrow(
        TrainingPlannerForbiddenError,
      );
    },
  );

  it("a quien no es socio del club lo trata como tal", async () => {
    const withoutMember: ClubMarksGateways = {
      ...gateways(),
      members: { findRoleRequestMember: async () => null },
    };

    await expect(listClubMarks(withoutMember, COACH_ID)).rejects.toThrow(
      MemberNotFoundError,
    );
  });
});

describe("createClubMark", () => {
  it("la crea detrás de la última, con el nombre recortado, y lo anota", async () => {
    const result = await createClubMark(gateways(), {
      callerId: COACH_ID,
      name: "  Power clean ",
    });

    expect(result.marks.at(-1)).toMatchObject({
      id: NEW_MARK_ID,
      name: "Power clean",
    });
    expect(insertedSortOrders).toEqual([4]);
    expect(auditRows).toEqual([
      expect.objectContaining({
        club_id: CLUB_ID,
        actor_id: COACH_ID,
        action: "training_mark.created",
        entity_type: "training_mark",
        entity_id: NEW_MARK_ID,
      }),
    ]);
  });

  it("en un club sin marcas la crea la primera", async () => {
    marks = [];

    await createClubMark(gateways(), { callerId: COACH_ID, name: "Deadlift" });

    expect(insertedSortOrders).toEqual([0]);
  });

  it("rechaza un nombre que repite otro sin contar mayúsculas ni acentos", async () => {
    marks = [
      {
        id: SQUAT_ID,
        name: "Sentadilla",
        sortOrder: 0,
        routineRows: 0,
        membersRecorded: 0,
      },
    ];

    await expect(
      createClubMark(gateways(), { callerId: COACH_ID, name: "SENTADÍLLA" }),
    ).rejects.toThrow(MarkNameTakenError);
    expect(auditRows).toEqual([]);
  });

  it.each([
    ["vacío", "   ", "name_required"],
    ["demasiado largo", "x".repeat(MARK_NAME_MAX_LENGTH + 1), "name_too_long"],
  ])("rechaza un nombre %s", async (_label, name, code) => {
    await expect(
      createClubMark(gateways(), { callerId: COACH_ID, name }),
    ).rejects.toMatchObject(new MarkValidationError(code as "name_required"));
  });

  it("cuenta los caracteres como Postgres: un emoji es uno", async () => {
    const name = "💪".repeat(MARK_NAME_MAX_LENGTH);

    await expect(
      createClubMark(gateways(), { callerId: COACH_ID, name }),
    ).resolves.toBeDefined();
  });
});

describe("renameClubMark", () => {
  it("la renombra, la deja en su sitio y lo anota", async () => {
    const result = await renameClubMark(gateways(), {
      callerId: COACH_ID,
      markId: SQUAT_ID,
      name: "Front squat",
    });

    expect(result.marks[0]).toMatchObject({
      id: SQUAT_ID,
      name: "Front squat",
      membersRecorded: 5,
    });
    expect(auditRows).toEqual([
      expect.objectContaining({
        action: "training_mark.renamed",
        entity_id: SQUAT_ID,
        metadata: null,
      }),
    ]);
  });

  it("deja cambiarle sólo las mayúsculas", async () => {
    const result = await renameClubMark(gateways(), {
      callerId: COACH_ID,
      markId: SQUAT_ID,
      name: "BACK SQUAT",
    });

    expect(result.marks[0]?.name).toBe("BACK SQUAT");
  });

  it("rechaza el nombre de otra marca", async () => {
    await expect(
      renameClubMark(gateways(), {
        callerId: COACH_ID,
        markId: SQUAT_ID,
        name: "bench press",
      }),
    ).rejects.toThrow(MarkNameTakenError);
  });

  it("no encuentra una marca que no es del club", async () => {
    await expect(
      renameClubMark(gateways(), {
        callerId: COACH_ID,
        markId: UNKNOWN_MARK_ID,
        name: "Front squat",
      }),
    ).rejects.toThrow(MarkNotFoundError);
  });
});

describe("deleteClubMark", () => {
  it("no borra una marca que usa alguna fila", async () => {
    await expect(
      deleteClubMark(gateways(), {
        callerId: COACH_ID,
        markId: SQUAT_ID,
        confirm: true,
      }),
    ).rejects.toThrow(MarkInUseError);
    expect(marks).toHaveLength(2);
    expect(auditRows).toEqual([]);
  });

  it("borra una sin usar y sin valores, sin pedir confirmación", async () => {
    const result = await deleteClubMark(gateways(), {
      callerId: COACH_ID,
      markId: BENCH_ID,
      confirm: false,
    });

    expect(result.marks.map((mark) => mark.id)).toEqual([SQUAT_ID]);
    expect(auditRows).toEqual([
      expect.objectContaining({
        action: "training_mark.deleted",
        entity_id: BENCH_ID,
        metadata: { valuesDeleted: 0 },
      }),
    ]);
  });

  it("pide confirmación para una sin usar con valores, con cuántos socios", async () => {
    marks = [
      {
        id: BENCH_ID,
        name: "Bench press",
        sortOrder: 0,
        routineRows: 0,
        membersRecorded: 3,
      },
    ];

    const attempt = deleteClubMark(gateways(), {
      callerId: COACH_ID,
      markId: BENCH_ID,
      confirm: false,
    });

    await expect(attempt).rejects.toThrow(MarkHasValuesError);
    await expect(attempt).rejects.toMatchObject({ membersRecorded: 3 });
    expect(marks).toHaveLength(1);
  });

  it("con la confirmación borra la marca y los valores, y anota cuántos", async () => {
    marks = [
      {
        id: BENCH_ID,
        name: "Bench press",
        sortOrder: 0,
        routineRows: 0,
        membersRecorded: 3,
      },
    ];

    const result = await deleteClubMark(gateways(), {
      callerId: COACH_ID,
      markId: BENCH_ID,
      confirm: true,
    });

    expect(result.marks).toEqual([]);
    expect(auditRows[0]?.metadata).toEqual({ valuesDeleted: 3 });
  });

  it("si una fila la empezó a usar entretanto, no la borra", async () => {
    raceOnDelete = true;

    await expect(
      deleteClubMark(gateways(), {
        callerId: COACH_ID,
        markId: BENCH_ID,
        confirm: false,
      }),
    ).rejects.toThrow(MarkInUseError);
    expect(auditRows).toEqual([]);
  });

  it("no encuentra una marca que no es del club", async () => {
    await expect(
      deleteClubMark(gateways(), {
        callerId: COACH_ID,
        markId: UNKNOWN_MARK_ID,
        confirm: true,
      }),
    ).rejects.toThrow(MarkNotFoundError);
  });
});
