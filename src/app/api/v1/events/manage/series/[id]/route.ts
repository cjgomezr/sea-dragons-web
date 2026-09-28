import type { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  asEventsApiError,
  readSeriesId,
  requireSeriesManagementGateways,
  seriesEditSchema,
} from "@/lib/events/events-api";
import { type EditedSeries, editSeries } from "@/lib/events/series-management";

/**
 * Editar una serie de hoy en adelante (#315, RF-12 del PRD de E7). PATCH con
 * lo que cambia: título, tipo, hora, lugar, notas o audiencia. Cambia la
 * serie y todas sus ocurrencias futuras no canceladas, también las editadas
 * solas; las pasadas y las canceladas no se tocan. Mandar los días o las
 * fechas responde 400: para eso se cancela el resto y se crea otra.
 *
 * La frontera lo reserva a Admin y Committee, y el dominio lo vuelve a
 * comprobar. Una serie de otro club o que no existe responde 404; una sin
 * ocurrencias futuras, 422.
 */

// Depende de la sesión de quien llama y de la hora actual.
export const dynamic = "force-dynamic";

/** La serie como quedó guardada y cuántas ocurrencias cambiaron. */
export type EditedSeriesResponse = EditedSeries;

type SeriesEditBody = z.infer<typeof seriesEditSchema>;

type SeriesManageRouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export function PATCH(
  request: NextRequest,
  context: SeriesManageRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<EditedSeriesResponse, SeriesEditBody>({
    schema: seriesEditSchema,
    handler: async ({ request: apiRequest, body, decorateResponse }) => {
      const callerId = await identifyAccountCaller({
        request: apiRequest,
        decorateResponse,
      });
      const seriesId = readSeriesId((await context.params).id);
      try {
        return {
          data: await editSeries(requireSeriesManagementGateways(), {
            callerId,
            seriesId,
            changes: body,
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
