import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type PublishedTeamSplit,
  publishTeamSplit,
} from "@/lib/teams/team-publication";
import {
  asTeamsApiError,
  readTeamEventId,
  requireTeamBuilderGateways,
} from "@/lib/teams/team-builder-api";

/**
 * Publicar el reparto de un evento (#401, RF-7 del PRD de E10, FR-049,
 * AC-020). Cada asignado que entra o cambia de equipo recibe `team_assigned`
 * y quien sale `team_unassigned`; quien publica no se avisa a sí mismo (D6).
 * Un reparto vacío o inexistente es un 422. No hay cuerpo que mandar.
 *
 * Responde 201: crea una publicación, con su fecha y su entrada en la
 * bitácora.
 */

// Depende de la sesión de quien llama y del reparto guardado.
export const dynamic = "force-dynamic";

const CREATED_STATUS = 201;

export type PublishedTeamSplitResponse = PublishedTeamSplit;

type PublicationRouteContext = {
  readonly params: Promise<{ readonly eventId: string }>;
};

export function POST(
  request: NextRequest,
  context: PublicationRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<PublishedTeamSplitResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const eventId = readTeamEventId((await context.params).eventId);
      try {
        return {
          data: await publishTeamSplit(requireTeamBuilderGateways(), {
            callerId,
            eventId,
            now: new Date(),
          }),
          status: CREATED_STATUS,
        };
      } catch (error) {
        asTeamsApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
