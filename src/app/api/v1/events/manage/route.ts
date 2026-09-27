import type { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { type CreatedEvents, createEvents } from "@/lib/events/event-creation";
import {
  asEventsApiError,
  eventDraftSchema,
  requireEventGateways,
} from "@/lib/events/events-api";

/**
 * Crear un evento suelto o una serie semanal con todas sus ocurrencias (#307,
 * RF-2 y RF-3 del PRD de E7, FR-028 a FR-031).
 *
 * Quién puede llamarlo lo decide la frontera: `RESTRICTED_ROUTES` lo reserva
 * a Admin y Committee, y el dominio lo vuelve a comprobar. El autor y el club
 * salen de la sesión, nunca del cuerpo.
 */

// Depende de la sesión de quien llama.
export const dynamic = "force-dynamic";

type EventDraftBody = z.infer<typeof eventDraftSchema>;

/** El evento suelto, o la serie con el id y la fecha de cada ocurrencia. */
export type CreatedEventsResponse = CreatedEvents;

const postEvents = createApiRoute<CreatedEventsResponse, EventDraftBody>({
  schema: eventDraftSchema,
  handler: async ({ request, body, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await createEvents(requireEventGateways(), {
          callerId,
          draft: body,
          now: new Date(),
        }),
        status: 201,
      };
    } catch (error) {
      asEventsApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postEvents,
});
