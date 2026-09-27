import {
  type AuditAction,
  type AuditActor,
  type AuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";
import { calculateOverallRating } from "./overall-rating";

/**
 * La evaluación de un miembro (#319, RF-1, RF-2 y RF-5 del PRD de E9), contada
 * sin Supabase delante.
 *
 * Sólo la ve y la escribe el personal de entrenamiento (FR-055). La frontera
 * ya lo decide por el camino; aquí se vuelve a comprobar, porque es la regla
 * más delicada de la plataforma y no se deja a un solo cerrojo.
 *
 * Guardar sigue el patrón de la ficha del miembro (`member_status_changed`):
 * la escritura lleva la fecha de la evaluación que se tenía delante y sólo se
 * aplica si la base sigue en ella. Si alguien guardó entretanto, es un
 * conflicto y no se pisa nada.
 */

export const RATING_MIN = 1;
export const RATING_MAX = 10;

/** Los `reason` con los que la API distingue los casos que comparten código. */
export const EVALUATION_EXISTS_REASON = "evaluation_exists";
export const EVALUATION_CHANGED_REASON = "evaluation_changed";
export const EVALUATION_NOT_FOUND_REASON = "evaluation_not_found";
export const MEMBER_NOT_FOUND_REASON = "member_not_found";
export const MEMBER_INACTIVE_REASON = "member_inactive";
export const NO_ACTIVE_CATEGORIES_REASON = "no_active_categories";

/** En la bitácora la entidad es el miembro evaluado: "sobre quién". */
const AUDITED_ENTITY_TYPE = "member";

const INACTIVE_STATUS: AccountStatus = "inactive";

/** Una categoría de la evaluación. `isRetired` es que el club la desactivó
 * después: la evaluación la conserva hasta que alguien la ponga al día. */
export type EvaluationRating = {
  readonly categoryId: string;
  readonly name: string;
  readonly rating: number;
  readonly isRetired: boolean;
};

/** Lo que hay en la base. `updatedAt` va tal cual la devuelve Postgres, con
 * sus microsegundos: es la versión contra la que se guarda.
 * `missingCategoryCount` son las categorías activas del club que la
 * evaluación todavía no tiene. */
export type StoredEvaluation = {
  readonly updatedAt: string;
  readonly ratings: readonly EvaluationRating[];
  readonly missingCategoryCount: number;
};

export type MemberEvaluation =
  | { readonly status: "not_evaluated"; readonly memberId: string }
  | {
      readonly status: "evaluated";
      readonly memberId: string;
      readonly updatedAt: string;
      /** `null` sin ninguna categoría: no hay media de nada. */
      readonly overallRating: number | null;
      readonly ratings: readonly EvaluationRating[];
      /** Tiene justo las categorías activas del club: ponerla al día no
       * cambiaría nada. La pantalla sólo ofrece la acción cuando es `false`. */
      readonly isCurrent: boolean;
    };

export type EvaluationScope = {
  readonly clubId: string;
  readonly userId: string;
};

export type RatingChange = {
  readonly categoryId: string;
  readonly rating: number;
};

export type RatingsSubmission = {
  readonly expectedUpdatedAt: string;
  readonly ratings: readonly RatingChange[];
};

export type EvaluationCreation =
  | { readonly kind: "created" }
  | { readonly kind: "already_exists" }
  | { readonly kind: "no_active_categories" }
  | { readonly kind: "member_inactive" }
  | { readonly kind: "member_not_found" };

export type RatingsSave =
  | { readonly kind: "saved" }
  | { readonly kind: "evaluation_changed" }
  | { readonly kind: "evaluation_not_found" }
  | { readonly kind: "unknown_category"; readonly categoryId: string }
  | { readonly kind: "member_inactive" }
  | { readonly kind: "member_not_found" };

/** Lo que hizo la puesta al día, en la base. */
export type EvaluationRefresh =
  | {
      readonly kind: "refreshed";
      readonly addedCount: number;
      readonly removedCount: number;
    }
  | { readonly kind: "already_current" }
  | { readonly kind: "evaluation_not_found" }
  | { readonly kind: "no_active_categories" }
  | { readonly kind: "member_inactive" }
  | { readonly kind: "member_not_found" };

/** Lo que se le cuenta a quien la pidió: qué pasó y cómo quedó. */
export type RefreshOutcome = Extract<
  EvaluationRefresh,
  { readonly kind: "refreshed" | "already_current" }
>;

export type RefreshedEvaluation = {
  readonly outcome: RefreshOutcome;
  readonly evaluation: MemberEvaluation;
};

export type MemberEvaluationGateways = {
  readonly members: Pick<
    RoleRequestGateways["members"],
    "findRoleRequestMember"
  >;
  readonly evaluations: {
    /** `null` si no es miembro del club. */
    findMemberStatus(scope: EvaluationScope): Promise<AccountStatus | null>;
    /** Las valoraciones en el orden del catálogo del club. */
    findEvaluation(scope: EvaluationScope): Promise<StoredEvaluation | null>;
    /** Todas las categorías activas del club en su valor inicial, en una
     * sola escritura. */
    createEvaluation(scope: EvaluationScope): Promise<EvaluationCreation>;
    /** Aplica todas las valoraciones o ninguna, y sólo si la evaluación
     * sigue en `expectedUpdatedAt`. */
    saveRatings(
      scope: EvaluationScope,
      submission: RatingsSubmission,
    ): Promise<RatingsSave>;
    /** Las categorías activas que le faltan entran en 5 y las desactivadas
     * salen, en una sola escritura. Ya al día, no toca nada. */
    refreshEvaluation(scope: EvaluationScope): Promise<EvaluationRefresh>;
  };
  readonly audit: AuditLogWriter;
};

export const EVALUATION_ISSUE_CODES = [
  "ratings_required",
  "rating_out_of_range",
  "rating_not_integer",
  "duplicate_category",
  "unknown_category",
] as const;

export type EvaluationIssueCode = (typeof EVALUATION_ISSUE_CODES)[number];

export type EvaluationIssue =
  | { readonly code: "ratings_required" }
  | {
      readonly code: Exclude<EvaluationIssueCode, "ratings_required">;
      readonly categoryId: string;
    };

export class EvaluationForbiddenError extends Error {
  constructor() {
    super(
      "Sólo el personal de entrenamiento ve y escribe evaluaciones, tampoco la propia.",
    );
    this.name = "EvaluationForbiddenError";
  }
}

export class EvaluatedMemberNotFoundError extends Error {
  constructor() {
    super("No existe ese miembro en tu club.");
    this.name = "EvaluatedMemberNotFoundError";
  }
}

export class EvaluatedMemberInactiveError extends Error {
  constructor() {
    super("El miembro está dado de baja: no se le puede evaluar.");
    this.name = "EvaluatedMemberInactiveError";
  }
}

export class EvaluationNotFoundError extends Error {
  constructor() {
    super(
      "Ese miembro todavía no tiene evaluación: créala antes de guardarla.",
    );
    this.name = "EvaluationNotFoundError";
  }
}

export class EvaluationAlreadyExistsError extends Error {
  constructor() {
    super("Ese miembro ya tiene evaluación: ábrela para editarla.");
    this.name = "EvaluationAlreadyExistsError";
  }
}

export class NoActiveCategoriesError extends Error {
  constructor() {
    super(
      "El club no tiene ninguna categoría activa: activa o crea alguna antes de evaluar.",
    );
    this.name = "NoActiveCategoriesError";
  }
}

export class EvaluationChangedError extends Error {
  constructor() {
    super(
      "Alguien guardó esta evaluación mientras la editabas: vuelve a abrirla.",
    );
    this.name = "EvaluationChangedError";
  }
}

export class EvaluationValidationError extends Error {
  readonly issues: readonly EvaluationIssue[];

  constructor(issues: readonly EvaluationIssue[]) {
    super(
      `La evaluación trae valoraciones que no valen: ${issues
        .map((issue) => issue.code)
        .join(", ")}.`,
    );
    this.name = "EvaluationValidationError";
    this.issues = issues;
  }
}

function findRatingIssue(change: RatingChange): EvaluationIssue | null {
  const { categoryId, rating } = change;
  if (!Number.isInteger(rating)) {
    return { code: "rating_not_integer", categoryId };
  }
  if (rating < RATING_MIN || rating > RATING_MAX) {
    return { code: "rating_out_of_range", categoryId };
  }
  return null;
}

/** Lo que se sabe sin mirar la base. Que la categoría sea de la evaluación lo
 * decide la base, en la misma escritura. */
export function findRatingsIssues(
  ratings: readonly RatingChange[],
): readonly EvaluationIssue[] {
  if (ratings.length === 0) {
    return [{ code: "ratings_required" }];
  }
  const seen = new Set<string>();
  return ratings.flatMap((change): EvaluationIssue[] => {
    const repeated = seen.has(change.categoryId);
    seen.add(change.categoryId);
    if (repeated) {
      return [{ code: "duplicate_category", categoryId: change.categoryId }];
    }
    const issue = findRatingIssue(change);
    return issue === null ? [] : [issue];
  });
}

/** Quien pide, si es personal de entrenamiento. Lo usa también el catálogo de
 * categorías, que el SRD deja configurar a los mismos (FR-053), y la lista
 * de la pantalla (#322). */
export async function findEvaluatorActor(
  gateways: Pick<MemberEvaluationGateways, "members">,
  callerId: string,
): Promise<AuditActor> {
  const caller = await gateways.members.findRoleRequestMember(callerId);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  if (!hasCapability(caller.role, "viewEvaluations")) {
    throw new EvaluationForbiddenError();
  }
  return { id: callerId, clubId: caller.clubId };
}

async function findWritableMember(
  gateways: MemberEvaluationGateways,
  scope: EvaluationScope,
): Promise<void> {
  const status = await gateways.evaluations.findMemberStatus(scope);
  if (status === null) {
    throw new EvaluatedMemberNotFoundError();
  }
  if (status === INACTIVE_STATUS) {
    throw new EvaluatedMemberInactiveError();
  }
}

/** La misma regla que `refresh_member_evaluation`: al día es no tener nada
 * que quitar ni nada que añadir. */
function isCurrentEvaluation(stored: StoredEvaluation): boolean {
  return (
    stored.missingCategoryCount === 0 &&
    stored.ratings.every((entry) => !entry.isRetired)
  );
}

async function readEvaluation(
  gateways: MemberEvaluationGateways,
  scope: EvaluationScope,
): Promise<MemberEvaluation> {
  const stored = await gateways.evaluations.findEvaluation(scope);
  if (stored === null) {
    return { status: "not_evaluated", memberId: scope.userId };
  }
  return {
    status: "evaluated",
    memberId: scope.userId,
    updatedAt: stored.updatedAt,
    overallRating: calculateOverallRating(
      stored.ratings.map((entry) => entry.rating),
    ),
    ratings: stored.ratings,
    isCurrent: isCurrentEvaluation(stored),
  };
}

/** Sin metadata: ni las notas ni las categorías. Quién evaluó, sobre quién y
 * cuándo ya están en la entrada (NFR-010). */
function recordEvaluationEvent(
  gateways: MemberEvaluationGateways,
  event: {
    readonly actor: AuditActor;
    readonly action: AuditAction;
    readonly memberId: string;
  },
): Promise<void> {
  return recordAuditEvent(gateways.audit, {
    actor: event.actor,
    clubId: event.actor.clubId,
    action: event.action,
    entityType: AUDITED_ENTITY_TYPE,
    entityId: event.memberId,
    result: "success",
  });
}

type EvaluationRequest = {
  readonly callerId: string;
  readonly memberId: string;
};

export async function readMemberEvaluation(
  gateways: MemberEvaluationGateways,
  request: EvaluationRequest,
): Promise<MemberEvaluation> {
  const actor = await findEvaluatorActor(gateways, request.callerId);
  const scope = { clubId: actor.clubId, userId: request.memberId };
  if ((await gateways.evaluations.findMemberStatus(scope)) === null) {
    throw new EvaluatedMemberNotFoundError();
  }
  return readEvaluation(gateways, scope);
}

function assertCreated(creation: EvaluationCreation): void {
  switch (creation.kind) {
    case "created":
      return;
    case "already_exists":
      throw new EvaluationAlreadyExistsError();
    case "no_active_categories":
      throw new NoActiveCategoriesError();
    case "member_inactive":
      throw new EvaluatedMemberInactiveError();
    case "member_not_found":
      throw new EvaluatedMemberNotFoundError();
  }
}

/** Nace con todas las categorías activas del club en 5 (FR-051). La
 * bitácora se escribe después: antes dejaría rastro de algo que no se creó. */
export async function createMemberEvaluation(
  gateways: MemberEvaluationGateways,
  request: EvaluationRequest,
): Promise<MemberEvaluation> {
  const actor = await findEvaluatorActor(gateways, request.callerId);
  const scope = { clubId: actor.clubId, userId: request.memberId };
  await findWritableMember(gateways, scope);
  assertCreated(await gateways.evaluations.createEvaluation(scope));
  await recordEvaluationEvent(gateways, {
    actor,
    action: "member_evaluation.created",
    memberId: request.memberId,
  });
  return readEvaluation(gateways, scope);
}

function assertSaved(save: RatingsSave): void {
  switch (save.kind) {
    case "saved":
      return;
    case "evaluation_changed":
      throw new EvaluationChangedError();
    case "evaluation_not_found":
      throw new EvaluationNotFoundError();
    case "unknown_category":
      throw new EvaluationValidationError([
        { code: "unknown_category", categoryId: save.categoryId },
      ]);
    case "member_inactive":
      throw new EvaluatedMemberInactiveError();
    case "member_not_found":
      throw new EvaluatedMemberNotFoundError();
  }
}

/** Valida después de saber quién pide y antes de escribir nada: a quien no
 * puede ver evaluaciones no se le explica qué valoración falla. Sólo las
 * categorías que llegan: las demás de la evaluación se quedan como estaban. */
export async function saveEvaluationRatings(
  gateways: MemberEvaluationGateways,
  request: EvaluationRequest & RatingsSubmission,
): Promise<MemberEvaluation> {
  const actor = await findEvaluatorActor(gateways, request.callerId);
  const issues = findRatingsIssues(request.ratings);
  if (issues.length > 0) {
    throw new EvaluationValidationError(issues);
  }
  const scope = { clubId: actor.clubId, userId: request.memberId };
  await findWritableMember(gateways, scope);
  assertSaved(
    await gateways.evaluations.saveRatings(scope, {
      expectedUpdatedAt: request.expectedUpdatedAt,
      ratings: request.ratings,
    }),
  );
  await recordEvaluationEvent(gateways, {
    actor,
    action: "member_evaluation.ratings_saved",
    memberId: request.memberId,
  });
  return readEvaluation(gateways, scope);
}

function assertRefreshed(refresh: EvaluationRefresh): RefreshOutcome {
  switch (refresh.kind) {
    case "refreshed":
    case "already_current":
      return refresh;
    case "evaluation_not_found":
      throw new EvaluationNotFoundError();
    case "no_active_categories":
      throw new NoActiveCategoriesError();
    case "member_inactive":
      throw new EvaluatedMemberInactiveError();
    case "member_not_found":
      throw new EvaluatedMemberNotFoundError();
  }
}

/** Lleva la evaluación al conjunto activo del club (FR-053, AC-054). Es una
 * acción aparte y no un efecto de guardar: editar no migra (AC-035). Si ya
 * estaba al día no se anota nada, porque nada cambió. */
export async function refreshMemberEvaluation(
  gateways: MemberEvaluationGateways,
  request: EvaluationRequest,
): Promise<RefreshedEvaluation> {
  const actor = await findEvaluatorActor(gateways, request.callerId);
  const scope = { clubId: actor.clubId, userId: request.memberId };
  const outcome = assertRefreshed(
    await gateways.evaluations.refreshEvaluation(scope),
  );
  if (outcome.kind === "refreshed") {
    await recordEvaluationEvent(gateways, {
      actor,
      action: "member_evaluation.refreshed",
      memberId: request.memberId,
    });
  }
  return { outcome, evaluation: await readEvaluation(gateways, scope) };
}
