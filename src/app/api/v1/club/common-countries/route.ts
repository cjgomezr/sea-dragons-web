import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  asAccountApiError,
  identifyAccountCaller,
} from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { ClubSettingsForbiddenError } from "@/lib/club/club-settings";
import {
  type CommonCountriesGateways,
  readCommonCountries,
} from "@/lib/club/common-countries";
import { createSupabaseCommonCountriesGateways } from "@/lib/club/supabase-common-countries";
import type { CountryCode } from "@/lib/geo/countries";

/**
 * Los países más comunes entre los socios del club de quien llama (#864,
 * RF-11 y D15 del PRD de E33): hasta cuatro, de más a menos, o el país del
 * club si ningún socio lo tiene guardado. El panel de invitar los pone primero
 * en el selector de país.
 *
 * `RESTRICTED_ROUTES` lo reserva al Admin, y el dominio lo vuelve a
 * comprobar. El club sale de la fila de quien llama, nunca de un parámetro
 * (NFR-009).
 */

// Depende de la sesión de quien llama y de los socios del club ahora.
export const dynamic = "force-dynamic";

export type ClubCommonCountriesResponse = {
  readonly countries: readonly CountryCode[];
};

function requireCommonCountriesGateways(): CommonCountriesGateways {
  const wiring = createSupabaseCommonCountriesGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

function asCommonCountriesApiError(error: unknown): never {
  if (error instanceof ClubSettingsForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  return asAccountApiError(error);
}

const getClubCommonCountries = createApiRoute<ClubCommonCountriesResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: {
          countries: await readCommonCountries(
            requireCommonCountriesGateways(),
            callerId,
          ),
        },
      };
    } catch (error) {
      asCommonCountriesApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getClubCommonCountries,
});
