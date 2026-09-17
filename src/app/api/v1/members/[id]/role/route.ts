import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import {
  LastAdminError,
  type MemberRoleChange,
  MemberRoleChangeForbiddenError,
  type MemberRoleChangeGateways,
  MemberToChangeNotFoundError,
  RoleChangeNotAuditedError,
  changeMemberRole,
} from "@/lib/auth/member-role-change";
import { ROLES } from "@/lib/auth/roles";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { createSupabaseMemberRoleGateways } from "@/lib/auth/supabase-member-role-gateways";

/**
 * Cambiar el rol de un socio (FR-014, AC-008, RF-6 y RF-7 del PRD de E3).
 *
 * Quién puede llamarlo lo decide la frontera: `RESTRICTED_ROUTES` lo reserva a
 * la capacidad de gestionar usuarios y roles, que sólo tiene Admin. Quien
 * actúa es siempre quien identifica la cookie de sesión, y sólo alcanza a los
 * socios de su club. El `[id]` es el `user_id` del socio.
 */

// Depende de la sesión de quien llama y del rol del socio ahora.
export const dynamic = "force-dynamic";

const roleBodySchema = z.object({
  role: z.enum(ROLES),
});

type RoleBody = z.infer<typeof roleBodySchema>;

/** El rol del socio antes y después de la petición. */
export type MemberRoleResponse = MemberRoleChange;

type MemberRoleRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

const NOT_FOUND_MESSAGE = "No existe ese socio en tu club.";
const NOT_AUDITED_MESSAGE =
  "El rol quedó cambiado, pero no se pudo registrar en la bitácora. Avisa a quien mantiene la plataforma.";

function requireMemberRoleGateways(): MemberRoleChangeGateways {
  const wiring = createSupabaseMemberRoleGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** Un id que no es un uuid no puede nombrar a ningún socio: se responde como
 * uno que no existe, sin mandarle a Postgres un valor que rechazaría. */
function parseMemberId(id: string): string {
  if (!z.uuid().safeParse(id).success) {
    throw new ApiError("not_found", NOT_FOUND_MESSAGE);
  }
  return id;
}

function asApiError(error: unknown): never {
  if (error instanceof MemberRoleChangeForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  if (error instanceof MemberToChangeNotFoundError) {
    throw new ApiError("not_found", NOT_FOUND_MESSAGE);
  }
  if (error instanceof LastAdminError) {
    throw new ApiError("business_rule", error.message, "last_admin");
  }
  if (error instanceof RoleChangeNotAuditedError) {
    // El envoltorio no registra un `ApiError`: sin esto el fallo de la
    // bitácora sólo lo vería quien llama.
    console.error("[api/v1/members/role] bitácora sin escribir", {
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
  context: MemberRoleRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<MemberRoleResponse, RoleBody>({
    schema: roleBodySchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const actorId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const targetUserId = parseMemberId((await context.params).id);
      try {
        return {
          data: await changeMemberRole(requireMemberRoleGateways(), {
            actorId,
            targetUserId,
            newRole: body.role,
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
