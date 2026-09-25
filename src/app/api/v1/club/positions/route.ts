import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  type NamedPosition,
  type PositionChoicesGateways,
  listPositionChoices,
} from "@/lib/club/club-positions";
import { createSupabasePositionChoicesGateways } from "@/lib/club/supabase-club-positions";

/**
 * Las posiciones que se pueden elegir en el club de quien llama (#299, RF-7
 * del PRD de E18a): las activas, en el orden del club, con un nombre por
 * idioma. La pantalla elige el del idioma en que se lee.
 *
 * Lo alcanza cualquier cuenta activa. El club sale de la fila de quien llama,
 * nunca de un parámetro (NFR-009).
 */

// Depende de la sesión de quien llama y del catálogo del club.
export const dynamic = "force-dynamic";

export type ClubPositionsResponse = {
  readonly positions: readonly NamedPosition[];
};

function requirePositionChoicesGateways(): PositionChoicesGateways {
  const wiring = createSupabasePositionChoicesGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

const getClubPositions = createApiRoute<ClubPositionsResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: {
          positions: await listPositionChoices(
            requirePositionChoicesGateways(),
            callerId,
          ),
        },
      };
    } catch (error) {
      asAccountApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getClubPositions,
});
