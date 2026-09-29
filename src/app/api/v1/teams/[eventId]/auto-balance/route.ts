import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type AutoBalancedSplit,
  autoBalanceEventTeams,
} from "@/lib/teams/team-builder";
import {
  asTeamsApiError,
  readTeamEventId,
  requireTeamBuilderGateways,
} from "@/lib/teams/team-builder-api";

/**
 * El auto-balance de un evento (#401, RF-5 del PRD de E10, FR-046). El
 * servidor reparte los "Sí" con el algoritmo de C2, guarda el reparto en
 * borrador con modo `auto` y responde los dos equipos, los totales, la
 * sugerencia de intercambio y la marca de no evaluado de cada jugador. No hay
 * cuerpo que mandar.
 *
 * POST y no PUT: lo que queda depende de las respuestas y las notas del
 * momento, no de la petición. Una escuadra vacía es un 422.
 */

// Depende de la sesión de quien llama, de la hora y de las respuestas.
export const dynamic = "force-dynamic";

export type AutoBalancedSplitResponse = AutoBalancedSplit;

type AutoBalanceRouteContext = {
  readonly params: Promise<{ readonly eventId: string }>;
};

export function POST(
  request: NextRequest,
  context: AutoBalanceRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<AutoBalancedSplitResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const eventId = readTeamEventId((await context.params).eventId);
      try {
        return {
          data: await autoBalanceEventTeams(requireTeamBuilderGateways(), {
            callerId,
            eventId,
            now: new Date(),
          }),
        };
      } catch (error) {
        asTeamsApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
