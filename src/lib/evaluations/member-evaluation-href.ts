import {
  EVALUATIONS_PATH,
  EVALUATION_MEMBER_QUERY_PARAM,
} from "@/lib/auth/routes";

/** Evaluaciones con la ficha de ese miembro ya abierta (#324): a donde llevan
 * la marca de sin evaluar del directorio y la ficha del Admin. */
export function memberEvaluationHref(userId: string): string {
  const params = new URLSearchParams({
    [EVALUATION_MEMBER_QUERY_PARAM]: userId,
  });
  return `${EVALUATIONS_PATH}?${params.toString()}`;
}
