import { describe, expect, it } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import {
  type GroupMember,
  GroupMemberNotFoundError,
  type GroupMembersGateways,
  InactiveMemberError,
  assignGroupMember,
  listGroupCandidates,
  listGroupMembers,
  removeGroupMember,
} from "@/lib/groups/group-members";
import { GroupNotFoundError, GroupsForbiddenError } from "@/lib/groups/groups";

/**
 * Meter y sacar socios de un grupo (#227, RF-6 y RF-7 del PRD de E4). Todo
 * sale del club de quien llama, y sólo lo hace quien gestiona grupos.
 */

const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const GROUP_ID = "9a9a9a9a-0000-4000-8000-000000000009";
const MEMBER_ID = "b1b1b1b1-0000-4000-8000-00000000000b";

const PAULA: GroupMember = { id: MEMBER_ID, fullName: "Paula Player" };

type GatewayOptions = {
  readonly role?: Role;
  readonly memberStatus?: AccountStatus;
  readonly missingMember?: true;
  readonly missingGroup?: true;
  readonly memberVanished?: true;
};

type Write = {
  readonly kind: "insert" | "delete";
  readonly clubId: string;
  readonly groupId: string;
  readonly userId: string;
};

const writes: Write[] = [];
const scopesRead: string[] = [];

function gateways(options: GatewayOptions = {}): GroupMembersGateways {
  writes.length = 0;
  scopesRead.length = 0;
  const groupResult = <T>(value: T) =>
    options.missingGroup
      ? ({ kind: "group_not_found" } as const)
      : ({ kind: "found", members: value } as const);
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Carla Coach",
        role: options.role ?? "Coach",
      }),
    },
    groupMembers: {
      findGroupMembers: async ({ clubId, groupId }) => {
        scopesRead.push(`members ${clubId} ${groupId}`);
        return groupResult([PAULA]);
      },
      findCandidates: async ({ clubId, groupId }) => {
        scopesRead.push(`candidates ${clubId} ${groupId}`);
        return groupResult([PAULA]);
      },
      findClubMember: async ({ clubId, userId }) => {
        scopesRead.push(`member ${clubId} ${userId}`);
        return options.missingMember
          ? null
          : {
              ...PAULA,
              accountStatus: options.memberStatus ?? "active",
            };
      },
      insertMembership: async (membership) => {
        writes.push({ kind: "insert", ...membership });
        if (options.memberVanished) {
          return { kind: "member_not_found" };
        }
        return options.missingGroup
          ? { kind: "group_not_found" }
          : { kind: "assigned" };
      },
      deleteMembership: async (membership) => {
        writes.push({ kind: "delete", ...membership });
        return options.missingGroup
          ? { kind: "group_not_found" }
          : { kind: "removed" };
      },
    },
  };
}

const MEMBERSHIP = { clubId: CLUB_ID, groupId: GROUP_ID, userId: MEMBER_ID };
const REQUEST = { callerId: CALLER_ID, groupId: GROUP_ID, userId: MEMBER_ID };

describe("socios de un grupo: asignar", () => {
  it.each(["Admin", "Coach", "Committee"] as const)(
    "un %s asigna al socio en el club de quien llama y lo devuelve",
    async (role) => {
      const member = await assignGroupMember(gateways({ role }), REQUEST);

      expect(member).toEqual(PAULA);
      expect(writes).toEqual([{ kind: "insert", ...MEMBERSHIP }]);
    },
  );

  it("permite asignar a un socio con la cuenta incompleta", async () => {
    const member = await assignGroupMember(
      gateways({ memberStatus: "incomplete" }),
      REQUEST,
    );

    expect(member).toEqual(PAULA);
    expect(writes).toEqual([{ kind: "insert", ...MEMBERSHIP }]);
  });

  it("rechaza a un socio dado de baja sin escribir nada", async () => {
    await expect(
      assignGroupMember(gateways({ memberStatus: "inactive" }), REQUEST),
    ).rejects.toBeInstanceOf(InactiveMemberError);
    expect(writes).toEqual([]);
  });

  it("rechaza a un socio que no existe o es de otro club sin escribir nada", async () => {
    const sut = gateways({ missingMember: true });

    await expect(assignGroupMember(sut, REQUEST)).rejects.toBeInstanceOf(
      GroupMemberNotFoundError,
    );
    expect(scopesRead).toEqual([`member ${CLUB_ID} ${MEMBER_ID}`]);
    expect(writes).toEqual([]);
  });

  it("rechaza a un socio que borran entre la lectura y la asignación", async () => {
    await expect(
      assignGroupMember(gateways({ memberVanished: true }), REQUEST),
    ).rejects.toBeInstanceOf(GroupMemberNotFoundError);
  });

  it("rechaza un grupo que no existe, es de otro club o acaban de borrar", async () => {
    await expect(
      assignGroupMember(gateways({ missingGroup: true }), REQUEST),
    ).rejects.toBeInstanceOf(GroupNotFoundError);
  });

  it("rechaza a un Player sin leer ni escribir nada", async () => {
    await expect(
      assignGroupMember(gateways({ role: "Player" }), REQUEST),
    ).rejects.toBeInstanceOf(GroupsForbiddenError);
    expect(scopesRead).toEqual([]);
    expect(writes).toEqual([]);
  });
});

