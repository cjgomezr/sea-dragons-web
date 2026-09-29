import type { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type SavedTeamSplit,
  type TeamBuilder,
  openTeamBuilder,
  saveTeamSplit,
} from "@/lib/teams/team-builder";
import {
  asTeamsApiError,
  readTeamEventId,
  requireTeamBuilderGateways,
  teamSplitSchema,
} from "@/lib/teams/team-builder-api";

/**
 * La escuadra y el reparto de un evento (#401, RF-3 y RF-4 del PRD de E10).
 * GET abre el builder: los "Sí" disponibles, los "Quizás" aparte, cada uno con
 * su OVR, y el reparto guardado si lo hay. PUT guarda el reparto entero a
 * mano, en borrador y sin avisar a nadie. PUT porque repetirlo deja lo mismo:
 * el reparto nuevo sustituye al anterior.
 *
 * `RESTRICTED_ROUTES` reserva este camino a Admin y Coach, y el dominio lo
 * vuelve a comprobar. Un evento de otro club o que no existe es un 404; una
 * reunión o un social, uno pasado según el día de Melbourne o uno cancelado,
 * un 422 con su `reason` (D2).
 */

// Depende de la sesión de quien llama, de la hora y de las respuestas.
export const dynamic = "force-dynamic";

type TeamSplitBody = z.infer<typeof teamSplitSchema>;

export type TeamBuilderResponse = TeamBuilder;

/** Lo que quedó guardado: el modo y cuántos quedaron asignados. */
export type SavedTeamSplitResponse = SavedTeamSplit;

type TeamBuilderRouteContext = {
  readonly params: Promise<{ readonly eventId: string }>;
};

export function GET(
  request: NextRequest,
  context: TeamBuilderRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<TeamBuilderResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const eventId = readTeamEventId((await context.params).eventId);
      try {
        return {
          data: await openTeamBuilder(requireTeamBuilderGateways(), {
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

export function PUT(
  request: NextRequest,
  context: TeamBuilderRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<SavedTeamSplitResponse, TeamSplitBody>({
    schema: teamSplitSchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const eventId = readTeamEventId((await context.params).eventId);
      try {
        return {
          data: await saveTeamSplit(requireTeamBuilderGateways(), {
            callerId,
            eventId,
            teams: body.teams,
            assignments: body.assignments,
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

export const { POST, PATCH, DELETE } = createApiModule({});
