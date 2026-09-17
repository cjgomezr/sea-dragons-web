import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  MemberRoleChangeGateways,
  MemberRoleChangeWrite,
} from "./member-role-change";
import { ROLES } from "./roles";
import { createRoleRequestGateways } from "./supabase-role-request-gateways";

/**
 * Adaptadores entre el cambio de rol de un socio y Supabase.
 *
 * Van por la llave de servicio: `change_member_role` sólo la puede ejecutar
 * `service_role`, para que ningún socio se haga Admin llamándola por
 * PostgREST. El servidor identifica a quien actúa por su cookie de sesión.
 */

const CHANGE_MEMBER_ROLE_FUNCTION = "change_member_role";

/** Lo que devuelve la función de `0014_change_member_role.sql`, uno por
 * `outcome`. Un valor que no encaja es un error de la base, no un caso. */
const changeResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("changed"),
    previous_role: z.enum(ROLES),
    new_role: z.enum(ROLES),
  }),
  z.object({ outcome: z.literal("unchanged"), role: z.enum(ROLES) }),
  z.object({ outcome: z.literal("last_admin") }),
  z.object({ outcome: z.literal("actor_not_admin") }),
  z.object({ outcome: z.literal("not_found") }),
]);

type ChangeResult = z.infer<typeof changeResultSchema>;

function toRoleChangeWrite(result: ChangeResult): MemberRoleChangeWrite {
  switch (result.outcome) {
    case "changed":
      return {
        kind: "changed",
        previousRole: result.previous_role,
        newRole: result.new_role,
      };
    case "unchanged":
      return { kind: "unchanged", role: result.role };
    case "last_admin":
    case "actor_not_admin":
    case "not_found":
      return { kind: result.outcome };
  }
}

export function createMemberRoleGateways(
  serviceClient: SupabaseClient,
): MemberRoleChangeGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    roles: {
      async applyRoleChange(input) {
        const { data, error } = await serviceClient.rpc(
          CHANGE_MEMBER_ROLE_FUNCTION,
          {
            target_user_id: input.targetUserId,
            acting_club_id: input.clubId,
            acting_user_id: input.actorId,
            new_role: input.newRole,
          },
        );
        if (error) {
          throw new Error(
            `No se pudo cambiar el rol del socio ${input.targetUserId}: ${error.message}`,
          );
        }
        const parsed = changeResultSchema.safeParse(data);
        if (!parsed.success) {
          throw new Error(
            `El cambio de rol del socio ${input.targetUserId} volvió con una forma que el dominio no reconoce: ${parsed.error.message}`,
          );
        }
        return toRoleChangeWrite(parsed.data);
      },
    },
    audit: createSupabaseAuditLogWriter(serviceClient),
  };
}

export type MemberRoleGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: MemberRoleChangeGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

type Environment = Readonly<Record<string, string | undefined>>;

/** Raíz de composición para el endpoint. Devuelve las variables que faltan en
 * vez de lanzar, como `createSupabaseRoleRequestDecisionGateways`. */
export function createSupabaseMemberRoleGateways(
  env: Environment,
): MemberRoleGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createMemberRoleGateways(createServiceRoleClient(env)),
  };
}
