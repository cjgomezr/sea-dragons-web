import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUPABASE_ANON_KEY_ENV, SUPABASE_URL_ENV } from "@/lib/supabase/config";

const GATEWAY_TIMEOUT = {
  data: { user: null },
  error: {
    name: "AuthRetryableFetchError",
    message: "Gateway Timeout",
    status: 504,
  },
};

// Lo que `withTestUser` hacía con cada identidad (crearla con reintento y
// borrarla sin tapar el resultado del test) pasó a la reserva de socios de
// prueba (#415): lo prueban tests/unit/support/test-member-pool.test.ts y,
// para el reintento al crear, tests/unit/supabase-retry.test.ts.
describe("el arnés RLS pasa sus llamadas a Supabase por el reintento", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("@supabase/supabase-js");
  });

  it("createRlsClient inicia sesión aunque el primer intento dé un 504", async () => {
    const signInWithPassword = vi
      .fn()
      .mockResolvedValueOnce(GATEWAY_TIMEOUT)
      .mockResolvedValueOnce({ data: {}, error: null });
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({ auth: { signInWithPassword } }),
    }));
    const { createRlsClient } = await import("../support/rls");

    const pending = createRlsClient(
      {
        role: "authenticated",
        email: "player@example.test",
        password: "secret",
      },
      {
        [SUPABASE_URL_ENV]: "https://club.supabase.co",
        [SUPABASE_ANON_KEY_ENV]: "anon-key",
      },
    );
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({ role: "authenticated" });
    expect(signInWithPassword).toHaveBeenCalledTimes(2);
  });
});
