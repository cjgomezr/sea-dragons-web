import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type BulkAssignment,
  type GroupRosterMember,
  assignGroupMembers,
  listGroupMembers,
} from "@/lib/groups/group-members";
import {
  asGroupsApiError,
  readGroupId,
  requireGroupMembersGateways,
} from "@/lib/groups/groups-api";
import { readApiRequestLocale } from "@/lib/i18n/request-locale";

/**
 * Los socios de un grupo (FR-026; RF-6 del PRD de E4), y añadir a varios de
 * una vez (D3 de E32).
 *
 * Quién puede llamarlo lo decide la frontera: cuelga de `/api/v1/groups`, que
 * `RESTRICTED_ROUTES` reserva a quien gestiona grupos. Un grupo de otro club
 * responde 404, como uno que no existe.
 */

// Depende de la sesión de quien llama y de las pertenencias de ahora.
export const dynamic = "force-dynamic";

/** Los socios del grupo que no están dados de baja, en orden alfabético, con
 * su posición en el idioma de quien pide y su foto firmada. Nada de la ficha
 * de contacto. */
export type GroupMembersResponse = {
  readonly members: readonly GroupRosterMember[];
};

/** Los ids viajan a la base en el filtro de una URL: el tope la mantiene
 * corta. Un club tiene decenas de socios, no cientos. */
const MAX_MEMBERS_PER_REQUEST = 200;

const bulkAssignmentSchema = z.object({
  userIds: z.array(z.uuid()).min(1).max(MAX_MEMBERS_PER_REQUEST),
});

type BulkAssignmentBody = z.infer<typeof bulkAssignmentSchema>;

/** La lista del grupo y los candidatos ya actualizados, con los mismos campos
 * que sus `GET`, y quién no entró y por qué. Quien ya estaba no es un
 * rechazo. */
export type BulkAssignmentResponse = BulkAssignment;

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
              locale: readApiRequestLocale(apiRequest),
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

export function POST(
  request: NextRequest,
  context: GroupRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<BulkAssignmentResponse, BulkAssignmentBody>({
    schema: bulkAssignmentSchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const groupId = readGroupId((await context.params).id);
      try {
        return {
          data: await assignGroupMembers(requireGroupMembersGateways(), {
            callerId,
            groupId,
            userIds: body.userIds,
            locale: readApiRequestLocale(apiRequest),
          }),
        };
      } catch (error) {
        asGroupsApiError(error);
      }
    },
  });
  return route(request);
}

export const { PUT, PATCH, DELETE } = createApiModule({});
