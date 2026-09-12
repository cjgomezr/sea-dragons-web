import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SUPABASE_ANON_KEY_ENV,
  SUPABASE_SERVICE_ROLE_KEY_ENV,
  SUPABASE_URL_ENV,
} from "@/lib/supabase/config";
import { describeRls, skippedSuiteName } from "../support/rls";

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

// Qué variables faltan y cómo se nombran vive en
// `tests/unit/supabase-credentials.test.ts`, que es donde se decide: aquí sólo
// se prueba qué hace `describeRls` con esa decisión.
describe("detección de entorno", () => {
  // Sin credenciales en una máquina de desarrollo, saltarse es lo correcto. En
  // CI no: desde el issue #149 el runner las tiene, y un salto ahí sería una
  // corrida verde que no probó ninguna policy.
  it("rompe en vez de saltarse cuando a CI le faltan las credenciales", () => {
    expect(() =>
      describeRls("policies que nadie llegó a probar", () => {}, {
        CI: "true",
      }),
    ).toThrowError(new RegExp(SUPABASE_URL_ENV));
  });

  it("nombra en el título del salto lo que le falta a esta máquina", () => {
    expect(
      skippedSuiteName("policies de members", `faltan ${SUPABASE_URL_ENV}`),
    ).toBe(`policies de members (saltado: faltan ${SUPABASE_URL_ENV})`);
  });
});

// Fuera de CI el mismo caso se salta en vez de romper, y se comprueba desde
// donde se usa de verdad: al cargar el módulo. El cuerpo falla si llegara a
// correr, así que un `describeRls` que dejara de saltarse se vería.
describeRls(
  "suite sin credenciales en una máquina de desarrollo",
  () => {
    it("no llega a correr", () => {
      expect.unreachable("describeRls dejó de saltarse sin credenciales");
    });
  },
  {},
);

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

  it("pasa cuando la consulta devuelve el código Postgres de permiso insuficiente", async () => {
    const { assertDenied } = await import("../support/rls");

    const rlsClient = {
      kind: "rls-client" as const,
      role: "authenticated" as const,
      client: {} as never,
    };

    await expect(
      assertDenied(rlsClient, async () => ({
        data: null,
        error: { code: "42501", message: "insufficient_privilege" },
      })),
    ).resolves.toBeUndefined();
  });

  it("falla cuando la consulta devuelve un error que no es de permiso", async () => {
    const { assertDenied } = await import("../support/rls");

    const rlsClient = {
      kind: "rls-client" as const,
      role: "authenticated" as const,
      client: {} as never,
    };

    await expect(
      assertDenied(rlsClient, async () => ({
        data: null,
        error: { message: 'relation "audit_log" does not exist' },
      })),
    ).rejects.toThrow(/error de permiso/);
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
