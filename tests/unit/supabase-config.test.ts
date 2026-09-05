import { describe, expect, it } from "vitest";
import {
  SUPABASE_ANON_KEY_ENV,
  SUPABASE_SERVICE_ROLE_KEY_ENV,
  SUPABASE_URL_ENV,
  readSupabaseConfig,
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
