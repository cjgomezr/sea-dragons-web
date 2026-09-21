import { describe, expect, it } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import { InactiveMemberError } from "@/lib/groups/group-members";
import { GroupNotFoundError } from "@/lib/groups/groups";
import {
  type AufRegistration,
  MemberRecordForbiddenError,
  type MemberRecordGateways,
  MemberRecordNotFoundError,
  MemberRecordValidationError,
  type MemberRecordSubmission,
  readMemberRecord,
  updateMemberRecord,
} from "@/lib/members/member-record";

/**
 * La ficha reservada al Admin (#242, RF-4 del PRD de E5): el número de AUF,
 * su vencimiento y los grupos de otro miembro. Todo sale del club de quien
 * llama, y los grupos se escriben con las mismas funciones que la sección
 * Grupos.
 */

const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const OTHER_CLUB_ID = "5c1ab000-0000-4000-8000-000000000002";
const MEMBER_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const SENIOR_ID = "9a9a9a9a-0000-4000-8000-000000000001";
const MASTERS_ID = "9a9a9a9a-0000-4000-8000-000000000002";
const JUNIORS_ID = "9a9a9a9a-0000-4000-8000-000000000003";
const TODAY_IN_CLUB = "2026-09-21";
const JOINED_ON = "2024-03-06";

const CLUB_GROUPS = [
  { id: MASTERS_ID, name: "Masters Squad" },
  { id: SENIOR_ID, name: "Senior Squad" },
  { id: JUNIORS_ID, name: "Juniors" },
] as const;

type FakeOptions = {
  readonly callerRole?: Role;
  readonly memberClubId?: string;
  readonly memberStatus?: AccountStatus;
  readonly aufNumber?: string | null;
  readonly aufExpiry?: string | null;
  readonly groupIds?: readonly string[];
};

type Fake = {
  readonly gateways: MemberRecordGateways;
  /** Todo lo que se escribió, en orden. */
  readonly writes: string[];
  /** Cuántas lecturas se hicieron: validar no debe tocar la base. */
  readonly reads: string[];
};

function fake(options: FakeOptions = {}): Fake {
  const writes: string[] = [];
  const reads: string[] = [];
  const memberClubId = options.memberClubId ?? CLUB_ID;
  let auf = {
    aufNumber: options.aufNumber ?? null,
    aufExpiry: options.aufExpiry ?? null,
  };
  const memberships = new Set(options.groupIds ?? []);
  const isClubMember = (clubId: string, userId: string): boolean =>
    clubId === memberClubId && userId === MEMBER_ID;
  const groupName = (groupId: string): string =>
    CLUB_GROUPS.find((group) => group.id === groupId)?.name ?? "";
  const isClubGroup = (groupId: string): boolean =>
    CLUB_GROUPS.some((group) => group.id === groupId);

  const gateways: MemberRecordGateways = {
    members: {
      findRoleRequestMember: async (userId) => {
        reads.push(`caller ${userId}`);
        return {
          clubId: CLUB_ID,
          fullName: "Ana Admin",
          role: options.callerRole ?? "Admin",
        };
      },
    },
    records: {
      findMemberRecord: async ({ clubId, userId }) => {
        reads.push(`record ${clubId} ${userId}`);
        return isClubMember(clubId, userId)
          ? {
              userId,
              fullName: "Paula Player",
              joinedOn: JOINED_ON,
              ...auf,
            }
          : null;
      },
      findMemberGroups: async ({ clubId, userId }) => {
        reads.push(`groups of ${clubId} ${userId}`);
        return isClubMember(clubId, userId)
          ? [...memberships].map((id) => ({ id, name: groupName(id) }))
          : [];
      },
      updateAufRegistration: async ({ clubId, userId }, registration) => {
        writes.push(`auf ${JSON.stringify(registration)}`);
        if (!isClubMember(clubId, userId)) {
          return { kind: "member_not_found" };
        }
        auf =
          registration.kind === "none"
            ? { aufNumber: null, aufExpiry: null }
            : {
                aufNumber: registration.number,
                aufExpiry: registration.expiry,
              };
        return { kind: "updated" };
      },
    },
    groups: {
      findClubGroups: async (clubId) => {
        reads.push(`club groups ${clubId}`);
        return clubId === CLUB_ID
          ? CLUB_GROUPS.map((group) => ({ ...group, memberCount: 0 }))
          : [];
      },
    },
    groupMembers: {
      findGroupMembers: async () => ({ kind: "found", members: [] }),
      findCandidates: async () => ({ kind: "found", members: [] }),
      findClubMember: async ({ clubId, userId }) =>
        isClubMember(clubId, userId)
          ? {
              id: userId,
              fullName: "Paula Player",
              accountStatus: options.memberStatus ?? "active",
            }
          : null,
      insertMembership: async ({ groupId }) => {
        if (!isClubGroup(groupId)) {
          return { kind: "group_not_found" };
        }
        writes.push(`assign ${groupId}`);
        memberships.add(groupId);
        return { kind: "assigned" };
      },
      deleteMembership: async ({ groupId }) => {
        writes.push(`remove ${groupId}`);
        memberships.delete(groupId);
        return { kind: "removed" };
      },
    },
  };
  return { gateways, writes, reads };
}

