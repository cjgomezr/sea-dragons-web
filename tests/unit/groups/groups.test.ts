import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import type {
  GroupAudienceUses,
  GroupMembershipRecord,
} from "@/lib/groups/group-overview";
import {
  GROUP_NAME_MAX_LENGTH,
  type Group,
  GroupNameTakenError,
  GroupNotFoundError,
  type GroupsGateways,
  GroupsForbiddenError,
  InvalidGroupNameError,
  createGroup,
  deleteGroup,
  listGroups,
  renameGroup,
} from "@/lib/groups/groups";

/**
 * Crear, listar, renombrar y borrar los grupos del club (#226, RF-2 a RF-5 del
 * PRD de E4). Todo sale del club de quien llama, y sólo lo hace quien tiene
 * la capacidad de gestionar grupos.
 */

const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const GROUP_ID = "9a9a9a9a-0000-4000-8000-000000000009";

const SENIOR_SQUAD: Group = {
  id: GROUP_ID,
  name: "Senior Squad",
  memberCount: 3,
};

type GatewayOptions = {
  readonly role?: Role;
  readonly member?: null;
  readonly nameTaken?: true;
  readonly missingGroup?: true;
};

type Write =
  | { readonly kind: "insert"; readonly clubId: string; readonly name: string }
  | {
      readonly kind: "rename";
      readonly clubId: string;
      readonly groupId: string;
      readonly name: string;
    }
  | {
      readonly kind: "delete";
      readonly clubId: string;
      readonly groupId: string;
    };

const clubsRead: string[] = [];
const writes: Write[] = [];
const audienceQueries: string[] = [];
const signedPaths: string[] = [];

const NOW = new Date("2026-10-22T09:00:00Z");
const TODAY = "2026-10-22";
const SIGNED_URL_PREFIX = "https://storage.test/photos/";

function membership(
  fullName: string,
  accountStatus: AccountStatus,
  photoPath: string | null,
): GroupMembershipRecord {
  return {
    groupId: GROUP_ID,
    member: { id: `id-${fullName}`, fullName, accountStatus, photoPath },
  };
}

const MEMBERSHIPS: readonly GroupMembershipRecord[] = [
  membership("Zoe Zapata", "active", "zoe.webp"),
  membership("Ana Alba", "active", "ana.webp"),
  membership("Bea Bravo", "incomplete", "bea.webp"),
  membership("Carla Cruz", "active", null),
  membership("Dani Diaz", "active", "dani.webp"),
];

/** La próxima sesión programada de una serie que sigue en pie. */
const NEXT_SESSION = {
  id: "5e5e5e5e-0000-4000-8000-00000000005e",
  startsOn: TODAY,
};

const AUDIENCE_USES: GroupAudienceUses = {
  events: [{ groupIds: [GROUP_ID], startsOn: TODAY, status: "scheduled" }],
  series: [{ groupIds: [GROUP_ID], endsOn: TODAY, nextSession: NEXT_SESSION }],
  posts: [{ groupIds: [GROUP_ID], status: "published" }],
};

function gateways(options: GatewayOptions = {}): GroupsGateways {
  clubsRead.length = 0;
  writes.length = 0;
  audienceQueries.length = 0;
  signedPaths.length = 0;
  return {
    members: {
      findRoleRequestMember: async () =>
        options.member === null
          ? null
          : {
              clubId: CLUB_ID,
              fullName: "Carla Coach",
              role: options.role ?? "Coach",
            },
    },
    groups: {
      findClubGroups: async (clubId) => {
        clubsRead.push(clubId);
        return [SENIOR_SQUAD];
      },
      insertGroup: async (input) => {
        writes.push({ kind: "insert", ...input });
        return options.nameTaken
          ? { kind: "name_taken" }
          : {
              kind: "created",
              group: { id: GROUP_ID, name: input.name, memberCount: 0 },
            };
      },
      renameGroup: async (input) => {
        writes.push({ kind: "rename", ...input });
        if (options.missingGroup) {
          return { kind: "not_found" };
        }
        return options.nameTaken
          ? { kind: "name_taken" }
          : { kind: "renamed", group: { ...SENIOR_SQUAD, name: input.name } };
      },
      deleteGroup: async (input) => {
        writes.push({ kind: "delete", ...input });
        return options.missingGroup
          ? { kind: "not_found" }
          : { kind: "deleted" };
      },
    },
    overview: {
      findMemberships: async (clubId) => {
        clubsRead.push(clubId);
        return MEMBERSHIPS;
      },
      findAudienceUses: async ({ clubId, today }) => {
        audienceQueries.push(`${clubId} ${today}`);
        return AUDIENCE_USES;
      },
    },
    photos: {
      signPhotoUrls: async (photoPaths) => {
        signedPaths.push(...photoPaths);
        return new Map(
          photoPaths.map((path) => [path, `${SIGNED_URL_PREFIX}${path}`]),
        );
      },
    },
  };
}

