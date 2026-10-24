import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  CLUB_HOME_COUNTRY,
  type CommonCountriesGateways,
  rankCommonCountries,
  readCommonCountries,
} from "@/lib/club/common-countries";
import { ClubSettingsForbiddenError } from "@/lib/club/club-settings";

/**
 * Los países más comunes del club (#864, RF-11 y D15 del PRD de E33): los
 * cuatro más frecuentes entre sus socios, de más a menos y a igual frecuencia
 * por código, o el país del club si ninguno lo tiene guardado.
 */

const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

function repeated(code: string, times: number): readonly string[] {
  return Array.from({ length: times }, () => code);
}

const CLUB_COUNTRIES = [
  ...repeated("NZ", 2),
  ...repeated("AR", 1),
  ...repeated("ES", 2),
  ...repeated("AU", 5),
  ...repeated("CO", 3),
];

function gatewaysFor(
  role: Role,
  countries: readonly string[],
): CommonCountriesGateways & { readonly askedClubs: string[] } {
  const askedClubs: string[] = [];
  return {
    askedClubs,
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Ana Admin",
        role,
      }),
    },
    countries: {
      listMemberCountries: async (clubId) => {
        askedClubs.push(clubId);
        return countries;
      },
    },
  };
}

describe("rankCommonCountries", () => {
  it("devuelve los 4 más frecuentes, de más a menos", () => {
    expect(rankCommonCountries(CLUB_COUNTRIES)).toEqual([
      "AU",
      "CO",
      "ES",
      "NZ",
    ]);
  });

  it("a igual frecuencia ordena por código", () => {
    expect(rankCommonCountries(["NZ", "ES", "BR", "AR"])).toEqual([
      "AR",
      "BR",
      "ES",
      "NZ",
    ]);
  });

  it("devuelve el país del club cuando nadie tiene país guardado", () => {
    expect(rankCommonCountries([])).toEqual([CLUB_HOME_COUNTRY]);
  });

  it("el país del club es Australia", () => {
    expect(CLUB_HOME_COUNTRY).toBe("AU");
  });

  it("cuenta un código en minúsculas como el mismo país", () => {
    expect(rankCommonCountries(["co", "CO", "AU"])).toEqual(["CO", "AU"]);
  });

  it("ignora un código que no está en el catálogo", () => {
    expect(rankCommonCountries(["XX", "XX", "CO"])).toEqual(["CO"]);
  });
});

describe("readCommonCountries", () => {
  it("cuenta los países del club de quien llama", async () => {
    const gateways = gatewaysFor("Admin", CLUB_COUNTRIES);

    const countries = await readCommonCountries(gateways, ADMIN_ID);

    expect(countries).toEqual(["AU", "CO", "ES", "NZ"]);
    expect(gateways.askedClubs).toEqual([CLUB_ID]);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "rechaza a un %s sin leer los países",
    async (role) => {
      const gateways = gatewaysFor(role, CLUB_COUNTRIES);

      await expect(readCommonCountries(gateways, ADMIN_ID)).rejects.toThrow(
        ClubSettingsForbiddenError,
      );
      expect(gateways.askedClubs).toEqual([]);
    },
  );
});
