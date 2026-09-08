import { describe, expect, it } from "vitest";
import { SUPABASE_URL_ENV } from "@/lib/supabase/config";
import {
  DEVELOPMENT_SUPABASE_PROJECT_REF,
  assertTestSupabaseEnvironment,
  checkTestSupabaseEnvironment,
} from "@/lib/supabase/environment-guard";

describe("guardia de entorno de tests", () => {
  it("falla cuando la URL de Supabase configurada no es la del proyecto de desarrollo", () => {
    const env = { [SUPABASE_URL_ENV]: "https://otro-proyecto.supabase.co" };

    const check = checkTestSupabaseEnvironment(env);

    expect(check.kind).toBe("wrong-project");
  });

  it("pasa con la URL del proyecto de desarrollo declarado", () => {
    const env = {
      [SUPABASE_URL_ENV]: `https://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`,
    };

    expect(checkTestSupabaseEnvironment(env)).toEqual({ kind: "ok" });
    expect(() => assertTestSupabaseEnvironment(env)).not.toThrow();
  });

  it("pasa cuando no hay ninguna URL de Supabase configurada", () => {
    expect(checkTestSupabaseEnvironment({})).toEqual({ kind: "ok" });
  });

  it("falla con un mensaje que nombra la variable culpable, sin imprimir su valor", () => {
    const productionLookingUrl =
      "https://ref-secreto-de-produccion.supabase.co";
    const env = { [SUPABASE_URL_ENV]: productionLookingUrl };

    const check = checkTestSupabaseEnvironment(env);

    expect(check.kind).toBe("wrong-project");
    if (check.kind === "wrong-project") {
      expect(check.message).toContain(SUPABASE_URL_ENV);
      expect(check.message).not.toContain(productionLookingUrl);
    }

    expect(() => assertTestSupabaseEnvironment(env)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(SUPABASE_URL_ENV),
      }),
    );
  });
});
