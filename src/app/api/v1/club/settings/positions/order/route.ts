import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { reorderPositions } from "@/lib/club/manage-club-positions";
import {
  type ManagedPositionsResponse,
  asManagedPositionsApiError,
  positionsChanged,
  requireManagedPositionsGateways,
} from "@/lib/club/manage-club-positions-api";

/**
 * Reordenar las posiciones del club (#300): PUT con la lista entera de las
 * activas en el orden nuevo, no un movimiento por petición. Si otro Admin
 * cambió las activas entretanto, responde 409 y no toca nada.
 *
 * Es sólo del Admin, como todo lo que cuelga de la configuración del club.
 */

// Depende de la sesión de quien llama y del catálogo del club ahora.
export const dynamic = "force-dynamic";

/** Un tope holgado: ningún club tiene tantas posiciones. */
const MAX_POSITIONS_IN_ORDER = 200;

const orderBodySchema = z
  .object({ positionIds: z.array(z.uuid()).max(MAX_POSITIONS_IN_ORDER) })
  .strict();

type OrderBody = z.infer<typeof orderBodySchema>;

const putOrder = createApiRoute<ManagedPositionsResponse, OrderBody>({
  schema: orderBodySchema,
  handler: async ({ request, body, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      const positions = await reorderPositions(
        requireManagedPositionsGateways(),
        { callerId, positionIds: body.positionIds },
      );
      return { data: positionsChanged(positions) };
    } catch (error) {
      asManagedPositionsApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  PUT: putOrder,
});
