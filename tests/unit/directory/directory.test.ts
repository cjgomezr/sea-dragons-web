import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { Role } from "@/lib/auth/roles";
import {
  DEFAULT_DIRECTORY_QUERY,
  DIRECTORY_FILTERS,
  type DirectoryGateways,
  DirectoryFilterForbiddenError,
  DirectoryForbiddenError,
  type DirectoryMemberRecord,
  type DirectoryQuery,
  type DirectoryListing,
  listDirectory,
  withMemberRole,
} from "@/lib/directory/directory";
import type { MemberAttendance } from "@/lib/attendance/attendance-stats";
import type { ClubPosition } from "@/lib/club/club-positions";

/**
 * El directorio del club (#238, RF-2 del PRD de E5, FR-015 a FR-019),
 * contado sin Supabase delante: quién lo ve, a quién trae, en qué orden y qué
 * campos lleva cada socio.
 *
 * El club de quien pregunta sale de su propia fila y nunca de un parámetro,
 * como en el resto de las lecturas de club (NFR-009).
 */

const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const TODAY = "2026-09-21";

/** En el orden que decidió el club, que no es el del SRD ni el alfabético:
 * así el orden por posición sólo sale bien si sigue al club (#299). */
const FORWARD: ClubPosition = {
  id: "f0f0f0f0-0000-4000-8000-000000000003",
  names: { en: "Forward", es: "Ataque" },
  isArchived: false,
};
const GOALKEEPER: ClubPosition = {
  id: "f0f0f0f0-0000-4000-8000-000000000001",
  names: { en: "Goalkeeper", es: "Portería" },
  isArchived: false,
};
const DEFENDER: ClubPosition = {
  id: "f0f0f0f0-0000-4000-8000-000000000002",
  names: { en: "Defender", es: null },
  // Archivada: quien la tenía la conserva, y el directorio la sigue enseñando.
  isArchived: true,
};
const CLUB_POSITIONS = [FORWARD, GOALKEEPER, DEFENDER] as const;
const clubsWhosePositionsWereRead: string[] = [];
const positionsReferenced: (readonly string[])[] = [];

const SENIOR_GROUP_ID = "9a9a9a9a-0000-4000-8000-000000000001";
const JUNIOR_GROUP_ID = "9a9a9a9a-0000-4000-8000-000000000002";

const ANA: DirectoryMemberRecord = {
  userId: "aaaaaaaa-0000-4000-8000-00000000000a",
  fullName: "Ana Admin",
  country: "AU",
  experienceLevel: "Advanced",
  role: "Admin",
  positionId: null,
  status: "active",
  aufNumber: "AUF-1",
  aufExpiry: "2027-01-31",
  isAufVerified: true,
  photoPath: "aaaaaaaa-0000-4000-8000-00000000000a/foto.webp",
  isEvaluated: true,
  membershipStatus: "active",
  groupIds: [SENIOR_GROUP_ID],
  email: "ana@club.test",
  phone: "0412 345 678",
  emergencyContact: {
    name: "Luis Admin",
    phone: "0499 111 222",
    relationship: "Pareja",
  },
};

const BRUNO: DirectoryMemberRecord = {
  userId: "bbbbbbbb-0000-4000-8000-00000000000b",
  fullName: "Bruno Beltrán",
  country: "CO",
  experienceLevel: "Beginner",
  role: "Coach",
  positionId: GOALKEEPER.id,
  status: "active",
  aufNumber: "AUF-2",
  aufExpiry: "2026-09-20",
  isAufVerified: true,
  photoPath: null,
  isEvaluated: false,
  membershipStatus: "pending",
  groupIds: [JUNIOR_GROUP_ID],
  email: "bruno@club.test",
  // Sin teléfono propio, que es opcional (D1), y con contacto de emergencia.
  phone: null,
  emergencyContact: {
    name: "Rosa Beltrán",
    phone: "+57 300 123 4567",
    relationship: "Madre",
  },
};

const MARIA: DirectoryMemberRecord = {
  userId: "cccccccc-0000-4000-8000-00000000000c",
  fullName: "María Ñíguez",
  country: null,
  experienceLevel: "Intermediate",
  role: "Player",
  positionId: DEFENDER.id,
  status: "active",
  aufNumber: null,
  aufExpiry: null,
  isAufVerified: false,
  photoPath: null,
  isEvaluated: true,
  membershipStatus: "waived",
  groupIds: [SENIOR_GROUP_ID, JUNIOR_GROUP_ID],
  email: "maria@club.test",
  phone: "0400 000 111",
  emergencyContact: null,
};

const ZOE: DirectoryMemberRecord = {
  userId: "dddddddd-0000-4000-8000-00000000000d",
  fullName: "Zoe Zapata",
  country: "AU",
  experienceLevel: null,
  role: "Committee",
  positionId: FORWARD.id,
  status: "inactive",
  aufNumber: "AUF-4",
  aufExpiry: TODAY,
  // Lo escribió la socia y ningún Admin lo ha verificado todavía (#274).
  isAufVerified: false,
  photoPath: "dddddddd-0000-4000-8000-00000000000d/foto.png",
  isEvaluated: false,
  membershipStatus: null,
  groupIds: [],
  email: "zoe@club.test",
  phone: null,
  emergencyContact: null,
};

