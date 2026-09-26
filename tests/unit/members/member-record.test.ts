import { describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import { InactiveMemberError } from "@/lib/groups/group-members";
import { GroupNotFoundError } from "@/lib/groups/groups";
import {
  type AufRegistration,
  MemberRecordConflictError,
  correctionRequiresGuardianConsent,
  MemberRecordForbiddenError,
  type MemberRecordGateways,
  MemberRecordNotFoundError,
  MemberRecordValidationError,
  type MemberRecordSubmission,
  MemberAufChangedError,
  type MemberRecord,
  readMemberRecord,
  updateMemberRecord,
  verifyMemberAuf,
} from "@/lib/members/member-record";

/**
 * La ficha reservada al Admin (#242, RF-4 del PRD de E5): el número de AUF,
 * su vencimiento y los grupos de otro miembro. Todo sale del club de quien
 * llama, y los grupos se escriben con las mismas funciones que la sección
 * Grupos. Desde #274 el Admin además verifica el AUF que propuso el miembro,
 * y el que escribe él mismo nace verificado.
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
/** El registro de la fila: la edad que decide el consentimiento es la de ese
 * día en Melbourne (#134). */
const REGISTERED_AT = "2024-03-06T01:00:00.000Z";
const ADULT_BIRTH = "1990-05-10";
/** 14 años el día del registro. */
const MINOR_BIRTH = "2010-01-01";

const PHOTO_PATH = `${MEMBER_ID}/foto.webp`;
const SIGNED_PHOTO_ORIGIN = "https://storage.example/member-photos";

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
  readonly isAufVerified?: boolean;
  /** El miembro cambió su AUF entre la lectura y la verificación. */
  readonly aufChangesMidway?: boolean;
  readonly groupIds?: readonly string[];
  readonly dateOfBirth?: string | null;
  readonly hasGuardianConsent?: boolean;
  /** Otra petición cambió el estado de la cuenta entre la lectura y la
   * escritura. */
  readonly statusChangesMidway?: boolean;
  /** La ruta de la foto en Storage (#245), o null si no tiene. */
  readonly photoPath?: string | null;
  /** Cómo responde Storage al firmarla: `unsigned` es que no firmó esa
   * ruta, `failed` que la llamada entera falló. */
  readonly photoSigning?: "signed" | "unsigned" | "failed";
};

type Fake = {
  readonly gateways: MemberRecordGateways;
  /** Todo lo que se escribió, en orden. */
  readonly writes: string[];
  /** Cuántas lecturas se hicieron: validar no debe tocar la base. */
  readonly reads: string[];
  readonly auditRows: AuditLogInsertRow[];
};

