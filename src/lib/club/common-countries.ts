import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { type CountryCode, toCountryCode } from "@/lib/geo/countries";
import { findAdministrator } from "./club-settings";

/**
 * Los países más comunes entre los socios del club (#864, RF-11 y D15 del PRD
 * de E33): el panel de invitar los propone antes de la lista entera, porque
 * suelen ser los que elige el Admin. Se calculan en cada petición; guardarlos
 * queda fuera de alcance.
 */

/** Los que caben en el grupo de arriba del selector sin tapar la lista. */
export const COMMON_COUNTRIES_LIMIT = 4;

/** El club es de Melbourne, como dice `CLUB_TIME_ZONE`. Release 1 opera un
 * solo club (CON-004), así que su país no vive en `clubs` todavía. */
export const CLUB_HOME_COUNTRY: CountryCode = "AU";

export type CommonCountriesGateways = {
  readonly members: Pick<
    RoleRequestGateways["members"],
    "findRoleRequestMember"
  >;
  readonly countries: {
    /** El país guardado de cada socio del club que lo tiene, repetido tantas
     * veces como socios. */
    listMemberCountries(clubId: string): Promise<readonly string[]>;
  };
};

function countByCode(countries: readonly string[]): Map<CountryCode, number> {
  const counts = new Map<CountryCode, number>();
  for (const country of countries) {
    const code = toCountryCode(country);
    if (code !== null) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return counts;
}

/** De más a menos frecuente y, a igual frecuencia, por código, para que el
 * orden no cambie entre dos peticiones. Sin ningún país guardado propone el
 * del club, que es el que tendrá casi cualquier socio nuevo. */
export function rankCommonCountries(
  countries: readonly string[],
): readonly CountryCode[] {
  const ranked = [...countByCode(countries)]
    .sort(
      ([firstCode, firstCount], [secondCode, secondCount]) =>
        secondCount - firstCount || firstCode.localeCompare(secondCode),
    )
    .slice(0, COMMON_COUNTRIES_LIMIT)
    .map(([code]) => code);
  return ranked.length === 0 ? [CLUB_HOME_COUNTRY] : ranked;
}

/** Sólo para un Admin, que es quien invita: la frontera ya lo comprobó por
 * la ruta y esto es el cerrojo del propio dominio. */
export async function readCommonCountries(
  gateways: CommonCountriesGateways,
  callerId: string,
): Promise<readonly CountryCode[]> {
  const caller = await findAdministrator(gateways, callerId);
  return rankCommonCountries(
    await gateways.countries.listMemberCountries(caller.clubId),
  );
}
