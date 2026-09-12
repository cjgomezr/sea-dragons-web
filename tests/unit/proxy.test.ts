import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REGISTER_API_PATH, SIGN_IN_PATH } from "@/lib/auth/routes";

const createSessionClient = vi.fn();
const applySessionCookies = vi.fn();
const hasValidSession = vi.fn();

vi.mock("@/lib/supabase/session-client", () => ({
  createSessionClient: (...args: unknown[]) => createSessionClient(...args),
  applySessionCookies: (...args: unknown[]) => applySessionCookies(...args),
  readIncomingCookies: () => [],
}));

vi.mock("@/lib/auth/session-reader", () => ({
  hasValidSession: (...args: unknown[]) => hasValidSession(...args),
}));

const { proxy } = await import("@/proxy");

const ORIGIN = "http://localhost:3417";

function requestFor(path: string): NextRequest {
  return new NextRequest(new URL(path, ORIGIN));
}

function givenSupabaseConfigured(withSession: boolean): void {
  createSessionClient.mockReturnValue({
    kind: "ready",
    client: {},
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  });
  hasValidSession.mockResolvedValue(withSession);
}

describe("frontera de sesión: pantallas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirige a la entrada una pantalla pedida sin sesión", async () => {
    givenSupabaseConfigured(false);

    const response = await proxy(requestFor("/calendario"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      SIGN_IN_PATH,
    );
  });

  it("deja pasar una pantalla cuando hay sesión", async () => {
    givenSupabaseConfigured(true);

    const response = await proxy(requestFor("/calendario"));

    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("deja pasar la pantalla de entrada sin preguntar por la sesión", async () => {
    givenSupabaseConfigured(false);

    const response = await proxy(requestFor(SIGN_IN_PATH));

    expect(response.headers.get("location")).toBeNull();
    // Una ruta pública lo es con sesión y sin ella, así que preguntar sería un
    // viaje a Supabase por cada visita anónima.
    expect(hasValidSession).not.toHaveBeenCalled();
  });
});

describe("frontera de sesión: API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("responde 401 con el cuerpo de la convención a un endpoint sin sesión", async () => {
    givenSupabaseConfigured(false);

    const response = await proxy(requestFor("/api/v1/evaluaciones"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthenticated", message: expect.any(String) },
    });
  });

  it("deja público el endpoint de salud, que consulta el monitoreo", async () => {
    givenSupabaseConfigured(false);

    const response = await proxy(requestFor("/api/v1/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    // El monitoreo lo pide cada 5 minutos: atarlo a la latencia de Supabase
    // sería hacer que el endpoint que vigila el servicio dependa del servicio.
    expect(hasValidSession).not.toHaveBeenCalled();
  });

  it("deja público el endpoint con el que se crea la cuenta", async () => {
    givenSupabaseConfigured(false);

    const response = await proxy(requestFor(REGISTER_API_PATH));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    // Preguntar por una sesión que por definición no existe es un viaje a
    // Supabase por cada visita anónima al formulario.
    expect(hasValidSession).not.toHaveBeenCalled();
  });

  it("deja pasar un endpoint cuando hay sesión", async () => {
    givenSupabaseConfigured(true);

    const response = await proxy(requestFor("/api/v1/evaluaciones"));

    expect(response.status).toBe(200);
  });
});

describe("frontera de sesión sin Supabase configurado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSessionClient.mockReturnValue({
      kind: "unconfigured",
      missingKeys: ["NEXT_PUBLIC_SUPABASE_URL"],
    });
  });

  it("cierra la frontera en vez de abrirla", async () => {
    const response = await proxy(requestFor("/calendario"));

    expect(response.status).toBe(307);
    expect(hasValidSession).not.toHaveBeenCalled();
  });
});

describe("cookies del refresco de token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("las copia a la respuesta que sale, o el refresco se perdería", async () => {
    givenSupabaseConfigured(true);

    const response = await proxy(requestFor("/calendario"));

    expect(applySessionCookies).toHaveBeenCalledWith(
      response,
      expect.anything(),
    );
  });
});
