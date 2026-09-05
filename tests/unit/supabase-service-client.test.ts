import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SUPABASE_SERVICE_ROLE_KEY_ENV,
  SUPABASE_URL_ENV,
} from "@/lib/supabase/config";

describe("createServiceRoleClient", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("@supabase/supabase-js");
  });

  it("throws naming the missing variables instead of creating a half-configured client", async () => {
    const { createServiceRoleClient } =
      await import("@/lib/supabase/service-client");

    expect(() => createServiceRoleClient({})).toThrow(
      new RegExp(`${SUPABASE_URL_ENV}.*${SUPABASE_SERVICE_ROLE_KEY_ENV}`),
    );
  });

  it("builds the client with the service role key when configured", async () => {
    const createClient = vi.fn().mockReturnValue({ marker: "service-client" });
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { createServiceRoleClient } =
      await import("@/lib/supabase/service-client");

    const client = createServiceRoleClient({
      [SUPABASE_URL_ENV]: "https://club.supabase.co",
      [SUPABASE_SERVICE_ROLE_KEY_ENV]: "service-role-key",
    });

    expect(createClient).toHaveBeenCalledWith(
      "https://club.supabase.co",
      "service-role-key",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    expect(client).toEqual({ marker: "service-client" });
  });
});
