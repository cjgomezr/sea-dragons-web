import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type GroupMember,
  listGroupCandidates,
} from "@/lib/groups/group-members";
import {
  asGroupsApiError,
  readGroupId,
  requireGroupMembersGateways,
} from "@/lib/groups/groups-api";

/**
 * A quién se puede agregar a un grupo (RF-6 del PRD de E4).
 *
 * Coach y Committee no pueden leer `GET /api/v1/members`, que es de Admin, así
 * que esta es su lista para elegir: sólo id y nombre, sin correo ni ningún
 * otro dato de la ficha. Quién puede llamarlo lo decide la frontera, como el
 * resto de `/api/v1/groups`.
 */

// Depende de la sesión de quien llama y de los socios de ahora.
export const dynamic = "force-dynamic";

/** Los socios del club que no están en el grupo ni dados de baja, en orden
 * alfabético. */
export type GroupCandidatesResponse = {
  readonly candidates: readonly GroupMember[];
};

type GroupRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function GET(
  request: NextRequest,
  context: GroupRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<GroupCandidatesResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const groupId = readGroupId((await context.params).id);
      try {
        return {
          data: {
            candidates: await listGroupCandidates(
              requireGroupMembersGateways(),
              { callerId, groupId },
            ),
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
