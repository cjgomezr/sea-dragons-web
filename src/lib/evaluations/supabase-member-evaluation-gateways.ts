import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import {
  ACCOUNT_STATUSES,
  type AccountStatus,
} from "@/lib/auth/account-status";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  EvaluationCreation,
  EvaluationRefresh,
  EvaluationScope,
  MemberEvaluationGateways,
  RatingsSave,
  RatingsSubmission,
  StoredEvaluation,
} from "./member-evaluation";

/**
 * Adaptador entre la evaluación de un miembro (#319) y Supabase.
 *
 * Va por la llave de servicio: `0031_member_evaluations.sql` no da ningún
 * privilegio a `authenticated` (FR-055), y las escrituras son las funciones de
 * `0032_member_evaluation_writes.sql` y la puesta al día de
 * `0033_manage_evaluation_categories.sql`, que sólo ejecuta `service_role`. El
 * servidor ya comprobó que quien pide es Admin o Coach, y cada consulta va
 * acotada a su club.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const MEMBERS_TABLE = "members";
const EVALUATIONS_TABLE = "member_evaluations";
const CREATE_FUNCTION = "create_member_evaluation";
const SAVE_FUNCTION = "save_member_evaluation_ratings";
const REFRESH_FUNCTION = "refresh_member_evaluation";

const EVALUATION_COLUMNS =
  "updated_at, member_evaluation_ratings(rating, evaluation_categories(id, name, sort_order, deactivated_at))";

const memberRowSchema = z.object({ account_status: z.enum(ACCOUNT_STATUSES) });

const evaluationRowSchema = z.object({
  updated_at: z.string(),
  member_evaluation_ratings: z.array(
    z.object({
      rating: z.number(),
      evaluation_categories: z.object({
        id: z.uuid(),
        name: z.string(),
        sort_order: z.number(),
        deactivated_at: z.string().nullable(),
      }),
    }),
  ),
});

type EvaluationRow = z.infer<typeof evaluationRowSchema>;

const creationResultSchema = z.object({
  outcome: z.enum([
    "created",
    "already_exists",
    "no_active_categories",
    "member_inactive",
    "member_not_found",
  ]),
});

const saveResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.enum([
      "saved",
      "evaluation_changed",
      "evaluation_not_found",
      "member_inactive",
      "member_not_found",
    ]),
  }),
  z.object({ outcome: z.literal("unknown_category"), category_id: z.uuid() }),
]);

const refreshResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("refreshed"),
    added_count: z.number().int(),
    removed_count: z.number().int(),
  }),
  z.object({
    outcome: z.enum([
      "already_current",
      "evaluation_not_found",
      "no_active_categories",
      "member_inactive",
      "member_not_found",
    ]),
  }),
]);

function parseRow<Row>(
  schema: z.ZodType<Row>,
  data: unknown,
  context: string,
): Row {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `${context} volvió con una forma que el dominio no reconoce: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/** En el orden del catálogo del club; dos con el mismo orden, por nombre. */
function toStoredEvaluation(row: EvaluationRow): StoredEvaluation {
  const sorted = [...row.member_evaluation_ratings].sort(
    (first, second) =>
      first.evaluation_categories.sort_order -
        second.evaluation_categories.sort_order ||
      first.evaluation_categories.name.localeCompare(
        second.evaluation_categories.name,
      ),
  );
  return {
    updatedAt: row.updated_at,
    ratings: sorted.map(({ rating, evaluation_categories: category }) => ({
      categoryId: category.id,
      name: category.name,
      rating,
      isRetired: category.deactivated_at !== null,
    })),
  };
}

