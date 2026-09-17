import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import {
  type DecidedRoleRequest,
  DecisionNotAuditedError,
  ROLE_REQUEST_DECISIONS,
  type RoleRequestDecisionGateways,
  RoleAlreadyGrantedError,
  RoleRequestAlreadyDecidedError,
  RoleRequestDecisionForbiddenError,
  RoleRequestNotFoundError,
  decideRoleRequest,
} from "@/lib/auth/role-request-decision";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { createSupabaseRoleRequestDecisionGateways } from "@/lib/auth/supabase-role-request-decision-gateways";

/**
 * Aprobar o rechazar una solicitud de rol (FR-011, AC-006, RF-5 del PRD de E3).
 *
 * Quién puede llamarlo lo decide la frontera: `RESTRICTED_ROUTES` lo reserva a
 * la capacidad de gestionar usuarios y roles, que sólo tiene Admin. Quien
 * decide es siempre quien identifica la cookie de sesión, nunca un id del
 * cuerpo, y sólo alcanza las solicitudes de su club.
 */

// Depende de la sesión de quien llama y del estado de la solicitud ahora.
export const dynamic = "force-dynamic";

const decisionBodySchema = z.object({
  decision: z.enum(ROLE_REQUEST_DECISIONS),
});

type DecisionBody = z.infer<typeof decisionBodySchema>;

/** La solicitud recién decidida, con quién decidió y cuándo. */
export type RoleRequestDecisionResponse = DecidedRoleRequest;

type DecisionRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

const NOT_FOUND_MESSAGE = "No existe esa solicitud de rol en tu club.";
const NOT_AUDITED_MESSAGE =
  "La decisión quedó aplicada, pero no se pudo registrar en la bitácora. Avisa a quien mantiene la plataforma.";

function requireDecisionGateways(): RoleRequestDecisionGateways {
  const wiring = createSupabaseRoleRequestDecisionGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** Un id que no es un uuid no puede nombrar ninguna solicitud: se responde
 * como una que no existe, sin mandarle a Postgres un valor que rechazaría. */
function parseRequestId(id: string): string {
  if (!z.uuid().safeParse(id).success) {
    throw new ApiError("not_found", NOT_FOUND_MESSAGE);
  }
  return id;
}

function asApiError(error: unknown): never {
  if (error instanceof RoleRequestDecisionForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  if (error instanceof RoleRequestNotFoundError) {
    throw new ApiError("not_found", NOT_FOUND_MESSAGE);
  }
  if (error instanceof RoleRequestAlreadyDecidedError) {
    throw new ApiError("conflict", error.message, `already_${error.status}`);
  }
  if (error instanceof RoleAlreadyGrantedError) {
    throw new ApiError("business_rule", error.message, "role_already_granted");
  }
  if (error instanceof DecisionNotAuditedError) {
    // El envoltorio no registra un `ApiError`: sin esto el fallo de la
    // bitácora sólo lo vería quien llama.
    console.error("[api/v1/role-requests/decision] bitácora sin escribir", {
      message: error.message,
      cause: error.cause,
    });
    throw new ApiError(
      "internal_error",
      NOT_AUDITED_MESSAGE,
      "audit_not_recorded",
    );
  }
  return asAccountApiError(error);
}

export function POST(
  request: NextRequest,
  context: DecisionRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<RoleRequestDecisionResponse, DecisionBody>({
    schema: decisionBodySchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const deciderId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const requestId = parseRequestId((await context.params).id);
      try {
        return {
          data: await decideRoleRequest(requireDecisionGateways(), {
            deciderId,
            requestId,
            decision: body.decision,
          }),
        };
      } catch (error) {
        asApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
