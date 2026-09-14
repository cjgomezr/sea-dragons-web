import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUPABASE_ANON_KEY_ENV, SUPABASE_URL_ENV } from "@/lib/supabase/config";
import type { ServiceRoleClient } from "../support/rls";

const GATEWAY_TIMEOUT = {
  data: { user: null },
  error: {
    name: "AuthRetryableFetchError",
    message: "Gateway Timeout",
    status: 504,
  },
};

function fakeServiceClient(admin: Record<string, unknown>): ServiceRoleClient {
  return {
    kind: "service-role-client",
    client: { auth: { admin } },
  } as unknown as ServiceRoleClient;
}

describe("el arnés RLS pasa sus llamadas a Supabase por el reintento", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("@supabase/supabase-js");
  });

  it("withTestUser sigue cuando crear el usuario da un 504 y el segundo intento contesta", async () => {
    const createUser = vi
      .fn()
      .mockResolvedValueOnce(GATEWAY_TIMEOUT)
      .mockResolvedValueOnce({ data: { user: { id: "user-1" } }, error: null });
    const deleteUser = vi.fn().mockResolvedValue({ data: {}, error: null });
    const { withTestUser } = await import("../support/rls");

    const pending = withTestUser(
      fakeServiceClient({ createUser, deleteUser }),
      async (user) => user.id,
    );
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe("user-1");
    expect(createUser).toHaveBeenCalledTimes(2);
  });

  it("withTestUser no tapa un test que pasó cuando borrar el usuario da un 504 pasajero", async () => {
    const createUser = vi
      .fn()
      .mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    const deleteUser = vi
      .fn()
      .mockResolvedValueOnce(GATEWAY_TIMEOUT)
      .mockResolvedValueOnce({ data: {}, error: null });
    const { withTestUser } = await import("../support/rls");

    const pending = withTestUser(
      fakeServiceClient({ createUser, deleteUser }),
      async () => "pasó",
    );
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe("pasó");
    expect(deleteUser).toHaveBeenCalledTimes(2);
  });

  it("withTestUser relanza el fallo del test aunque la limpieza agote sus intentos", async () => {
    const createUser = vi
      .fn()
      .mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    const deleteUser = vi.fn().mockResolvedValue(GATEWAY_TIMEOUT);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const testFailure = new Error("la aserción del test falló");
    const { withTestUser } = await import("../support/rls");

    const pending = withTestUser(
      fakeServiceClient({ createUser, deleteUser }),
      async () => {
        throw testFailure;
      },
    );
    const settled = pending.catch((error: unknown) => error);
    await vi.runAllTimersAsync();

    expect(await settled).toBe(testFailure);
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