function fake(options: FakeOptions = {}): Fake {
  const writes: string[] = [];
  const reads: string[] = [];
  const auditRows: AuditLogInsertRow[] = [];
  const memberClubId = options.memberClubId ?? CLUB_ID;
  let auf = {
    aufNumber: options.aufNumber ?? null,
    aufExpiry: options.aufExpiry ?? null,
    isAufVerified: options.isAufVerified ?? false,
  };
  const memberships = new Set(options.groupIds ?? []);
  let dateOfBirth =
    options.dateOfBirth === undefined ? ADULT_BIRTH : options.dateOfBirth;
  let accountStatus = options.memberStatus ?? "active";
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
              accountStatus,
              ...auf,
              dateOfBirth,
              registeredAt: REGISTERED_AT,
              hasGuardianConsent: options.hasGuardianConsent ?? false,
              photoPath: options.photoPath ?? null,
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
            ? { aufNumber: null, aufExpiry: null, isAufVerified: false }
            : {
                aufNumber: registration.number,
                aufExpiry: registration.expiry,
                isAufVerified: true,
              };
        return { kind: "updated" };
      },
      verifyAufRegistration: async ({ clubId, userId }, registration) => {
        writes.push(`verify ${JSON.stringify(registration)}`);
        const isStillTheSame =
          isClubMember(clubId, userId) &&
          options.aufChangesMidway !== true &&
          auf.aufNumber === registration.number &&
          auf.aufExpiry === registration.expiry &&
          !auf.isAufVerified;
        if (!isStillTheSame) {
          return { kind: "changed" };
        }
        auf = { ...auf, isAufVerified: true };
        return { kind: "verified" };
      },
      correctDateOfBirth: async ({ clubId, userId }, correction) => {
        writes.push(
          `birth ${correction.dateOfBirth} ${correction.fromStatus}->${correction.toStatus}`,
        );
        if (!isClubMember(clubId, userId)) {
          return { kind: "member_not_found" };
        }
        if (options.statusChangesMidway === true) {
          return { kind: "status_changed" };
        }
        dateOfBirth = correction.dateOfBirth;
        accountStatus = correction.toStatus;
        return { kind: "corrected" };
      },
    },
    photos: {
      signPhotoUrl: async (photoPath) => {
        reads.push(`sign ${photoPath}`);
        if (options.photoSigning === "failed") {
          throw new Error("Storage no responde.");
        }
        return options.photoSigning === "unsigned"
          ? null
          : `${SIGNED_PHOTO_ORIGIN}/${photoPath}?token=firma`;
      },
    },
    audit: {
      insertAuditLogRow: async (row) => {
        auditRows.push(row);
        return { error: null };
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
  return { gateways, writes, reads, auditRows };
}

/** El AUF que manda `submission()`, ya guardado y verificado: guardar la
 * ficha no lo cambia. */
const UNCHANGED_AUF = {
  aufNumber: "AUF-2026-0042",
  aufExpiry: "2027-03-31",
  isAufVerified: true,
} as const;

/** La ficha como la escribe el formulario cuando el AUF se editó. */
type EditedSubmission = {
  readonly aufNumber: string | null;
  readonly aufExpiry: string | null;
  readonly groupIds: readonly string[];
  readonly dateOfBirth: string | null;
};

function submission(
  overrides: Partial<EditedSubmission> = {},
): MemberRecordSubmission {
  const { aufNumber, aufExpiry, ...rest }: EditedSubmission = {
    aufNumber: "AUF-2026-0042",
    aufExpiry: "2027-03-31",
    groupIds: [],
    dateOfBirth: ADULT_BIRTH,
    ...overrides,
  };
  return { ...rest, auf: { aufNumber, aufExpiry } };
}

async function save(
  { gateways }: Fake,
  overrides: Partial<EditedSubmission> = {},
  callerId: string = ADMIN_ID,
): ReturnType<typeof updateMemberRecord> {
  return updateMemberRecord(gateways, {
    callerId,
    userId: MEMBER_ID,
    submission: submission(overrides),
    todayInClub: TODAY_IN_CLUB,
  });
}

/** Guarda la ficha con el AUF sin tocar: el formulario no lo manda. */
async function saveKeepingAuf(
  { gateways }: Fake,
  groupIds: readonly string[],
): ReturnType<typeof updateMemberRecord> {
  return updateMemberRecord(gateways, {
    callerId: ADMIN_ID,
    userId: MEMBER_ID,
    submission: { ...submission({ groupIds }), auf: null },
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
      accountStatus: "active",
      aufNumber: "AUF-1",
      aufExpiry: "2027-01-01",
      isAufVerified: false,
      dateOfBirth: ADULT_BIRTH,
      registeredAt: REGISTERED_AT,
      hasGuardianConsent: false,
      photoUrl: null,
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

describe("la foto en la ficha", () => {
  function readRecord(gateways: MemberRecordGateways): Promise<MemberRecord> {
    return readMemberRecord(gateways, {
      callerId: ADMIN_ID,
      userId: MEMBER_ID,
      todayInClub: TODAY_IN_CLUB,
    });
  }

  it("trae la dirección firmada de la foto del miembro", async () => {
    const { gateways } = fake({ photoPath: PHOTO_PATH });

    const record = await readRecord(gateways);

    expect(record.photoUrl).toBe(
      `${SIGNED_PHOTO_ORIGIN}/${PHOTO_PATH}?token=firma`,
    );
  });

  it("no expone la ruta interna de la foto en Storage", async () => {
    const { gateways } = fake({ photoPath: PHOTO_PATH });

    const record = await readRecord(gateways);

    expect(record).not.toHaveProperty("photoPath");
  });

  it("trae la foto en null y no firma nada si el miembro no tiene", async () => {
    const { gateways, reads } = fake({ photoPath: null });

    const record = await readRecord(gateways);

    expect(record.photoUrl).toBeNull();
    expect(reads.some((read) => read.startsWith("sign"))).toBe(false);
  });

  it("trae la foto en null si Storage no firma esa ruta", async () => {
    const { gateways } = fake({
      photoPath: PHOTO_PATH,
      photoSigning: "unsigned",
    });

    const record = await readRecord(gateways);

    expect(record.photoUrl).toBeNull();
  });

  it("trae la foto en null y el resto de la ficha si firmar falla", async () => {
    const { gateways } = fake({
      photoPath: PHOTO_PATH,
      photoSigning: "failed",
      aufNumber: "AUF-1",
      groupIds: [SENIOR_ID],
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const record = await readRecord(gateways);

    expect(record.photoUrl).toBeNull();
    expect(record.aufNumber).toBe("AUF-1");
    expect(record.groups).toEqual([{ id: SENIOR_ID, name: "Senior Squad" }]);
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("Storage no responde."),
    );
    logged.mockRestore();
  });

  it("devuelve la foto también tras guardar la ficha", async () => {
    const record = await save(
      fake({ photoPath: PHOTO_PATH, ...UNCHANGED_AUF }),
    );

    expect(record.photoUrl).toBe(
      `${SIGNED_PHOTO_ORIGIN}/${PHOTO_PATH}?token=firma`,
    );
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

describe("corregir la fecha de nacimiento", () => {
  it("guarda la fecha corregida de un mayor que sigue siendo mayor", async () => {
    const store = fake();

    const record = await save(store, { dateOfBirth: "1988-11-02" });

    expect(record).toMatchObject({
      dateOfBirth: "1988-11-02",
      accountStatus: "active",
    });
    expect(store.writes).toContain("birth 1988-11-02 active->active");
  });

  it("pasa a incomplete a quien queda menor sin consentimiento de tutor", async () => {
    const store = fake();

    const record = await save(store, { dateOfBirth: MINOR_BIRTH });

    expect(record).toMatchObject({
      dateOfBirth: MINOR_BIRTH,
      accountStatus: "incomplete",
      hasGuardianConsent: false,
    });
    expect(store.writes).toContain(`birth ${MINOR_BIRTH} active->incomplete`);
  });

  it("mide la edad el día del registro, no hoy", async () => {
    const store = fake();
    // 18 años se cumplen el 2024-03-07: el día del registro todavía tenía 17,
    // aunque hoy ya es mayor.
    const seventeenOnRegistration = "2006-03-07";

    const record = await save(store, { dateOfBirth: seventeenOnRegistration });

    expect(record.accountStatus).toBe("incomplete");
  });

  it("no cambia el estado de quien queda menor y ya tiene consentimiento", async () => {
    const store = fake({ hasGuardianConsent: true });

    const record = await save(store, { dateOfBirth: MINOR_BIRTH });

    expect(record).toMatchObject({
      dateOfBirth: MINOR_BIRTH,
      accountStatus: "active",
    });
  });

  it("no cambia el estado de quien era menor y queda mayor, y conserva su consentimiento", async () => {
    const store = fake({ dateOfBirth: MINOR_BIRTH, hasGuardianConsent: true });

    const record = await save(store, { dateOfBirth: ADULT_BIRTH });

    expect(record).toMatchObject({
      dateOfBirth: ADULT_BIRTH,
      accountStatus: "active",
      hasGuardianConsent: true,
    });
  });

  it.each(["incomplete", "inactive"] as const)(
    "deja %s una cuenta que ya no estaba activa",
    async (memberStatus) => {
      const store = fake({ memberStatus });

      const record = await save(store, { dateOfBirth: MINOR_BIRTH });

      expect(record.accountStatus).toBe(memberStatus);
    },
  );

  it("no escribe la fecha si no cambió", async () => {
    const store = fake(UNCHANGED_AUF);

    await save(store, { dateOfBirth: ADULT_BIRTH });

    expect(store.writes.some((write) => write.startsWith("birth"))).toBe(false);
    expect(store.auditRows).toEqual([]);
  });

  it("deja sin fecha a quien todavía no la tenía si no se da ninguna", async () => {
    const store = fake({ dateOfBirth: null, memberStatus: "incomplete" });

    const record = await save(store, { dateOfBirth: null });

    expect(record.dateOfBirth).toBeNull();
    expect(store.writes.some((write) => write.startsWith("birth"))).toBe(false);
  });

  it("da la primera fecha a quien todavía no la tenía", async () => {
    const store = fake({ dateOfBirth: null, memberStatus: "incomplete" });

    const record = await save(store, { dateOfBirth: ADULT_BIRTH });

    expect(record.dateOfBirth).toBe(ADULT_BIRTH);
  });

  it("no deja borrar una fecha que ya estaba, sin escribir nada", async () => {
    const store = fake();

    const issues = await issuesOf(save(store, { dateOfBirth: null }));

    expect(issues).toEqual([
      { field: "dateOfBirth", code: "date_of_birth_required" },
    ]);
    expect(store.writes).toEqual([]);
  });

  it.each([
    ["2026-09-22", "date_of_birth_in_future"],
    ["1899-12-31", "date_of_birth_too_early"],
    ["2010-02-30", "date_of_birth_not_a_date"],
    ["01/01/2010", "date_of_birth_not_a_date"],
    ["", "date_of_birth_not_a_date"],
  ])(
    "rechaza la fecha %j (%s) sin leer ni escribir nada",
    async (dateOfBirth, code) => {
      const store = fake();

      const issues = await issuesOf(save(store, { dateOfBirth }));

      expect(issues).toEqual([{ field: "dateOfBirth", code }]);
      expect(store.reads).toEqual([]);
      expect(store.writes).toEqual([]);
    },
  );

  it("acepta la fecha de hoy y el 1 de enero de 1900", async () => {
    await expect(
      save(fake(), { dateOfBirth: TODAY_IN_CLUB }),
    ).resolves.toMatchObject({ dateOfBirth: TODAY_IN_CLUB });
    await expect(
      save(fake(), { dateOfBirth: "1900-01-01" }),
    ).resolves.toMatchObject({ dateOfBirth: "1900-01-01" });
  });

  it("responde con un conflicto si el estado de la cuenta cambió a medias", async () => {
    const store = fake({ statusChangesMidway: true });

    await expect(
      save(store, { dateOfBirth: MINOR_BIRTH }),
    ).rejects.toBeInstanceOf(MemberRecordConflictError);
    expect(store.auditRows).toEqual([]);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "rechaza la corrección de un %s sin escribir nada",
    async (callerRole) => {
      const store = fake({ callerRole });

      await expect(
        save(store, { dateOfBirth: MINOR_BIRTH }),
      ).rejects.toBeInstanceOf(MemberRecordForbiddenError);
      expect(store.writes).toEqual([]);
      expect(store.auditRows).toEqual([]);
    },
  );
});

describe("bitácora de la corrección de la fecha de nacimiento", () => {
  it("guarda quién la hizo, sobre quién y el resultado", async () => {
    const store = fake(UNCHANGED_AUF);

    await save(store, { dateOfBirth: MINOR_BIRTH });

    expect(store.auditRows).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: ADMIN_ID,
        action: "member.date_of_birth_corrected",
        entity_type: "member",
        entity_id: MEMBER_ID,
        result: "success",
        metadata: null,
      },
    ]);
  });

  it("no guarda la fecha nueva ni la anterior", async () => {
    const store = fake();

    await save(store, { dateOfBirth: MINOR_BIRTH });

    const logged = JSON.stringify(store.auditRows);
    expect(logged).not.toContain(MINOR_BIRTH);
    expect(logged).not.toContain(ADULT_BIRTH);
  });
});

describe("aviso del consentimiento del tutor", () => {
  const activeWithoutConsent = {
    accountStatus: "active",
    registeredAt: REGISTERED_AT,
    hasGuardianConsent: false,
  } as const;

  it("avisa cuando la fecha deja menor a una cuenta activa sin consentimiento", () => {
    expect(
      correctionRequiresGuardianConsent(activeWithoutConsent, MINOR_BIRTH),
    ).toBe(true);
  });

  it.each([
    ["con la fecha de un mayor", activeWithoutConsent, ADULT_BIRTH],
    [
      "con consentimiento ya dado",
      { ...activeWithoutConsent, hasGuardianConsent: true },
      MINOR_BIRTH,
    ],
    [
      "con la cuenta sin activar",
      { ...activeWithoutConsent, accountStatus: "incomplete" },
      MINOR_BIRTH,
    ],
  ] as const)("no avisa %s", (_case, record, dateOfBirth) => {
    expect(correctionRequiresGuardianConsent(record, dateOfBirth)).toBe(false);
  });
});

describe("el AUF que escribe el Admin nace verificado", () => {
  it("queda verificado al escribirlo en la ficha", async () => {
    const store = fake();

    const record = await save(store);

    expect(record).toMatchObject({
      aufNumber: "AUF-2026-0042",
      isAufVerified: true,
    });
  });

  it("queda verificado al corregir uno que el miembro propuso", async () => {
    const store = fake({ aufNumber: "AUF-MAL", aufExpiry: "2027-03-31" });

    const record = await save(store);

    expect(record).toMatchObject({
      aufNumber: "AUF-2026-0042",
      isAufVerified: true,
    });
  });

  it("no toca el AUF que el miembro propuso mientras el Admin tenía la ficha abierta", async () => {
    // El Admin abrió la ficha con otro AUF; el miembro propuso éste después.
    const store = fake({
      aufNumber: "AUF-NUEVO",
      aufExpiry: "2028-01-31",
      isAufVerified: false,
    });

    const record = await saveKeepingAuf(store, [SENIOR_ID]);

    expect(record).toMatchObject({
      aufNumber: "AUF-NUEVO",
      aufExpiry: "2028-01-31",
      isAufVerified: false,
    });
    expect(store.writes.some((write) => write.startsWith("auf"))).toBe(false);
    expect(store.auditRows).toEqual([]);
  });

  it("no toca un AUF pendiente si guarda la ficha sin cambiarlo", async () => {
    const store = fake({ ...UNCHANGED_AUF, isAufVerified: false });

    const record = await save(store, { groupIds: [SENIOR_ID] });

    expect(record.isAufVerified).toBe(false);
    expect(store.writes.some((write) => write.startsWith("auf"))).toBe(false);
  });

  it("guarda en la bitácora quién lo verificó al escribirlo", async () => {
    const store = fake();

    await save(store);

    expect(store.auditRows).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: ADMIN_ID,
        action: "member.auf_verified",
        entity_type: "member",
        entity_id: MEMBER_ID,
        result: "success",
        metadata: null,
      },
    ]);
  });

  it("no deja rastro de verificación al borrar el AUF", async () => {
    const store = fake(UNCHANGED_AUF);

    await save(store, { aufNumber: null, aufExpiry: null });

    expect(store.auditRows).toEqual([]);
  });
});

async function verify(
  store: Fake,
  expected: { readonly aufNumber: string; readonly aufExpiry: string | null },
  callerId: string = ADMIN_ID,
): ReturnType<typeof verifyMemberAuf> {
  return verifyMemberAuf(store.gateways, {
    callerId,
    userId: MEMBER_ID,
    expected,
    todayInClub: TODAY_IN_CLUB,
  });
}

const PENDING = { aufNumber: "AUF-9", aufExpiry: "2027-06-30" } as const;

describe("verificar el AUF", () => {
  it("el Admin confirma un AUF pendiente y queda verificado", async () => {
    const store = fake(PENDING);

    const record = await verify(store, PENDING);

    expect(record).toMatchObject({ ...PENDING, isAufVerified: true });
  });

  it("guarda en la bitácora quién lo verificó, sobre quién y sin el número", async () => {
    const store = fake(PENDING);

    await verify(store, PENDING);

    expect(store.auditRows).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: ADMIN_ID,
        action: "member.auf_verified",
        entity_type: "member",
        entity_id: MEMBER_ID,
        result: "success",
        metadata: null,
      },
    ]);
    expect(JSON.stringify(store.auditRows)).not.toContain("AUF-9");
  });

  it("verifica también uno sin vencimiento", async () => {
    const store = fake({ aufNumber: "AUF-9", aufExpiry: null });

    const record = await verify(store, { aufNumber: "AUF-9", aufExpiry: null });

    expect(record.isAufVerified).toBe(true);
  });

  it("no repite la verificación ni la bitácora de uno ya verificado", async () => {
    const store = fake({ ...PENDING, isAufVerified: true });

    const record = await verify(store, PENDING);

    expect(record.isAufVerified).toBe(true);
    expect(store.writes).toEqual([]);
    expect(store.auditRows).toEqual([]);
  });

  it("responde con un conflicto si el AUF no es el que el Admin vio", async () => {
    const store = fake(PENDING);

    await expect(
      verify(store, { aufNumber: "AUF-9", aufExpiry: "2028-01-01" }),
    ).rejects.toBeInstanceOf(MemberAufChangedError);
    expect(store.writes).toEqual([]);
    expect(store.auditRows).toEqual([]);
  });

  it("responde con un conflicto si el miembro ya no tiene AUF", async () => {
    const store = fake();

    await expect(verify(store, PENDING)).rejects.toBeInstanceOf(
      MemberAufChangedError,
    );
  });

  it("responde con un conflicto si el miembro lo cambió mientras se verificaba", async () => {
    const store = fake({ ...PENDING, aufChangesMidway: true });

    await expect(verify(store, PENDING)).rejects.toBeInstanceOf(
      MemberAufChangedError,
    );
    expect(store.auditRows).toEqual([]);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "rechaza a un %s sin escribir nada",
    async (callerRole) => {
      const store = fake({ ...PENDING, callerRole });

      await expect(verify(store, PENDING)).rejects.toBeInstanceOf(
        MemberRecordForbiddenError,
      );
      expect(store.writes).toEqual([]);
      expect(store.auditRows).toEqual([]);
    },
  );

  it("responde que no existe un miembro de otro club", async () => {
    const store = fake({ ...PENDING, memberClubId: OTHER_CLUB_ID });

    await expect(verify(store, PENDING)).rejects.toBeInstanceOf(
      MemberRecordNotFoundError,
    );
  });

  it("un AUF verificado que vence sigue verificado y se marca vencido", async () => {
    const store = fake({
      aufNumber: "AUF-9",
      aufExpiry: "2026-09-20",
      isAufVerified: true,
    });

    const record = await readMemberRecord(store.gateways, {
      callerId: ADMIN_ID,
      userId: MEMBER_ID,
      todayInClub: TODAY_IN_CLUB,
    });

    expect(record).toMatchObject({ isAufVerified: true, isAufExpired: true });
  });
});