const CLUB: readonly DirectoryMemberRecord[] = [ZOE, MARIA, ANA, BRUNO];

/** Ana y Zoe empatan: el nombre decide entre las dos. Bruno no tiene
 * sesiones elegibles (AC-017b). */
const ATTENDANCE: ReadonlyMap<string, MemberAttendance> = new Map([
  [ANA.userId, { kind: "rate", percent: 90, sessions: 9 }],
  [BRUNO.userId, { kind: "no_data" }],
  [MARIA.userId, { kind: "rate", percent: 40, sessions: 2 }],
  [ZOE.userId, { kind: "rate", percent: 90, sessions: 5 }],
]);

type AttendanceRequest = {
  readonly clubId: string;
  readonly userIds: readonly string[];
};

const attendanceRequests: AttendanceRequest[] = [];

const clubsRead: string[] = [];
const photosSigned: string[] = [];

function signedUrlOf(photoPath: string): string {
  return `https://storage.test/${photoPath}?token=t`;
}

function gateways(
  options: { readonly callerRole?: Role; readonly member?: null } = {},
): DirectoryGateways {
  clubsRead.length = 0;
  photosSigned.length = 0;
  clubsWhosePositionsWereRead.length = 0;
  positionsReferenced.length = 0;
  attendanceRequests.length = 0;
  return {
    members: {
      findRoleRequestMember: async () =>
        options.member === null
          ? null
          : {
              clubId: CLUB_ID,
              fullName: "Quien pregunta",
              role: options.callerRole ?? "Player",
            },
    },
    directory: {
      findDirectoryMembers: async (clubId) => {
        clubsRead.push(clubId);
        return CLUB;
      },
    },
    positions: {
      findClubPositions: async (clubId, referencedIds) => {
        clubsWhosePositionsWereRead.push(clubId);
        positionsReferenced.push(referencedIds);
        return CLUB_POSITIONS;
      },
    },
    photos: {
      signPhotoUrls: async (photoPaths) => {
        photosSigned.push(...photoPaths);
        return new Map(photoPaths.map((path) => [path, signedUrlOf(path)]));
      },
    },
    attendance: {
      findMemberAttendance: async (clubId, userIds) => {
        // En orden, para que el test no dependa del de la lista.
        attendanceRequests.push({ clubId, userIds: [...userIds].sort() });
        return new Map(
          [...ATTENDANCE].filter(([userId]) => userIds.includes(userId)),
        );
      },
    },
  };
}

async function listNames(
  query: Partial<DirectoryQuery> = {},
  callerRole: Role = "Player",
): Promise<readonly string[]> {
  const listing = await listDirectory(gateways({ callerRole }), {
    callerId: CALLER_ID,
    query: { ...DEFAULT_DIRECTORY_QUERY, ...query },
    todayInClub: TODAY,
  });
  return listing.members.map((member) => member.fullName);
}

