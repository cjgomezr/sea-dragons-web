import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  createPosition,
  listManagedPositions,
} from "@/lib/club/manage-club-positions";
import {
  type ManagedPositionsResponse,
  asManagedPositionsApiError,
  positionNamesBodySchema,
  positionsChanged,
  requireManagedPositionsGateways,
} from "@/lib/club/manage-club-positions-api";

/**
 * Las posiciones del club tal como las administra el Admin (#300, RF-7 del
 * PRD de E18a): GET las lista todas, archivadas incluidas, y POST crea una.
 *
 * Quién puede llamarlo lo decide la frontera: `RESTRICTED_ROUTES` lo reserva
 * al Admin, y el dominio lo vuelve a comprobar. El club sale de la fila de
 * quien llama, nunca de un parámetro (NFR-009).
 */

// Depende de la sesión de quien llama y del catálogo del club ahora.
export const dynamic = "force-dynamic";

const createBodySchema = z.object({ names: positionNamesBodySchema }).strict();

type CreateBody = z.infer<typeof createBodySchema>;

const getPositions = createApiRoute<ManagedPositionsResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: {
          positions: await listManagedPositions(
            requireManagedPositionsGateways(),
            callerId,
          ),
        },
      };
    } catch (error) {
      asManagedPositionsApiError(error);
    }
  },
});

const postPosition = createApiRoute<ManagedPositionsResponse, CreateBody>({
  schema: createBodySchema,
  handler: async ({ request, body, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      const positions = await createPosition(
        requireManagedPositionsGateways(),
        { callerId, names: body.names },
      );
      return { data: positionsChanged(positions), status: 201 };
    } catch (error) {
      asManagedPositionsApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getPositions,
  POST: postPosition,
});
