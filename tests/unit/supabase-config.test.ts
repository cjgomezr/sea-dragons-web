import { describe, expect, it } from "vitest";
import {
  SUPABASE_ANON_KEY_ENV,
  SUPABASE_SERVICE_ROLE_KEY_ENV,
  SUPABASE_URL_ENV,
  readSupabaseConfig,
  readSupabaseProjectRef,
  readSupabaseServiceRoleConfig,
} from "@/lib/supabase/config";

describe("readSupabaseConfig", () => {
  it("returns the configured credentials when both variables are present", () => {
    const config = readSupabaseConfig({
      [SUPABASE_URL_ENV]: "https://club.supabase.co",
      [SUPABASE_ANON_KEY_ENV]: "anon-key",
    });

    expect(config).toEqual({
      kind: "configured",
      url: "https://club.supabase.co",
      anonKey: "anon-key",
    });
  });

  it("reports every missing variable by name", () => {
    const config = readSupabaseConfig({});

    expect(config).toEqual({
      kind: "missing",
      missingKeys: [SUPABASE_URL_ENV, SUPABASE_ANON_KEY_ENV],
    });
  });

  it("treats a blank variable as missing", () => {
    const config = readSupabaseConfig({
      [SUPABASE_URL_ENV]: "   ",
      [SUPABASE_ANON_KEY_ENV]: "anon-key",
    });

    expect(config).toEqual({
      kind: "missing",
      missingKeys: [SUPABASE_URL_ENV],
    });
  });
});

describe("readSupabaseServiceRoleConfig", () => {
  it("returns the configured credentials when both variables are present", () => {
    const config = readSupabaseServiceRoleConfig({
      [SUPABASE_URL_ENV]: "https://club.supabase.co",
      [SUPABASE_SERVICE_ROLE_KEY_ENV]: "service-role-key",
    });

    expect(config).toEqual({
      kind: "configured",
      url: "https://club.supabase.co",
      serviceRoleKey: "service-role-key",
    });
  });

  it("reports every missing variable by name", () => {
    const config = readSupabaseServiceRoleConfig({});

    expect(config).toEqual({
      kind: "missing",
      missingKeys: [SUPABASE_URL_ENV, SUPABASE_SERVICE_ROLE_KEY_ENV],
    });
  });

  it("treats a blank variable as missing", () => {
    const config = readSupabaseServiceRoleConfig({
      [SUPABASE_URL_ENV]: "https://club.supabase.co",
      [SUPABASE_SERVICE_ROLE_KEY_ENV]: "   ",
    });

    expect(config).toEqual({
      kind: "missing",
      missingKeys: [SUPABASE_SERVICE_ROLE_KEY_ENV],
    });
  });
});

describe("readSupabaseProjectRef", () => {
  it("extrae el ref del subdominio de la URL configurada", () => {
    expect(
      readSupabaseProjectRef({
        [SUPABASE_URL_ENV]: "https://ejemplo123.supabase.co",
      }),
    ).toBe("ejemplo123");
  });

  it("devuelve null cuando no hay URL configurada", () => {
    expect(readSupabaseProjectRef({})).toBeNull();
  });

  it("devuelve null cuando el host no es de supabase.co", () => {
    expect(
      readSupabaseProjectRef({
        [SUPABASE_URL_ENV]: "https://api.seadragons.example",
      }),
    ).toBeNull();
  });

  it("devuelve null cuando el valor no es una URL", () => {
    expect(
      readSupabaseProjectRef({ [SUPABASE_URL_ENV]: "no-es-una-url" }),
    ).toBeNull();
  });
});
