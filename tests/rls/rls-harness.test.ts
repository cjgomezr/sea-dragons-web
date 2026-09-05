import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SUPABASE_ANON_KEY_ENV,
  SUPABASE_SERVICE_ROLE_KEY_ENV,
  SUPABASE_URL_ENV,
} from "@/lib/supabase/config";

describe("cliente por rol", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("@supabase/supabase-js");
  });

  it("devuelve un cliente distinto por identidad y ninguno usa la llave de servicio", async () => {
    const createClient = vi.fn().mockImplementation(() => ({
      marker: Symbol("rls-client"),
      auth: { signInWithPassword: vi.fn().mockResolvedValue({ error: null }) },
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { createRlsClient } = await import("../support/rls");

    const env = {
      [SUPABASE_URL_ENV]: "https://club.supabase.co",
      [SUPABASE_ANON_KEY_ENV]: "anon-key",
      [SUPABASE_SERVICE_ROLE_KEY_ENV]: "service-role-key",
    };

    const anonClient = await createRlsClient({ role: "anon" }, env);
    const authenticatedClient = await createRlsClient(
      {
        role: "authenticated",
        email: "player@example.test",
        password: "secret",
      },
      env,
    );

    expect(anonClient.client).not.toBe(authenticatedClient.client);
    expect(anonClient.role).toBe("anon");
    expect(authenticatedClient.role).toBe("authenticated");

    for (const call of createClient.mock.calls) {
      expect(call[1]).toBe("anon-key");
      expect(call[1]).not.toBe("service-role-key");
    }
  });

  it("pedir un cliente sin configuración lanza un error que nombra la variable ausente", async () => {
    const { createRlsClient } = await import("../support/rls");

    await expect(createRlsClient({ role: "anon" }, {})).rejects.toThrow(
      new RegExp(`${SUPABASE_URL_ENV}.*${SUPABASE_ANON_KEY_ENV}`),
    );
  });
});

describe("detección de entorno", () => {
  it("está disponible cuando las tres variables están presentes", async () => {
    const { detectRlsEnvironment } = await import("../support/rls");

    const status = detectRlsEnvironment({
      [SUPABASE_URL_ENV]: "https://club.supabase.co",
      [SUPABASE_ANON_KEY_ENV]: "anon-key",
      [SUPABASE_SERVICE_ROLE_KEY_ENV]: "service-role-key",
    });

    expect(status).toEqual({ kind: "available" });
  });

  it("nombra cada variable ausente sin duplicados", async () => {
    const { detectRlsEnvironment } = await import("../support/rls");

    const status = detectRlsEnvironment({
      [SUPABASE_URL_ENV]: "https://club.supabase.co",
    });

    expect(status).toEqual({
      kind: "unavailable",
      missingKeys: [SUPABASE_ANON_KEY_ENV, SUPABASE_SERVICE_ROLE_KEY_ENV],
    });
  });
});

describe("afirmación de negación", () => {
  it("falla cuando la consulta devuelve filas", async () => {
    const { assertDenied } = await import("../support/rls");

    const rlsClient = {
      kind: "rls-client" as const,
      role: "authenticated" as const,
      client: {} as never,
    };

    await expect(
      assertDenied(rlsClient, async () => ({
        data: [{ id: "1" }],
        error: null,
      })),
    ).rejects.toThrow(/negara/);
  });

  it("pasa cuando la consulta devuelve una lista vacía", async () => {
    const { assertDenied } = await import("../support/rls");

    const rlsClient = {
      kind: "rls-client" as const,
      role: "authenticated" as const,
      client: {} as never,
    };

    await expect(
      assertDenied(rlsClient, async () => ({ data: [], error: null })),
    ).resolves.toBeUndefined();
  });

  it("pasa cuando la consulta devuelve un error de permiso", async () => {
    const { assertDenied } = await import("../support/rls");

    const rlsClient = {
      kind: "rls-client" as const,
      role: "authenticated" as const,
      client: {} as never,
    };

    await expect(
      assertDenied(rlsClient, async () => ({
        data: null,
        error: { message: "permission denied for table audit_log" },
      })),
    ).resolves.toBeUndefined();
  });

  it("impide que se use un cliente de servicio en lugar de un cliente RLS", async () => {
    const { assertDenied } = await import("../support/rls");

    const serviceClient = {
      kind: "service-role-client" as const,
      client: {} as never,
    };

    await expect(
      // La firma de tipos ya impide esto en TypeScript; el test simula al
      // desarrollador que se lo salta con un `as never`, que es exactamente
      // el falso verde que este arnés no puede permitir.
      assertDenied(serviceClient as never, async () => ({
        data: [],
        error: null,
      })),
    ).rejects.toThrow(/cliente de servicio/);
  });
});
