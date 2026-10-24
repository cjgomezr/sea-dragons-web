import { z } from "zod";
import {
  type ApiRequestFailure,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { CLUB_COMMON_COUNTRIES_API_PATH } from "@/lib/auth/routes";
import { COUNTRY_CODES, type CountryCode } from "@/lib/geo/countries";

/**
 * Los países más comunes del club tal como llegan de la API (#864): el panel
 * de invitar los propone primero en el selector de país.
 */

const responseSchema = z.object({
  data: z.object({ countries: z.array(z.enum(COUNTRY_CODES)) }),
});

export type CommonCountriesLoad =
  | {
      readonly kind: "loaded";
      readonly countries: readonly CountryCode[];
    }
  | ApiRequestFailure;

/** Nunca rechaza: un fallo de red o un cuerpo que no cuadra salen como
 * fallo, igual que en `loadPositionChoices`. */
export async function loadCommonCountries(): Promise<CommonCountriesLoad> {
  const read = readApiPayload(
    await requestApi(CLUB_COMMON_COUNTRIES_API_PATH),
    responseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", countries: read.value.data.countries };
}
