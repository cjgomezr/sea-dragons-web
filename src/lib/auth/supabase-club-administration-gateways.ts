import type { SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  ClubAdministrationGateways,
  ClubMember,
  PendingRoleRequest,
} from "./club-administration";
import { parseRequestableRole } from "./role-request";
import { parseRole } from "./roles";
import { readRequiredText, readText } from "./supabase-auth-gateways";
import { createRoleRequestGateways } from "./supabase-role-request-gateways";

/**
 * Adaptadores entre las lecturas de la pantalla de administración y Supabase.
 *
 * Van por la llave de servicio, como las escrituras de #210 y #211: la policy
 * de `0003_members.sql` deja a un socio ver sólo su propia fila, y la de
 * `0012_role_requests.sql` sólo sus solicitudes. La bandeja y la lista de
 * socios son justo lo contrario, así que las lee el servidor, que ya averiguó
 * por la cookie de sesión quién pregunta y de qué club.
 */

const MEMBERS_TABLE = "members";
const ROLE_REQUESTS_TABLE = "role_requests";
const MEMBER_COLUMNS = "user_id, full_name, email, role";
const PENDING_REQUEST_COLUMNS =
  "id, user_id, requested_role, justification, created_at";
const PENDING_STATUS = "pending";

type Environment = Readonly<Record<string, string | undefined>>;

type Row = Record<string, unknown>;

/** Las filas que devuelve supabase-js llegan sin tipo del esquema. Se estrecha
 * columna a columna, como en `supabase-role-request-gateways.ts`. */
function toClubMember(row: Row): ClubMember {
  const value = readRequiredText(row, "role", MEMBERS_TABLE);
  const role = parseRole(value);
  if (role === null) {
    throw new Error(`${value} no es un rol que el catálogo reconozca.`);
  }
  return {
    userId: readRequiredText(row, "user_id", MEMBERS_TABLE),
    fullName: readRequiredText(row, "full_name", MEMBERS_TABLE),
    email: readRequiredText(row, "email", MEMBERS_TABLE),
    role,
  };
}

function toPendingRequest(row: Row, fullName: string): PendingRoleRequest {
  const value = readRequiredText(row, "requested_role", ROLE_REQUESTS_TABLE);
  const requestedRole = parseRequestableRole(value);
  if (requestedRole === null) {
    throw new Error(`${value} no es un rol que se pueda pedir.`);
  }
  return {
    id: readRequiredText(row, "id", ROLE_REQUESTS_TABLE),
    userId: readRequiredText(row, "user_id", ROLE_REQUESTS_TABLE),
    fullName,
    requestedRole,
    justification: readText(row, "justification", ROLE_REQUESTS_TABLE),
    // Postgres devuelve `timestamptz` con su propio formato; se normaliza a
    // ISO para que la API responda siempre igual.
    createdAt: new Date(
      readRequiredText(row, "created_at", ROLE_REQUESTS_TABLE),
    ).toISOString(),
  };
}

/**
 * Los nombres de quienes pidieron, en una sola consulta más.
 *
 * Se leen aparte en vez de pedirle a PostgREST que incruste `members` en la
 * misma consulta: la clave foránea de `role_requests.user_id` apunta a una
 * columna única y no a la primaria, y una lectura que depende de cómo
 * PostgREST deduzca esa relación es una lectura que se rompe sin que nadie
 * toque este archivo. Son dos consultas fijas, no una por solicitud.
 */
async function readRequesterNames(
  serviceClient: SupabaseClient,
  clubId: string,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const { data, error } = await serviceClient
    .from(MEMBERS_TABLE)
    .select("user_id, full_name")
    .eq("club_id", clubId)
    .in("user_id", userIds);
  if (error) {
    throw new Error(
      `No se pudieron leer los nombres de quienes pidieron un rol en el club ${clubId}: ${error.message}`,
    );
  }
  return new Map(
    data.map((row: Row) => [
      readRequiredText(row, "user_id", MEMBERS_TABLE),
      readRequiredText(row, "full_name", MEMBERS_TABLE),
    ]),
  );
}

export function createClubAdministrationGateways(
  serviceClient: SupabaseClient,
): ClubAdministrationGateways {
  return {
    members: {
      ...createRoleRequestGateways(serviceClient).members,

      async findClubMembers(clubId) {
        const { data, error } = await serviceClient
          .from(MEMBERS_TABLE)
          .select(MEMBER_COLUMNS)
          .eq("club_id", clubId)
          .order("full_name");
        if (error) {
          throw new Error(
            `No se pudieron leer los socios del club ${clubId}: ${error.message}`,
          );
        }
        return data.map(toClubMember);
      },
    },
    requests: {
      async findPendingRequests(clubId) {
        const { data, error } = await serviceClient
          .from(ROLE_REQUESTS_TABLE)
          .select(PENDING_REQUEST_COLUMNS)
          .eq("club_id", clubId)
          .eq("status", PENDING_STATUS)
          // La más antigua primero: es la que lleva más tiempo esperando.
          .order("created_at", { ascending: true });
        if (error) {
          throw new Error(
            `No se pudieron leer las solicitudes pendientes del club ${clubId}: ${error.message}`,
          );
        }
        if (data.length === 0) {
          return [];
        }

        const userIds = data.map((row: Row) =>
          readRequiredText(row, "user_id", ROLE_REQUESTS_TABLE),
        );
        const names = await readRequesterNames(serviceClient, clubId, userIds);
        return data.map((row: Row) => {
          const userId = readRequiredText(row, "user_id", ROLE_REQUESTS_TABLE);
          const fullName = names.get(userId);
          if (fullName === undefined) {
            throw new Error(
              `La solicitud de rol de ${userId} no tiene socio en el club ${clubId}.`,
            );
          }
          return toPendingRequest(row, fullName);
        });
      },
    },
  };
}

export type ClubAdministrationGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: ClubAdministrationGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para los dos endpoints de lectura. Devuelve las
 * variables que faltan en vez de lanzar, como las demás. */
export function createSupabaseClubAdministrationGateways(
  env: Environment,
): ClubAdministrationGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createClubAdministrationGateways(createServiceRoleClient(env)),
  };
}
