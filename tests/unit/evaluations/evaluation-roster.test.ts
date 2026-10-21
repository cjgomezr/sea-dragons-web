import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { EvaluationForbiddenError } from "@/lib/evaluations/member-evaluation";
import {
  type EvaluationRosterGateways,
  type RosterMemberRecord,
  listEvaluationRoster,
} from "@/lib/evaluations/evaluation-roster";

/**
 * La lista de la pantalla de Evaluaciones (#322, RF-6 del PRD de E9; #817,
 * RF-1 del PRD de E31): los miembros del club con su posición, su foto, su
 * OVR, cuándo y quién los evaluó, y el resumen de la plantilla. Contada sin
 * Supabase delante.
 */

const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const COACH_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const FITNESS_ID = "ca7e0000-0000-4000-8000-000000000001";
const SPEED_ID = "ca7e0000-0000-4000-8000-000000000002";
const GOALKEEPER = {
  id: "90510000-0000-4000-8000-000000000001",
  names: { en: "Goalkeeper", es: "Portero" },
};
const ZOE_PHOTO = "dddddddd-0000-4000-8000-00000000000d/foto-thumb.webp";
const ZOE_PHOTO_URL = "https://fotos.example.test/zoe";

const ZOE: RosterMemberRecord = {
  userId: "dddddddd-0000-4000-8000-00000000000d",
  fullName: "Zoe Zapata",
  status: "active",
  position: GOALKEEPER,
  photoPath: ZOE_PHOTO,
  evaluation: {
    updatedAt: "2026-10-01T09:00:00.123456+00:00",
    updatedBy: "Carla Coach",
    ratings: [
      {
        categoryId: FITNESS_ID,
        categoryName: "Fitness",
        sortOrder: 1,
        isRetired: false,
        rating: 8,
      },
      {
        categoryId: SPEED_ID,
        categoryName: "Speed",
        sortOrder: 2,
        isRetired: false,
        rating: 9,
      },
    ],
  },
};

const ALBA: RosterMemberRecord = {
  userId: "aaaaaaaa-0000-4000-8000-00000000000a",
  fullName: "Álvaro Alba",
  status: "incomplete",
  position: null,
  photoPath: null,
  evaluation: null,
};

/** Evaluada antes de `0078`: nadie sabe quién fue. */
const MARIA: RosterMemberRecord = {
  userId: "bbbbbbbb-0000-4000-8000-00000000000b",
  fullName: "maría Ruiz",
  status: "active",
  position: null,
  photoPath: null,
  evaluation: {
    updatedAt: "2026-09-01T09:00:00+00:00",
    updatedBy: null,
    ratings: [],
  },
};

const RETIRED: RosterMemberRecord = {
  userId: "eeeeeeee-0000-4000-8000-00000000000e",
  fullName: "Beto Baja",
  status: "inactive",
  position: null,
  photoPath: "eeeeeeee-0000-4000-8000-00000000000e/foto-thumb.webp",
  evaluation: {
    updatedAt: "2026-08-01T09:00:00+00:00",
    updatedBy: "Carla Coach",
    ratings: [
      {
        categoryId: FITNESS_ID,
        categoryName: "Fitness",
        sortOrder: 1,
        isRetired: false,
        rating: 1,
      },
    ],
  },
};

type FakeRoster = EvaluationRosterGateways & {
  readonly askedClubs: string[];
  readonly signedPaths: (readonly string[])[];
};

