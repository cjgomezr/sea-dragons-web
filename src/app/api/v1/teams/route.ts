import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  type BuildableEvents,
  listBuildableEvents,
} from "@/lib/teams/buildable-events";
import {
  asTeamsApiError,
  requireTeamBuilderGateways,
} from "@/lib/teams/team-builder-api";

/**
 * Los eventos que se pueden armar (#402, RF-9 del PRD de E10): los
 * entrenamientos y competiciones del club no cancelados, de hoy en adelante,
 * del más cercano al más lejano. Es lo que la pantalla de Equipos ofrece
 * para elegir antes de abrir la escuadra de uno.
 *
 * `RESTRICTED_ROUTES` reserva este camino a Admin y Coach, y el dominio lo
 * vuelve a comprobar.
 */

// Depende de la sesión de quien llama y del día de hoy.
export const dynamic = "force-dynamic";

export type BuildableEventsResponse = BuildableEvents;

const getBuildableEvents = createApiRoute<BuildableEventsResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await listBuildableEvents(requireTeamBuilderGateways(), {
          callerId,
          now: new Date(),
        }),
      };
    } catch (error) {
      asTeamsApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getBuildableEvents,
});