describe("grupos: crear", () => {
  it.each(["Admin", "Coach", "Committee"] as const)(
    "un %s crea el grupo en su club y nace con 0 miembros",
    async (role) => {
      const group = await createGroup(gateways({ role }), {
        callerId: CALLER_ID,
        name: "Masters Squad",
      });

      expect(group).toEqual({
        id: GROUP_ID,
        name: "Masters Squad",
        memberCount: 0,
      });
      expect(writes).toEqual([
        { kind: "insert", clubId: CLUB_ID, name: "Masters Squad" },
      ]);
    },
  );

  it("guarda el nombre sin los espacios, tabuladores ni saltos de línea de alrededor", async () => {
    await createGroup(gateways(), {
      callerId: CALLER_ID,
      name: " \tMasters Squad\n ",
    });

    expect(writes).toEqual([
      { kind: "insert", clubId: CLUB_ID, name: "Masters Squad" },
    ]);
  });

  it("rechaza un nombre que ya existe en el club", async () => {
    await expect(
      createGroup(gateways({ nameTaken: true }), {
        callerId: CALLER_ID,
        name: "senior squad",
      }),
    ).rejects.toBeInstanceOf(GroupNameTakenError);
  });

  it.each([
    ["vacío", ""],
    ["de solo espacios", "   \t "],
    ["de más de 60 caracteres", "x".repeat(GROUP_NAME_MAX_LENGTH + 1)],
    ["con un carácter nulo dentro", "Senior\u0000Squad"],
    ["con un tabulador dentro", "Senior\tSquad"],
  ])("rechaza un nombre %s sin escribir", async (_case, name) => {
    await expect(
      createGroup(gateways(), { callerId: CALLER_ID, name }),
    ).rejects.toBeInstanceOf(InvalidGroupNameError);
    expect(writes).toEqual([]);
  });

  it("acepta un nombre de exactamente 60 caracteres", async () => {
    const name = "x".repeat(GROUP_NAME_MAX_LENGTH);

    const group = await createGroup(gateways(), { callerId: CALLER_ID, name });

    expect(group.name).toBe(name);
  });

  it("mide el largo en caracteres, como la base, y no en unidades de UTF-16", async () => {
    const name = "🐉".repeat(GROUP_NAME_MAX_LENGTH);

    const group = await createGroup(gateways(), { callerId: CALLER_ID, name });

    expect(group.name).toBe(name);
  });
});

const LIST_REQUEST = { callerId: CALLER_ID, now: NOW };

describe("grupos: listar", () => {
  it("devuelve los grupos del club de quien llama", async () => {
    const [group] = await listGroups(gateways(), LIST_REQUEST);

    expect(group).toMatchObject(SENIOR_SQUAD);
    expect(clubsRead).toEqual([CLUB_ID, CLUB_ID]);
  });

  it("trae el uso de cada grupo contado desde el día de hoy en Melbourne", async () => {
    const [group] = await listGroups(gateways(), LIST_REQUEST);

    expect(group?.usage).toEqual({ events: 2, posts: 1 });
    expect(audienceQueries).toEqual([`${CLUB_ID} ${TODAY}`]);
  });

  it("trae a tres miembros activos con su foto firmada o null", async () => {
    const [group] = await listGroups(gateways(), LIST_REQUEST);

    expect(group?.previewMembers).toEqual([
      {
        id: "id-Ana Alba",
        fullName: "Ana Alba",
        photoUrl: `${SIGNED_URL_PREFIX}ana.webp`,
      },
      { id: "id-Carla Cruz", fullName: "Carla Cruz", photoUrl: null },
      {
        id: "id-Dani Diaz",
        fullName: "Dani Diaz",
        photoUrl: `${SIGNED_URL_PREFIX}dani.webp`,
      },
    ]);
  });

  it("firma sólo las fotos de la vista previa, en una llamada", async () => {
    await listGroups(gateways(), LIST_REQUEST);

    expect(signedPaths).toEqual(["ana.webp", "dani.webp"]);
  });

  it("un grupo sin uso ni miembros activos sale con ceros y la vista previa vacía", async () => {
    const empty = gateways();
    const [group] = await listGroups(
      {
        ...empty,
        overview: {
          findMemberships: async () => [],
          findAudienceUses: async () => ({ events: [], series: [], posts: [] }),
        },
      },
      LIST_REQUEST,
    );

    expect(group?.usage).toEqual({ events: 0, posts: 0 });
    expect(group?.previewMembers).toEqual([]);
  });
});