function fakeGateways(
  role: Role,
  records: readonly RosterMemberRecord[],
  signPhotoUrls: EvaluationRosterGateways["photos"]["signPhotoUrls"] = async () =>
    new Map([[ZOE_PHOTO, ZOE_PHOTO_URL]]),
): FakeRoster {
  const askedClubs: string[] = [];
  const signedPaths: (readonly string[])[] = [];
  return {
    askedClubs,
    signedPaths,
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
    photos: {
      signPhotoUrls: async (paths) => {
        signedPaths.push(paths);
        return signPhotoUrls(paths);
      },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lista de evaluaciones", () => {
  it("trae a cada jugador con su posición, su foto, su OVR, la fecha y quién lo evaluó", async () => {
    const gateways = fakeGateways("Coach", [ZOE]);

    const roster = await listEvaluationRoster(gateways, COACH_ID);

    expect(roster.members).toEqual([
      {
        status: "evaluated",
        userId: ZOE.userId,
        fullName: ZOE.fullName,
        position: GOALKEEPER,
        photoUrl: ZOE_PHOTO_URL,
        overall: 8.5,
        updatedAt: "2026-10-01T09:00:00.123456+00:00",
        updatedBy: "Carla Coach",
      },
    ]);
  });

  it("marca a quien no tiene evaluación, sin fecha ni evaluador", async () => {
    const gateways = fakeGateways("Coach", [ALBA]);

    const roster = await listEvaluationRoster(gateways, COACH_ID);

    expect(roster.members).toEqual([
      {
        status: "not_evaluated",
        userId: ALBA.userId,
        fullName: ALBA.fullName,
        position: null,
        photoUrl: null,
      },
    ]);
  });

  it("deja sin evaluador una evaluación anterior a la migración, sin inventar a nadie", async () => {
    const gateways = fakeGateways("Coach", [MARIA]);

    const roster = await listEvaluationRoster(gateways, COACH_ID);

    expect(roster.members).toEqual([
      expect.objectContaining({ status: "evaluated", updatedBy: null }),
    ]);
  });

  it("da un OVR nulo a una evaluación sin categorías, en vez de un cero", async () => {
    const gateways = fakeGateways("Coach", [MARIA]);

    const roster = await listEvaluationRoster(gateways, COACH_ID);

    expect(roster.members).toEqual([
      expect.objectContaining({ status: "evaluated", overall: null }),
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

  it("deja fuera a los dados de baja, de la lista y del resumen, y no firma su foto", async () => {
    const gateways = fakeGateways("Coach", [ZOE, RETIRED]);

    const roster = await listEvaluationRoster(gateways, COACH_ID);

    expect(roster.members.map((member) => member.userId)).toEqual([ZOE.userId]);
    expect(roster.summary).toMatchObject({
      evaluatedCount: 1,
      playerCount: 1,
      averageOverall: 8.5,
    });
    expect(gateways.signedPaths).toEqual([[ZOE_PHOTO]]);
  });

  it("trae el resumen de la plantilla en la misma respuesta", async () => {
    const gateways = fakeGateways("Coach", [ZOE, ALBA, MARIA]);

    const roster = await listEvaluationRoster(gateways, COACH_ID);

    expect(roster.summary).toEqual({
      evaluatedCount: 2,
      playerCount: 3,
      categoryAverages: [
        { categoryId: FITNESS_ID, name: "Fitness", average: 8 },
        { categoryId: SPEED_ID, name: "Speed", average: 9 },
      ],
      averageOverall: 8.5,
      longestUnreviewed: [
        {
          userId: MARIA.userId,
          fullName: MARIA.fullName,
          updatedAt: "2026-09-01T09:00:00+00:00",
        },
        {
          userId: ZOE.userId,
          fullName: ZOE.fullName,
          updatedAt: "2026-10-01T09:00:00.123456+00:00",
        },
      ],
    });
  });

  it("deja las iniciales si las fotos no se pueden firmar, sin tumbar la lista", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const gateways = fakeGateways("Coach", [ZOE], async () => {
      throw new Error("Storage caído");
    });

    const roster = await listEvaluationRoster(gateways, COACH_ID);

    expect(roster.members).toEqual([
      expect.objectContaining({ userId: ZOE.userId, photoUrl: null }),
    ]);
  });

  it("lee el club de quien pregunta con una sola consulta", async () => {
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
