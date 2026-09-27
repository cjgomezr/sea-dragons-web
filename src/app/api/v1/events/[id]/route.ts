import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { type EventDetail, openEvent } from "@/lib/events/event-agenda";
import {
  asEventsApiError,
  readEventId,
  requireEventAgendaGateways,
} from "@/lib/events/events-api";

/**
 * Un evento desplegado (#309, RF-6 y RF-8 del PRD de E7): lo de la agenda
 * más las notas y los nombres de quién va y quién quizás. A Admin y
 * Committee les llega además la audiencia.
 *
 * Quien no es su audiencia recibe 404, no 403, igual que con uno de otro
 * club o que no existe (AC-052): con un 403 distinto se podrían recorrer ids
 * y enumerar qué eventos tiene el club.
 */

// Depende de la sesión de quien llama y de las respuestas ahora.
export const dynamic = "force-dynamic";

export type EventDetailResponse = EventDetail;

type EventRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function GET(
  request: NextRequest,
  context: EventRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<EventDetailResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const eventId = readEventId((await context.params).id);
      try {
        return {
          data: await openEvent(requireEventAgendaGateways(), {
            callerId,
            eventId,
          }),
        };
      } catch (error) {
        asEventsApiError(error);
      }
    },
  });
  return route(request);
}

export const { POST, PUT, PATCH, DELETE } = createApiModule({});