describe("grupos: renombrar", () => {
  it("renombra el grupo del club y lo devuelve con sus socios", async () => {
    const group = await renameGroup(gateways(), {
      callerId: CALLER_ID,
      groupId: GROUP_ID,
      name: "  Senior Squad A ",
    });

    expect(group).toEqual({ ...SENIOR_SQUAD, name: "Senior Squad A" });
    expect(writes).toEqual([
      {
        kind: "rename",
        clubId: CLUB_ID,
        groupId: GROUP_ID,
        name: "Senior Squad A",
      },
    ]);
  });

  it("rechaza un nombre que ya usa otro grupo del club", async () => {
    await expect(
      renameGroup(gateways({ nameTaken: true }), {
        callerId: CALLER_ID,
        groupId: GROUP_ID,
        name: "Junior Squad",
      }),
    ).rejects.toBeInstanceOf(GroupNameTakenError);
  });

  it("rechaza un nombre inválido sin escribir", async () => {
    await expect(
      renameGroup(gateways(), {
        callerId: CALLER_ID,
        groupId: GROUP_ID,
        name: " ",
      }),
    ).rejects.toBeInstanceOf(InvalidGroupNameError);
    expect(writes).toEqual([]);
  });

  it("rechaza un grupo que no existe en el club", async () => {
    await expect(
      renameGroup(gateways({ missingGroup: true }), {
        callerId: CALLER_ID,
        groupId: GROUP_ID,
        name: "Senior Squad",
      }),
    ).rejects.toBeInstanceOf(GroupNotFoundError);
  });
});

describe("grupos: borrar", () => {
  it("borra el grupo del club de quien llama", async () => {
    await deleteGroup(gateways(), { callerId: CALLER_ID, groupId: GROUP_ID });

    expect(writes).toEqual([
      { kind: "delete", clubId: CLUB_ID, groupId: GROUP_ID },
    ]);
  });

  it("rechaza un grupo que no existe en el club", async () => {
    await expect(
      deleteGroup(gateways({ missingGroup: true }), {
        callerId: CALLER_ID,
        groupId: GROUP_ID,
      }),
    ).rejects.toBeInstanceOf(GroupNotFoundError);
  });
});

describe("grupos: quién puede", () => {
  const operations = [
    ["listar", (g: GroupsGateways) => listGroups(g, LIST_REQUEST)],
    [
      "crear",
      (g: GroupsGateways) =>
        createGroup(g, { callerId: CALLER_ID, name: "Masters Squad" }),
    ],
    [
      "renombrar",
      (g: GroupsGateways) =>
        renameGroup(g, {
          callerId: CALLER_ID,
          groupId: GROUP_ID,
          name: "Masters Squad",
        }),
    ],
    [
      "borrar",
      (g: GroupsGateways) =>
        deleteGroup(g, { callerId: CALLER_ID, groupId: GROUP_ID }),
    ],
  ] as const;

  it.each(operations)(
    "niega a un Player %s sin tocar la base",
    async (_operation, run) => {
      await expect(run(gateways({ role: "Player" }))).rejects.toBeInstanceOf(
        GroupsForbiddenError,
      );
      expect(clubsRead).toEqual([]);
      expect(writes).toEqual([]);
    },
  );

  it.each([
    [
      "crear",
      (g: GroupsGateways) => createGroup(g, { callerId: CALLER_ID, name: "" }),
    ],
    [
      "renombrar",
      (g: GroupsGateways) =>
        renameGroup(g, { callerId: CALLER_ID, groupId: GROUP_ID, name: "" }),
    ],
  ] as const)(
    "niega a un Player %s aunque el nombre tampoco valga",
    async (_operation, run) => {
      await expect(run(gateways({ role: "Player" }))).rejects.toBeInstanceOf(
        GroupsForbiddenError,
      );
    },
  );

  it.each(operations)(
    "rechaza %s a una identidad que no es socia de ningún club",
    async (_operation, run) => {
      await expect(run(gateways({ member: null }))).rejects.toBeInstanceOf(
        MemberNotFoundError,
      );
    },
  );
});
