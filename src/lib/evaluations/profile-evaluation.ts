import {
  EvaluationForbiddenError,
  type MemberEvaluation,
  type MemberEvaluationGateways,
  readMemberEvaluation,
} from "./member-evaluation";

/**
 * Lo que el perfil de un miembro enseña de su evaluación (#324, RF-5 del PRD
 * de E9).
 *
 * Al personal de entrenamiento, la evaluación con su OVR. A un Player o un
 * Committee, nada: ni la suya (FR-055, AC-023). El perfil les explica
 * entonces que las notas sólo las ve el personal de entrenamiento (FR-056),
 * y por eso la respuesta lo dice con una variante propia en vez de un null.
 *
 * Quién ve evaluaciones lo decide `readMemberEvaluation`, que lo comprueba
 * antes de leer ninguna: a quien no puede verla no se le lee.
 */

export type ProfileEvaluation =
  | { readonly visibility: "staff_only" }
  | { readonly visibility: "visible"; readonly evaluation: MemberEvaluation };

export async function readProfileEvaluation(
  gateways: MemberEvaluationGateways,
  request: { readonly callerId: string; readonly memberId: string },
): Promise<ProfileEvaluation> {
  try {
    return {
      visibility: "visible",
      evaluation: await readMemberEvaluation(gateways, request),
    };
  } catch (error) {
    if (error instanceof EvaluationForbiddenError) {
      return { visibility: "staff_only" };
    }
    throw error;
  }
}
