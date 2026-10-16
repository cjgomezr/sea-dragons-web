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
import {
  type EditedSeries,
  type SeriesEditDraft,
  type SeriesEditScope,
  editSeries,
} from "@/lib/events/series-management";

/**
 * Editar una serie de hoy en adelante (#315, RF-12 del PRD de E7). PATCH con
 * lo que cambia: título, tipo, hora, lugar, notas o audiencia. Cambia la
 * serie y todas sus ocurrencias futuras no canceladas, también las editadas
 * solas; las pasadas y las canceladas no se tocan. Mandar los días o la
 * fecha final sin `fromOccurrenceId` responde 400, y la fecha de inicio,
 * siempre.
 *
 * Con `fromOccurrenceId` ("esta y las siguientes", #653) la serie se parte
 * desde esa sesión y responde la serie nueva; las sesiones anteriores no
 * cambian. Si es la primera, se edita la serie entera. Una sesión que ya
 * empezó responde 422 (`occurrence_started`); una que no es de la serie, o
 * que otra partición ya se llevó, 409 (`session_not_in_series`). Desde una
 * sesión también cambian `weekdays` y `endsOn` (#654): lo que ya no encaja
 * se cancela y lo que falta se crea. Sin días es un 422
 * (`series_weekdays_empty`), y sin ninguna sesión, otro
 * (`series_without_sessions`).
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

/** Los cambios, aparte de desde dónde se edita y, al partir, con qué días
 * y fecha final. */
function readSeriesEdit(body: SeriesEditBody): {
  readonly scope: SeriesEditScope;
  readonly changes: SeriesEditDraft;
} {
  const { fromOccurrenceId, weekdays, endsOn, ...changes } = body;
  if (fromOccurrenceId === undefined) {
    return { scope: {}, changes };
  }
  const isRescheduling = weekdays !== undefined || endsOn !== undefined;
  return {
    scope: {
      fromOccurrenceId,
      schedule: isRescheduling ? { weekdays, endsOn } : undefined,
    },
    changes,
  };
}

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
      const { scope, changes } = readSeriesEdit(body);
      try {
        return {
          data: await editSeries(requireSeriesManagementGateways(), {
            ...scope,
            callerId,
            seriesId,
            changes,
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
