import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type AccountStatus,
  parseAccountStatus,
} from "@/lib/auth/account-status";
import { readRequiredText, readText } from "@/lib/auth/supabase-auth-gateways";
import { createGroupMembersGateways } from "@/lib/groups/supabase-group-members-gateways";
import { createGroupsGateways } from "@/lib/groups/supabase-groups-gateways";
import { createSupabaseMemberGroupsGateway } from "@/lib/groups/supabase-member-groups-gateway";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import { signProfilePhotoUrl } from "./supabase-profile-photo-gateways";
import type {
  AufRegistration,
  AufVerificationResult,
  DateOfBirthCorrection,
  DateOfBirthCorrectionResult,
  MemberRecordGateways,
  MemberScope,
  RegisteredAuf,
  StoredMemberRecord,
} from "./member-record";

/**
 * Adaptador entre la ficha reservada al Admin (#242) y Supabase.
 *
 * Va por la llave de servicio: `authenticated` no tiene `update` sobre
 * `members` (`0003_members.sql`), y la policy sólo deja leer la fila propia.
 * El servidor ya comprobó que quien pide es Admin, y cada consulta filtra por
 * su club: es lo único que separa un club de otro con esta llave (NFR-009).
 *
 * Los grupos se leen y se escriben con los adaptadores de E4, los mismos que
 * usa la sección Grupos.
 *
 * La foto se firma con la misma llave (#354): el bucket es privado.
 *
 * Del consentimiento del tutor sólo se lee si existe: su nombre y su correo
 * no salen de la fila. De la verificación del AUF (#274), igual: sólo si
 * existe. Quién la hizo está en la bitácora.
 */

const MEMBERS_TABLE = "members";
const RECORD_COLUMNS =
  "user_id, full_name, joined_on, account_status, auf_number, auf_expiry, auf_verified_at, date_of_birth, created_at, guardian_consent_at, photo_path";

type Environment = Readonly<Record<string, string | undefined>>;

type Row = Record<string, unknown>;

function readAccountStatus(row: Row): AccountStatus {
  const value = readRequiredText(row, "account_status", MEMBERS_TABLE);
  const status = parseAccountStatus(value);
  if (status === null) {
    throw new Error(`${value} no es un estado de cuenta que se reconozca.`);
  }
  return status;
}

function toStoredMemberRecord(row: Row): StoredMemberRecord {
  return {
    userId: readRequiredText(row, "user_id", MEMBERS_TABLE),
    fullName: readRequiredText(row, "full_name", MEMBERS_TABLE),
    // Las columnas `date` llegan como YYYY-MM-DD, el formato con el que el
    // dominio las compara.
    joinedOn: readRequiredText(row, "joined_on", MEMBERS_TABLE),
    accountStatus: readAccountStatus(row),
    aufNumber: readText(row, "auf_number", MEMBERS_TABLE),
    aufExpiry: readText(row, "auf_expiry", MEMBERS_TABLE),
    isAufVerified: readText(row, "auf_verified_at", MEMBERS_TABLE) !== null,
    dateOfBirth: readText(row, "date_of_birth", MEMBERS_TABLE),
    registeredAt: readRequiredText(row, "created_at", MEMBERS_TABLE),
    hasGuardianConsent:
      readText(row, "guardian_consent_at", MEMBERS_TABLE) !== null,
    photoPath: readText(row, "photo_path", MEMBERS_TABLE),
  };
}

/** Lo que escribe un Admin queda verificado desde ahora. Sin número no hay
 * nada que verificar, y el `check` de `0021` no dejaría la marca suelta. */
function toAufColumns(registration: AufRegistration): {
  readonly auf_number: string | null;
  readonly auf_expiry: string | null;
  readonly auf_verified_at: string | null;
} {
  return registration.kind === "none"
    ? { auf_number: null, auf_expiry: null, auf_verified_at: null }
    : {
        auf_number: registration.number,
        auf_expiry: registration.expiry,
        auf_verified_at: new Date().toISOString(),
      };
}

/** La marca en un solo `update` condicionado a que el AUF siga siendo el que
 * el Admin vio y siga sin verificar: si el miembro lo cambió entretanto, no
 * toca ninguna fila. */
