import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import {
  MemberRoleChangeForbiddenError,
  type MemberRoleChangeGateways,
} from "@/lib/auth/member-role-change";
import {
  type BulkRoleChange,
  MAX_BULK_ROLE_CHANGE_MEMBERS,
  changeMemberRoles,
} from "@/lib/auth/member-roles-bulk-change";
import { ROLES } from "@/lib/auth/roles";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { createSupabaseMemberRoleGateways } from "@/lib/auth/supabase-member-role-gateways";

/**
 * Cambiar el rol de varios socios a la vez (#552, RF-6 del PRD de E21).
 *
 * Como el cambio de uno, lo reserva al Admin `RESTRICTED_ROUTES`, y el
 * dominio lo vuelve a mirar antes de tocar a nadie. Responde 200 aunque
 * algún socio no cambie: el resultado de cada uno va en `results`, y la
 * pantalla dice cuáles y por qué. Los `userIds` son `user_id` de socios.
 */

// Depende de la sesión de quien llama y del rol de cada socio ahora.
export const dynamic = "force-dynamic";

const rolesBodySchema = z.object({
  userIds: z.array(z.uuid()).min(1).max(MAX_BULK_ROLE_CHANGE_MEMBERS),
  role: z.enum(ROLES),
});

type RolesBody = z.infer<typeof rolesBodySchema>;

/** El rol pedido y qué pasó con cada socio. */
export type MemberRolesResponse = BulkRoleChange;

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

function asApiError(error: unknown): never {
  if (error instanceof MemberRoleChangeForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  return asAccountApiError(error);
}

export function POST(request: NextRequest): Promise<NextResponse> {
  const route = createApiRoute<MemberRolesResponse, RolesBody>({
    schema: rolesBodySchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const actorId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      try {
        return {
          data: await changeMemberRoles(requireMemberRoleGateways(), {
            actorId,
            targetUserIds: body.userIds,
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

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
