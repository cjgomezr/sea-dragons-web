import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ACCOUNT_STATUSES } from "@/lib/auth/account-status";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  EvaluationRosterGateways,
  RosterMemberRecord,
} from "./evaluation-roster";

/**
 * Adaptador entre la lista de Evaluaciones (#322) y Supabase.
 *
 * Va por la llave de servicio por el mismo motivo que la evaluación de un
 * miembro: `authenticated` no tiene ningún privilegio sobre las evaluaciones
 * (FR-055). El servidor ya comprobó que quien pide es Admin o Coach, y la
 * consulta va acotada a su club.
 *
 * Una sola consulta con las valoraciones anidadas: el PRD pide servir el club
 * entero con su OVR sin una lectura por miembro.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const MEMBERS_TABLE = "members";
const ROSTER_COLUMNS =
  "user_id, full_name, account_status, member_evaluations(member_evaluation_ratings(rating))";

const evaluationSchema = z.object({
  member_evaluation_ratings: z.array(z.object({ rating: z.number() })),
});

// PostgREST sirve la relación como lista: la clave foránea es compuesta y la
// restricción única es sólo de `user_id`, así que no la ve como uno a uno.
// Una restricción única ya garantiza que haya como mucho una.
const rosterRowSchema = z.object({
  user_id: z.uuid(),
  full_name: z.string(),
  account_status: z.enum(ACCOUNT_STATUSES),
  member_evaluations: z.array(evaluationSchema).max(1),
});

type RosterRow = z.infer<typeof rosterRowSchema>;

function toRosterMemberRecord(row: RosterRow): RosterMemberRecord {
  const [evaluation] = row.member_evaluations;
  return {
    userId: row.user_id,
    fullName: row.full_name,
    status: row.account_status,
    ratings:
      evaluation === undefined
        ? null
        : evaluation.member_evaluation_ratings.map(({ rating }) => rating),
  };
}

async function findRosterMembers(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<readonly RosterMemberRecord[]> {
  const { data, error } = await serviceClient
    .from(MEMBERS_TABLE)
    .select(ROSTER_COLUMNS)
    .eq("club_id", clubId);
  if (error) {
    throw new Error(
      `No se pudo leer la lista de evaluaciones del club ${clubId}: ${error.message}`,
    );
  }
  const parsed = z.array(rosterRowSchema).safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `La lista de evaluaciones del club ${clubId} volvió con una forma que el dominio no reconoce: ${parsed.error.message}`,
    );
  }
  return parsed.data.map(toRosterMemberRecord);
}

export function createEvaluationRosterGateways(
  serviceClient: SupabaseClient,
): EvaluationRosterGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    roster: {
      findRosterMembers: (clubId) => findRosterMembers(serviceClient, clubId),
    },
  };
}

export type EvaluationRosterGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: EvaluationRosterGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del endpoint. Devuelve las variables que faltan en vez
 * de lanzar, como las demás. */
export function createSupabaseEvaluationRosterGateways(
  env: Environment,
): EvaluationRosterGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createEvaluationRosterGateways(createServiceRoleClient(env)),
  };
}