async function verifyAufRegistration(
  serviceClient: SupabaseClient,
  { clubId, userId }: MemberScope,
  registration: RegisteredAuf,
): Promise<AufVerificationResult> {
  const update = serviceClient
    .from(MEMBERS_TABLE)
    .update({ auf_verified_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("club_id", clubId)
    .eq("auf_number", registration.number)
    .is("auf_verified_at", null);
  const { data, error } = await (
    registration.expiry === null
      ? update.is("auf_expiry", null)
      : update.eq("auf_expiry", registration.expiry)
  )
    .select("user_id")
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo verificar el AUF del socio ${userId}: ${error.message}`,
    );
  }
  return data === null ? { kind: "changed" } : { kind: "verified" };
}

async function memberExists(
  serviceClient: SupabaseClient,
  { clubId, userId }: MemberScope,
): Promise<boolean> {
  const { data, error } = await serviceClient
    .from(MEMBERS_TABLE)
    .select("user_id")
    .eq("user_id", userId)
    .eq("club_id", clubId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo comprobar si existe el socio ${userId}: ${error.message}`,
    );
  }
  return data !== null;
}

/** La fecha y el estado en un solo `update`, y sólo si el estado sigue siendo
 * el que se leyó. Si no toca ninguna fila, una segunda lectura dice si el
 * socio ya no está o si cambió su estado. El `check`
 * `members_active_minor_requires_guardian_consent` de `0007` es la red: una
 * cuenta activa de un menor sin consentimiento no llega a escribirse. */
async function correctDateOfBirth(
  serviceClient: SupabaseClient,
  scope: MemberScope,
  correction: DateOfBirthCorrection,
): Promise<DateOfBirthCorrectionResult> {
  const { data, error } = await serviceClient
    .from(MEMBERS_TABLE)
    .update({
      date_of_birth: correction.dateOfBirth,
      account_status: correction.toStatus,
    })
    .eq("user_id", scope.userId)
    .eq("club_id", scope.clubId)
    .eq("account_status", correction.fromStatus)
    .select("user_id")
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo corregir la fecha de nacimiento del socio ${scope.userId}: ${error.message}`,
    );
  }
  if (data !== null) {
    return { kind: "corrected" };
  }
  return (await memberExists(serviceClient, scope))
    ? { kind: "status_changed" }
    : { kind: "member_not_found" };
}

export function createMemberRecordGateways(
  serviceClient: SupabaseClient,
): MemberRecordGateways {
  const groupMembersGateways = createGroupMembersGateways(serviceClient);
  // Con la llave de servicio este adaptador vería los grupos de cualquiera;
  // lo acota el `user_id` que filtra, y el socio ya se buscó en el club.
  const memberGroups = createSupabaseMemberGroupsGateway(serviceClient);
  return {
    members: groupMembersGateways.members,
    groupMembers: groupMembersGateways.groupMembers,
    groups: createGroupsGateways(serviceClient).groups,
    audit: createSupabaseAuditLogWriter(serviceClient),
    photos: {
      signPhotoUrl: (photoPath) =>
        signProfilePhotoUrl(serviceClient, photoPath),
    },
    records: {
      async findMemberRecord({ clubId, userId }) {
        const { data, error } = await serviceClient
          .from(MEMBERS_TABLE)
          .select(RECORD_COLUMNS)
          .eq("user_id", userId)
          .eq("club_id", clubId)
          .maybeSingle();
        if (error) {
          throw new Error(
            `No se pudo leer la ficha del socio ${userId}: ${error.message}`,
          );
        }
        return data === null ? null : toStoredMemberRecord(data);
      },

      findMemberGroups: ({ userId }) => memberGroups.listGroupsOf(userId),

      // Un solo `update` con las dos columnas: Postgres no deja que otro
      // guardado se meta entre el número y el vencimiento.
      async updateAufRegistration({ clubId, userId }, registration) {
        const { data, error } = await serviceClient
          .from(MEMBERS_TABLE)
          .update(toAufColumns(registration))
          .eq("user_id", userId)
          .eq("club_id", clubId)
          .select("user_id")
          .maybeSingle();
        if (error) {
          throw new Error(
            `No se pudo guardar el AUF del socio ${userId}: ${error.message}`,
          );
        }
        return data === null
          ? { kind: "member_not_found" }
          : { kind: "updated" };
      },

      verifyAufRegistration: (scope, registration) =>
        verifyAufRegistration(serviceClient, scope, registration),

      correctDateOfBirth: (scope, correction) =>
        correctDateOfBirth(serviceClient, scope, correction),
    },
  };
}

export type MemberRecordGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: MemberRecordGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del endpoint. Devuelve las variables que faltan en vez
 * de lanzar, como las demás. */
export function createSupabaseMemberRecordGateways(
  env: Environment,
): MemberRecordGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createMemberRecordGateways(createServiceRoleClient(env)),
  };
}
