import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { activateAccountIfComplete } from "@/lib/auth/account-activation";
import type { ConfirmationEmailGateway } from "@/lib/auth/register-member";
import { createSupabaseAuthGateways } from "@/lib/auth/supabase-auth-gateways";
import {
  createRecoveryTokenIssuer,
  createRecoveryTokenRedeemer,
} from "@/lib/auth/supabase-password-recovery";
import {
  DEFAULT_DIRECTORY_QUERY,
  listDirectory,
} from "@/lib/directory/directory";
import { DEFAULT_CLUB_BRAND } from "@/lib/club/club-brand";
import { createDirectoryGateways } from "@/lib/directory/supabase-directory-gateways";
import { createClubPositionsGateway } from "@/lib/club/supabase-club-positions";
import type { OutgoingEmail } from "@/lib/email/resend-email-sender";
import { createGroupsGateways } from "@/lib/groups/supabase-groups-gateways";
import { createInvitationEmailGateway } from "@/lib/members/invitation-email-sender";
import {
  InvitationNotPendingError,
  MemberEmailTakenError,
  type MemberInvitationGateways,
  type NewMemberSubmission,
  createInvitedMember,
  resendInvitation,
} from "@/lib/members/member-invitation";
import { createInvitedMemberStore } from "@/lib/members/supabase-member-invitation-gateways";
import { createMemberRecordGateways } from "@/lib/members/supabase-member-record-gateways";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * El alta de un miembro contra `seadragons-dev` (#243). Lo que ningún doble
 * puede afirmar: que la identidad nace sin confirmar, que la fila pasa los
 * `check` de `members`, que el directorio la ve pendiente y los grupos no la
 * cuentan, y que el enlace de la invitación deja al miembro entrar y activar
 * su cuenta con la pantalla de completar registro.
 *
 * NINGÚN test de aquí manda un correo: el emisor es un doble que guarda lo que
 * habría mandado, y el enlace se emite con `generateLink`, que no envía nada.
 */

const MEMBERS_TABLE = "members";
const PASSWORD = "bajoelagua-de-prueba";
const APP_URL = "http://localhost:3417/api/v1/members";

type Scenario = {
  readonly serviceClient: ServiceRoleClient;
  readonly clubId: string;
  readonly adminId: string;
  readonly groupId: string;
};

async function withScenario(
  run: (scenario: Scenario) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  await withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `alta-${randomUUID()}`, name: "Club del alta" }],
    ([club]) =>
      withTestUser(serviceClient, async (admin) => {
        const clubId = club!.id as string;
        const { error } = await serviceClient.client
          .from(MEMBERS_TABLE)
          .insert({
            club_id: clubId,
            user_id: admin.id,
            full_name: "Ana Admin",
            email: admin.email,
            account_status: "active",
            role: "Admin",
          });
        if (error) {
          throw new Error(`No se pudo sembrar al Admin: ${error.message}`);
        }
        await withSeededRows(
          serviceClient,
          "groups",
          [{ club_id: clubId, name: "Senior Squad" }],
          ([group]) =>
            run({
              serviceClient,
              clubId,
              adminId: admin.id,
              groupId: group!.id as string,
            }),
        );
      }),
  );
}

/** Borra las identidades que el alta creó, y con ellas sus filas. */
async function deleteIdentitiesByEmail(
  serviceClient: ServiceRoleClient,
  email: string,
): Promise<void> {
  const { data, error } = await serviceClient.client
    .from(MEMBERS_TABLE)
    .select("user_id")
    .eq("email", email);
  if (error) {
    throw new Error(`No se pudo buscar el alta de prueba: ${error.message}`);
  }
  for (const row of data) {
    await serviceClient.client.auth.admin.deleteUser(row.user_id as string);
  }
}

async function withInvitedEmail(
  serviceClient: ServiceRoleClient,
  run: (email: string) => Promise<void>,
): Promise<void> {
  const email = `alta-${randomUUID()}@example.test`;
  try {
    await run(email);
  } finally {
    await deleteIdentitiesByEmail(serviceClient, email);
  }
}

