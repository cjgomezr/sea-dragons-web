import { z } from "zod";
import { ApiError } from "@/lib/api/response";
import { asAccountApiError } from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  CATEGORIES_CHANGED_REASON,
  CATEGORY_NAME_MAX_LENGTH,
  CategoriesChangedError,
  CategoryNotFoundError,
  CategoryValidationError,
  type EvaluationCategories,
  type EvaluationCategoriesGateways,
} from "./evaluation-categories";
import { EvaluationForbiddenError } from "./member-evaluation";
import { createSupabaseEvaluationCategoriesGateways } from "./supabase-evaluation-categories-gateways";

/**
 * Lo que comparten los endpoints del catálogo de categorías (#320): cómo se
 * cablean, qué nombre aceptan y cómo responde cada error del dominio.
 */

/** Todas las del club, desactivadas incluidas, en su orden, tal como
 * quedaron después de la petición. */
export type EvaluationCategoriesResponse = {
  readonly categories: EvaluationCategories;
};

/** Un tope holgado sólo para no arrastrar un cuerpo de megas hasta el
 * dominio, que cuenta en caracteres y dice qué falló. */
const NAME_BODY_MAX_LENGTH = CATEGORY_NAME_MAX_LENGTH * 4;

export const categoryNameSchema = z.string().max(NAME_BODY_MAX_LENGTH);

export function requireEvaluationCategoriesGateways(): EvaluationCategoriesGateways {
  const wiring = createSupabaseEvaluationCategoriesGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** Un id que no es un uuid no nombra ninguna categoría: se responde como una
 * que no existe, sin mandarle a Postgres un valor que rechazaría. */
export function readCategoryId(value: string): string {
  if (!z.uuid().safeParse(value).success) {
    throw new ApiError("not_found", new CategoryNotFoundError().message);
  }
  return value;
}

/** El código del problema va como `reason`, que la pantalla traduce y pone
 * junto al campo. */
export function asCategoriesApiError(error: unknown): never {
  if (error instanceof CategoryValidationError) {
    throw new ApiError(
      "validation_error",
      error.message,
      error.issues[0]?.code,
    );
  }
  if (error instanceof CategoryNotFoundError) {
    throw new ApiError("not_found", error.message);
  }
  if (error instanceof CategoriesChangedError) {
    throw new ApiError("conflict", error.message, CATEGORIES_CHANGED_REASON);
  }
  if (error instanceof EvaluationForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  return asAccountApiError(error);
}
