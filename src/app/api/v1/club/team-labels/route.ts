import type { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  changeClubTeamLabels,
  clubTeamLabelsChangeSchema,
  readClubTeamLabels,
} from "@/lib/teams/club-team-labels";
import type { TeamLabels } from "@/lib/teams/team-builder";
import type { EventSplitLabels } from "@/lib/teams/team-ids";
import {
  asTeamsApiError,
  requireTeamBuilderGateways,
} from "@/lib/teams/team-builder-api";

/**
 * El nombre y el color de los dos equipos del club (#755, RF-1 y D1 a D3 del
 * PRD de E28). GET los lee y PATCH los cambia; los dos responden los equipos
 * del club. Un reparto nuevo y el auto-balance estrenan éstos; un reparto ya
 * guardado conserva los suyos (D4).
 *
 * `RESTRICTED_ROUTES` reserva este camino a Admin y Coach, y el dominio lo
 * vuelve a comprobar. Un nombre vacío o de más de 24 caracteres, un color
 * fuera del muestrario o los dos colores iguales son un 400 que nombra el
 * campo. Con `eventId`, el cambio también llega al reparto de ese evento si
 * está guardado y sin publicar (D4).
 */

// Depende de la sesión de quien llama y de lo que el club tiene guardado.
export const dynamic = "force-dynamic";

type ClubTeamLabelsBody = z.infer<typeof clubTeamLabelsChangeSchema>;

export type ClubTeamLabelsResponse = TeamLabels;

/** Los equipos que quedaron y qué pasó con el reparto del evento, si el
 * cambio llegó desde su builder. */
export type ClubTeamLabelsChangeResponse = TeamLabels & {
  readonly eventSplit: EventSplitLabels;
};

const getClubTeamLabels = createApiRoute<ClubTeamLabelsResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await readClubTeamLabels(requireTeamBuilderGateways(), callerId),
      };
    } catch (error) {
      asTeamsApiError(error);
    }
  },
});

const patchClubTeamLabels = createApiRoute<
  ClubTeamLabelsChangeResponse,
  ClubTeamLabelsBody
>({
  schema: clubTeamLabelsChangeSchema,
  handler: async ({ request, body, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      const change = await changeClubTeamLabels(requireTeamBuilderGateways(), {
        callerId,
        teams: { a: body.a, b: body.b },
        eventId: body.eventId,
      });
      return { data: { ...change.teams, eventSplit: change.eventSplit } };
    } catch (error) {
      asTeamsApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getClubTeamLabels,
  PATCH: patchClubTeamLabels,
});
