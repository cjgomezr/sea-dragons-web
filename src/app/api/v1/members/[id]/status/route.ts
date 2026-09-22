import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { MemberToChangeNotFoundError } from "@/lib/auth/member-role-change";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  LastAdminDeactivationError,
  type MemberStatusChange,
  MemberStatusChangeForbiddenError,
  type MemberStatusChangeGateways,
  REQUESTABLE_MEMBER_STATUSES,
  SelfDeactivationError,
  StatusChangeNotAuditedError,
  changeMemberStatus,
} from "@/lib/members/member-status-change";
import { createSupabaseMemberStatusGateways } from "@/lib/members/supabase-member-status-gateways";

/**
 * Dar de baja o reactivar a un miembro (FR-085, AC-040, RF-6 del PRD de E5).
 *
 * Quién puede llamarlo lo decide la frontera: `RESTRICTED_ROUTES` lo reserva a
 * la capacidad de gestionar usuarios y roles, que sólo tiene Admin. Quien
 * actúa es siempre quien identifica la cookie de sesión, y sólo alcanza a los
 * miembros de su club. El `[id]` es el `user_id` del miembro.
 *
 * Pedir `active` puede responder `incomplete`: quien se dio de baja sin
 * terminar su registro vuelve a terminarlo.
 */

// Depende de la sesión de quien llama y del estado del miembro ahora.
export const dynamic = "force-dynamic";

const statusBodySchema = z.object({
  status: z.enum(REQUESTABLE_MEMBER_STATUSES),
});

type StatusBody = z.infer<typeof statusBodySchema>;

/** El estado del miembro antes y después de la petición. */
export type MemberStatusResponse = MemberStatusChange;

type MemberStatusRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

const NOT_FOUND_MESSAGE = "No existe ese miembro en tu club.";
const NOT_AUDITED_MESSAGE =
  "El estado quedó cambiado, pero no se pudo registrar en la bitácora. Avisa a quien mantiene la plataforma.";

function requireMemberStatusGateways(): MemberStatusChangeGateways {
  const wiring = createSupabaseMemberStatusGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** Un id que no es un uuid no puede nombrar a ningún miembro: se responde
 * como uno que no existe, sin mandarle a Postgres un valor que rechazaría. */
function parseMemberId(id: string): string {
  if (!z.uuid().safeParse(id).success) {
    throw new ApiError("not_found", NOT_FOUND_MESSAGE);
  }
  return id;
}

function asApiError(error: unknown): never {
  if (error instanceof MemberStatusChangeForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  if (error instanceof MemberToChangeNotFoundError) {
    throw new ApiError("not_found", NOT_FOUND_MESSAGE);
  }
  if (error instanceof LastAdminDeactivationError) {
    throw new ApiError("business_rule", error.message, "last_admin");
  }
  if (error instanceof SelfDeactivationError) {
    throw new ApiError("business_rule", error.message, "self_deactivation");
  }
  if (error instanceof StatusChangeNotAuditedError) {
    // El envoltorio no registra un `ApiError`: sin esto el fallo de la
    // bitácora sólo lo vería quien llama.
    console.error("[api/v1/members/status] bitácora sin escribir", {
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

export function PATCH(
  request: NextRequest,
  context: MemberStatusRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<MemberStatusResponse, StatusBody>({
    schema: statusBodySchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const actorId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const targetUserId = parseMemberId((await context.params).id);
      try {
        return {
          data: await changeMemberStatus(requireMemberStatusGateways(), {
            actorId,
            targetUserId,
            status: body.status,
          }),
        };
      } catch (error) {
        asApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, POST, PUT, DELETE } = createApiModule({});
