import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { Role } from "@/lib/auth/roles";
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

function gateways(options: GatewayOptions = {}): GroupsGateways {
  clubsRead.length = 0;
  writes.length = 0;
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

describe("grupos: listar", () => {
  it("devuelve los grupos del club de quien llama", async () => {
    const groups = await listGroups(gateways(), CALLER_ID);

    expect(groups).toEqual([SENIOR_SQUAD]);
    expect(clubsRead).toEqual([CLUB_ID]);
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
    ["listar", (g: GroupsGateways) => listGroups(g, CALLER_ID)],
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

  it.each(operations)(
    "rechaza %s a una identidad que no es socia de ningún club",
    async (_operation, run) => {
      await expect(run(gateways({ member: null }))).rejects.toBeInstanceOf(
        MemberNotFoundError,
      );
    },
  );
});
