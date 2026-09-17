import type { SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import {
  ROLE_REQUEST_STATUSES,
  type RoleRequest,
  type RoleRequestGateways,
  type RoleRequestMember,
  parseRequestableRole,
} from "./role-request";
import { parseRole } from "./roles";
import { readRequiredText } from "./supabase-auth-gateways";

/**
 * Adaptadores entre las solicitudes de rol y Supabase.
 *
 * Van por la llave de servicio a propósito: `0012_role_requests.sql` no deja
 * escribir a `authenticated`, para que nadie cree ni decida una solicitud
 * atacando la base directamente. El servidor identifica a quien pide por su
 * cookie de sesión y sólo entonces lee o escribe, acotado a su `user_id`.
 */

const MEMBERS_TABLE = "members";
const ROLE_REQUESTS_TABLE = "role_requests";
const ROLE_REQUEST_COLUMNS = "id, requested_role, status, created_at";

/** El código de Postgres de una violación de unicidad, y el índice que la
 * convierte en "ya hay una pendiente". Se mira el nombre para no confundir
 * este choque con otro que algún día tenga la tabla. */
const UNIQUE_VIOLATION_CODE = "23505";
const ONE_PENDING_INDEX = "role_requests_one_pending_per_member";

export type RoleRequestGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: RoleRequestGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

type Environment = Readonly<Record<string, string | undefined>>;

function readRole(row: Record<string, unknown>): RoleRequestMember["role"] {
  const value = readRequiredText(row, "role", MEMBERS_TABLE);
  const role = parseRole(value);
  if (role === null) {
    throw new Error(`${value} no es un rol que el catálogo reconozca.`);
  }
  return role;
}

function toRoleRequest(row: Record<string, unknown>): RoleRequest {
  const requestedRole = readRequiredText(
    row,
    "requested_role",
    ROLE_REQUESTS_TABLE,
  );
  const status = readRequiredText(row, "status", ROLE_REQUESTS_TABLE);
  const parsedRole = parseRequestableRole(requestedRole);
  const parsedStatus = ROLE_REQUEST_STATUSES.find(
    (candidate) => candidate === status,
  );
  if (parsedRole === null || parsedStatus === undefined) {
    throw new Error(
      `La solicitud de rol trae valores que el dominio no reconoce: ${requestedRole}, ${status}.`,
    );
  }
  return {
    id: readRequiredText(row, "id", ROLE_REQUESTS_TABLE),
    requestedRole: parsedRole,
    status: parsedStatus,
    // Postgres devuelve `timestamptz` con su propio formato; se normaliza a
    // ISO para que la API responda siempre igual.
    createdAt: new Date(
      readRequiredText(row, "created_at", ROLE_REQUESTS_TABLE),
    ).toISOString(),
  };
}

function isOnePendingViolation(error: {
  readonly code: string;
  readonly message: string;
}): boolean {
  return (
    error.code === UNIQUE_VIOLATION_CODE &&
    error.message.includes(ONE_PENDING_INDEX)
  );
}

export function createRoleRequestGateways(
  serviceClient: SupabaseClient,
): RoleRequestGateways {
  return {
    members: {
      async findRoleRequestMember(userId) {
        const { data, error } = await serviceClient
          .from(MEMBERS_TABLE)
          .select("club_id, full_name, role")
          .eq("user_id", userId)
          .maybeSingle();
        if (error) {
          throw new Error(
            `No se pudo leer el socio de la identidad ${userId}: ${error.message}`,
          );
        }
        return data === null
          ? null
          : {
              clubId: readRequiredText(data, "club_id", MEMBERS_TABLE),
              fullName: readRequiredText(data, "full_name", MEMBERS_TABLE),
              role: readRole(data),
            };
      },
    },
    requests: {
      async findLatestRequest(userId) {
        const { data, error } = await serviceClient
          .from(ROLE_REQUESTS_TABLE)
          .select(ROLE_REQUEST_COLUMNS)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) {
          throw new Error(
            `No se pudo leer la última solicitud de rol de ${userId}: ${error.message}`,
          );
        }
        return data === null ? null : toRoleRequest(data);
      },

      async insertPendingRequest(request) {
        const { data, error } = await serviceClient
          .from(ROLE_REQUESTS_TABLE)
          .insert({
            club_id: request.clubId,
            user_id: request.userId,
            requested_role: request.requestedRole,
            justification: request.justification,
          })
          .select(ROLE_REQUEST_COLUMNS)
          .single();
        if (error) {
          if (isOnePendingViolation(error)) {
            return { kind: "pending_exists" };
          }
          throw new Error(
            `No se pudo guardar la solicitud de rol de ${request.userId}: ${error.message}`,
          );
        }
        return { kind: "created", request: toRoleRequest(data) };
      },
    },
  };
}

/** Raíz de composición para la página y el endpoint. Devuelve las variables
 * que faltan en vez de lanzar, como `createSupabaseAuthGateways`. */
export function createSupabaseRoleRequestGateways(
  env: Environment,
): RoleRequestGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createRoleRequestGateways(createServiceRoleClient(env)),
  };
}
