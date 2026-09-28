import type { NextRequest, NextResponse } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  asEventsApiError,
  readSeriesId,
  requireSeriesManagementGateways,
} from "@/lib/events/events-api";
import {
  type CancelledSeries,
  cancelSeries,
} from "@/lib/events/series-management";

/**
 * Cancelar una serie de hoy en adelante (#315, RF-12 del PRD de E7). Marca
 * canceladas todas sus ocurrencias futuras, con la hora; no las borra, y sus
 * respuestas se conservan para el historial de E8. Las pasadas no se tocan.
 * No hay cuerpo que mandar.
 *
 * POST y no PUT: repetirlo no deja lo mismo, responde 422 porque ya no
 * quedan ocurrencias futuras. La frontera lo reserva a Admin y Committee, y
 * el dominio lo vuelve a comprobar.
 */

// Depende de la sesión de quien llama y de la hora actual.
export const dynamic = "force-dynamic";

/** La hora de la cancelación y cuántas ocurrencias canceló. */
export type CancelledSeriesResponse = CancelledSeries;

type SeriesCancellationRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function POST(
  request: NextRequest,
  context: SeriesCancellationRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<CancelledSeriesResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const seriesId = readSeriesId((await context.params).id);
      try {
        return {
          data: await cancelSeries(requireSeriesManagementGateways(), {
            callerId,
            seriesId,
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
