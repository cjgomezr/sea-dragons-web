import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import { MEMBER_RECORD_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type {
  AufRegistration,
  MemberRecordGateways,
} from "@/lib/members/member-record";

/**
 * La ficha reservada al Admin por la API (#242, RF-4 del PRD de E5). La
 * petición entra por el proxy y sólo llega al handler si la frontera la deja
 * seguir, como en producción: así el 403 de los otros tres roles es el de
 * verdad y no uno que el test se inventa.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const MEMBER_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const UNKNOWN_MEMBER_ID = "b1b1b1b1-0000-4000-8000-0000000000ff";
const SENIOR_ID = "9a9a9a9a-0000-4000-8000-000000000001";
const UNKNOWN_GROUP_ID = "9a9a9a9a-0000-4000-8000-0000000000ff";
const JOINED_ON = "2024-03-06";
const REGISTERED_AT = "2024-03-06T01:00:00.000Z";
const ADULT_BIRTH = "1990-05-10";
/** 14 años el día del registro. */
const MINOR_BIRTH = "2010-01-01";

const VALID_BODY = {
  aufNumber: "AUF-2026-0042",
  aufExpiry: "2027-03-31",
  groupIds: [SENIOR_ID],
  dateOfBirth: ADULT_BIRTH,
} as const;

const readSessionState = vi.fn();
const writes: string[] = [];
let callerRole: Role = "Admin";
let memberStatus: AccountStatus = "active";

function memberRecordGateways(): MemberRecordGateways {
  let auf: { aufNumber: string | null; aufExpiry: string | null } = {
    aufNumber: null,
    aufExpiry: null,
  };
  const memberships = new Set<string>();
  let dateOfBirth: string = ADULT_BIRTH;
  let accountStatus: AccountStatus = "active";
  const isKnown = (userId: string): boolean => userId === MEMBER_ID;
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Ana Admin",
        role: callerRole,
      }),
    },
    records: {
      findMemberRecord: async ({ userId }) =>
        isKnown(userId)
          ? {
              userId,
              fullName: "Paula Player",
              joinedOn: JOINED_ON,
              accountStatus,
              ...auf,
              dateOfBirth,
              registeredAt: REGISTERED_AT,
              hasGuardianConsent: false,
            }
          : null,
      findMemberGroups: async () =>
        [...memberships].map((id) => ({ id, name: "Senior Squad" })),
      updateAufRegistration: async (_scope, registration: AufRegistration) => {
        writes.push(`auf ${registration.kind}`);
        auf =
          registration.kind === "none"
            ? { aufNumber: null, aufExpiry: null }
            : {
                aufNumber: registration.number,
                aufExpiry: registration.expiry,
              };
        return { kind: "updated" };
      },
      correctDateOfBirth: async (_scope, correction) => {
        writes.push(`birth ${correction.toStatus}`);
        dateOfBirth = correction.dateOfBirth;
        accountStatus = correction.toStatus;
        return { kind: "corrected" };
      },
    },
    audit: {
      insertAuditLogRow: async (row) => {
        writes.push(`audit ${row.action}`);
        return { error: null };
      },
    },
    groups: {
      findClubGroups: async () => [
        { id: SENIOR_ID, name: "Senior Squad", memberCount: 0 },
      ],
    },
    groupMembers: {
      findGroupMembers: async () => ({ kind: "found", members: [] }),
      findCandidates: async () => ({ kind: "found", members: [] }),
      findClubMember: async ({ userId }) => ({
        id: userId,
        fullName: "Paula Player",
        accountStatus: memberStatus,
      }),
      insertMembership: async ({ groupId }) => {
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
}

let gateways = memberRecordGateways();

vi.mock("@/lib/supabase/session-client", () => ({
  readIncomingCookies: () => [],
  applySessionCookies: () => undefined,
  createSessionClient: () => ({
    kind: "ready",
    client: {},
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  }),
}));

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
  readAuthenticatedUserId: async () => ADMIN_ID,
}));

vi.mock("@/lib/members/supabase-member-record-gateways", () => ({
  createSupabaseMemberRecordGateways: () => ({ kind: "ready", gateways }),
}));

const { proxy } = await import("@/proxy");
const { GET, PATCH, POST } =
  await import("@/app/api/v1/members/[id]/record/route");