async function findMemberStatus(
  serviceClient: SupabaseClient,
  scope: EvaluationScope,
): Promise<AccountStatus | null> {
  const { data, error } = await serviceClient
    .from(MEMBERS_TABLE)
    .select("account_status")
    .eq("user_id", scope.userId)
    .eq("club_id", scope.clubId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer el estado del miembro ${scope.userId}: ${error.message}`,
    );
  }
  if (data === null) {
    return null;
  }
  const context = `El miembro ${scope.userId}`;
  return parseRow(memberRowSchema, data, context).account_status;
}

async function findEvaluation(
  serviceClient: SupabaseClient,
  scope: EvaluationScope,
): Promise<StoredEvaluation | null> {
  const { data, error } = await serviceClient
    .from(EVALUATIONS_TABLE)
    .select(EVALUATION_COLUMNS)
    .eq("user_id", scope.userId)
    .eq("club_id", scope.clubId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer la evaluación del miembro ${scope.userId}: ${error.message}`,
    );
  }
  if (data === null) {
    return null;
  }
  const context = `La evaluación del miembro ${scope.userId}`;
  return toStoredEvaluation(parseRow(evaluationRowSchema, data, context));
}

/** Un error de la base no es un resultado del dominio: sube con el nombre de
 * la función. */
async function callEvaluationFunction(
  serviceClient: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await serviceClient.rpc(name, args);
  if (error) {
    throw new Error(`Falló ${name}: ${error.message}`);
  }
  return data;
}

async function createEvaluation(
  serviceClient: SupabaseClient,
  scope: EvaluationScope,
): Promise<EvaluationCreation> {
  const data = await callEvaluationFunction(serviceClient, CREATE_FUNCTION, {
    acting_club_id: scope.clubId,
    target_user_id: scope.userId,
  });
  return {
    kind: parseRow(creationResultSchema, data, CREATE_FUNCTION).outcome,
  };
}

async function saveRatings(
  serviceClient: SupabaseClient,
  scope: EvaluationScope,
  submission: RatingsSubmission,
): Promise<RatingsSave> {
  const data = await callEvaluationFunction(serviceClient, SAVE_FUNCTION, {
    acting_club_id: scope.clubId,
    target_user_id: scope.userId,
    expected_updated_at: submission.expectedUpdatedAt,
    ratings: submission.ratings.map(({ categoryId, rating }) => ({
      category_id: categoryId,
      rating,
    })),
  });
  const result = parseRow(saveResultSchema, data, SAVE_FUNCTION);
  return result.outcome === "unknown_category"
    ? { kind: "unknown_category", categoryId: result.category_id }
    : { kind: result.outcome };
}

async function refreshEvaluation(
  serviceClient: SupabaseClient,
  scope: EvaluationScope,
): Promise<EvaluationRefresh> {
  const data = await callEvaluationFunction(serviceClient, REFRESH_FUNCTION, {
    acting_club_id: scope.clubId,
    target_user_id: scope.userId,
  });
  const result = parseRow(refreshResultSchema, data, REFRESH_FUNCTION);
  return result.outcome === "refreshed"
    ? {
        kind: "refreshed",
        addedCount: result.added_count,
        removedCount: result.removed_count,
      }
    : { kind: result.outcome };
}

export function createMemberEvaluationGateways(
  serviceClient: SupabaseClient,
): MemberEvaluationGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    evaluations: {
      findMemberStatus: (scope) => findMemberStatus(serviceClient, scope),
      findEvaluation: (scope) => findEvaluation(serviceClient, scope),
      createEvaluation: (scope) => createEvaluation(serviceClient, scope),
      saveRatings: (scope, submission) =>
        saveRatings(serviceClient, scope, submission),
      refreshEvaluation: (scope) => refreshEvaluation(serviceClient, scope),
    },
    audit: createSupabaseAuditLogWriter(serviceClient),
  };
}

export type MemberEvaluationGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: MemberEvaluationGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del endpoint. Devuelve las variables que faltan en vez
 * de lanzar, como las demás. */
export function createSupabaseMemberEvaluationGateways(
  env: Environment,
): MemberEvaluationGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createMemberEvaluationGateways(createServiceRoleClient(env)),
  };
}