describe("directorio", () => {
  it("sirve firmada la foto de quien tiene una, y null a quien no", async () => {
    const listing = await listDirectory(gateways(), {
      callerId: CALLER_ID,
      query: DEFAULT_DIRECTORY_QUERY,
      todayInClub: TODAY,
    });

    expect(
      listing.members.map((member) => [member.fullName, member.photoUrl]),
    ).toEqual([
      ["Ana Admin", signedUrlOf(ANA.photoPath ?? "")],
      ["Bruno Beltrán", null],
      ["María Ñíguez", null],
    ]);
  });

  it("enseña las iniciales de quien tiene una foto que no se pudo firmar, y el resto de la lista sigue", async () => {
    const unsigned = gateways();
    const listing = await listDirectory(
      { ...unsigned, photos: { signPhotoUrls: async () => new Map() } },
      {
        callerId: CALLER_ID,
        query: DEFAULT_DIRECTORY_QUERY,
        todayInClub: TODAY,
      },
    );

    expect(
      listing.members.map((member) => [member.fullName, member.photoUrl]),
    ).toEqual([
      ["Ana Admin", null],
      ["Bruno Beltrán", null],
      ["María Ñíguez", null],
    ]);
  });

  it("no firma la foto de quien no sale en la lista", async () => {
    await listDirectory(gateways(), {
      callerId: CALLER_ID,
      query: DEFAULT_DIRECTORY_QUERY,
      todayInClub: TODAY,
    });

    expect(photosSigned).toEqual([ANA.photoPath]);
  });

  it("no cuenta la ruta de la foto, sólo su dirección firmada", async () => {
    const listing = await listDirectory(gateways(), {
      callerId: CALLER_ID,
      query: DEFAULT_DIRECTORY_QUERY,
      todayInClub: TODAY,
    });

    for (const member of listing.members) {
      expect(Object.keys(member)).not.toContain("photoPath");
    }
  });

  it("trae a los socios del club de quien pregunta, por nombre ascendente", async () => {
    const listing = await listDirectory(gateways(), {
      callerId: CALLER_ID,
      query: DEFAULT_DIRECTORY_QUERY,
      todayInClub: TODAY,
    });

    expect(listing.members.map((member) => member.fullName)).toEqual([
      "Ana Admin",
      "Bruno Beltrán",
      "María Ñíguez",
    ]);
    expect(clubsRead).toEqual([CLUB_ID]);
  });

  it("describe a cada socio con los campos del directorio y ninguno más", async () => {
    const listing = await listDirectory(gateways(), {
      callerId: CALLER_ID,
      query: { ...DEFAULT_DIRECTORY_QUERY, search: "maria" },
      todayInClub: TODAY,
    });

    expect(listing.members).toEqual([
      {
        userId: MARIA.userId,
        fullName: "María Ñíguez",
        country: null,
        experienceLevel: "Intermediate",
        role: "Player",
        position: { id: DEFENDER.id, names: DEFENDER.names },
        status: "active",
        photoUrl: null,
        attendance: { kind: "rate", percent: 40, sessions: 2 },
      },
    ]);
  });

  it("trae a un Player el porcentaje de los demás, o sin datos (FR-015)", async () => {
    const listing = await listDirectory(gateways({ callerRole: "Player" }), {
      callerId: CALLER_ID,
      query: DEFAULT_DIRECTORY_QUERY,
      todayInClub: TODAY,
    });

    expect(
      listing.members.map((member) => [member.fullName, member.attendance]),
    ).toEqual([
      ["Ana Admin", { kind: "rate", percent: 90, sessions: 9 }],
      ["Bruno Beltrán", { kind: "no_data" }],
      ["María Ñíguez", { kind: "rate", percent: 40, sessions: 2 }],
    ]);
  });

  it("cuenta la asistencia de toda la lista en una sola consulta (NFR-008)", async () => {
    await listNames({ search: "a" });

    expect(attendanceRequests).toEqual([
      {
        clubId: CLUB_ID,
        userIds: [ANA.userId, BRUNO.userId, MARIA.userId].sort(),
      },
    ]);
  });

  it("lee las posiciones del club de quien pregunta", async () => {
    await listNames();

    expect(clubsWhosePositionsWereRead).toEqual([CLUB_ID]);
  });

  it("pide al catálogo las posiciones de los socios que tiene que pintar", async () => {
    await listNames();

    expect(positionsReferenced).toEqual([
      [GOALKEEPER.id, DEFENDER.id, FORWARD.id].sort(),
    ]);
  });

  it.each(["Player", "Admin"] as const)(
    "no enseña la fecha de nacimiento ni a un %s",
    async (callerRole) => {
      const listing = await listDirectory(gateways({ callerRole }), {
        callerId: CALLER_ID,
        query: DEFAULT_DIRECTORY_QUERY,
        todayInClub: TODAY,
      });

      for (const member of listing.members) {
        expect(Object.keys(member)).not.toContain("dateOfBirth");
      }
    },
  );

  it("encuentra un nombre sin distinguir acentos ni mayúsculas", async () => {
    await expect(listNames({ search: "maria niguez" })).resolves.toEqual([
      "María Ñíguez",
    ]);
  });

  it("busca en cualquier parte del nombre", async () => {
    await expect(listNames({ search: "BELTR" })).resolves.toEqual([
      "Bruno Beltrán",
    ]);
  });

  it("devuelve la lista vacía cuando nadie lleva ese nombre", async () => {
    await expect(listNames({ search: "nadie" })).resolves.toEqual([]);
  });

  it("filtra por rol", async () => {
    await expect(listNames({ role: "Coach" })).resolves.toEqual([
      "Bruno Beltrán",
    ]);
  });

  it("no trae a los socios dados de baja", async () => {
    await expect(listNames()).resolves.not.toContain("Zoe Zapata");
  });

  it("trae a los dados de baja, marcados, cuando un Admin los pide", async () => {
    const listing = await listDirectory(gateways({ callerRole: "Admin" }), {
      callerId: CALLER_ID,
      query: { ...DEFAULT_DIRECTORY_QUERY, includeInactive: true },
      todayInClub: TODAY,
    });

    expect(
      listing.members.map((member) => [member.fullName, member.status]),
    ).toContainEqual(["Zoe Zapata", "inactive"]);
  });

  it("cuenta a todo el club activo aunque la búsqueda y el rol recorten la lista (#548)", async () => {
    const listing = await listDirectory(gateways(), {
      callerId: CALLER_ID,
      query: { ...DEFAULT_DIRECTORY_QUERY, role: "Coach", search: "bru" },
      todayInClub: TODAY,
    });

    expect(listing.members).toHaveLength(1);
    expect(listing.total).toBe(3);
  });

  it("cuenta también a los dados de baja cuando un Admin los pide (#548)", async () => {
    const listing = await listDirectory(gateways({ callerRole: "Admin" }), {
      callerId: CALLER_ID,
      query: { ...DEFAULT_DIRECTORY_QUERY, includeInactive: true },
      todayInClub: TODAY,
    });

    expect(listing.total).toBe(4);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "niega los dados de baja a un %s, sin leer el directorio",
    async (callerRole) => {
      const wiring = gateways({ callerRole });

      await expect(
        listDirectory(wiring, {
          callerId: CALLER_ID,
          query: { ...DEFAULT_DIRECTORY_QUERY, includeInactive: true },
          todayInClub: TODAY,
        }),
      ).rejects.toBeInstanceOf(DirectoryForbiddenError);
      expect(clubsRead).toEqual([]);
    },
  );

  it("rechaza a quien no tiene fila de socio", async () => {
    await expect(
      listDirectory(gateways({ member: null }), {
        callerId: CALLER_ID,
        query: DEFAULT_DIRECTORY_QUERY,
        todayInClub: TODAY,
      }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});

describe("el orden del directorio", () => {
  async function orderedBy(
    sort: DirectoryQuery["sort"],
    direction: DirectoryQuery["direction"],
  ): Promise<readonly string[]> {
    return listNames({ sort, direction, includeInactive: true }, "Admin");
  }

  it.each([
    [
      "name",
      "asc",
      ["Ana Admin", "Bruno Beltrán", "María Ñíguez", "Zoe Zapata"],
    ],
    [
      "name",
      "desc",
      ["Zoe Zapata", "María Ñíguez", "Bruno Beltrán", "Ana Admin"],
    ],
    // El catálogo de FR-012, no el alfabeto: Admin, Coach, Committee, Player.
    [
      "role",
      "asc",
      ["Ana Admin", "Bruno Beltrán", "Zoe Zapata", "María Ñíguez"],
    ],
    [
      "role",
      "desc",
      ["María Ñíguez", "Zoe Zapata", "Bruno Beltrán", "Ana Admin"],
    ],
    // El orden del club (#299): Forward, Goalkeeper, Defender. Sin posición,
    // al final en los dos sentidos.
    [
      "position",
      "asc",
      ["Zoe Zapata", "Bruno Beltrán", "María Ñíguez", "Ana Admin"],
    ],
    [
      "position",
      "desc",
      ["María Ñíguez", "Bruno Beltrán", "Zoe Zapata", "Ana Admin"],
    ],
    // Sin datos al final en los dos sentidos (AC-010); Ana y Zoe empatan y
    // las ordena el nombre.
    [
      "attendance",
      "asc",
      ["María Ñíguez", "Ana Admin", "Zoe Zapata", "Bruno Beltrán"],
    ],
    [
      "attendance",
      "desc",
      ["Ana Admin", "Zoe Zapata", "María Ñíguez", "Bruno Beltrán"],
    ],
  ] as const)("ordena por %s %s", async (sort, direction, expected) => {
    await expect(orderedBy(sort, direction)).resolves.toEqual(expected);
  });
});

describe("la membresía en el directorio (#453)", () => {
  it("le da al Admin el estado de la membresía de cada socio", async () => {
    const listing = await listDirectory(gateways({ callerRole: "Admin" }), {
      callerId: CALLER_ID,
      query: { ...DEFAULT_DIRECTORY_QUERY, includeInactive: true },
      todayInClub: TODAY,
    });
    if (listing.kind !== "admin") {
      throw new Error("Un Admin tiene que recibir la vista de Admin.");
    }

    expect(
      Object.fromEntries(
        listing.members.map((member) => [
          member.fullName,
          member.membershipStatus,
        ]),
      ),
    ).toEqual({
      [ANA.fullName]: "active",
      [BRUNO.fullName]: "pending",
      [MARIA.fullName]: "waived",
      [ZOE.fullName]: null,
    });
  });

  it.each<Role>(["Coach", "Committee", "Player"])(
    "no le da el estado de la membresía a un %s, y lista igual a quien no está al día",
    async (callerRole) => {
      const listing = await listDirectory(gateways({ callerRole }), {
        callerId: CALLER_ID,
        query: DEFAULT_DIRECTORY_QUERY,
        todayInClub: TODAY,
      });

      expect(listing.members.map((member) => member.fullName)).toContain(
        BRUNO.fullName,
      );
      for (const member of listing.members) {
        expect(member).not.toHaveProperty("membershipStatus");
      }
    },
  );
});

describe("el AUF en el directorio", () => {
  async function listForAdmin(): Promise<
    ReadonlyMap<string, Record<string, unknown>>
  > {
    const listing = await listDirectory(gateways({ callerRole: "Admin" }), {
      callerId: CALLER_ID,
      query: { ...DEFAULT_DIRECTORY_QUERY, includeInactive: true },
      todayInClub: TODAY,
    });
    if (listing.kind !== "admin") {
      throw new Error("Un Admin tiene que recibir la vista de Admin.");
    }
    return new Map(
      listing.members.map((member) => [member.fullName, { ...member }]),
    );
  }

  it("añade a cada socio su AUF y su vencimiento cuando pregunta un Admin", async () => {
    const members = await listForAdmin();

    expect(members.get("Ana Admin")).toMatchObject({
      aufNumber: "AUF-1",
      aufExpiry: "2027-01-31",
      isAufExpired: false,
    });
  });

  it("marca vencido el registro que caducó antes de hoy", async () => {
    const members = await listForAdmin();

    expect(members.get("Bruno Beltrán")).toMatchObject({
      aufExpiry: "2026-09-20",
      isAufExpired: true,
    });
  });

  it("no marca vencido el registro que caduca hoy", async () => {
    const members = await listForAdmin();

    expect(members.get("Zoe Zapata")).toMatchObject({
      aufExpiry: TODAY,
      isAufExpired: false,
    });
  });

  it("no da por vencido a quien no tiene registro", async () => {
    const members = await listForAdmin();

    expect(members.get("María Ñíguez")).toMatchObject({
      aufNumber: null,
      aufExpiry: null,
      isAufExpired: false,
    });
  });

  it("marca sin verificar el AUF que escribió el socio", async () => {
    const members = await listForAdmin();

    expect(members.get("Zoe Zapata")).toMatchObject({
      aufNumber: "AUF-4",
      isAufVerified: false,
    });
  });

  it("marca verificado el AUF que confirmó un Admin", async () => {
    const members = await listForAdmin();

    expect(members.get("Ana Admin")).toMatchObject({ isAufVerified: true });
  });

  it("un AUF verificado que venció sigue verificado y además vencido", async () => {
    const members = await listForAdmin();

    expect(members.get("Bruno Beltrán")).toMatchObject({
      isAufVerified: true,
      isAufExpired: true,
    });
  });

  it.each([
    ["Coach", "coach"],
    ["Committee", "committee"],
    ["Player", "member"],
  ] as const)(
    "no le cuenta el AUF ni su verificación a un %s",
    async (callerRole, expectedKind) => {
      const listing = await listDirectory(gateways({ callerRole }), {
        callerId: CALLER_ID,
        query: DEFAULT_DIRECTORY_QUERY,
        todayInClub: TODAY,
      });

      expect(listing.kind).toBe(expectedKind);
      for (const member of listing.members) {
        expect(Object.keys(member)).not.toContain("aufNumber");
        expect(Object.keys(member)).not.toContain("isAufVerified");
      }
    },
  );
});

describe("marca de sin evaluar", () => {
  async function listFor(
    callerRole: Role,
  ): Promise<ReadonlyMap<string, Record<string, unknown>>> {
    const listing = await listDirectory(gateways({ callerRole }), {
      callerId: CALLER_ID,
      query: DEFAULT_DIRECTORY_QUERY,
      todayInClub: TODAY,
    });
    return new Map(
      listing.members.map((member) => [member.fullName, { ...member }]),
    );
  }

  it.each(["Admin", "Coach"] as const)(
    "le dice a un %s quién tiene evaluación y quién no",
    async (callerRole) => {
      const members = await listFor(callerRole);

      expect(members.get("Ana Admin")).toMatchObject({ isEvaluated: true });
      expect(members.get("Bruno Beltrán")).toMatchObject({
        isEvaluated: false,
      });
    },
  );

  it("un Coach recibe la vista con la evaluación, sin lo del Admin", async () => {
    const listing = await listDirectory(gateways({ callerRole: "Coach" }), {
      callerId: CALLER_ID,
      query: { ...DEFAULT_DIRECTORY_QUERY, search: "bruno" },
      todayInClub: TODAY,
    });

    expect(listing).toEqual({
      kind: "coach",
      members: [
        {
          userId: BRUNO.userId,
          fullName: "Bruno Beltrán",
          country: "CO",
          experienceLevel: "Beginner",
          role: "Coach",
          position: { id: GOALKEEPER.id, names: GOALKEEPER.names },
          status: "active",
          photoUrl: null,
          attendance: { kind: "no_data" },
          isEvaluated: false,
          emergencyContact: BRUNO.emergencyContact,
        },
      ],
      availableFilters: ["position", "group"],
      total: 3,
    });
  });

  it.each(["Committee", "Player"] as const)(
    "a un %s no le manda si nadie está evaluado, ni siquiera él",
    async (callerRole) => {
      const members = await listFor(callerRole);

      for (const member of members.values()) {
        expect(Object.keys(member)).not.toContain("isEvaluated");
      }
    },
  );
});

describe("el rol nuevo en la lista (#240)", () => {
  const NEREA = {
    userId: "bbbbbbbb-0000-4000-8000-00000000000b",
    fullName: "Nerea Ruiz",
    country: "ES",
    experienceLevel: "Beginner",
    role: "Player",
    position: { id: GOALKEEPER.id, names: GOALKEEPER.names },
    status: "active",
    photoUrl: null,
    attendance: { kind: "no_data" },
  } as const;
  const TOMAS = {
    ...NEREA,
    userId: "cccccccc-0000-4000-8000-00000000000c",
    fullName: "Tomás Errekondo",
  } as const;

  it("cambia sólo el rol del miembro nombrado", () => {
    const listing: DirectoryListing = {
      kind: "member",
      members: [NEREA, TOMAS],
      availableFilters: ["position"],
      total: 2,
    };

    expect(withMemberRole(listing, NEREA.userId, "Coach")).toEqual({
      kind: "member",
      members: [{ ...NEREA, role: "Coach" }, TOMAS],
      availableFilters: ["position"],
      total: 2,
    });
  });

  it("conserva lo que sólo ve un Admin", () => {
    const admin = {
      ...NEREA,
      aufNumber: "AUF-9",
      aufExpiry: "2020-01-31",
      isAufVerified: true,
      isAufExpired: true,
      isEvaluated: true,
      membershipStatus: "active" as const,
      email: "nerea@club.test",
      phone: null,
      emergencyContact: null,
    };
    const listing: DirectoryListing = {
      kind: "admin",
      members: [admin],
      availableFilters: DIRECTORY_FILTERS,
      total: 2,
    };

    expect(withMemberRole(listing, NEREA.userId, "Committee")).toEqual({
      kind: "admin",
      members: [{ ...admin, role: "Committee" }],
      availableFilters: DIRECTORY_FILTERS,
      total: 2,
    });
  });

  it("conserva el contacto de la vista del Committee (#499)", () => {
    const committeeView = {
      ...NEREA,
      email: "nerea@club.test",
      phone: "0412 000 000",
      emergencyContact: null,
    };
    const listing: DirectoryListing = {
      kind: "committee",
      members: [committeeView],
      availableFilters: ["position", "group"],
      total: 2,
    };

    expect(withMemberRole(listing, NEREA.userId, "Coach")).toEqual({
      kind: "committee",
      members: [{ ...committeeView, role: "Coach" }],
      availableFilters: ["position", "group"],
      total: 2,
    });
  });

  it("conserva la marca de evaluación de la vista del Coach", () => {
    const coachView = { ...NEREA, isEvaluated: false, emergencyContact: null };
    const listing: DirectoryListing = {
      kind: "coach",
      members: [coachView],
      availableFilters: ["position", "group"],
      total: 2,
    };

    expect(withMemberRole(listing, NEREA.userId, "Coach")).toEqual({
      kind: "coach",
      members: [{ ...coachView, role: "Coach" }],
      availableFilters: ["position", "group"],
      total: 2,
    });
  });
});

describe("los filtros del directorio (#497)", () => {
  /** Zoe tiene que estar para contar: es la única con el AUF que vence hoy. */
  function asAdmin(query: Partial<DirectoryQuery>): Promise<readonly string[]> {
    return listNames({ includeInactive: true, ...query }, "Admin");
  }

  it("filtra por una posición del catálogo", async () => {
    await expect(
      listNames({ position: { kind: "position", positionId: GOALKEEPER.id } }),
    ).resolves.toEqual(["Bruno Beltrán"]);
  });

  it("filtra a quien no tiene posición", async () => {
    await expect(
      listNames({ position: { kind: "unassigned" } }),
    ).resolves.toEqual(["Ana Admin"]);
  });

  it("devuelve la lista vacía con una posición que nadie tiene", async () => {
    await expect(
      listNames({
        position: {
          kind: "position",
          positionId: "f0f0f0f0-0000-4000-8000-0000000000ff",
        },
      }),
    ).resolves.toEqual([]);
  });

  it.each(["Admin", "Coach", "Committee"] as const)(
    "deja a un %s filtrar por grupo",
    async (callerRole) => {
      await expect(
        listNames({ groupId: SENIOR_GROUP_ID }, callerRole),
      ).resolves.toEqual(["Ana Admin", "María Ñíguez"]);
    },
  );

  it.each([
    ["missing", ["María Ñíguez"]],
    ["expired", ["Bruno Beltrán"]],
    // Vence hoy: todavía no está vencido, y vence dentro de los 30 días.
    ["expiring", ["Zoe Zapata"]],
    // Con número y sin la confirmación de un Admin; sin número no cuenta.
    ["unverified", ["Zoe Zapata"]],
  ] as const)("filtra el AUF %s", async (auf, expected) => {
    await expect(asAdmin({ auf })).resolves.toEqual(expected);
  });

  it.each([
    ["active", ["Ana Admin"]],
    ["pending", ["Bruno Beltrán"]],
    ["waived", ["María Ñíguez"]],
    ["trialing", []],
    ["past_due", []],
    ["cancelled", []],
    ["none", ["Zoe Zapata"]],
  ] as const)("filtra la membresía %s", async (membership, expected) => {
    await expect(asAdmin({ membership })).resolves.toEqual(expected);
  });

  it("combina los filtros entre sí y con la búsqueda, el rol y el orden", async () => {
    await expect(
      asAdmin({
        groupId: JUNIOR_GROUP_ID,
        membership: "pending",
        role: "Coach",
        search: "bruno",
      }),
    ).resolves.toEqual(["Bruno Beltrán"]);
    await expect(
      asAdmin({ groupId: SENIOR_GROUP_ID, sort: "name", direction: "desc" }),
    ).resolves.toEqual(["María Ñíguez", "Ana Admin"]);
    await expect(
      asAdmin({ groupId: SENIOR_GROUP_ID, auf: "expired" }),
    ).resolves.toEqual([]);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "niega a un %s los filtros del AUF y de la membresía, sin leer el directorio",
    async (callerRole) => {
      for (const query of [
        { auf: "expired" },
        { membership: "active" },
      ] as const) {
        const wiring = gateways({ callerRole });

        await expect(
          listDirectory(wiring, {
            callerId: CALLER_ID,
            query: { ...DEFAULT_DIRECTORY_QUERY, ...query },
            todayInClub: TODAY,
          }),
        ).rejects.toBeInstanceOf(DirectoryFilterForbiddenError);
        expect(clubsRead).toEqual([]);
      }
    },
  );

  it("niega a un Player el filtro por grupo y dice cuál", async () => {
    const rejection = listDirectory(gateways({ callerRole: "Player" }), {
      callerId: CALLER_ID,
      query: { ...DEFAULT_DIRECTORY_QUERY, groupId: SENIOR_GROUP_ID },
      todayInClub: TODAY,
    });

    await expect(rejection).rejects.toBeInstanceOf(
      DirectoryFilterForbiddenError,
    );
    await expect(rejection).rejects.toMatchObject({ filter: "group" });
  });

  it.each([
    ["Player", ["position"]],
    ["Coach", ["position", "group"]],
    [
      "Committee",
      ["position", "group", "withoutPhone", "withoutEmergencyContact"],
    ],
    [
      "Admin",
      [
        "position",
        "group",
        "auf",
        "membership",
        "withoutPhone",
        "withoutEmergencyContact",
      ],
    ],
  ] as const)(
    "dice a un %s qué filtros puede usar",
    async (callerRole, expected) => {
      const listing = await listDirectory(gateways({ callerRole }), {
        callerId: CALLER_ID,
        query: DEFAULT_DIRECTORY_QUERY,
        todayInClub: TODAY,
      });

      expect(listing.availableFilters).toEqual(expected);
    },
  );
});

describe("el AUF que vence en los próximos 30 días (#497)", () => {
  /** El 1 de octubre de 2026 en Melbourne: el 30 de septiembre en UTC. */
  const MELBOURNE_TODAY = "2026-10-01";

  async function expiringOf(aufExpiry: string): Promise<boolean> {
    const record: DirectoryMemberRecord = {
      ...ANA,
      aufExpiry,
      fullName: "Socia de prueba",
    };
    const wiring = gateways({ callerRole: "Admin" });
    const listing = await listDirectory(
      {
        ...wiring,
        directory: { findDirectoryMembers: async () => [record] },
      },
      {
        callerId: CALLER_ID,
        query: { ...DEFAULT_DIRECTORY_QUERY, auf: "expiring" },
        todayInClub: MELBOURNE_TODAY,
      },
    );
    return listing.members.length === 1;
  }

  it.each([
    ["el que venció ayer", "2026-09-30", false],
    ["el que vence hoy", "2026-10-01", true],
    ["el que vence dentro de 30 días", "2026-10-31", true],
    ["el que vence dentro de 31 días", "2026-11-01", false],
  ] as const)("cuenta %s: %s", async (_case, aufExpiry, isExpiring) => {
    await expect(expiringOf(aufExpiry)).resolves.toBe(isExpiring);
  });

  it("no cuenta a quien no tiene vencimiento", async () => {
    const wiring = gateways({ callerRole: "Admin" });
    const listing = await listDirectory(
      {
        ...wiring,
        directory: {
          findDirectoryMembers: async () => [{ ...ANA, aufExpiry: null }],
        },
      },
      {
        callerId: CALLER_ID,
        query: { ...DEFAULT_DIRECTORY_QUERY, auf: "expiring" },
        todayInClub: TODAY,
      },
    );

    expect(listing.members).toEqual([]);
  });
});
describe("el contacto en el directorio (#499)", () => {
  async function listFor(callerRole: Role): Promise<DirectoryListing> {
    return listDirectory(gateways({ callerRole }), {
      callerId: CALLER_ID,
      query: DEFAULT_DIRECTORY_QUERY,
      todayInClub: TODAY,
    });
  }

  function byName(
    listing: DirectoryListing,
  ): ReadonlyMap<string, Record<string, unknown>> {
    return new Map(
      listing.members.map((member) => [member.fullName, { ...member }]),
    );
  }

  it.each(["Admin", "Committee"] as const)(
    "le da a un %s el correo, el teléfono y el contacto de emergencia de cada socio",
    async (callerRole) => {
      const members = byName(await listFor(callerRole));

      expect(members.get("Ana Admin")).toMatchObject({
        email: "ana@club.test",
        phone: "0412 345 678",
        emergencyContact: ANA.emergencyContact,
      });
      expect(members.get("Bruno Beltrán")).toMatchObject({
        email: "bruno@club.test",
        phone: null,
        emergencyContact: BRUNO.emergencyContact,
      });
      expect(members.get("María Ñíguez")).toMatchObject({
        email: "maria@club.test",
        phone: "0400 000 111",
        emergencyContact: null,
      });
    },
  );

  it("un Committee recibe su propia vista: el contacto, sin el AUF, la membresía ni la evaluación", async () => {
    const listing = await listDirectory(gateways({ callerRole: "Committee" }), {
      callerId: CALLER_ID,
      query: { ...DEFAULT_DIRECTORY_QUERY, search: "maria" },
      todayInClub: TODAY,
    });

    expect(listing).toEqual({
      kind: "committee",
      members: [
        {
          userId: MARIA.userId,
          fullName: "María Ñíguez",
          country: null,
          experienceLevel: "Intermediate",
          role: "Player",
          position: { id: DEFENDER.id, names: DEFENDER.names },
          status: "active",
          photoUrl: null,
          attendance: { kind: "rate", percent: 40, sessions: 2 },
          email: "maria@club.test",
          phone: "0400 000 111",
          emergencyContact: null,
        },
      ],
      availableFilters: [
        "position",
        "group",
        "withoutPhone",
        "withoutEmergencyContact",
      ],
      total: 3,
    });
  });

  it("a un Coach le da el contacto de emergencia y nada más de lo de contacto", async () => {
    const members = byName(await listFor("Coach"));

    expect(members.get("Bruno Beltrán")).toMatchObject({
      emergencyContact: BRUNO.emergencyContact,
    });
    expect(members.get("María Ñíguez")).toMatchObject({
      emergencyContact: null,
    });
    for (const member of members.values()) {
      expect(Object.keys(member)).not.toContain("email");
      expect(Object.keys(member)).not.toContain("phone");
    }
  });

  it("a un Player no le manda ni el correo, ni el teléfono, ni el contacto de emergencia de nadie", async () => {
    const members = byName(await listFor("Player"));

    for (const member of members.values()) {
      expect(Object.keys(member)).not.toContain("email");
      expect(Object.keys(member)).not.toContain("phone");
      expect(Object.keys(member)).not.toContain("emergencyContact");
    }
  });
});

describe("los filtros de contacto (#499)", () => {
  it.each(["Admin", "Committee"] as const)(
    "deja a un %s filtrar a quien no tiene teléfono",
    async (callerRole) => {
      await expect(
        listNames({ withoutPhone: true }, callerRole),
      ).resolves.toEqual(["Bruno Beltrán"]);
    },
  );

  it.each(["Admin", "Committee"] as const)(
    "deja a un %s filtrar a quien no tiene contacto de emergencia",
    async (callerRole) => {
      await expect(
        listNames({ withoutEmergencyContact: true }, callerRole),
      ).resolves.toEqual(["María Ñíguez"]);
    },
  );

  it("combina los dos entre sí y con la búsqueda, el rol y los dados de baja", async () => {
    await expect(
      listNames(
        {
          withoutPhone: true,
          withoutEmergencyContact: true,
          includeInactive: true,
        },
        "Admin",
      ),
    ).resolves.toEqual(["Zoe Zapata"]);
    await expect(
      listNames({ withoutPhone: true, role: "Player" }, "Committee"),
    ).resolves.toEqual([]);
    await expect(
      listNames({ withoutEmergencyContact: true, search: "ñig" }, "Admin"),
    ).resolves.toEqual(["María Ñíguez"]);
  });

  it.each(["Coach", "Player"] as const)(
    "niega a un %s los dos filtros, sin leer el directorio",
    async (callerRole) => {
      for (const [query, filter] of [
        [{ withoutPhone: true }, "withoutPhone"],
        [{ withoutEmergencyContact: true }, "withoutEmergencyContact"],
      ] as const) {
        const rejection = listDirectory(gateways({ callerRole }), {
          callerId: CALLER_ID,
          query: { ...DEFAULT_DIRECTORY_QUERY, ...query },
          todayInClub: TODAY,
        });

        await expect(rejection).rejects.toBeInstanceOf(
          DirectoryFilterForbiddenError,
        );
        await expect(rejection).rejects.toMatchObject({ filter });
        expect(clubsRead).toEqual([]);
      }
    },
  );
});
