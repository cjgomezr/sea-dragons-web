import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type GroupMember,
  assignGroupMember,
  removeGroupMember,
} from "@/lib/groups/group-members";
import {
  asGroupsApiError,
  readGroupId,
  readMemberId,
  requireGroupMembersGateways,
} from "@/lib/groups/groups-api";

/**
 * Meter y sacar a un socio de un grupo (FR-026, AC-049; RF-6 y RF-7 del PRD
 * de E4).
 *
 * Los dos son idempotentes, por eso `PUT` y no `POST`: asignar otra vez
 * responde 200 sin duplicar, y quitar a quien no estaba responde 204. Un grupo
 * o un socio de otro club, o que no existen, responden 404; un socio dado de
 * baja no se asigna (422). Quién puede llamarlo lo decide la frontera, como el
 * resto de `/api/v1/groups`.
 */

// Escribe en la base según la sesión de quien llama.
export const dynamic = "force-dynamic";

/** El socio recién asignado, para sumarlo a la lista sin volver a pedirla. */
export type AssignedGroupMemberResponse = GroupMember;

type MembershipRouteContext = {
  readonly params: Promise<{ readonly id: string; readonly userId: string }>;
};

type MembershipIds = { readonly groupId: string; readonly userId: string };

async function readMembershipIds(
  context: MembershipRouteContext,
): Promise<MembershipIds> {
  const { id, userId } = await context.params;
  return { groupId: readGroupId(id), userId: readMemberId(userId) };
}

export function PUT(
  request: NextRequest,
  context: MembershipRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<AssignedGroupMemberResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const ids = await readMembershipIds(context);
      try {
        return {
          data: await assignGroupMember(requireGroupMembersGateways(), {
            callerId,
            ...ids,
          }),
        };
      } catch (error) {
        asGroupsApiError(error);
      }
    },
  });
  return route(request);
}

export function DELETE(
  request: NextRequest,
  context: MembershipRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<null>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const ids = await readMembershipIds(context);
      try {
        await removeGroupMember(requireGroupMembersGateways(), {
          callerId,
          ...ids,
        });
        return { status: 204 };
      } catch (error) {
        asGroupsApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, POST, PATCH } = createApiModule({});
