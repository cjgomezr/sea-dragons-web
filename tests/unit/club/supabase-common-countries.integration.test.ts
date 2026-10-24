import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  CLUB_HOME_COUNTRY,
  rankCommonCountries,
} from "@/lib/club/common-countries";
import { createCommonCountriesGateways } from "@/lib/club/supabase-common-countries";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * Los países más comunes del club contra `seadragons-dev` (#864, RF-11 del
 * PRD de E33). Va con la llave de servicio, que se salta RLS, así que lo único
 * que separa un club de otro es el filtro del adaptador (NFR-009).
 *
 * Cada socio cuesta una identidad de la reserva (#415), así que el club lleva
 * los justos para probar el orden, el desempate, el tope de cuatro y el
 * aislamiento: AU dos veces, CO, ES y NZ una, y un socio sin país. El vecino
 * tiene un AR que, si contara, empataría con CO y lo adelantaría por código.
 */

const CLUBS_TABLE = "clubs";
const MEMBERS_TABLE = "members";

type CountrySeed = {
  readonly clubId: string;
  readonly country: string | null;
};

async function withClubs<T>(
  serviceClient: ServiceRoleClient,
  run: (clubIds: readonly [string, string, string]) => Promise<T>,
): Promise<T> {
  const club = (name: string) => ({ slug: `paises-${randomUUID()}`, name });
  return withSeededRows(
    serviceClient,
    CLUBS_TABLE,
    [club("Club de los países"), club("Club vecino"), club("Club sin países")],
    ([own, other, empty]) =>
      run([own!.id as string, other!.id as string, empty!.id as string]),
  );
}

/** Anida una identidad de la reserva por socio: al salir, cada una se lleva
 * su fila de `members`, que es lo que deja borrar después los clubes. */
async function withMembers<T>(
  serviceClient: ServiceRoleClient,
  seeds: readonly CountrySeed[],
  run: () => Promise<T>,
): Promise<T> {
  const [seed, ...rest] = seeds;
  if (seed === undefined) {
    return run();
  }
  return withTestUser(serviceClient, async (user) => {
    const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
      club_id: seed.clubId,
      user_id: user.id,
      full_name: `Socio ${seed.country ?? "sin país"}`,
      email: user.email,
      country: seed.country,
    });
    if (error) {
      throw new Error(`No se pudo sembrar al socio: ${error.message}`);
    }
    return withMembers(serviceClient, rest, run);
  });
}

describeRls("los países más comunes del club contra seadragons-dev", () => {
  it(
    "cuenta sólo los del club, de más a menos, por código al empatar, y cae al país del club si no hay",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const { countries } = createCommonCountriesGateways(serviceClient.client);

      await withClubs(serviceClient, async ([ownId, otherId, emptyId]) => {
        const seeds: readonly CountrySeed[] = [
          { clubId: ownId, country: "NZ" },
          { clubId: ownId, country: "AU" },
          { clubId: ownId, country: "ES" },
          { clubId: ownId, country: "AU" },
          { clubId: ownId, country: "CO" },
          { clubId: ownId, country: null },
          { clubId: otherId, country: "AR" },
        ];

        await withMembers(serviceClient, seeds, async () => {
          expect(
            rankCommonCountries(await countries.listMemberCountries(ownId)),
          ).toEqual(["AU", "CO", "ES", "NZ"]);
          expect(
            rankCommonCountries(await countries.listMemberCountries(emptyId)),
          ).toEqual([CLUB_HOME_COUNTRY]);
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
