import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { ACCOUNT_STATUSES } from "@/lib/auth/account-status";
import { createSupabaseAuthGateways } from "@/lib/auth/supabase-auth-gateways";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  MemberStatusChangeGateways,
  MemberStatusWrite,
} from "./member-status-change";

/**
 * Adaptadores entre la baja y la reactivación de un miembro (#244) y Supabase.
 *
 * Van por la llave de servicio: `set_member_status` sólo la puede ejecutar
 * `service_role`, para que nadie se reactive llamándola por PostgREST. El
 * servidor identifica a quien actúa por su cookie de sesión. La fila y la
 * confirmación del correo que decide a qué estado vuelve quien se reactiva se
 * leen con los adaptadores del registro.
 */

const SET_MEMBER_STATUS_FUNCTION = "set_member_status";

type Environment = Readonly<Record<string, string | undefined>>;

/** Lo que devuelve la función de `0017_set_member_status.sql`, uno por
 * `outcome`. Un valor que no encaja es un error de la base, no un caso. */
const statusResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("changed"),
    previous_status: z.enum(ACCOUNT_STATUSES),
    new_status: z.enum(ACCOUNT_STATUSES),
  }),
  z.object({
    outcome: z.literal("unchanged"),
    status: z.enum(ACCOUNT_STATUSES),
  }),
  z.object({
    outcome: z.literal("last_admin"),
    previous_status: z.enum(ACCOUNT_STATUSES),
  }),
  z.object({ outcome: z.literal("self_deactivation") }),
  z.object({ outcome: z.literal("actor_not_admin") }),
  z.object({ outcome: z.literal("not_found") }),
]);

type StatusResult = z.infer<typeof statusResultSchema>;

function toStatusWrite(result: StatusResult): MemberStatusWrite {
  switch (result.outcome) {
    case "changed":
      return {
        kind: "changed",
        previousStatus: result.previous_status,
        newStatus: result.new_status,
      };
    case "unchanged":
      return { kind: "unchanged", status: result.status };
    case "last_admin":
      return { kind: "last_admin", previousStatus: result.previous_status };
    case "self_deactivation":
    case "actor_not_admin":
    case "not_found":
      return { kind: result.outcome };
  }
}

/** La escritura de la baja y su bitácora. Va aparte de la raíz de composición
 * para que el test de integración la use con el cliente de servicio. */
export function createMemberStatusWriters(
  serviceClient: SupabaseClient,
): Pick<MemberStatusChangeGateways, "members" | "statuses" | "audit"> {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    statuses: {
      async applyStatusChange(input) {
        const { data, error } = await serviceClient.rpc(
          SET_MEMBER_STATUS_FUNCTION,
          {
            target_user_id: input.targetUserId,
            acting_club_id: input.clubId,
            acting_user_id: input.actorId,
            new_status: input.newStatus,
          },
        );
        if (error) {
          throw new Error(
            `No se pudo cambiar el estado del miembro ${input.targetUserId}: ${error.message}`,
          );
        }
        const parsed = statusResultSchema.safeParse(data);
        if (!parsed.success) {
          throw new Error(
            `El cambio de estado del miembro ${input.targetUserId} volvió con una forma que el dominio no reconoce: ${parsed.error.message}`,
          );
        }
        return toStatusWrite(parsed.data);
      },
    },
    audit: createSupabaseAuditLogWriter(serviceClient),
  };
}

export type MemberStatusGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: MemberStatusChangeGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para el endpoint. Pide el entorno de las rutas de
 * cuentas, porque lee la confirmación del correo, y devuelve lo que falta en
 * vez de lanzar. */
export function createSupabaseMemberStatusGateways(
  env: Environment,
): MemberStatusGatewaysResult {
  const authWiring = createSupabaseAuthGateways(env);
  if (authWiring.kind === "unconfigured") {
    return authWiring;
  }
  return {
    kind: "ready",
    gateways: {
      ...createMemberStatusWriters(createServiceRoleClient(env)),
      accounts: authWiring.gateways.accounts,
      identities: authWiring.gateways.identities,
    },
  };
}
