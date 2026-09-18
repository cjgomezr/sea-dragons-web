import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type Group,
  GroupNotFoundError,
  deleteGroup,
  renameGroup,
} from "@/lib/groups/groups";
import {
  asGroupsApiError,
  requireGroupsGateways,
} from "@/lib/groups/groups-api";

/**
 * Renombrar y borrar un grupo del club (FR-025, AC-012; RF-4 y RF-5 del PRD
 * de E4).
 *
 * Quién puede llamarlo lo decide la frontera, igual que la lista. El `[id]` es
 * el del grupo, y sólo alcanza a los del club de quien llama: el de otro club
 * responde 404, como uno que no existe.
 */

// Depende de la sesión de quien llama y del grupo ahora.
export const dynamic = "force-dynamic";

const renameBodySchema = z.object({ name: z.string() });

type RenameBody = z.infer<typeof renameBodySchema>;

/** El grupo con su nombre nuevo y los mismos socios. */
export type RenamedGroupResponse = Group;

type GroupRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

/** Un id que no es un uuid no puede nombrar a ningún grupo: se responde como
 * uno que no existe, sin mandarle a Postgres un valor que rechazaría. */
async function readGroupId(context: GroupRouteContext): Promise<string> {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    throw new ApiError("not_found", new GroupNotFoundError().message);
  }
  return id;
}

export function PATCH(
  request: NextRequest,
  context: GroupRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<RenamedGroupResponse, RenameBody>({
    schema: renameBodySchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const groupId = await readGroupId(context);
      try {
        return {
          data: await renameGroup(requireGroupsGateways(), {
            callerId,
            groupId,
            name: body.name,
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
  context: GroupRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<null>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const groupId = await readGroupId(context);
      try {
        await deleteGroup(requireGroupsGateways(), { callerId, groupId });
        return { status: 204 };
      } catch (error) {
        asGroupsApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, POST, PUT } = createApiModule({});
