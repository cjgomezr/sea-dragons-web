import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  InvalidSearchTextError,
  type SearchGateways,
  type SearchResults,
  searchClub,
} from "@/lib/search/search";
import { createSupabaseSearchGateways } from "@/lib/search/supabase-search-gateways";

/**
 * La búsqueda global (#425, RF-7 del PRD de E14, CON-002):
 * `GET /api/v1/search?q=` devuelve socios, eventos y noticias, hasta cinco de
 * cada uno con el total, y sólo lo que quien busca vería en cada sección.
 */

// Depende de la sesión de quien llama y del estado actual del club.
export const dynamic = "force-dynamic";

const SEARCH_QUERY_PARAM = "q";

export type SearchResponse = SearchResults;

function requireSearchGateways(): SearchGateways {
  const wiring = createSupabaseSearchGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

function asSearchApiError(error: unknown): never {
  if (error instanceof InvalidSearchTextError) {
    throw new ApiError("validation_error", error.message, error.reason);
  }
  return asAccountApiError(error);
}

const getSearch = createApiRoute<SearchResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: await searchClub(requireSearchGateways(), {
          callerId,
          text: request.nextUrl.searchParams.get(SEARCH_QUERY_PARAM) ?? "",
          now: new Date(),
        }),
      };
    } catch (error) {
      return asSearchApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getSearch,
});
