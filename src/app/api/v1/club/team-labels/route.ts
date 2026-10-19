import type { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  changeClubTeamLabels,
  clubTeamLabelsSchema,
  readClubTeamLabels,
} from "@/lib/teams/club-team-labels";
import type { TeamLabels } from "@/lib/teams/team-builder";
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
 * campo.
 */

// Depende de la sesión de quien llama y de lo que el club tiene guardado.
export const dynamic = "force-dynamic";

type ClubTeamLabelsBody = z.infer<typeof clubTeamLabelsSchema>;

export type ClubTeamLabelsResponse = TeamLabels;

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
  ClubTeamLabelsResponse,
  ClubTeamLabelsBody
>({
  schema: clubTeamLabelsSchema,
  handler: async ({ request, body, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await changeClubTeamLabels(requireTeamBuilderGateways(), {
          callerId,
          teams: body,
        }),
      };
    } catch (error) {
      asTeamsApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getClubTeamLabels,
  PATCH: patchClubTeamLabels,
});
