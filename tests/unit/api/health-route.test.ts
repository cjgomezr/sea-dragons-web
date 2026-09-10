import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SECRET_ENV_VARS } from "../../support/env-vars";

const ORIGINAL_ENV = { ...process.env };

const HEALTH_URL = "http://localhost/api/v1/health";
const PROJECT_REF = "ejemplo123";
const COMMIT_SHA = "9f1c0dea1b2c3d4e5f60718293a4b5c6d7e8f901";
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
/** Una clave anónima real es un JWT. Vale como valor de prueba justo por eso:
 * si el cuerpo de la respuesta la arrastrara, el test lo vería. */
const JWT_LOOKING_ANON_KEY =
  "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.ZmlybWE";

function mockReachableDatabase(): void {
  vi.doMock("@supabase/supabase-js", () => ({
    createClient: () => ({
      from: () => ({
        select: () => ({
          limit: async () => ({ error: null }),
        }),
      }),
    }),
  }));
}

function configureHealthyEnvironment(): void {
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = JWT_LOOKING_ANON_KEY;
  process.env.VERCEL_GIT_COMMIT_SHA = COMMIT_SHA;
  mockReachableDatabase();
}

async function getHealth(
  headers: Record<string, string> = {},
): Promise<Response> {
  const { GET } = await import("@/app/api/v1/health/route");
  return GET(new NextRequest(HEALTH_URL, { headers }));
}

describe("health", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("responde con la envoltura data cuando Supabase está configurado y alcanzable", async () => {
    configureHealthyEnvironment();

    const response = await getHealth();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        status: "ok",
        database: "ok",
        detail: "database reachable",
        supabaseProjectRef: PROJECT_REF,
        commit: COMMIT_SHA,
      },
    });
  });

  it("responde 200 con el ref del proyecto y el sha del commit desplegado", async () => {
    configureHealthyEnvironment();

    const response = await getHealth();
    const body = (await response.json()) as {
      data: { supabaseProjectRef: string | null; commit: string | null };
    };

    expect(response.status).toBe(200);
    expect(body.data.supabaseProjectRef).toBe(PROJECT_REF);
    expect(body.data.commit).toBe(COMMIT_SHA);
  });

  it("no filtra ninguna variable secreta ni ninguna cadena con forma de JWT", async () => {
    configureHealthyEnvironment();
    const secretValues = SECRET_ENV_VARS.map((name, index) => {
      const value = `sb_secret_valor-de-prueba-${index}`;
      process.env[name] = value;
      return value;
    });

    const rawBody = await (await getHealth()).text();

    for (const value of secretValues) {
      expect(rawBody).not.toContain(value);
    }
    expect(rawBody).not.toContain(JWT_LOOKING_ANON_KEY);
    expect(rawBody).not.toMatch(JWT_PATTERN);
  });

  it("responde igual con y sin cookie de sesión, porque el monitoreo consulta sin autenticarse", async () => {
    configureHealthyEnvironment();

    const anonymous = await getHealth();
    const withSession = await getHealth({
      cookie: "sb-access-token=una-sesion",
    });

    expect(anonymous.status).toBe(200);
    expect(withSession.status).toBe(anonymous.status);
    await expect(withSession.json()).resolves.toEqual(await anonymous.json());
  });

  it("responde 503 con la forma de error cuando Supabase no está configurado", async () => {
    const response = await getHealth();

    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("service_unavailable");
    expect(body.error.message).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("responde 405 con la forma de error para un método no soportado", async () => {
    const { POST } = await import("@/app/api/v1/health/route");
    const response = await POST(
      new NextRequest(HEALTH_URL, { method: "POST" }),
    );

    expect(response.status).toBe(405);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("method_not_allowed");
  });
});
