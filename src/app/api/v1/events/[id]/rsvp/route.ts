import type { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { type EventRsvp, respondToEvent } from "@/lib/events/event-rsvp";
import {
  asEventsApiError,
  eventRsvpSchema,
  readEventId,
  requireEventRsvpGateways,
} from "@/lib/events/events-api";

/**
 * Responder Sí, Quizás o No a una ocurrencia (#308, RF-5 del PRD de E7,
 * FR-034 y FR-035). PUT porque repetirlo deja lo mismo: la respuesta nueva
 * reescribe la anterior, y un doble toque no duplica nada.
 *
 * Lo alcanza cualquier cuenta activa. Quien no es la audiencia del evento
 * recibe 404, igual que con uno de otro club o que no existe; uno cancelado o
 * que ya empezó, según la hora del servidor, responde 422.
 */

// Depende de la sesión de quien llama y de la hora actual.
export const dynamic = "force-dynamic";

type EventRsvpBody = z.infer<typeof eventRsvpSchema>;

/** La respuesta guardada, con la hora de la última. */
export type EventRsvpResponse = EventRsvp;

type EventRsvpRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function PUT(
  request: NextRequest,
  context: EventRsvpRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<EventRsvpResponse, EventRsvpBody>({
    schema: eventRsvpSchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const eventId = readEventId((await context.params).id);
      try {
        return {
          data: await respondToEvent(requireEventRsvpGateways(), {
            callerId,
            eventId,
            response: body.response,
            now: new Date(),
          }),
        };
      } catch (error) {
        asEventsApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, POST, PATCH, DELETE } = createApiModule({});
