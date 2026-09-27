import { z } from "zod";
import { ApiError } from "@/lib/api/response";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  AGENDA_PERIODS,
  type AgendaPage,
  type AgendaPeriod,
  listAgenda,
} from "@/lib/events/event-agenda";
import {
  asEventsApiError,
  requireEventAgendaGateways,
} from "@/lib/events/events-api";

/**
 * La agenda de quien llama (#309, RF-4, RF-6 y RF-7 del PRD de E7): los
 * eventos de hoy en adelante, o los pasados con `?period=past`, de 50 en 50.
 * La siguiente página se pide con `?cursor=` y el `nextCursor` de la
 * anterior.
 *
 * Lo alcanza cualquier cuenta activa. Admin y Committee reciben todos los
 * eventos del club; los demás, sólo los de su audiencia. Crear eventos no
 * cuelga de aquí sino de `/api/v1/events/manage`.
 */

// Depende de la sesión de quien llama y de la fecha de hoy.
export const dynamic = "force-dynamic";

const PERIOD_PARAM = "period";
const CURSOR_PARAM = "cursor";
const DEFAULT_PERIOD: AgendaPeriod = "upcoming";

const periodSchema = z.enum(AGENDA_PERIODS);

export type EventAgendaResponse = AgendaPage;

function readPeriod(value: string | null): AgendaPeriod {
  if (value === null) {
    return DEFAULT_PERIOD;
  }
  const parsed = periodSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      "validation_error",
      `El periodo tiene que ser uno de: ${AGENDA_PERIODS.join(", ")}.`,
    );
  }
  return parsed.data;
}

const getAgenda = createApiRoute<EventAgendaResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    const params = request.nextUrl.searchParams;
    const period = readPeriod(params.get(PERIOD_PARAM));
    const cursor = params.get(CURSOR_PARAM);
    try {
      return {
        data: await listAgenda(requireEventAgendaGateways(), {
          callerId,
          period,
          now: new Date(),
          ...(cursor === null ? {} : { cursor }),
        }),
      };
    } catch (error) {
      asEventsApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getAgenda,
});