function submission(
  overrides: Partial<MemberRecordSubmission> = {},
): MemberRecordSubmission {
  return {
    aufNumber: "AUF-2026-0042",
    aufExpiry: "2027-03-31",
    groupIds: [],
    ...overrides,
  };
}

async function save(
  { gateways }: Fake,
  overrides: Partial<MemberRecordSubmission> = {},
  callerId: string = ADMIN_ID,
): ReturnType<typeof updateMemberRecord> {
  return updateMemberRecord(gateways, {
    callerId,
    userId: MEMBER_ID,
    submission: submission(overrides),
    todayInClub: TODAY_IN_CLUB,
  });
}

async function issuesOf(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(MemberRecordValidationError);
  return (error as MemberRecordValidationError).issues;
}

describe("ficha reservada al Admin: lectura", () => {
  it("devuelve el AUF, el ingreso y los grupos en orden alfabético", async () => {
    const { gateways } = fake({
      aufNumber: "AUF-1",
      aufExpiry: "2027-01-01",
      groupIds: [SENIOR_ID, MASTERS_ID],
    });

    const record = await readMemberRecord(gateways, {
      callerId: ADMIN_ID,
      userId: MEMBER_ID,
      todayInClub: TODAY_IN_CLUB,
    });

    expect(record).toEqual({
      userId: MEMBER_ID,
      fullName: "Paula Player",
      joinedOn: JOINED_ON,
      aufNumber: "AUF-1",
      aufExpiry: "2027-01-01",
      isAufExpired: false,
      groups: [
        { id: MASTERS_ID, name: "Masters Squad" },
        { id: SENIOR_ID, name: "Senior Squad" },
      ],
    });
  });

  it("marca vencido un AUF que caducó antes de hoy", async () => {
    const { gateways } = fake({ aufNumber: "AUF-1", aufExpiry: "2026-09-20" });

    const record = await readMemberRecord(gateways, {
      callerId: ADMIN_ID,
      userId: MEMBER_ID,
      todayInClub: TODAY_IN_CLUB,
    });

    expect(record.isAufExpired).toBe(true);
  });

  it("no marca vencido un AUF que caduca hoy", async () => {
    const { gateways } = fake({ aufNumber: "AUF-1", aufExpiry: TODAY_IN_CLUB });

    const record = await readMemberRecord(gateways, {
      callerId: ADMIN_ID,
      userId: MEMBER_ID,
      todayInClub: TODAY_IN_CLUB,
    });

    expect(record.isAufExpired).toBe(false);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "rechaza a un %s sin leer la ficha",
    async (callerRole) => {
      const { gateways, reads } = fake({ callerRole });

      await expect(
        readMemberRecord(gateways, {
          callerId: ADMIN_ID,
          userId: MEMBER_ID,
          todayInClub: TODAY_IN_CLUB,
        }),
      ).rejects.toBeInstanceOf(MemberRecordForbiddenError);
      expect(reads).toEqual([`caller ${ADMIN_ID}`]);
    },
  );

  it("responde que no existe un miembro de otro club", async () => {
    const { gateways } = fake({ memberClubId: OTHER_CLUB_ID });

    await expect(
      readMemberRecord(gateways, {
        callerId: ADMIN_ID,
        userId: MEMBER_ID,
        todayInClub: TODAY_IN_CLUB,
      }),
    ).rejects.toBeInstanceOf(MemberRecordNotFoundError);
  });
});

describe("ficha reservada al Admin: AUF", () => {
  it("guarda el número con su vencimiento", async () => {
    const store = fake();

    const record = await save(store);

    expect(record).toMatchObject({
      aufNumber: "AUF-2026-0042",
      aufExpiry: "2027-03-31",
      isAufExpired: false,
    });
  });

  it("guarda el número sin vencimiento", async () => {
    const store = fake();

    const record = await save(store, { aufExpiry: null });

    expect(record).toMatchObject({
      aufNumber: "AUF-2026-0042",
      aufExpiry: null,
      isAufExpired: false,
    });
  });

  it("recorta los espacios del número antes de guardarlo", async () => {
    const store = fake();

    await save(store, { aufNumber: "  AUF-7  " });

    expect(store.writes).toContain(
      `auf ${JSON.stringify({ kind: "registered", number: "AUF-7", expiry: "2027-03-31" } satisfies AufRegistration)}`,
    );
  });

  it("acepta un vencimiento el mismo día del ingreso", async () => {
    const store = fake();

    const record = await save(store, { aufExpiry: JOINED_ON });

    expect(record.aufExpiry).toBe(JOINED_ON);
  });

  it("guarda un vencimiento pasado y lo devuelve marcado", async () => {
    const store = fake();

    const record = await save(store, { aufExpiry: "2025-01-15" });

    expect(record).toMatchObject({
      aufExpiry: "2025-01-15",
      isAufExpired: true,
    });
  });

  it("rechaza un vencimiento anterior al ingreso sin escribir nada", async () => {
    const store = fake();

    const issues = await issuesOf(save(store, { aufExpiry: "2024-03-05" }));

    expect(issues).toEqual([
      { field: "aufExpiry", code: "auf_expiry_before_joined" },
    ]);
    expect(store.writes).toEqual([]);
  });

  it.each(["2026-02-30", "31/03/2027", "2027-3-31", "mañana", ""])(
    "rechaza el vencimiento %j sin leer ni escribir nada",
    async (aufExpiry) => {
      const store = fake();

      const issues = await issuesOf(save(store, { aufExpiry }));

      expect(issues).toEqual([
        { field: "aufExpiry", code: "auf_expiry_not_a_date" },
      ]);
      expect(store.reads).toEqual([]);
      expect(store.writes).toEqual([]);
    },
  );

  it("rechaza un número de más de 40 caracteres sin leer ni escribir nada", async () => {
    const store = fake();

    const issues = await issuesOf(save(store, { aufNumber: "9".repeat(41) }));

    expect(issues).toEqual([
      { field: "aufNumber", code: "auf_number_too_long" },
    ]);
    expect(store.reads).toEqual([]);
    expect(store.writes).toEqual([]);
  });

  it("acepta un número de exactamente 40 caracteres", async () => {
    const store = fake();

    const record = await save(store, { aufNumber: "9".repeat(40) });

    expect(record.aufNumber).toBe("9".repeat(40));
  });

  it("cuenta los caracteres y no las unidades UTF-16", async () => {
    const store = fake();

    const record = await save(store, { aufNumber: "🏊".repeat(40) });

    expect(record.aufNumber).toBe("🏊".repeat(40));
  });

  it.each([null, "", "   "])(
    "con el número borrado (%j) deja sin valor el número y el vencimiento",
    async (aufNumber) => {
      const store = fake({ aufNumber: "AUF-1", aufExpiry: "2027-01-01" });

      const record = await save(store, { aufNumber, aufExpiry: "2027-01-01" });

      expect(record).toMatchObject({
        aufNumber: null,
        aufExpiry: null,
        isAufExpired: false,
      });
      expect(store.writes).toEqual([
        `auf ${JSON.stringify({ kind: "none" } satisfies AufRegistration)}`,
      ]);
    },
  );

  it("escribe el número y el vencimiento en una sola escritura", async () => {
    const store = fake();

    await save(store);

    expect(store.writes.filter((write) => write.startsWith("auf"))).toEqual([
      `auf ${JSON.stringify({ kind: "registered", number: "AUF-2026-0042", expiry: "2027-03-31" } satisfies AufRegistration)}`,
    ]);
  });
});

describe("ficha reservada al Admin: grupos", () => {
  it("agrega los grupos nuevos y quita los que ya no están", async () => {
    const store = fake({ groupIds: [SENIOR_ID, JUNIORS_ID] });

    const record = await save(store, { groupIds: [SENIOR_ID, MASTERS_ID] });

    expect(store.writes).toEqual(
      expect.arrayContaining([`assign ${MASTERS_ID}`, `remove ${JUNIORS_ID}`]),
    );
    expect(store.writes).not.toContain(`assign ${SENIOR_ID}`);
    expect(record.groups).toEqual([
      { id: MASTERS_ID, name: "Masters Squad" },
      { id: SENIOR_ID, name: "Senior Squad" },
    ]);
  });

  it("quita todos los grupos con una lista vacía", async () => {
    const store = fake({ groupIds: [SENIOR_ID, MASTERS_ID] });

    const record = await save(store, { groupIds: [] });

    expect(record.groups).toEqual([]);
  });

  it("no repite una asignación con un id duplicado", async () => {
    const store = fake();

    await save(store, { groupIds: [SENIOR_ID, SENIOR_ID] });

    expect(
      store.writes.filter((write) => write === `assign ${SENIOR_ID}`),
    ).toHaveLength(1);
  });

  it("no toca los grupos si no cambian", async () => {
    const store = fake({ groupIds: [SENIOR_ID] });

    await save(store, { groupIds: [SENIOR_ID] });

    expect(store.writes.filter((write) => !write.startsWith("auf"))).toEqual(
      [],
    );
  });

  it("rechaza un grupo que no es del club sin escribir nada", async () => {
    const store = fake();
    const foreignGroupId = "9a9a9a9a-0000-4000-8000-0000000000ff";

    await expect(
      save(store, { groupIds: [SENIOR_ID, foreignGroupId] }),
    ).rejects.toBeInstanceOf(GroupNotFoundError);
    expect(store.writes).toEqual([]);
  });

  it("aplica la regla de Grupos: a un miembro dado de baja no se le asigna", async () => {
    const store = fake({ memberStatus: "inactive" });

    await expect(save(store, { groupIds: [SENIOR_ID] })).rejects.toBeInstanceOf(
      InactiveMemberError,
    );
    expect(store.writes).toEqual([]);
  });

  it("deja editar el AUF de un miembro dado de baja si no se le agregan grupos", async () => {
    const store = fake({ memberStatus: "inactive", groupIds: [SENIOR_ID] });

    const record = await save(store, { groupIds: [] });

    expect(record).toMatchObject({ aufNumber: "AUF-2026-0042", groups: [] });
  });
});

describe("ficha reservada al Admin: quién y a quién", () => {
  it.each(["Coach", "Committee", "Player"] as const)(
    "rechaza a un %s sin escribir nada",
    async (callerRole) => {
      const store = fake({ callerRole });

      await expect(save(store)).rejects.toBeInstanceOf(
        MemberRecordForbiddenError,
      );
      expect(store.writes).toEqual([]);
    },
  );

  it("responde que no existe un miembro de otro club, sin escribir nada", async () => {
    const store = fake({ memberClubId: OTHER_CLUB_ID });

    await expect(save(store)).rejects.toBeInstanceOf(MemberRecordNotFoundError);
    expect(store.writes).toEqual([]);
  });

  it("busca al miembro en el club de quien llama", async () => {
    const store = fake();

    await save(store);

    expect(store.reads).toContain(`record ${CLUB_ID} ${MEMBER_ID}`);
  });
});
