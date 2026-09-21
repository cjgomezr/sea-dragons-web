import { describe, expect, it } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import { MAX_CONFIRMATION_EMAILS_PER_WINDOW } from "@/lib/auth/confirmation-email-resend";
import type { ConfirmationEmailOutcome } from "@/lib/auth/register-member";
import type { Role } from "@/lib/auth/roles";
import type { EmailDeliveryAvailability } from "@/lib/email/email-delivery-availability";
import { GroupNotFoundError } from "@/lib/groups/groups";
import {
  InvitationNotPendingError,
  InvitationNotSentError,
  InvitationRateLimitedError,
  type InvitedMemberRow,
  MemberEmailTakenError,
  MemberInvitationForbiddenError,
  type MemberInvitationGateways,
  NewMemberValidationError,
  type NewMemberSubmission,
  createInvitedMember,
  resendInvitation,
} from "@/lib/members/member-invitation";
import { MemberRecordNotFoundError } from "@/lib/members/member-record";

/**
 * El alta de un miembro por un Admin y su invitación (#243, RF-5 del PRD de
 * E5), contados sin Supabase ni proveedor de correo delante.
 */

const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const NEW_USER_ID = "c2c2c2c2-0000-4000-8000-00000000000c";
const SENIOR_ID = "9a9a9a9a-0000-4000-8000-000000000001";
const MASTERS_ID = "9a9a9a9a-0000-4000-8000-000000000002";
const OTHER_CLUB_GROUP_ID = "9a9a9a9a-0000-4000-8000-000000000099";
const TODAY_IN_CLUB = "2026-09-22";
const NOW = new Date("2026-09-22T01:00:00Z");
const APP_URL = "https://club.example/api/v1/members";

const CLUB_GROUPS = [
  { id: SENIOR_ID, name: "Senior Squad", memberCount: 4 },
  { id: MASTERS_ID, name: "Masters Squad", memberCount: 2 },
] as const;

const VALID_SUBMISSION: NewMemberSubmission = {
  fullName: "  Nerea Silva ",
  email: " Nerea.Silva@Example.com ",
  country: "au",
  position: "Forward",
  experienceLevel: "Intermediate",
  gender: "female",
  aufNumber: " AUF-2210 ",
  aufExpiry: "2027-06-30",
  groupIds: [SENIOR_ID, MASTERS_ID],
};

type FakeOptions = {
  readonly callerRole?: Role;
  readonly emailTaken?: boolean;
  readonly insertFails?: boolean;
  readonly emailDelivery?: EmailDeliveryAvailability;
  readonly emailOutcome?: ConfirmationEmailOutcome;
  readonly invitee?: {
    readonly accountStatus: AccountStatus;
    readonly emailConfirmed: boolean;
  } | null;
  readonly previousRequests?: number;
};

type Fake = {
  readonly gateways: MemberInvitationGateways;
  readonly insertedRows: InvitedMemberRow[];
  readonly assignedGroups: string[];
  readonly createdIdentities: string[];
  readonly deletedIdentities: string[];
  readonly sentEmails: { readonly email: string; readonly appUrl: string }[];
};

function fake(options: FakeOptions = {}): Fake {
  const insertedRows: InvitedMemberRow[] = [];
  const assignedGroups: string[] = [];
  const createdIdentities: string[] = [];
  const deletedIdentities: string[] = [];
  const sentEmails: { email: string; appUrl: string }[] = [];
  let requestsInWindow = options.previousRequests ?? 0;
  const invitee =
    options.invitee === undefined
      ? { accountStatus: "incomplete" as const, emailConfirmed: false }
      : options.invitee;

  const gateways: MemberInvitationGateways = {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Ana Admin",
        role: options.callerRole ?? "Admin",
      }),
    },
    groups: {
      findClubGroups: async () => CLUB_GROUPS,
    },
    groupMembers: {
      findGroupMembers: async () => ({ kind: "found", members: [] }),
      findCandidates: async () => ({ kind: "found", members: [] }),
      findClubMember: async ({ userId }) =>
        insertedRows.some((row) => row.user_id === userId)
          ? { id: userId, fullName: "Nerea Silva", accountStatus: "incomplete" }
          : null,
      insertMembership: async ({ groupId }) => {
        assignedGroups.push(groupId);
        return { kind: "assigned" };
      },
      deleteMembership: async () => ({ kind: "removed" }),
    },
    identities: {
      createInvitedIdentity: async (email) => {
        if (options.emailTaken) {
          return { kind: "already_registered" };
        }
        createdIdentities.push(email);
        return { kind: "created", userId: NEW_USER_ID };
      },
      deleteIdentity: async (userId) => {
        deletedIdentities.push(userId);
      },
      isEmailConfirmed: async () => invitee?.emailConfirmed ?? false,
    },
    invitees: {
      insertInvitedMember: async (row) => {
        if (options.insertFails) {
          throw new Error("la base no respondió");
        }
        insertedRows.push(row);
      },
      findInvitee: async ({ userId }) =>
        invitee === null || userId !== NEW_USER_ID
          ? null
          : {
              email: "nerea.silva@example.com",
              accountStatus: invitee.accountStatus,
            },
    },
    invitationEmail: {
      requestConfirmationEmail: async (email, appUrl) => {
        sentEmails.push({ email, appUrl });
        return options.emailOutcome ?? { kind: "requested" };
      },
    },
    emailDeliveryForClub: () => ({
      checkAvailability: async () =>
        options.emailDelivery ?? { kind: "available" },
    }),
    invitationRequestsForClub: () => ({
      recordAndCountRecent: async () => {
        requestsInWindow += 1;
        return requestsInWindow;
      },
    }),
  };

  return {
    gateways,
    insertedRows,
    assignedGroups,
    createdIdentities,
    deletedIdentities,
    sentEmails,
  };
}

