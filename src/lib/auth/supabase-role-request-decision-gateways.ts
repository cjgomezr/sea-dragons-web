import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import { REQUESTABLE_ROLES } from "./role-request";
import {
  type DecidedRoleRequest,
  ROLE_REQUEST_DECISIONS,
  type RoleRequestDecisionGateways,
  type RoleRequestDecisionWrite,
} from "./role-request-decision";
import { ROLES } from "./roles";
import { createRoleRequestGateways } from "./supabase-role-request-gateways";

/**
 * Adaptadores entre la decisión de una solicitud de rol y Supabase.
 *
 * Van por la llave de servicio: `decide_role_request` sólo la puede ejecutar
 * `service_role`, para que ningún socio se apruebe a sí mismo llamándola por
 * PostgREST. El servidor identifica a quien decide por su cookie de sesión.
 */

const DECIDE_ROLE_REQUEST_FUNCTION = "decide_role_request";

const decidedFields = {
  id: z.string(),
  decided_by: z.string(),
  decided_at: z.string(),
};

/** Lo que devuelve la función de `0013_decide_role_request.sql`, uno por
 * `outcome`. Un valor que no encaja es un error de la base, no un caso. */
const decisionResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("approved"),
    ...decidedFields,
    user_id: z.string(),
    previous_role: z.enum(ROLES),
    new_role: z.enum(REQUESTABLE_ROLES),
  }),
  z.object({ outcome: z.literal("rejected"), ...decidedFields }),
  z.object({
    outcome: z.literal("already_decided"),
    status: z.enum(ROLE_REQUEST_DECISIONS),
  }),
  z.object({ outcome: z.literal("role_already_granted") }),
  z.object({ outcome: z.literal("not_found") }),
]);

type DecisionResult = z.infer<typeof decisionResultSchema>;

function toDecidedRequest(
  result: Extract<DecisionResult, { outcome: "approved" | "rejected" }>,
): DecidedRoleRequest {
  return {
    id: result.id,
    status: result.outcome,
    decidedBy: result.decided_by,
    // Postgres serializa `timestamptz` con su propio formato; se normaliza a
    // ISO para que la API responda siempre igual.
    decidedAt: new Date(result.decided_at).toISOString(),
  };
}

function toDecisionWrite(result: DecisionResult): RoleRequestDecisionWrite {
  switch (result.outcome) {
    case "approved":
      return {
        kind: "approved",
        request: toDecidedRequest(result),
        roleChange: {
          memberUserId: result.user_id,
          previousRole: result.previous_role,
          newRole: result.new_role,
        },
      };
    case "rejected":
      return { kind: "rejected", request: toDecidedRequest(result) };
    case "already_decided":
      return { kind: "already_decided", status: result.status };
    case "role_already_granted":
      return { kind: "role_already_granted" };
    case "not_found":
      return { kind: "not_found" };
  }
}

export function createRoleRequestDecisionGateways(
  serviceClient: SupabaseClient,
): RoleRequestDecisionGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    decisions: {
      async applyDecision(input) {
        const { data, error } = await serviceClient.rpc(
          DECIDE_ROLE_REQUEST_FUNCTION,
          {
            target_request_id: input.requestId,
            deciding_club_id: input.clubId,
            deciding_user_id: input.decidedBy,
            decision: input.decision,
          },
        );
        if (error) {
          throw new Error(
            `No se pudo decidir la solicitud de rol ${input.requestId}: ${error.message}`,
          );
        }
        const parsed = decisionResultSchema.safeParse(data);
        if (!parsed.success) {
          throw new Error(
            `La decisión de la solicitud ${input.requestId} volvió con una forma que el dominio no reconoce: ${parsed.error.message}`,
          );
        }
        return toDecisionWrite(parsed.data);
      },
    },
    audit: createSupabaseAuditLogWriter(serviceClient),
  };
}

export type RoleRequestDecisionGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: RoleRequestDecisionGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

type Environment = Readonly<Record<string, string | undefined>>;

/** Raíz de composición para el endpoint. Devuelve las variables que faltan en
 * vez de lanzar, como `createSupabaseRoleRequestGateways`. */
export function createSupabaseRoleRequestDecisionGateways(
  env: Environment,
): RoleRequestDecisionGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createRoleRequestDecisionGateways(createServiceRoleClient(env)),
  };
}
