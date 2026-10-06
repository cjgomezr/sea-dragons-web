import { describe, expect, it } from "vitest";
import { NO_SIGN_IN_TEXTS } from "@/lib/club/sign-in-texts";
import { fetchClubBrandRow } from "@/lib/club/supabase-club-brand";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { RLS_NETWORK_TEST_TIMEOUT_MS } from "../../support/rls";

/**
 * La lectura de la marca contra `seadragons-dev` (#292). La base de desarrollo
 * tiene más clubes que el sembrado (los crean otros tests), así que esto prueba
 * también que se lee el de la instalación y no otro.
 */

const hasCredentials =
  readSupabaseServiceRoleConfig(process.env).kind === "configured";
if (!hasCredentials) {
  console.warn("⚠ marca del club: test saltado, falta la config de Supabase");
}

describe.skipIf(!hasCredentials)("lectura de la marca en Supabase", () => {
  it(
    "lee el nombre y las iniciales sembrados del club de la instalación",
    async () => {
      const row = await fetchClubBrandRow(process.env);

      expect(row).toEqual({
        name: "Victoria Seadragons",
        initials: "VS",
        accentColor: "#1c6ea4",
        logoUrl: null,
        signInTexts: NO_SIGN_IN_TEXTS,
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});

describe("lectura de la marca sin Supabase configurado", () => {
  it("falla nombrando las variables que faltan", async () => {
    await expect(fetchClubBrandRow({})).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });
});