type CapturingEmail = {
  readonly gateway: ConfirmationEmailGateway;
  readonly sent: OutgoingEmail[];
};

/** El emisor de verdad, con el enlace de verdad, y un buzón de mentira. */
function capturingInvitationEmail(
  serviceClient: ServiceRoleClient,
): CapturingEmail {
  const sent: OutgoingEmail[] = [];
  const auth = createSupabaseAuthGateways(process.env);
  if (auth.kind === "unconfigured") {
    throw new Error("Faltan las variables de Supabase.");
  }
  return {
    sent,
    gateway: createInvitationEmailGateway({
      tokens: createRecoveryTokenIssuer(serviceClient.client),
      emails: {
        kind: "connected",
        sender: {
          sendEmail: async (email) => {
            sent.push(email);
            return { id: randomUUID() };
          },
        },
      },
      emailLocales: auth.gateways.emailLocales,
      readClubBrand: async () => DEFAULT_CLUB_BRAND,
    }),
  };
}

function realGateways(
  serviceClient: ServiceRoleClient,
  invitationEmail: ConfirmationEmailGateway,
): MemberInvitationGateways {
  const auth = createSupabaseAuthGateways(process.env);
  if (auth.kind === "unconfigured") {
    throw new Error("Faltan las variables de Supabase.");
  }
  const record = createMemberRecordGateways(serviceClient.client);
  const store = createInvitedMemberStore(serviceClient.client);
  return {
    members: record.members,
    groupMembers: record.groupMembers,
    groups: record.groups,
    identities: { ...store.identities, ...auth.gateways.identities },
    invitees: store.invitees,
    invitationEmail,
    emailDeliveryForClub: () => ({
      checkAvailability: async () => ({ kind: "available" }),
    }),
    // El límite tiene sus propios tests; éste no escribe en su tabla.
    invitationRequestsForClub: () => ({
      recordAndCountRecent: async () => 1,
    }),
  };
}

function submissionFor(email: string, groupId: string): NewMemberSubmission {
  return {
    fullName: "Nerea Invitada",
    email,
    country: "AU",
    position: "Forward",
    experienceLevel: "Beginner",
    gender: "undisclosed",
    aufNumber: "AUF-243",
    aufExpiry: "2099-12-31",
    groupIds: [groupId],
  };
}