function givenRole(role: Role): void {
  callerRole = role;
  readSessionState.mockResolvedValue({
    kind: "active",
    role,
  } satisfies SessionState);
}

function recordPath(memberId: string): string {
  return MEMBER_RECORD_API_PATH.replace("[id]", memberId);
}

async function throughBoundary(
  request: NextRequest,
  handle: (request: NextRequest) => Promise<Response>,
): Promise<Response> {
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? handle(request)
    : boundaryResponse;
}

async function patchRecord(
  body: unknown,
  memberId: string = MEMBER_ID,
): Promise<Response> {
  const request = new NextRequest(new URL(recordPath(memberId), ORIGIN), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return throughBoundary(request, (incoming) =>
    PATCH(incoming, { params: Promise.resolve({ id: memberId }) }),
  );
}

async function getRecord(memberId: string = MEMBER_ID): Promise<Response> {
  const request = new NextRequest(new URL(recordPath(memberId), ORIGIN));
  return throughBoundary(request, (incoming) =>
    GET(incoming, { params: Promise.resolve({ id: memberId }) }),
  );
}

async function reasonOf(response: Response): Promise<unknown> {
  const body = (await response.json()) as { error: { reason?: string } };
  return body.error.reason;
}

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  gateways = memberRecordGateways();
  memberStatus = "active";
  givenRole("Admin");
});

describe("PATCH /api/v1/members/{id}/record", () => {
  it("responde 200 con la ficha guardada", async () => {
    const response = await patchRecord(VALID_BODY);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        userId: MEMBER_ID,
        fullName: "Paula Player",
        joinedOn: JOINED_ON,
        accountStatus: "active",
        aufNumber: "AUF-2026-0042",
        aufExpiry: "2027-03-31",
        dateOfBirth: ADULT_BIRTH,
        registeredAt: REGISTERED_AT,
        hasGuardianConsent: false,
        isAufExpired: false,
        groups: [{ id: SENIOR_ID, name: "Senior Squad" }],
      },
    });
  });

  it("deja sin valor el número y el vencimiento cuando el número llega vacío", async () => {
    const response = await patchRecord({ ...VALID_BODY, aufNumber: null });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { aufNumber: null, aufExpiry: null },
    });
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s sin escribir nada",
    async (role) => {
      givenRole(role);

      const response = await patchRecord(VALID_BODY);

      expect(response.status).toBe(403);
      expect(writes).toEqual([]);
    },
  );

  it("responde 400 con el motivo a un vencimiento anterior al ingreso", async () => {
    const response = await patchRecord({
      ...VALID_BODY,
      aufExpiry: "2024-03-05",
    });

    expect(response.status).toBe(400);
    await expect(reasonOf(response)).resolves.toBe("auf_expiry_before_joined");
    expect(writes).toEqual([]);
  });

  it.each(["2027-02-30", "31/03/2027", "mañana"])(
    "responde 400 al vencimiento %j sin tocar la base",
    async (aufExpiry) => {
      const response = await patchRecord({ ...VALID_BODY, aufExpiry });

      expect(response.status).toBe(400);
      await expect(reasonOf(response)).resolves.toBe("auf_expiry_not_a_date");
      expect(writes).toEqual([]);
    },
  );

  it("responde 400 a un número de más de 40 caracteres sin tocar la base", async () => {
    const response = await patchRecord({
      ...VALID_BODY,
      aufNumber: "9".repeat(41),
    });

    expect(response.status).toBe(400);
    await expect(reasonOf(response)).resolves.toBe("auf_number_too_long");
    expect(writes).toEqual([]);
  });

  it.each([
    ["un campo que no es de la ficha", { ...VALID_BODY, role: "Admin" }],
    ["un grupo que no es un uuid", { ...VALID_BODY, groupIds: ["senior"] }],
    ["sin la lista de grupos", { aufNumber: "A", aufExpiry: null }],
    ["un número que no es texto", { ...VALID_BODY, aufNumber: 42 }],
    ["sin la fecha de nacimiento", { ...VALID_BODY, dateOfBirth: undefined }],
    ["una fecha que no es texto", { ...VALID_BODY, dateOfBirth: 20100101 }],
  ])("responde 400 a %s", async (_case, body) => {
    const response = await patchRecord(body);

    expect(response.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it("responde 404 a un miembro que no es del club", async () => {
    const response = await patchRecord(VALID_BODY, UNKNOWN_MEMBER_ID);

    expect(response.status).toBe(404);
    await expect(reasonOf(response)).resolves.toBe("member_not_found");
    expect(writes).toEqual([]);
  });

  it("responde 404 a un id que no es un uuid", async () => {
    const response = await patchRecord(VALID_BODY, "paula");

    expect(response.status).toBe(404);
  });

  it("responde 404 a un grupo que no es del club, sin escribir nada", async () => {
    const response = await patchRecord({
      ...VALID_BODY,
      groupIds: [UNKNOWN_GROUP_ID],
    });

    expect(response.status).toBe(404);
    await expect(reasonOf(response)).resolves.toBe("group_not_found");
    expect(writes).toEqual([]);
  });

  it("responde 422 al agregar grupos a un miembro dado de baja", async () => {
    memberStatus = "inactive";

    const response = await patchRecord(VALID_BODY);

    expect(response.status).toBe(422);
    await expect(reasonOf(response)).resolves.toBe("member_inactive");
    expect(writes).toEqual([]);
  });

  it("no acepta otros métodos que escriban", async () => {
    const response = await POST(
      new NextRequest(new URL(recordPath(MEMBER_ID), ORIGIN), {
        method: "POST",
      }),
    );

    expect(response.status).toBe(405);
  });
});

describe("GET /api/v1/members/{id}/record", () => {
  it("responde 200 con la ficha a un Admin", async () => {
    const response = await getRecord();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { userId: MEMBER_ID, joinedOn: JOINED_ON, groups: [] },
    });
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s",
    async (role) => {
      givenRole(role);

      const response = await getRecord();

      expect(response.status).toBe(403);
    },
  );

  it("responde 404 a un miembro que no es del club", async () => {
    const response = await getRecord(UNKNOWN_MEMBER_ID);

    expect(response.status).toBe(404);
    await expect(reasonOf(response)).resolves.toBe("member_not_found");
  });
});