function create(
  gateways: MemberInvitationGateways,
  submission: NewMemberSubmission = VALID_SUBMISSION,
): ReturnType<typeof createInvitedMember> {
  return createInvitedMember(gateways, {
    callerId: ADMIN_ID,
    submission,
    todayInClub: TODAY_IN_CLUB,
    now: NOW,
    locale: "en",
    appUrl: APP_URL,
  });
}

function resend(
  gateways: MemberInvitationGateways,
): ReturnType<typeof resendInvitation> {
  return resendInvitation(gateways, {
    callerId: ADMIN_ID,
    userId: NEW_USER_ID,
    now: NOW,
    appUrl: APP_URL,
  });
}

async function captureValidationCodes(
  submission: NewMemberSubmission,
): Promise<readonly string[]> {
  const error = await create(fake().gateways, submission).catch(
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(NewMemberValidationError);
  return (error as NewMemberValidationError).issues.map(
    (issue) => `${issue.field}:${issue.code}`,
  );
}

describe("alta de un miembro", () => {
  it("creates the member as an incomplete Player with the Admin's locale", async () => {
    const { gateways, insertedRows } = fake();

    await create(gateways);

    expect(insertedRows).toEqual([
      {
        club_id: CLUB_ID,
        user_id: NEW_USER_ID,
        full_name: "Nerea Silva",
        email: "nerea.silva@example.com",
        country: "AU",
        position: "Forward",
        experience_level: "Intermediate",
        gender: "female",
        auf_number: "AUF-2210",
        auf_expiry: "2027-06-30",
        role: "Player",
        account_status: "incomplete",
        email_locale: "en",
      },
    ]);
  });

  it("assigns every chosen group to the new member", async () => {
    const { gateways, assignedGroups } = fake();

    await create(gateways);

    expect(assignedGroups).toEqual([SENIOR_ID, MASTERS_ID]);
  });

  it("creates a member with no groups when none are chosen", async () => {
    const { gateways, insertedRows, assignedGroups } = fake();

    await create(gateways, { ...VALID_SUBMISSION, groupIds: [] });

    expect(insertedRows).toHaveLength(1);
    expect(assignedGroups).toEqual([]);
  });

  it("sends the invitation to the new address and reports it sent", async () => {
    const { gateways, sentEmails } = fake();

    const created = await create(gateways);

    expect(sentEmails).toEqual([
      { email: "nerea.silva@example.com", appUrl: APP_URL },
    ]);
    expect(created).toEqual({
      member: {
        userId: NEW_USER_ID,
        fullName: "Nerea Silva",
        email: "nerea.silva@example.com",
      },
      invitation: { kind: "sent" },
    });
  });

  it("rejects an address that already has an account with no row, groups or email", async () => {
    const { gateways, insertedRows, assignedGroups, sentEmails } = fake({
      emailTaken: true,
    });

    await expect(create(gateways)).rejects.toBeInstanceOf(
      MemberEmailTakenError,
    );
    expect(insertedRows).toEqual([]);
    expect(assignedGroups).toEqual([]);
    expect(sentEmails).toEqual([]);
  });

  it("names every invalid field at once", async () => {
    const codes = await captureValidationCodes({
      ...VALID_SUBMISSION,
      email: "nerea-at-example",
      country: "Atlantis",
      position: "Striker",
      experienceLevel: "Expert",
      gender: "other",
      aufExpiry: "2027-02-30",
    });

    expect(codes).toEqual([
      "email:email_malformed",
      "country:country_unknown",
      "position:position_unknown",
      "experienceLevel:experience_level_unknown",
      "gender:gender_unknown",
      "aufExpiry:auf_expiry_not_a_date",
    ]);
  });

  it("rejects empty required fields", async () => {
    const codes = await captureValidationCodes({
      ...VALID_SUBMISSION,
      fullName: "   ",
      aufNumber: " ",
      aufExpiry: "",
    });

    expect(codes).toEqual([
      "fullName:full_name_missing",
      "aufNumber:auf_number_missing",
      "aufExpiry:auf_expiry_not_a_date",
    ]);
  });

  it("rejects an AUF number longer than the database allows", async () => {
    const codes = await captureValidationCodes({
      ...VALID_SUBMISSION,
      aufNumber: "A".repeat(41),
    });

    expect(codes).toEqual(["aufNumber:auf_number_too_long"]);
  });

  it("rejects an AUF that expired before the member joins today", async () => {
    const codes = await captureValidationCodes({
      ...VALID_SUBMISSION,
      aufExpiry: "2026-09-21",
    });

    expect(codes).toEqual(["aufExpiry:auf_expiry_before_joined"]);
  });

  it("creates nothing when the submission is invalid", async () => {
    const { gateways, createdIdentities } = fake();

    await create(gateways, { ...VALID_SUBMISSION, email: "" }).catch(
      () => undefined,
    );

    expect(createdIdentities).toEqual([]);
  });

  it.each<Role>(["Coach", "Committee", "Player"])(
    "forbids a %s from creating members",
    async (callerRole) => {
      const { gateways, createdIdentities } = fake({ callerRole });

      await expect(create(gateways)).rejects.toBeInstanceOf(
        MemberInvitationForbiddenError,
      );
      expect(createdIdentities).toEqual([]);
    },
  );

  it("rejects a group from another club before creating anything", async () => {
    const { gateways, createdIdentities } = fake();

    await expect(
      create(gateways, {
        ...VALID_SUBMISSION,
        groupIds: [SENIOR_ID, OTHER_CLUB_GROUP_ID],
      }),
    ).rejects.toBeInstanceOf(GroupNotFoundError);
    expect(createdIdentities).toEqual([]);
  });

  it("keeps the member when the invitation fails to send", async () => {
    const { gateways, insertedRows, assignedGroups } = fake({
      emailOutcome: { kind: "failed", reason: "503: provider down" },
    });

    const created = await create(gateways);

    expect(insertedRows).toHaveLength(1);
    expect(assignedGroups).toEqual([SENIOR_ID, MASTERS_ID]);
    expect(created.invitation).toEqual({
      kind: "not_sent",
      reason: "503: provider down",
    });
  });

  it("does not ask for the email when delivery is unavailable", async () => {
    const { gateways, insertedRows, sentEmails } = fake({
      emailDelivery: { kind: "unavailable", reason: "cupo agotado" },
    });

    const created = await create(gateways);

    expect(insertedRows).toHaveLength(1);
    expect(sentEmails).toEqual([]);
    expect(created.invitation).toEqual({
      kind: "not_sent",
      reason: "cupo agotado",
    });
  });

  it("undoes the identity when the member row cannot be written", async () => {
    const { gateways, deletedIdentities, sentEmails } = fake({
      insertFails: true,
    });

    await expect(create(gateways)).rejects.toThrow(/la base no respondió/);
    expect(deletedIdentities).toEqual([NEW_USER_ID]);
    expect(sentEmails).toEqual([]);
  });
});

describe("reenvío de la invitación", () => {
  it("sends a new invitation to a member who has not joined yet", async () => {
    const { gateways, sentEmails } = fake();

    await resend(gateways);

    expect(sentEmails).toEqual([
      { email: "nerea.silva@example.com", appUrl: APP_URL },
    ]);
  });

  it("answers not found for someone outside the club", async () => {
    const { gateways, sentEmails } = fake({ invitee: null });

    await expect(resend(gateways)).rejects.toBeInstanceOf(
      MemberRecordNotFoundError,
    );
    expect(sentEmails).toEqual([]);
  });

  it.each([
    { accountStatus: "active" as const, emailConfirmed: true },
    { accountStatus: "inactive" as const, emailConfirmed: true },
    { accountStatus: "incomplete" as const, emailConfirmed: true },
  ])(
    "refuses to resend once the member has come in ($accountStatus, confirmed)",
    async (invitee) => {
      const { gateways, sentEmails } = fake({ invitee });

      await expect(resend(gateways)).rejects.toBeInstanceOf(
        InvitationNotPendingError,
      );
      expect(sentEmails).toEqual([]);
    },
  );

  it("limits resends like the confirmation email", async () => {
    const { gateways, sentEmails } = fake({
      previousRequests: MAX_CONFIRMATION_EMAILS_PER_WINDOW,
    });

    await expect(resend(gateways)).rejects.toBeInstanceOf(
      InvitationRateLimitedError,
    );
    expect(sentEmails).toEqual([]);
  });

  it("reports a resend that the provider could not send", async () => {
    const { gateways } = fake({
      emailOutcome: { kind: "failed", reason: "503: provider down" },
    });

    await expect(resend(gateways)).rejects.toBeInstanceOf(
      InvitationNotSentError,
    );
  });

  it("reports a resend when delivery is unavailable", async () => {
    const { gateways, sentEmails } = fake({
      emailDelivery: { kind: "unavailable", reason: "cupo agotado" },
    });

    await expect(resend(gateways)).rejects.toBeInstanceOf(
      InvitationNotSentError,
    );
    expect(sentEmails).toEqual([]);
  });

  it.each<Role>(["Coach", "Committee", "Player"])(
    "forbids a %s from resending",
    async (callerRole) => {
      const { gateways, sentEmails } = fake({ callerRole });

      await expect(resend(gateways)).rejects.toBeInstanceOf(
        MemberInvitationForbiddenError,
      );
      expect(sentEmails).toEqual([]);
    },
  );
});
