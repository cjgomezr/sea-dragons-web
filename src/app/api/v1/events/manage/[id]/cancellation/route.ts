import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { type ManagedEvent, cancelEvent } from "@/lib/events/event-management";
import {
  asEventsApiError,
  readEventId,
  requireEventManagementGateways,
} from "@/lib/events/events-api";

/**
 * Cancelar un evento suelto o una sola ocurrencia de una serie (#314, RF-11
 * del PRD de E7). Marca el evento y guarda la hora; no lo borra, y sus
 * respuestas se conservan para el historial de E8. Después nadie puede
 * responder (#308). No hay cuerpo que mandar.
 *
 * POST y no PUT: repetirlo no deja lo mismo, responde 422 porque el evento
 * ya está cancelado. La frontera lo reserva a Admin y Committee, y el dominio
 * lo vuelve a comprobar.
 */

// Depende de la sesión de quien llama y de la hora actual.
export const dynamic = "force-dynamic";

/** El evento ya cancelado, con la hora de la cancelación. */
export type CancelledEventResponse = ManagedEvent;

type EventCancellationRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function POST(
  request: NextRequest,
  context: EventCancellationRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<CancelledEventResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const eventId = readEventId((await context.params).id);
      try {
        return {
          data: await cancelEvent(requireEventManagementGateways(), {
            callerId,
            eventId,
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

export const { GET, PUT, PATCH, DELETE } = createApiModule({});
