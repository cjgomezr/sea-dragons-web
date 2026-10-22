import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type GroupAudience,
  listGroupAudience,
} from "@/lib/groups/group-audience";
import {
  asGroupsApiError,
  readGroupId,
  requireGroupAudienceGateways,
} from "@/lib/groups/groups-api";

/**
 * Dónde se usa un grupo (D9 del PRD de E32): los eventos y las noticias que
 * lo tienen en su audiencia ahora, para la tarjeta "Audiencia de" y el aviso
 * de borrar.
 *
 * Quién puede llamarlo lo decide la frontera, como el resto de
 * `/api/v1/groups`. Un grupo de otro club o recién borrado responde 404.
 */

// Depende de la sesión de quien llama, de la fecha de hoy y de la base.
export const dynamic = "force-dynamic";

/** Hasta cinco eventos (los sueltos de hoy en adelante y las series en pie,
 * en orden de fecha) y cinco noticias publicadas (de la más reciente a la más
 * antigua), cada lista con su total. */
export type GroupAudienceResponse = GroupAudience;

type GroupRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function GET(
  request: NextRequest,
  context: GroupRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<GroupAudienceResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const groupId = readGroupId((await context.params).id);
      try {
        return {
          data: await listGroupAudience(requireGroupAudienceGateways(), {
            callerId,
            groupId,
            now: new Date(),
          }),
        };
      } catch (error) {
        asGroupsApiError(error);
      }
    },
  });
  return route(request);
}

export const { POST, PUT, PATCH, DELETE } = createApiModule({});