describe("endpoint de la ficha: fecha de nacimiento", () => {
  it("guarda la fecha corregida, lo deja en la bitácora y responde el estado nuevo", async () => {
    const response = await patchRecord({
      ...VALID_BODY,
      dateOfBirth: MINOR_BIRTH,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { dateOfBirth: MINOR_BIRTH, accountStatus: "incomplete" },
    });
    expect(writes).toEqual(
      expect.arrayContaining([
        "birth incomplete",
        "audit member.date_of_birth_corrected",
      ]),
    );
  });

  it.each([
    ["2999-01-01", "date_of_birth_in_future"],
    ["1899-12-31", "date_of_birth_too_early"],
    ["2010-02-30", "date_of_birth_not_a_date"],
    ["10/05/1990", "date_of_birth_not_a_date"],
  ])(
    "responde 400 a la fecha %j con el motivo %s, sin tocar la base",
    async (dateOfBirth, reason) => {
      const response = await patchRecord({ ...VALID_BODY, dateOfBirth });

      expect(response.status).toBe(400);
      await expect(reasonOf(response)).resolves.toBe(reason);
      expect(writes).toEqual([]);
    },
  );

  it("responde 400 si intenta borrar una fecha que ya estaba", async () => {
    const response = await patchRecord({ ...VALID_BODY, dateOfBirth: null });

    expect(response.status).toBe(400);
    await expect(reasonOf(response)).resolves.toBe("date_of_birth_required");
    expect(writes).toEqual([]);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s que intenta corregir la fecha",
    async (role) => {
      givenRole(role);

      const response = await patchRecord({
        ...VALID_BODY,
        dateOfBirth: MINOR_BIRTH,
      });

      expect(response.status).toBe(403);
      expect(writes).toEqual([]);
    },
  );

  it("responde 409 si el estado de la cuenta cambió mientras se guardaba", async () => {
    gateways = {
      ...gateways,
      records: {
        ...gateways.records,
        correctDateOfBirth: async () => ({ kind: "status_changed" }),
      },
    };

    const response = await patchRecord({
      ...VALID_BODY,
      dateOfBirth: MINOR_BIRTH,
    });

    expect(response.status).toBe(409);
    await expect(reasonOf(response)).resolves.toBe("member_status_changed");
  });
});