describe("socios de un grupo: quitar", () => {
  it("quita al socio del grupo en el club de quien llama", async () => {
    await removeGroupMember(gateways(), REQUEST);

    expect(writes).toEqual([{ kind: "delete", ...MEMBERSHIP }]);
  });

  it("deja quitar a un socio dado de baja", async () => {
    await removeGroupMember(gateways({ memberStatus: "inactive" }), REQUEST);

    expect(writes).toEqual([{ kind: "delete", ...MEMBERSHIP }]);
  });

  it("rechaza a un socio que no existe o es de otro club sin escribir nada", async () => {
    await expect(
      removeGroupMember(gateways({ missingMember: true }), REQUEST),
    ).rejects.toBeInstanceOf(GroupMemberNotFoundError);
    expect(writes).toEqual([]);
  });

  it("rechaza un grupo que no existe o es de otro club", async () => {
    await expect(
      removeGroupMember(gateways({ missingGroup: true }), REQUEST),
    ).rejects.toBeInstanceOf(GroupNotFoundError);
  });

  it("rechaza a un Player sin escribir nada", async () => {
    await expect(
      removeGroupMember(gateways({ role: "Player" }), REQUEST),
    ).rejects.toBeInstanceOf(GroupsForbiddenError);
    expect(writes).toEqual([]);
  });
});

describe("socios de un grupo: listar", () => {
  const LIST_REQUEST = { callerId: CALLER_ID, groupId: GROUP_ID };

  it("devuelve los socios del grupo, leídos en el club de quien llama", async () => {
    const members = await listGroupMembers(gateways(), LIST_REQUEST);

    expect(members).toEqual([PAULA]);
    expect(scopesRead).toEqual([`members ${CLUB_ID} ${GROUP_ID}`]);
  });

  it("rechaza un grupo que no existe o es de otro club", async () => {
    await expect(
      listGroupMembers(gateways({ missingGroup: true }), LIST_REQUEST),
    ).rejects.toBeInstanceOf(GroupNotFoundError);
  });

  it("rechaza a un Player sin leer nada", async () => {
    await expect(
      listGroupMembers(gateways({ role: "Player" }), LIST_REQUEST),
    ).rejects.toBeInstanceOf(GroupsForbiddenError);
    expect(scopesRead).toEqual([]);
  });
});

describe("candidatos", () => {
  const LIST_REQUEST = { callerId: CALLER_ID, groupId: GROUP_ID };

  it("devuelve los candidatos del grupo, leídos en el club de quien llama", async () => {
    const candidates = await listGroupCandidates(gateways(), LIST_REQUEST);

    expect(candidates).toEqual([PAULA]);
    expect(scopesRead).toEqual([`candidates ${CLUB_ID} ${GROUP_ID}`]);
  });

  it("rechaza un grupo que no existe o es de otro club", async () => {
    await expect(
      listGroupCandidates(gateways({ missingGroup: true }), LIST_REQUEST),
    ).rejects.toBeInstanceOf(GroupNotFoundError);
  });

  it("rechaza a un Player sin leer nada", async () => {
    await expect(
      listGroupCandidates(gateways({ role: "Player" }), LIST_REQUEST),
    ).rejects.toBeInstanceOf(GroupsForbiddenError);
    expect(scopesRead).toEqual([]);
  });
});
