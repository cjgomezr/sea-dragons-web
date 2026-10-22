import { describe, expect, it } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import {
  type AssignableMember,
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

const OTHER_GROUP_ID = "8b8b8b8b-0000-4000-8000-000000000008";
const SIGNED_URL_PREFIX = "https://storage.test/photos/";

const PAULA: GroupMember = {
  id: MEMBER_ID,
  fullName: "Paula Player",
  isPendingActivation: false,
};

/** En este grupo y en otro, con foto y posición. */
const PAULA_RECORD: AssignableMember = {
  id: MEMBER_ID,
  fullName: "Paula Player",
  accountStatus: "active",
  photoPath: "paula.webp",
  position: { en: "Forward", es: "Delantera" },
  groupIds: [GROUP_ID, OTHER_GROUP_ID],
};

/** En este grupo, sin activar, sin foto ni posición. */
const ZOE_RECORD: AssignableMember = {
  id: "c2c2c2c2-0000-4000-8000-00000000000c",
  fullName: "Zoe Zapata",
  accountStatus: "incomplete",
  photoPath: null,
  position: null,
  groupIds: [GROUP_ID],
};

/** Fuera del grupo, en otro. La posición sólo tiene nombre en inglés. */
const NEREA_RECORD: AssignableMember = {
  id: "d3d3d3d3-0000-4000-8000-00000000000d",
  fullName: "nerea Navarro",
  accountStatus: "active",
  photoPath: "nerea.webp",
  position: { en: "Goalkeeper", es: null },
  groupIds: [OTHER_GROUP_ID],
};

/** Fuera de todos los grupos. */
const BEA_RECORD: AssignableMember = {
  id: "e4e4e4e4-0000-4000-8000-00000000000e",
  fullName: "Bea Bravo",
  accountStatus: "active",
  photoPath: null,
  position: null,
  groupIds: [],
};

const ASSIGNABLE = [ZOE_RECORD, NEREA_RECORD, PAULA_RECORD, BEA_RECORD];

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
const signedPaths: string[] = [];

function gateways(options: GatewayOptions = {}): GroupMembersGateways {
  writes.length = 0;
  scopesRead.length = 0;
  signedPaths.length = 0;
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Carla Coach",
        role: options.role ?? "Coach",
      }),
    },
    groupMembers: {
      findAssignableMembers: async ({ clubId, groupId }) => {
        scopesRead.push(`assignable ${clubId} ${groupId}`);
        return options.missingGroup
          ? { kind: "group_not_found" }
          : { kind: "found", members: ASSIGNABLE };
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

  it("permite asignar a un socio con la cuenta incompleta y lo marca pendiente de activar", async () => {
    const member = await assignGroupMember(
      gateways({ memberStatus: "incomplete" }),
      REQUEST,
    );

    expect(member).toEqual({ ...PAULA, isPendingActivation: true });
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
  const LIST_REQUEST = {
    callerId: CALLER_ID,
    groupId: GROUP_ID,
    locale: "es" as const,
  };

  it("devuelve los socios del grupo en orden de nombre, leídos en el club de quien llama", async () => {
    const members = await listGroupMembers(gateways(), LIST_REQUEST);

    expect(members.map(({ fullName }) => fullName)).toEqual([
      "Paula Player",
      "Zoe Zapata",
    ]);
    expect(scopesRead).toEqual([`assignable ${CLUB_ID} ${GROUP_ID}`]);
  });

  it("trae la posición en el idioma de quien pide y la foto firmada", async () => {
    const [paula, zoe] = await listGroupMembers(gateways(), LIST_REQUEST);

    expect(paula).toEqual({
      ...PAULA,
      positionName: "Delantera",
      photoUrl: `${SIGNED_URL_PREFIX}paula.webp`,
    });
    expect(zoe).toEqual({
      id: ZOE_RECORD.id,
      fullName: "Zoe Zapata",
      isPendingActivation: true,
      positionName: null,
      photoUrl: null,
    });
  });

  it("firma sólo las fotos de los socios que devuelve, en una llamada", async () => {
    await listGroupMembers(gateways(), LIST_REQUEST);

    expect(signedPaths).toEqual(["paula.webp"]);
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
  const LIST_REQUEST = {
    callerId: CALLER_ID,
    groupId: GROUP_ID,
    locale: "es" as const,
  };

  it("devuelve a quien no está en el grupo en orden de nombre, leído en el club de quien llama", async () => {
    const candidates = await listGroupCandidates(gateways(), LIST_REQUEST);

    expect(candidates.map(({ fullName }) => fullName)).toEqual([
      "Bea Bravo",
      "nerea Navarro",
    ]);
    expect(scopesRead).toEqual([`assignable ${CLUB_ID} ${GROUP_ID}`]);
  });

  it("trae de cada uno la posición, la foto y en cuántos grupos del club está ya", async () => {
    const [bea, nerea] = await listGroupCandidates(gateways(), LIST_REQUEST);

    expect(bea).toEqual({
      id: BEA_RECORD.id,
      fullName: "Bea Bravo",
      isPendingActivation: false,
      positionName: null,
      photoUrl: null,
      groupCount: 0,
    });
    expect(nerea).toEqual({
      id: NEREA_RECORD.id,
      fullName: "nerea Navarro",
      isPendingActivation: false,
      positionName: "Goalkeeper",
      photoUrl: `${SIGNED_URL_PREFIX}nerea.webp`,
      groupCount: 1,
    });
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
