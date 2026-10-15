import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { asEventsApiError } from "@/lib/events/events-api";
import {
  PLACE_QUERY_MAX_LENGTH,
  type PlaceSearchGateways,
  type PlaceSuggestions,
  suggestPlaces,
} from "@/lib/events/place-search";
import { createSupabasePlaceSearchGateways } from "@/lib/events/supabase-place-search-gateways";

/**
 * Buscar un lugar para un evento (#646, RF-5 y D1 del PRD de E24):
 * `?q=princes` responde primero los lugares que el club ya usó y después
 * hasta 3 de Photon. Sin `q`, o con menos de 3 caracteres, los 5 del club
 * más usados. La espera entre teclas la pone quien llama (#652).
 *
 * Sólo lo alcanzan Admin y Committee (`createEvents`): la frontera lo
 * decide por el camino y el dominio lo vuelve a comprobar.
 */

// Depende de la sesión de quien llama y del club al que pertenece.
export const dynamic = "force-dynamic";

const QUERY_PARAM = "q";

const querySchema = z.string().max(PLACE_QUERY_MAX_LENGTH);

export type EventPlacesResponse = PlaceSuggestions;

function readQuery(value: string | null): string {
  const parsed = querySchema.safeParse(value ?? "");
  if (!parsed.success) {
    throw new ApiError(
      "validation_error",
      `La búsqueda admite hasta ${PLACE_QUERY_MAX_LENGTH} caracteres.`,
    );
  }
  return parsed.data;
}

function requirePlaceSearchGateways(): PlaceSearchGateways {
  const wiring = createSupabasePlaceSearchGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

const getPlaces = createApiRoute<EventPlacesResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    const query = readQuery(request.nextUrl.searchParams.get(QUERY_PARAM));
    try {
      return {
        data: await suggestPlaces(requirePlaceSearchGateways(), {
          callerId,
          query,
        }),
      };
    } catch (error) {
      asEventsApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getPlaces,
});
