import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAccountStatus } from "@/lib/auth/account-status";
import {
  createSupabaseAuthGateways,
  isAlreadyRegistered,
  readRequiredText,
} from "@/lib/auth/supabase-auth-gateways";
import { createRecoveryTokenIssuer } from "@/lib/auth/supabase-password-recovery";
import { readClubBrand } from "@/lib/club/supabase-club-brand";
import { cachedClubPositions } from "@/lib/club/supabase-club-positions";
import { connectResendEmailSender } from "@/lib/email/resend-email-sender";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import { createInvitationEmailGateway } from "./invitation-email-sender";
import type { Invitee, MemberInvitationGateways } from "./member-invitation";
import { createMemberRecordGateways } from "./supabase-member-record-gateways";

/**
 * Adaptador entre el alta de un miembro (#243) y Supabase.
 *
 * Va por la llave de servicio: crear una identidad y escribir en `members`
 * sólo se puede con ella (`0003_members.sql`). El servidor ya comprobó que
 * quien pide es Admin, y cada lectura filtra por su club (NFR-009).
 *
 * Los grupos, el límite del reenvío, el cupo de correos y el idioma guardado
 * se leen con los adaptadores que ya existen: los de E4, los del registro y
 * los de la recuperación de contraseña.
 */

const MEMBERS_TABLE = "members";

type Environment = Readonly<Record<string, string | undefined>>;

type Row = Record<string, unknown>;

function toInvitee(row: Row): Invitee {
  const value = readRequiredText(row, "account_status", MEMBERS_TABLE);
  const accountStatus = parseAccountStatus(value);
  if (accountStatus === null) {
    throw new Error(`${value} no es un estado de cuenta que se reconozca.`);
  }
  return {
    email: readRequiredText(row, "email", MEMBERS_TABLE),
    accountStatus,
  };
}

/** Lo que el alta escribe y lee de Supabase por su cuenta. Va aparte de la
 * raíz de composición para que el test de integración lo use con un correo
 * que no sale. */
export function createInvitedMemberStore(serviceClient: SupabaseClient): Pick<
  MemberInvitationGateways,
  "invitees"
> & {
  readonly identities: Pick<
    MemberInvitationGateways["identities"],
    "createInvitedIdentity" | "deleteIdentity"
  >;
} {
  return {
    identities: {
      async createInvitedIdentity(email) {
        // Sin contraseña y sin confirmar (FR-083): el miembro la elige con el
        // enlace de la invitación, y canjearlo confirma el correo.
        const { data, error } = await serviceClient.auth.admin.createUser({
          email,
          email_confirm: false,
        });
        if (error) {
          if (isAlreadyRegistered(error)) {
            return { kind: "already_registered" };
          }
          throw new Error(
            `Supabase Auth rechazó la identidad del miembro dado de alta: ${error.message}`,
          );
        }
        return { kind: "created", userId: data.user.id };
      },

      async deleteIdentity(userId) {
        const { error } = await serviceClient.auth.admin.deleteUser(userId);
        if (error) {
          throw new Error(
            `No se pudo borrar la identidad ${userId}: ${error.message}`,
          );
        }
      },
    },
    invitees: {
      async insertInvitedMember(row) {
        // El AUF del alta lo escribe un Admin: nace verificado (#274).
        const { error } = await serviceClient
          .from(MEMBERS_TABLE)
          .insert({ ...row, auf_verified_at: new Date().toISOString() });
        if (error) {
          throw new Error(
            `No se pudo crear la fila del miembro dado de alta: ${error.message}`,
          );
        }
      },

      async findInvitee({ clubId, userId }) {
        const { data, error } = await serviceClient
          .from(MEMBERS_TABLE)
          .select("email, account_status")
          .eq("user_id", userId)
          .eq("club_id", clubId)
          .maybeSingle();
        if (error) {
          throw new Error(
            `No se pudo leer al miembro ${userId}: ${error.message}`,
          );
        }
        return data === null ? null : toInvitee(data);
      },
    },
  };
}

export type MemberInvitationGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: MemberInvitationGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición de los endpoints del alta. Pide el entorno de las
 * rutas de cuentas, y devuelve lo que falta en vez de lanzar. */
export function createSupabaseMemberInvitationGateways(
  env: Environment,
): MemberInvitationGatewaysResult {
  const authWiring = createSupabaseAuthGateways(env);
  if (authWiring.kind === "unconfigured") {
    return authWiring;
  }
  const auth = authWiring.gateways;
  const serviceClient = createServiceRoleClient(env);
  const record = createMemberRecordGateways(serviceClient);
  const store = createInvitedMemberStore(serviceClient);
  return {
    kind: "ready",
    gateways: {
      members: record.members,
      groupMembers: record.groupMembers,
      groups: record.groups,
      positions: cachedClubPositions,
      identities: { ...store.identities, ...auth.identities },
      invitees: store.invitees,
      invitationEmail: createInvitationEmailGateway({
        tokens: createRecoveryTokenIssuer(serviceClient),
        emails: connectResendEmailSender(env),
        emailLocales: auth.emailLocales,
        readClubBrand,
      }),
      emailDeliveryForClub: auth.emailDeliveryForClub,
      invitationRequestsForClub: auth.confirmationEmailRequestsForClub,
    },
  };
}
