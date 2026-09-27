import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  CategoryActivationResult,
  CategoryInsertResult,
  CategoryRenameResult,
  CategoryReorderResult,
  EvaluationCategories,
  EvaluationCategoriesGateways,
} from "./evaluation-categories";

/**
 * Adaptador entre el catálogo de categorías (#320) y Supabase: cada cambio es
 * una función de `0033_manage_evaluation_categories.sql`, que lo hace entero
 * o no lo hace.
 *
 * Va por la llave de servicio: `0031` no da ningún privilegio sobre el
 * catálogo a `authenticated` (FR-055). El servidor ya comprobó que quien pide
 * es Admin o Coach y pasa su club; ni la lectura ni las funciones alcanzan una
 * categoría de otro.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const CATEGORIES_TABLE = "evaluation_categories";

const categoryRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  deactivated_at: z.string().nullable(),
});

const insertResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("created"), category_id: z.uuid() }),
  z.object({ outcome: z.literal("name_taken") }),
]);

const renameResultSchema = z.object({
  outcome: z.enum(["renamed", "name_taken", "not_found"]),
});

const reorderResultSchema = z.object({
  outcome: z.enum(["reordered", "categories_changed"]),
});

const activationResultSchema = z.object({
  outcome: z.enum(["changed", "unchanged", "not_found"]),
});

function parseResponse<Result>(
  schema: z.ZodType<Result>,
  data: unknown,
  context: string,
): Result {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `${context} volvió con una forma que el dominio no reconoce: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/** En el orden del club; dos con el mismo orden, por nombre, como la lectura
 * de una evaluación. */
async function findCategories(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<EvaluationCategories> {
  const { data, error } = await serviceClient
    .from(CATEGORIES_TABLE)
    .select("id, name, deactivated_at")
    .eq("club_id", clubId)
    .order("sort_order")
    .order("name");
  if (error) {
    throw new Error(
      `No se pudieron leer las categorías del club ${clubId}: ${error.message}`,
    );
  }
  const context = `Las categorías del club ${clubId}`;
  return parseResponse(z.array(categoryRowSchema), data, context).map(
    (row) => ({
      id: row.id,
      name: row.name,
      isActive: row.deactivated_at === null,
    }),
  );
}

/** Un error de la base no es un resultado del dominio: sube con el nombre de
 * la función. */
async function callCategoryFunction<Result>(
  serviceClient: SupabaseClient,
  call: {
    readonly name: string;
    readonly args: Record<string, unknown>;
    readonly schema: z.ZodType<Result>;
  },
): Promise<Result> {
  const { data, error } = await serviceClient.rpc(call.name, call.args);
  if (error) {
    throw new Error(`Falló ${call.name}: ${error.message}`);
  }
  return parseResponse(call.schema, data, call.name);
}

async function insertCategory(
  serviceClient: SupabaseClient,
  clubId: string,
  name: string,
): Promise<CategoryInsertResult> {
  const result = await callCategoryFunction(serviceClient, {
    name: "create_evaluation_category",
    args: { acting_club_id: clubId, category_name: name },
    schema: insertResultSchema,
  });
  return result.outcome === "created"
    ? { kind: "created", categoryId: result.category_id }
    : { kind: "name_taken" };
}

async function renameCategory(
  serviceClient: SupabaseClient,
  target: { readonly clubId: string; readonly categoryId: string },
  name: string,
): Promise<CategoryRenameResult> {
  const result = await callCategoryFunction(serviceClient, {
    name: "rename_evaluation_category",
    args: {
      acting_club_id: target.clubId,
      target_category_id: target.categoryId,
      category_name: name,
    },
    schema: renameResultSchema,
  });
  return { kind: result.outcome };
}

async function reorderCategories(
  serviceClient: SupabaseClient,
  clubId: string,
  categoryIds: readonly string[],
): Promise<CategoryReorderResult> {
  const result = await callCategoryFunction(serviceClient, {
    name: "reorder_evaluation_categories",
    args: { acting_club_id: clubId, ordered_ids: categoryIds },
    schema: reorderResultSchema,
  });
  return { kind: result.outcome };
}

async function setCategoryActive(
  serviceClient: SupabaseClient,
  target: { readonly clubId: string; readonly categoryId: string },
  isActive: boolean,
): Promise<CategoryActivationResult> {
  const result = await callCategoryFunction(serviceClient, {
    name: "set_evaluation_category_active",
    args: {
      acting_club_id: target.clubId,
      target_category_id: target.categoryId,
      active: isActive,
    },
    schema: activationResultSchema,
  });
  return { kind: result.outcome };
}

export function createEvaluationCategoriesGateways(
  serviceClient: SupabaseClient,
): EvaluationCategoriesGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    categories: {
      findCategories: (clubId) => findCategories(serviceClient, clubId),
      insertCategory: (clubId, name) =>
        insertCategory(serviceClient, clubId, name),
      renameCategory: (target, name) =>
        renameCategory(serviceClient, target, name),
      reorderCategories: (clubId, categoryIds) =>
        reorderCategories(serviceClient, clubId, categoryIds),
      setCategoryActive: (target, isActive) =>
        setCategoryActive(serviceClient, target, isActive),
    },
    audit: createSupabaseAuditLogWriter(serviceClient),
  };
}

export type EvaluationCategoriesGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: EvaluationCategoriesGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición de los endpoints. Devuelve las variables que faltan en
 * vez de lanzar, como las demás. */
export function createSupabaseEvaluationCategoriesGateways(
  env: Environment,
): EvaluationCategoriesGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createEvaluationCategoriesGateways(createServiceRoleClient(env)),
  };
}
