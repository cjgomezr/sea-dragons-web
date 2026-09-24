import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import { MAX_CONFIRMATION_EMAILS_PER_WINDOW } from "@/lib/auth/confirmation-email-resend";
import type { ConfirmationEmailOutcome } from "@/lib/auth/register-member";
import type { Role } from "@/lib/auth/roles";
import {
  MEMBERS_API_PATH,
  MEMBER_INVITATION_API_PATH,
} from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import { LOCALE_COOKIE_NAME } from "@/lib/i18n/locale";
import type {
  InvitedMemberRow,
  MemberInvitationGateways,
} from "@/lib/members/member-invitation";
import { FORWARD, SEEDED_POSITIONS } from "../helpers/seeded-positions";

/**
 * El alta de un miembro y el reenvío de su invitación por la API (#243, RF-5
 * del PRD de E5). La petición entra por el proxy y sólo llega al handler si la
 * frontera la deja seguir, como en producción: el 403 de los otros tres roles
 * es el de verdad.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const NEW_USER_ID = "c2c2c2c2-0000-4000-8000-00000000000c";
const UNKNOWN_MEMBER_ID = "c2c2c2c2-0000-4000-8000-0000000000ff";
const SENIOR_ID = "9a9a9a9a-0000-4000-8000-000000000001";

const VALID_BODY = {
  fullName: "Nerea Silva",
  email: "nerea.silva@example.com",
  country: "AU",
  positionId: FORWARD.id,
  experienceLevel: "Intermediate",
  gender: "female",
  aufNumber: "AUF-2210",
  aufExpiry: "2099-06-30",
  groupIds: [SENIOR_ID],
} as const;

const readSessionState = vi.fn();
const insertedRows: InvitedMemberRow[] = [];
const sentEmails: string[] = [];
let callerRole: Role = "Admin";
let emailTaken = false;
let inviteeStatus: AccountStatus = "incomplete";
let emailOutcome: ConfirmationEmailOutcome = { kind: "requested" };
let requestsInWindow = 0;

function invitationGateways(): MemberInvitationGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Ana Admin",
        role: callerRole,
      }),
    },
    positions: { findClubPositions: async () => SEEDED_POSITIONS },
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
        fullName: "Nerea Silva",
        accountStatus: "incomplete",
      }),
      insertMembership: async () => ({ kind: "assigned" }),
      deleteMembership: async () => ({ kind: "removed" }),
    },
    identities: {
      createInvitedIdentity: async () =>
        emailTaken
          ? { kind: "already_registered" }
          : { kind: "created", userId: NEW_USER_ID },
      deleteIdentity: async () => undefined,
      isEmailConfirmed: async () => false,
    },
    invitees: {
      insertInvitedMember: async (row) => {
        insertedRows.push(row);
      },
      findInvitee: async ({ userId }) =>
        userId === NEW_USER_ID
          ? { email: VALID_BODY.email, accountStatus: inviteeStatus }
          : null,
    },
    invitationEmail: {
      requestConfirmationEmail: async (email) => {
        sentEmails.push(email);
        return emailOutcome;
      },
    },
    emailDeliveryForClub: () => ({
      checkAvailability: async () => ({ kind: "available" }),
    }),
    invitationRequestsForClub: () => ({
      recordAndCountRecent: async () => {
        requestsInWindow += 1;
        return requestsInWindow;
      },
    }),
  };
}

let gateways = invitationGateways();

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
  readAuthenticatedUserId: async () => "a0a0a0a0-0000-4000-8000-00000000000a",
}));

vi.mock("@/lib/members/supabase-member-invitation-gateways", () => ({
  createSupabaseMemberInvitationGateways: () => ({ kind: "ready", gateways }),
}));

const { proxy } = await import("@/proxy");
const { POST: postMember } = await import("@/app/api/v1/members/route");
const { POST: postInvitation, GET: getInvitation } =
  await import("@/app/api/v1/members/[id]/invitation/route");

function givenRole(role: Role): void {
  callerRole = role;
  readSessionState.mockResolvedValue({
    kind: "active",
    role,
  } satisfies SessionState);
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

async function createMember(
  body: unknown,
  locale: "en" | "es" = "en",
): Promise<Response> {
  const request = new NextRequest(new URL(MEMBERS_API_PATH, ORIGIN), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${LOCALE_COOKIE_NAME}=${locale}`,
    },
    body: JSON.stringify(body),
  });
  return throughBoundary(request, postMember);
}

async function resend(memberId: string = NEW_USER_ID): Promise<Response> {
  const path = MEMBER_INVITATION_API_PATH.replace("[id]", memberId);
  const request = new NextRequest(new URL(path, ORIGIN), { method: "POST" });
  return throughBoundary(request, (incoming) =>
    postInvitation(incoming, { params: Promise.resolve({ id: memberId }) }),
  );
}

async function errorOf(
  response: Response,
): Promise<{ readonly code: string; readonly reason?: string }> {
  const body = (await response.json()) as {
    error: { code: string; reason?: string };
  };
  return body.error;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  insertedRows.length = 0;
  sentEmails.length = 0;
  emailTaken = false;
  inviteeStatus = "incomplete";
  emailOutcome = { kind: "requested" };
  requestsInWindow = 0;
  gateways = invitationGateways();
  givenRole("Admin");
});

describe("POST /api/v1/members", () => {
  it("responde 201 con el miembro creado y la invitación enviada", async () => {
    const response = await createMember(VALID_BODY);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: {
        member: {
          userId: NEW_USER_ID,
          fullName: "Nerea Silva",
          email: "nerea.silva@example.com",
        },
        invitation: "sent",
      },
    });
    expect(sentEmails).toEqual(["nerea.silva@example.com"]);
  });

  it("guarda como idioma de los correos el del Admin que lo da de alta", async () => {
    await createMember(VALID_BODY, "es");

    expect(insertedRows[0]?.email_locale).toBe("es");
  });

  it("responde 201 diciendo que la invitación no salió cuando el envío falla", async () => {
    emailOutcome = { kind: "failed", reason: "503: caído" };

    const response = await createMember(VALID_BODY);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { invitation: "not_sent" },
    });
    expect(insertedRows).toHaveLength(1);
  });

  it("responde 409 a un correo que ya tiene cuenta, sin crear ni mandar nada", async () => {
    emailTaken = true;

    const response = await createMember(VALID_BODY);

    expect(response.status).toBe(409);
    await expect(errorOf(response)).resolves.toMatchObject({
      code: "conflict",
      reason: "email_taken",
    });
    expect(insertedRows).toEqual([]);
    expect(sentEmails).toEqual([]);
  });

  it("responde 400 con el motivo a un correo con formato inválido", async () => {
    const response = await createMember({ ...VALID_BODY, email: "nerea" });

    expect(response.status).toBe(400);
    await expect(errorOf(response)).resolves.toMatchObject({
      reason: "email_malformed",
    });
    expect(insertedRows).toEqual([]);
  });

  it("responde 400 a un campo obligatorio vacío", async () => {
    const response = await createMember({ ...VALID_BODY, fullName: " " });

    expect(response.status).toBe(400);
    expect(insertedRows).toEqual([]);
  });

  it("responde 400 a un campo que falta o sobra", async () => {
    const withoutGender = Object.fromEntries(
      Object.entries(VALID_BODY).filter(([field]) => field !== "gender"),
    );

    const missing = await createMember(withoutGender);
    const extra = await createMember({ ...VALID_BODY, role: "Admin" });

    expect(missing.status).toBe(400);
    expect(extra.status).toBe(400);
    expect(insertedRows).toEqual([]);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s sin crear nada",
    async (role) => {
      givenRole(role);

      const response = await createMember(VALID_BODY);

      expect(response.status).toBe(403);
      expect(insertedRows).toEqual([]);
    },
  );
});

describe("POST /api/v1/members/{id}/invitation", () => {
  it("responde 200 y manda otra invitación a quien todavía no entró", async () => {
    const response = await resend();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { invitation: "sent" },
    });
    expect(sentEmails).toEqual([VALID_BODY.email]);
  });

  it("responde 409 a quien ya entró", async () => {
    inviteeStatus = "active";

    const response = await resend();

    expect(response.status).toBe(409);
    await expect(errorOf(response)).resolves.toMatchObject({
      reason: "invitation_not_pending",
    });
    expect(sentEmails).toEqual([]);
  });

  it("responde 404 a un miembro que no es del club", async () => {
    const response = await resend(UNKNOWN_MEMBER_ID);

    expect(response.status).toBe(404);
  });

  it("responde 404 a un id que no es un uuid", async () => {
    const response = await resend("no-es-un-id");

    expect(response.status).toBe(404);
  });

  it("limita los reenvíos seguidos como el correo de confirmación", async () => {
    const responses: number[] = [];
    for (let i = 0; i <= MAX_CONFIRMATION_EMAILS_PER_WINDOW; i += 1) {
      responses.push((await resend()).status);
    }

    expect(responses).toEqual([200, 200, 200, 429]);
    expect(sentEmails).toHaveLength(MAX_CONFIRMATION_EMAILS_PER_WINDOW);
  });

  it("responde 503 cuando la invitación no sale", async () => {
    emailOutcome = { kind: "failed", reason: "503: caído" };

    const response = await resend();

    expect(response.status).toBe(503);
    await expect(errorOf(response)).resolves.toMatchObject({
      reason: "invitation_not_sent",
    });
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s sin mandar nada",
    async (role) => {
      givenRole(role);

      const response = await resend();

      expect(response.status).toBe(403);
      expect(sentEmails).toEqual([]);
    },
  );

  it("no acepta otros métodos", async () => {
    const path = MEMBER_INVITATION_API_PATH.replace("[id]", NEW_USER_ID);

    const response = await getInvitation(
      new NextRequest(new URL(path, ORIGIN)),
    );

    expect(response.status).toBe(405);
  });
});
