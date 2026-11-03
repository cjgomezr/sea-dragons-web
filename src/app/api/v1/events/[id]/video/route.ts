import type { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  asEventsApiError,
  readEventId,
  requireSessionVideoGateways,
  sessionVideoSchema,
} from "@/lib/events/events-api";
import {
  type SessionVideo,
  removeSessionVideo,
  setSessionVideo,
} from "@/lib/events/session-video";

/**
 * El vídeo de YouTube de una sesión (#965, RF-4 y D8 del PRD de E37). PUT lo
 * pone o lo cambia, y repetirlo deja lo mismo; DELETE lo quita, y responde
 * 204 aunque no tuviera.
 *
 * Es de Admin, Committee y Coach: la frontera lo comprueba por el camino y
 * el dominio otra vez con el rol. Un Coach fuera de la audiencia recibe 404,
 * como con un evento de otro club o que no existe. Un enlace que no es de un
 * vídeo de YouTube es un 400 con el motivo; un PUT a un evento cancelado, un
 * 409. El vídeo se lee con el detalle del evento y con la agenda.
 */

// Depende de la sesión de quien llama.
export const dynamic = "force-dynamic";

type SessionVideoBody = z.infer<typeof sessionVideoSchema>;

/** El vídeo guardado. */
export type SessionVideoResponse = SessionVideo;

type EventVideoRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function PUT(
  request: NextRequest,
  context: EventVideoRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<SessionVideoResponse, SessionVideoBody>({
    schema: sessionVideoSchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const eventId = readEventId((await context.params).id);
      try {
        return {
          data: await setSessionVideo(requireSessionVideoGateways(), {
            callerId,
            eventId,
            url: body.url,
          }),
        };
      } catch (error) {
        asEventsApiError(error);
      }
    },
  });
  return route(request);
}

export function DELETE(
  request: NextRequest,
  context: EventVideoRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<null>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const eventId = readEventId((await context.params).id);
      try {
        await removeSessionVideo(requireSessionVideoGateways(), {
          callerId,
          eventId,
        });
        return { status: 204 };
      } catch (error) {
        asEventsApiError(error);
      }
    },
  });
  return route(request);
}

export const { GET, POST, PATCH } = createApiModule({});
