import type { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { type ManagedEvent, editEvent } from "@/lib/events/event-management";
import {
  asEventsApiError,
  eventEditSchema,
  readEventId,
  requireEventManagementGateways,
} from "@/lib/events/events-api";

/**
 * Editar un evento suelto o una sola ocurrencia de una serie (#314, RF-11 del
 * PRD de E7). PATCH con lo que cambia: lo que no viene se queda igual, y una
 * audiencia nueva sustituye entera a la anterior. Las respuestas se
 * conservan. Si dos organizadores guardan a la vez, queda lo del último.
 *
 * La frontera lo reserva a Admin y Committee, y el dominio lo vuelve a
 * comprobar. Un evento de otro club o que no existe responde 404; uno
 * cancelado o que ya empezó, 422.
 */

// Depende de la sesión de quien llama y de la hora actual.
export const dynamic = "force-dynamic";

/** El evento como quedó guardado. */
export type EditedEventResponse = ManagedEvent;

type EventEditBody = z.infer<typeof eventEditSchema>;

type EventManageRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function PATCH(
  request: NextRequest,
  context: EventManageRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<EditedEventResponse, EventEditBody>({
    schema: eventEditSchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const eventId = readEventId((await context.params).id);
      try {
        return {
          data: await editEvent(requireEventManagementGateways(), {
            callerId,
            eventId,
            changes: body,
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

export const { GET, POST, PUT, DELETE } = createApiModule({});
