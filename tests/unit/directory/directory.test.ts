import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { Role } from "@/lib/auth/roles";
import {
  DEFAULT_DIRECTORY_QUERY,
  type DirectoryGateways,
  DirectoryForbiddenError,
  type DirectoryMemberRecord,
  type DirectoryQuery,
  type DirectoryListing,
  listDirectory,
  withMemberRole,
} from "@/lib/directory/directory";

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

const ANA: DirectoryMemberRecord = {
  userId: "aaaaaaaa-0000-4000-8000-00000000000a",
  fullName: "Ana Admin",
  country: "AU",
  experienceLevel: "Advanced",
  role: "Admin",
  position: null,
  status: "active",
  aufNumber: "AUF-1",
  aufExpiry: "2027-01-31",
  photoPath: "aaaaaaaa-0000-4000-8000-00000000000a/foto.webp",
};

const BRUNO: DirectoryMemberRecord = {
  userId: "bbbbbbbb-0000-4000-8000-00000000000b",
  fullName: "Bruno Beltrán",
  country: "CO",
  experienceLevel: "Beginner",
  role: "Coach",
  position: "Goalkeeper",
  status: "active",
  aufNumber: "AUF-2",
  aufExpiry: "2026-09-20",
  photoPath: null,
};

const MARIA: DirectoryMemberRecord = {
  userId: "cccccccc-0000-4000-8000-00000000000c",
  fullName: "María Ñíguez",
  country: null,
  experienceLevel: "Intermediate",
  role: "Player",
  position: "Defender",
  status: "active",
  aufNumber: null,
  aufExpiry: null,
  photoPath: null,
};

const ZOE: DirectoryMemberRecord = {
  userId: "dddddddd-0000-4000-8000-00000000000d",
  fullName: "Zoe Zapata",
  country: "AU",
  experienceLevel: null,
  role: "Committee",
  position: "Forward",
  status: "inactive",
  aufNumber: "AUF-4",
  aufExpiry: TODAY,
  photoPath: "dddddddd-0000-4000-8000-00000000000d/foto.png",
};

const CLUB: readonly DirectoryMemberRecord[] = [ZOE, MARIA, ANA, BRUNO];

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
    photos: {
      signPhotoUrls: async (photoPaths) => {
        photosSigned.push(...photoPaths);
        return new Map(photoPaths.map((path) => [path, signedUrlOf(path)]));
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
        position: "Defender",
        status: "active",
        photoUrl: null,
      },
    ]);
  });

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
    // El orden del SRD: Goalkeeper, Defender, Forward. Sin posición, al final.
    [
      "position",
      "asc",
      ["Bruno Beltrán", "María Ñíguez", "Zoe Zapata", "Ana Admin"],
    ],
    [
      "position",
      "desc",
      ["Zoe Zapata", "María Ñíguez", "Bruno Beltrán", "Ana Admin"],
    ],
  ] as const)("ordena por %s %s", async (sort, direction, expected) => {
    await expect(orderedBy(sort, direction)).resolves.toEqual(expected);
  });
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

  it.each(["Coach", "Committee", "Player"] as const)(
    "no le cuenta el AUF a un %s",
    async (callerRole) => {
      const listing = await listDirectory(gateways({ callerRole }), {
        callerId: CALLER_ID,
        query: DEFAULT_DIRECTORY_QUERY,
        todayInClub: TODAY,
      });

      expect(listing.kind).toBe("member");
      for (const member of listing.members) {
        expect(Object.keys(member)).not.toContain("aufNumber");
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
    position: "Goalkeeper",
    status: "active",
    photoUrl: null,
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
    };

    expect(withMemberRole(listing, NEREA.userId, "Coach")).toEqual({
      kind: "member",
      members: [{ ...NEREA, role: "Coach" }, TOMAS],
    });
  });

  it("conserva lo que sólo ve un Admin", () => {
    const admin = {
      ...NEREA,
      aufNumber: "AUF-9",
      aufExpiry: "2020-01-31",
      isAufExpired: true,
    };
    const listing: DirectoryListing = { kind: "admin", members: [admin] };

    expect(withMemberRole(listing, NEREA.userId, "Committee")).toEqual({
      kind: "admin",
      members: [{ ...admin, role: "Committee" }],
    });
  });
});
