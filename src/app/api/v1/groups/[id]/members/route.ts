import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { type GroupMember, listGroupMembers } from "@/lib/groups/group-members";
import {
  asGroupsApiError,
  readGroupId,
  requireGroupMembersGateways,
} from "@/lib/groups/groups-api";

/**
 * Los socios de un grupo (FR-026; RF-6 del PRD de E4).
 *
 * Quién puede llamarlo lo decide la frontera: cuelga de `/api/v1/groups`, que
 * `RESTRICTED_ROUTES` reserva a quien gestiona grupos. Un grupo de otro club
 * responde 404, como uno que no existe.
 */

// Depende de la sesión de quien llama y de las pertenencias de ahora.
export const dynamic = "force-dynamic";

/** Los socios del grupo que no están dados de baja, en orden alfabético, con
 * id y nombre completo y nada más. */
export type GroupMembersResponse = {
  readonly members: readonly GroupMember[];
};

type GroupRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function GET(
  request: NextRequest,
  context: GroupRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<GroupMembersResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const groupId = readGroupId((await context.params).id);
      try {
        return {
          data: {
            members: await listGroupMembers(requireGroupMembersGateways(), {
              callerId,
              groupId,
            }),
          },
        };
      } catch (error) {
        asGroupsApiError(error);
      }
    },
  });
  return route(request);
}

export const { POST, PUT, PATCH, DELETE } = createApiModule({});
