import {
  type AuditAction,
  type AuditActor,
  type AuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import {
  type MemberEvaluationGateways,
  findEvaluatorActor,
} from "./member-evaluation";

/**
 * El catálogo de categorías del club (#320, RF-3 del PRD de E9), contado sin
 * Supabase delante: añadir, renombrar, reordenar, desactivar y reactivar. Lo
 * configuran Admin y Coach (FR-053), los mismos que evalúan.
 *
 * Sigue el patrón de las posiciones de E18a (`manage-club-positions.ts`):
 * nada se borra, cada acción devuelve el catálogo entero tal como quedó, y la
 * bitácora se escribe después de que la base aplicó el cambio. Ninguna acción
 * toca una evaluación guardada (AC-035): para eso está
 * `refreshMemberEvaluation`.
 */

/** El límite de `evaluation_categories_name_length` en `0031`. */
export const CATEGORY_NAME_MAX_LENGTH = 40;

export const CATEGORIES_CHANGED_REASON = "evaluation_categories_changed";

export const CATEGORY_ISSUE_CODES = [
  "name_required",
  "name_too_long",
  "name_taken",
] as const;

export type CategoryIssueCode = (typeof CATEGORY_ISSUE_CODES)[number];

export type CategoryIssue = { readonly code: CategoryIssueCode };

export type EvaluationCategory = {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
};

/** Todas, desactivadas incluidas, en el orden del club. */
export type EvaluationCategories = readonly EvaluationCategory[];

type CategoryTarget = { readonly clubId: string; readonly categoryId: string };

export type CategoryInsertResult =
  | { readonly kind: "created"; readonly categoryId: string }
  | { readonly kind: "name_taken" };

export type CategoryRenameResult =
  | { readonly kind: "renamed" }
  | { readonly kind: "name_taken" }
  | { readonly kind: "not_found" };

export type CategoryReorderResult =
  { readonly kind: "reordered" } | { readonly kind: "categories_changed" };

export type CategoryActivationResult =
  | { readonly kind: "changed" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "not_found" };

export type EvaluationCategoriesGateways = {
  readonly members: MemberEvaluationGateways["members"];
  readonly categories: {
    findCategories(clubId: string): Promise<EvaluationCategories>;
    insertCategory(clubId: string, name: string): Promise<CategoryInsertResult>;
    renameCategory(
      target: CategoryTarget,
      name: string,
    ): Promise<CategoryRenameResult>;
    /** `categoryIds` son las activas, todas, en el orden nuevo. */
    reorderCategories(
      clubId: string,
      categoryIds: readonly string[],
    ): Promise<CategoryReorderResult>;
    setCategoryActive(
      target: CategoryTarget,
      isActive: boolean,
    ): Promise<CategoryActivationResult>;
  };
  readonly audit: AuditLogWriter;
};

export class CategoryValidationError extends Error {
  readonly issues: readonly CategoryIssue[];

  constructor(issues: readonly CategoryIssue[]) {
    super(
      `El nombre de la categoría no vale: ${issues
        .map((issue) => issue.code)
        .join(", ")}.`,
    );
    this.name = "CategoryValidationError";
    this.issues = issues;
  }
}

export class CategoryNotFoundError extends Error {
  constructor() {
    super("No existe esa categoría en tu club.");
    this.name = "CategoryNotFoundError";
  }
}

export class CategoriesChangedError extends Error {
  constructor() {
    super(
      "Alguien cambió las categorías mientras las ordenabas: vuelve a cargarlas.",
    );
    this.name = "CategoriesChangedError";
  }
}

const CATEGORY_ENTITY_TYPE = "evaluation_category";
const CLUB_ENTITY_TYPE = "club";

/** Como `char_length` de Postgres: un emoji es un carácter, no dos. */
function countCharacters(text: string): number {
  return [...text].length;
}

/** Lo que se puede saber sin mirar el catálogo. El nombre repetido lo decide
 * la base, que ve lo que otra persona guardó hace un instante. */
export function findCategoryNameIssues(name: string): readonly CategoryIssue[] {
  const trimmed = name.trim();
  if (trimmed === "") {
    return [{ code: "name_required" }];
  }
  if (countCharacters(trimmed) > CATEGORY_NAME_MAX_LENGTH) {
    return [{ code: "name_too_long" }];
  }
  return [];
}

function validName(name: string): string {
  const issues = findCategoryNameIssues(name);
  if (issues.length > 0) {
    throw new CategoryValidationError(issues);
  }
  return name.trim();
}

function nameTaken(): CategoryValidationError {
  return new CategoryValidationError([{ code: "name_taken" }]);
}

/** Sin metadata salvo al reordenar: quién, qué y sobre qué categoría ya están
 * en la entrada. */
function recordCategoryEvent(
  gateways: EvaluationCategoriesGateways,
  event: {
    readonly actor: AuditActor;
    readonly action: AuditAction;
    readonly categoryId: string;
  },
): Promise<void> {
  return recordAuditEvent(gateways.audit, {
    actor: event.actor,
    clubId: event.actor.clubId,
    action: event.action,
    entityType: CATEGORY_ENTITY_TYPE,
    entityId: event.categoryId,
    result: "success",
  });
}

export async function listEvaluationCategories(
  gateways: EvaluationCategoriesGateways,
  callerId: string,
): Promise<EvaluationCategories> {
  const actor = await findEvaluatorActor(gateways, callerId);
  return gateways.categories.findCategories(actor.clubId);
}

/** Comprueba quién pide antes que el nombre: a quien no puede configurar no
 * se le explica qué falla. */
export async function createEvaluationCategory(
  gateways: EvaluationCategoriesGateways,
  request: { readonly callerId: string; readonly name: string },
): Promise<EvaluationCategories> {
  const actor = await findEvaluatorActor(gateways, request.callerId);
  const name = validName(request.name);
  const result = await gateways.categories.insertCategory(actor.clubId, name);
  if (result.kind === "name_taken") {
    throw nameTaken();
  }
  await recordCategoryEvent(gateways, {
    actor,
    action: "evaluation_category.created",
    categoryId: result.categoryId,
  });
  return gateways.categories.findCategories(actor.clubId);
}

export async function renameEvaluationCategory(
  gateways: EvaluationCategoriesGateways,
  request: {
    readonly callerId: string;
    readonly categoryId: string;
    readonly name: string;
  },
): Promise<EvaluationCategories> {
  const actor = await findEvaluatorActor(gateways, request.callerId);
  const name = validName(request.name);
  const result = await gateways.categories.renameCategory(
    { clubId: actor.clubId, categoryId: request.categoryId },
    name,
  );
  switch (result.kind) {
    case "not_found":
      throw new CategoryNotFoundError();
    case "name_taken":
      throw nameTaken();
    case "renamed":
      break;
  }
  await recordCategoryEvent(gateways, {
    actor,
    action: "evaluation_category.renamed",
    categoryId: request.categoryId,
  });
  return gateways.categories.findCategories(actor.clubId);
}

/** La lista entera en el orden nuevo, no un movimiento: si alguien cambió
 * las activas entretanto, no casa y no se aplica. */
export async function reorderEvaluationCategories(
  gateways: EvaluationCategoriesGateways,
  request: {
    readonly callerId: string;
    readonly categoryIds: readonly string[];
  },
): Promise<EvaluationCategories> {
  const actor = await findEvaluatorActor(gateways, request.callerId);
  const result = await gateways.categories.reorderCategories(
    actor.clubId,
    request.categoryIds,
  );
  if (result.kind === "categories_changed") {
    throw new CategoriesChangedError();
  }
  await recordAuditEvent(gateways.audit, {
    actor,
    clubId: actor.clubId,
    action: "evaluation_category.reordered",
    entityType: CLUB_ENTITY_TYPE,
    entityId: actor.clubId,
    result: "success",
    metadata: { categoryIds: request.categoryIds },
  });
  return gateways.categories.findCategories(actor.clubId);
}

/** Desactivar la que ya lo está no es un cambio, y no se anota. */
export async function setEvaluationCategoryActive(
  gateways: EvaluationCategoriesGateways,
  request: {
    readonly callerId: string;
    readonly categoryId: string;
    readonly isActive: boolean;
  },
): Promise<EvaluationCategories> {
  const actor = await findEvaluatorActor(gateways, request.callerId);
  const result = await gateways.categories.setCategoryActive(
    { clubId: actor.clubId, categoryId: request.categoryId },
    request.isActive,
  );
  if (result.kind === "not_found") {
    throw new CategoryNotFoundError();
  }
  if (result.kind === "changed") {
    await recordCategoryEvent(gateways, {
      actor,
      action: request.isActive
        ? "evaluation_category.reactivated"
        : "evaluation_category.deactivated",
      categoryId: request.categoryId,
    });
  }
  return gateways.categories.findCategories(actor.clubId);
}
