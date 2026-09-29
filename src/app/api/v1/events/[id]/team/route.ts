import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { type MyTeam, openMyTeam } from "@/lib/teams/my-team";
import {
  asTeamsApiError,
  readTeamEventId,
  requireMyTeamGateways,
} from "@/lib/teams/team-builder-api";

/**
 * El equipo de quien llama en un evento (#401, RF-8 del PRD de E10, FR-048):
 * su equipo con nombre, color y su posición, y la alineación de los dos
 * equipos con nombres y posiciones, nunca un OVR (D3). Un reparto en borrador
 * o inexistente responde `not_published`, no un 404 distinto.
 *
 * Cuelga del camino de lectura de eventos, que alcanza cualquier cuenta
 * activa; quien no ve el evento recibe 404, como en el detalle.
 */

// Depende de la sesión de quien llama y del reparto publicado.
export const dynamic = "force-dynamic";

export type MyTeamResponse = MyTeam;

type EventTeamRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function GET(
  request: NextRequest,
  context: EventTeamRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<MyTeamResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const eventId = readTeamEventId((await context.params).id);
      try {
        return {
          data: await openMyTeam(requireMyTeamGateways(), {
            callerId,
            eventId,
          }),
        };
      } catch (error) {
        asTeamsApiError(error);
      }
    },
  });
  return route(request);
}

export const { POST, PUT, PATCH, DELETE } = createApiModule({});
