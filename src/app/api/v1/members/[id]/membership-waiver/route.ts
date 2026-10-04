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
  type MembershipWaiverChange,
  type MembershipWaiverGateways,
  MembershipNotWaivedError,
  MembershipWaiverForbiddenError,
  MembershipWaiverValidationError,
  WaiverNotAuditedError,
  removeMembershipWaiver,
  waiveMembership,
} from "@/lib/membership/membership-waiver";
import { createSupabaseMembershipWaiverGateways } from "@/lib/membership/supabase-membership-waiver-gateways";

/**
 * Eximir de cuota a un miembro (POST) y retirarle la exención (DELETE)
 * (#457, RF-4 del PRD de E12, D4).
 *
 * Quién puede llamarlo lo decide la frontera: `RESTRICTED_ROUTES` lo reserva a
 * la capacidad de gestionar usuarios y roles, que sólo tiene Admin. Quien
 * actúa es siempre quien identifica la cookie de sesión, y sólo alcanza a los
 * miembros de su club. El `[id]` es el `user_id` del miembro.
 *
 * `until` es un día del club (YYYY-MM-DD) posterior a hoy; la respuesta lo
 * devuelve como el instante en que la exención deja de contar.
 */

// Depende de la sesión de quien llama y de la membresía del socio ahora.
export const dynamic = "force-dynamic";

const waiverBodySchema = z.object({
  reason: z.string(),
  until: z.string().nullable().optional(),
});

type WaiverBody = z.infer<typeof waiverBodySchema>;

/** La membresía del socio después del cambio. */
export type MembershipWaiverResponse = MembershipWaiverChange;

type MembershipWaiverRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

const NOT_FOUND_MESSAGE = "No existe ese miembro en tu club.";
const NOT_AUDITED_MESSAGE =
  "La exención quedó cambiada, pero no se pudo registrar en la bitácora. Avisa a quien mantiene la plataforma.";

function requireWaiverGateways(): MembershipWaiverGateways {
  const wiring = createSupabaseMembershipWaiverGateways(process.env);
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
  if (error instanceof MembershipWaiverValidationError) {
    throw new ApiError("validation_error", error.message, error.code);
  }
  if (error instanceof MembershipWaiverForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  if (error instanceof MemberToChangeNotFoundError) {
    throw new ApiError("not_found", NOT_FOUND_MESSAGE);
  }
  if (error instanceof MembershipNotWaivedError) {
    throw new ApiError("business_rule", error.message, "not_waived");
  }
  if (error instanceof WaiverNotAuditedError) {
    // El envoltorio no registra un `ApiError`: sin esto el fallo de la
    // bitácora sólo lo vería quien llama.
    console.error("[api/v1/members/membership-waiver] bitácora sin escribir", {
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
  context: MembershipWaiverRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<MembershipWaiverResponse, WaiverBody>({
    schema: waiverBodySchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const actorId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const targetUserId = parseMemberId((await context.params).id);
      try {
        return {
          data: await waiveMembership(requireWaiverGateways(), {
            actorId,
            targetUserId,
            submission: { reason: body.reason, until: body.until ?? null },
            now: new Date(),
          }),
        };
      } catch (error) {
        asApiError(error);
      }
    },
  });
  return route(request);
}

export function DELETE(
  request: NextRequest,
  context: MembershipWaiverRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<MembershipWaiverResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const actorId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const targetUserId = parseMemberId((await context.params).id);
      try {
        return {
          data: await removeMembershipWaiver(requireWaiverGateways(), {
            actorId,
            targetUserId,
          }),
        };
      } catch (error) {
        asApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, PUT, PATCH } = createApiModule({});
