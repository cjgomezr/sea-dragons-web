import { z } from "zod";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  EVALUATIONS_API_PATH,
  EVALUATION_REFRESH_API_PATH,
} from "@/lib/auth/routes";
import type { EvaluationRoster } from "@/lib/evaluations/evaluation-roster";
import {
  EVALUATION_CHANGED_REASON,
  EVALUATION_EXISTS_REASON,
  MEMBER_INACTIVE_REASON,
  MEMBER_NOT_FOUND_REASON,
  type MemberEvaluation,
  NO_ACTIVE_CATEGORIES_REASON,
  type RatingsSubmission,
} from "@/lib/evaluations/member-evaluation";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Lo que la pantalla de Evaluaciones (#322) le pide a la API v1 y cómo reduce
 * la respuesta a algo que pintar. Todo pasa por los endpoints de #319 y de
 * este ticket: la aplicación nativa de Release 2 usará los mismos (CON-002).
 * De un error se guarda el código, no la frase, para que el aviso cambie de
 * idioma con el interruptor (E17).
 */

const rosterEntrySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("not_evaluated"),
    userId: z.uuid(),
    fullName: z.string(),
  }),
  z.object({
    status: z.literal("evaluated"),
    userId: z.uuid(),
    fullName: z.string(),
    overallRating: z.number().nullable(),
  }),
]);

const rosterResponseSchema = z.object({
  data: z.object({ members: z.array(rosterEntrySchema) }),
});

const memberEvaluationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_evaluated"), memberId: z.uuid() }),
  z.object({
    status: z.literal("evaluated"),
    memberId: z.uuid(),
    updatedAt: z.string(),
    overallRating: z.number().nullable(),
    ratings: z.array(
      z.object({
        categoryId: z.uuid(),
        name: z.string(),
        rating: z.number(),
        isRetired: z.boolean(),
      }),
    ),
    isCurrent: z.boolean(),
  }),
]);

const evaluationResponseSchema = z.object({ data: memberEvaluationSchema });

/** De la puesta al día sólo interesa cómo quedó: qué cambió ya se ve. */
const refreshResponseSchema = z.object({
  data: z.object({ evaluation: memberEvaluationSchema }),
});

export type EvaluationFailure = ApiRequestFailure;

export type RosterLoad =
  | { readonly kind: "loaded"; readonly roster: EvaluationRoster }
  | EvaluationFailure;

export type EvaluationLoad =
  | { readonly kind: "loaded"; readonly evaluation: MemberEvaluation }
  | EvaluationFailure;

function memberEvaluationPath(memberId: string): string {
  return `${EVALUATIONS_API_PATH}/${encodeURIComponent(memberId)}`;
}

function refreshPath(memberId: string): string {
  return EVALUATION_REFRESH_API_PATH.replace(
    "[id]",
    encodeURIComponent(memberId),
  );
}

async function requestEvaluation(
  memberId: string,
  init?: RequestInit,
): Promise<EvaluationLoad> {
  const read = readApiPayload(
    await requestApi(memberEvaluationPath(memberId), init),
    evaluationResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", evaluation: read.value.data };
}

/** Ninguna rechaza: `requestApi` atrapa el fallo de red y un cuerpo que no
 * cuadra sale como fallo, no como excepción. */
export async function loadEvaluationRoster(): Promise<RosterLoad> {
  const read = readApiPayload(
    await requestApi(EVALUATIONS_API_PATH),
    rosterResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", roster: read.value.data };
}

export function loadMemberEvaluation(
  memberId: string,
): Promise<EvaluationLoad> {
  return requestEvaluation(memberId);
}

export function createMemberEvaluation(
  memberId: string,
): Promise<EvaluationLoad> {
  return requestEvaluation(memberId, { method: "POST" });
}

export function saveMemberEvaluation(
  memberId: string,
  submission: RatingsSubmission,
): Promise<EvaluationLoad> {
  return requestEvaluation(memberId, {
    method: "PUT",
    headers: JSON_REQUEST_HEADERS,
    body: JSON.stringify(submission),
  });
}

/** La lleva al conjunto activo del club (#320). Ya al día también responde
 * bien, así que un segundo clic no es un error. */
export async function refreshMemberEvaluation(
  memberId: string,
): Promise<EvaluationLoad> {
  const read = readApiPayload(
    await requestApi(refreshPath(memberId), { method: "POST" }),
    refreshResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", evaluation: read.value.data.evaluation };
}

/** Alguien guardó esa evaluación después de que se leyera, o la creó antes
 * que quien pulsa crear: lo que toca es recargarla, no reintentar. */
export function isStaleEvaluation(failure: EvaluationFailure): boolean {
  return (
    failure.reason === EVALUATION_CHANGED_REASON ||
    failure.reason === EVALUATION_EXISTS_REASON
  );
}

function describeReason(
  translate: Translator,
  reason: string | null,
): string | null {
  switch (reason) {
    case EVALUATION_CHANGED_REASON:
      return translate("evaluations.error.changed");
    case EVALUATION_EXISTS_REASON:
      return translate("evaluations.error.exists");
    case MEMBER_NOT_FOUND_REASON:
      return translate("evaluations.error.memberNotFound");
    case MEMBER_INACTIVE_REASON:
      return translate("evaluations.error.memberInactive");
    case NO_ACTIVE_CATEGORIES_REASON:
      return translate("evaluations.error.noActiveCategories");
    default:
      return null;
  }
}

/** Por qué no salió, en el idioma de la pantalla. */
export function describeEvaluationFailure(
  translate: Translator,
  { failure, reason }: EvaluationFailure,
): string {
  const described = describeReason(translate, reason);
  if (described !== null) {
    return described;
  }
  switch (failure) {
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
