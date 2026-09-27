import { z } from "zod";
import {
  type ApiRequestFailure,
  type ApiRequestOutcome,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  EVALUATION_CATEGORIES_API_PATH,
  EVALUATION_CATEGORIES_ORDER_API_PATH,
} from "@/lib/auth/routes";
import {
  CATEGORIES_CHANGED_REASON,
  CATEGORY_ISSUE_CODES,
  CATEGORY_NAME_MAX_LENGTH,
  type CategoryIssueCode,
  type EvaluationCategories,
} from "@/lib/evaluations/evaluation-categories";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Lo que la pantalla de categorías de evaluación (#323) le pide a la API v1
 * de #320 y cómo reduce cada respuesta a algo que pintar. Todas las
 * respuestas traen el catálogo entero tal como quedó, así que la pantalla
 * siempre enseña lo que guardó el servidor. Las reglas (nombre repetido, qué
 * entra en las evaluaciones nuevas) son suyas: aquí sólo se leen.
 */

const responseSchema = z.object({
  data: z.object({
    categories: z.array(
      z.object({ id: z.uuid(), name: z.string(), isActive: z.boolean() }),
    ),
  }),
});

export type CategoriesRead =
  | { readonly kind: "loaded"; readonly categories: EvaluationCategories }
  | ApiRequestFailure;

async function readCategoriesResponse(
  request: Promise<ApiRequestOutcome>,
): Promise<CategoriesRead> {
  const read = readApiPayload(await request, responseSchema);
  return read.kind === "failed"
    ? read
    : { kind: "loaded", categories: read.value.data.categories };
}

function sendJson(
  path: string,
  method: "POST" | "PUT" | "PATCH",
  body: unknown,
): Promise<CategoriesRead> {
  return readCategoriesResponse(
    requestApi(path, {
      method,
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify(body),
    }),
  );
}

function categoryPath(categoryId: string): string {
  return `${EVALUATION_CATEGORIES_API_PATH}/${encodeURIComponent(categoryId)}`;
}

export function loadCategories(): Promise<CategoriesRead> {
  return readCategoriesResponse(requestApi(EVALUATION_CATEGORIES_API_PATH));
}

export function createCategory(name: string): Promise<CategoriesRead> {
  return sendJson(EVALUATION_CATEGORIES_API_PATH, "POST", { name });
}

export function renameCategory(
  categoryId: string,
  name: string,
): Promise<CategoriesRead> {
  return sendJson(categoryPath(categoryId), "PATCH", { name });
}

export function setCategoryActive(
  categoryId: string,
  isActive: boolean,
): Promise<CategoriesRead> {
  return sendJson(categoryPath(categoryId), "PATCH", { isActive });
}

/** La lista entera de las activas en el orden nuevo, no un movimiento. */
export function reorderCategories(
  categoryIds: readonly string[],
): Promise<CategoriesRead> {
  return sendJson(EVALUATION_CATEGORIES_ORDER_API_PATH, "PUT", {
    categoryIds,
  });
}

/** El problema del campo del nombre del que habla un 400, si es uno de los
 * de las categorías. */
export function readCategoryIssueCode(
  failure: ApiRequestFailure,
): CategoryIssueCode | null {
  if (failure.failure !== "validation_error") {
    return null;
  }
  return CATEGORY_ISSUE_CODES.find((code) => code === failure.reason) ?? null;
}

/** Otro Coach o Admin cambió el catálogo: repetir lo mismo no casaría. */
export function isCategoriesOutdated(failure: ApiRequestFailure): boolean {
  return (
    failure.reason === CATEGORIES_CHANGED_REASON ||
    failure.failure === "not_found"
  );
}

export function describeCategoryIssue(
  translate: Translator,
  code: CategoryIssueCode,
): string {
  switch (code) {
    case "name_required":
      return translate("evaluations.categories.issue.nameRequired");
    case "name_too_long":
      return translate("evaluations.categories.issue.nameTooLong", {
        max: CATEGORY_NAME_MAX_LENGTH,
      });
    case "name_taken":
      return translate("evaluations.categories.issue.nameTaken");
  }
}

/** Por qué no se pudo leer o guardar, en el idioma de la pantalla. */
export function describeCategoriesFailure(
  translate: Translator,
  failure: ApiRequestFailure,
): string {
  if (failure.reason === CATEGORIES_CHANGED_REASON) {
    return translate("evaluations.categories.error.changed");
  }
  switch (failure.failure) {
    case "not_found":
      return translate("evaluations.categories.error.notFound");
    case "network":
      return translate("auth.error.network");
    case "unauthenticated":
      return translate("evaluations.error.signInRequired");
    case "forbidden":
      return translate("evaluations.error.forbidden");
    default:
      return translate("evaluations.error.unexpected");
  }
}