function tokenHashFrom(email: OutgoingEmail): string {
  const match = /token_hash=([^\s&"]+)/.exec(email.text);
  if (match?.[1] === undefined) {
    throw new Error("La invitación no llevaba el enlace.");
  }
  return decodeURIComponent(match[1]);
}

describeRls("alta de un miembro contra seadragons-dev", () => {
  it(
    "crea la identidad sin confirmar y su fila, y el directorio la muestra pendiente sin contarla en su grupo",
    async () => {
      await withScenario(
        async ({ serviceClient, clubId, adminId, groupId }) => {
          await withInvitedEmail(serviceClient, async (email) => {
            const { gateway } = capturingInvitationEmail(serviceClient);
            const today = clubCalendarDate(new Date());

            const created = await createInvitedMember(
              realGateways(serviceClient, gateway),
              {
                callerId: adminId,
                submission: submissionFor(email, groupId),
                todayInClub: today,
                now: new Date(),
                locale: "en",
                appUrl: APP_URL,
              },
            );

            const identity = await serviceClient.client.auth.admin.getUserById(
              created.member.userId,
            );
            expect(identity.data.user?.email_confirmed_at ?? null).toBeNull();
            const { data: row } = await serviceClient.client
              .from(MEMBERS_TABLE)
              .select(
                "role, account_status, email_locale, position, experience_level, gender, auf_number, auf_expiry, country, joined_on, auf_verified_at",
              )
              .eq("user_id", created.member.userId)
              .single();
            // El AUF del alta lo escribe un Admin: nace verificado (#274).
            expect(row?.auf_verified_at).not.toBeNull();
            expect({ ...row, auf_verified_at: undefined }).toEqual({
              role: "Player",
              account_status: "incomplete",
              email_locale: "en",
              position: "Forward",
              experience_level: "Beginner",
              gender: "undisclosed",
              auf_number: "AUF-243",
              auf_expiry: "2099-12-31",
              country: "AU",
              joined_on: today,
            });

            const listing = await listDirectory(
              createDirectoryGateways(
  serviceClient.client,
  createClubPositionsGateway(serviceClient.client),
),
              {
                callerId: adminId,
                query: DEFAULT_DIRECTORY_QUERY,
                todayInClub: today,
              },
            );
            expect(
              listing.members.find(
                (member) => member.userId === created.member.userId,
              )?.status,
            ).toBe("incomplete");
            const groups = await createGroupsGateways(
              serviceClient.client,
            ).groups.findClubGroups(clubId);
            expect(groups).toEqual([
              { id: groupId, name: "Senior Squad", memberCount: 0 },
            ]);
          });
        },
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "rechaza un correo que ya tiene cuenta sin crear otra fila ni mandar nada",
    async () => {
      await withScenario(async ({ serviceClient, adminId, groupId }) => {
        await withInvitedEmail(serviceClient, async (email) => {
          const { gateway, sent } = capturingInvitationEmail(serviceClient);
          const gateways = realGateways(serviceClient, gateway);
          const request = {
            callerId: adminId,
            submission: submissionFor(email, groupId),
            todayInClub: clubCalendarDate(new Date()),
            now: new Date(),
            locale: "es" as const,
            appUrl: APP_URL,
          };
          await createInvitedMember(gateways, request);

          await expect(
            createInvitedMember(gateways, {
              ...request,
              submission: {
                ...request.submission,
                email: email.toUpperCase(),
              },
            }),
          ).rejects.toBeInstanceOf(MemberEmailTakenError);
          const { count } = await serviceClient.client
            .from(MEMBERS_TABLE)
            .select("user_id", { count: "exact", head: true })
            .eq("email", email);
          expect(count).toBe(1);
          expect(sent).toHaveLength(1);
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "el enlace de la invitación deja elegir contraseña, y al completar el registro la cuenta queda activa",
    async () => {
      await withScenario(async ({ serviceClient, adminId, groupId }) => {
        await withInvitedEmail(serviceClient, async (email) => {
          const { gateway, sent } = capturingInvitationEmail(serviceClient);
          const gateways = realGateways(serviceClient, gateway);
          const created = await createInvitedMember(gateways, {
            callerId: adminId,
            submission: submissionFor(email, groupId),
            todayInClub: clubCalendarDate(new Date()),
            now: new Date(),
            locale: "es",
            appUrl: APP_URL,
          });
          expect(sent[0]?.subject).toBe("Te invitaron a Victoria Seadragons");

          const anon = readSupabaseConfig(process.env);
          if (anon.kind === "missing") {
            throw new Error("Falta la llave anónima.");
          }
          await expect(
            createRecoveryTokenRedeemer(anon).redeemRecoveryToken({
              tokenHash: tokenHashFrom(sent[0]!),
              newPassword: PASSWORD,
            }),
          ).resolves.toEqual({
            kind: "password_changed",
            userId: created.member.userId,
          });
          await expect(
            resendInvitation(gateways, {
              callerId: adminId,
              userId: created.member.userId,
              now: new Date(),
              appUrl: APP_URL,
            }),
          ).rejects.toBeInstanceOf(InvitationNotPendingError);

          // Lo que pide la pantalla de completar registro que ya existe.
          const auth = createSupabaseAuthGateways(process.env);
          if (auth.kind === "unconfigured") {
            throw new Error("Faltan las variables de Supabase.");
          }
          const account = await auth.gateways.accounts.findByUserId(
            created.member.userId,
          );
          await auth.gateways.accounts.updateProfile(account!.memberId, {
            dateOfBirth: "1990-05-04",
            membershipType: "Full",
          });
          await expect(
            activateAccountIfComplete(auth.gateways, created.member.userId),
          ).resolves.toEqual({ kind: "activated" });
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
