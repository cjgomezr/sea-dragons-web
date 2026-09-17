import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_API_PATH,
  COMPLETE_REGISTRATION_PATH,
  DASHBOARD_PATH,
  REGISTER_API_PATH,
  SIGN_IN_PATH,
} from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";

const createSessionClient = vi.fn();
const applySessionCookies = vi.fn();
const readSessionState = vi.fn();

vi.mock("@/lib/supabase/session-client", () => ({
  createSessionClient: (...args: unknown[]) => createSessionClient(...args),
  applySessionCookies: (...args: unknown[]) => applySessionCookies(...args),
  readIncomingCookies: () => [],
}));

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
}));

const { proxy } = await import("@/proxy");

const ANONYMOUS: SessionState = { kind: "anonymous" };
const INCOMPLETE: SessionState = { kind: "incomplete" };
const ACTIVE_PLAYER: SessionState = { kind: "active", role: "Player" };

const ORIGIN = "http://localhost:3417";
const TEMPORARY_REDIRECT = 307;

function requestFor(path: string): NextRequest {
  return new NextRequest(new URL(path, ORIGIN));
}

function givenSupabaseConfigured(session: SessionState): void {
  createSessionClient.mockReturnValue({
    kind: "ready",
    client: {},
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  });
  readSessionState.mockResolvedValue(session);
}

function redirectedTo(response: Response): string | null {
  const location = response.headers.get("location");
  return location === null ? null : new URL(location).pathname;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("frontera de sesión: pantallas", () => {
  it("redirige a la entrada una pantalla pedida sin sesión", async () => {
    givenSupabaseConfigured(ANONYMOUS);

    const response = await proxy(requestFor("/calendario"));

    expect(response.status).toBe(TEMPORARY_REDIRECT);
    expect(redirectedTo(response)).toBe(SIGN_IN_PATH);
  });

  it("deja pasar una pantalla cuando la cuenta está activa", async () => {
    givenSupabaseConfigured(ACTIVE_PLAYER);

    const response = await proxy(requestFor("/calendario"));

    expect(redirectedTo(response)).toBeNull();
    expect(response.status).toBe(200);
  });

  it("deja pasar la pantalla de entrada sin preguntar por la sesión", async () => {
    givenSupabaseConfigured(ANONYMOUS);

    const response = await proxy(requestFor(SIGN_IN_PATH));

    expect(redirectedTo(response)).toBeNull();
    // Una ruta pública lo es con sesión y sin ella, así que preguntar sería un
    // viaje a Supabase por cada visita anónima.
    expect(readSessionState).not.toHaveBeenCalled();
  });
});

describe("frontera de sesión: API", () => {
  it("responde 401 con el cuerpo de la convención a un endpoint sin sesión", async () => {
    givenSupabaseConfigured(ANONYMOUS);

    const response = await proxy(requestFor("/api/v1/evaluaciones"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthenticated", message: expect.any(String) },
    });
  });

  it("deja público el endpoint de salud, que consulta el monitoreo", async () => {
    givenSupabaseConfigured(ANONYMOUS);

    const response = await proxy(requestFor("/api/v1/health"));

    expect(response.status).toBe(200);
    expect(redirectedTo(response)).toBeNull();
    // El monitoreo lo pide cada 5 minutos: atarlo a la latencia de Supabase
    // sería hacer que el endpoint que vigila el servicio dependa del servicio.
    expect(readSessionState).not.toHaveBeenCalled();
  });

  it("deja público el registro, que nadie puede pedir con sesión", async () => {
    givenSupabaseConfigured(ANONYMOUS);

    const response = await proxy(requestFor(REGISTER_API_PATH));

    expect(response.status).toBe(200);
    expect(redirectedTo(response)).toBeNull();
    // Preguntar por una sesión que por definición no existe es un viaje a
    // Supabase por cada visita anónima al formulario.
    expect(readSessionState).not.toHaveBeenCalled();
  });

  it("deja pasar un endpoint cuando la cuenta está activa", async () => {
    givenSupabaseConfigured(ACTIVE_PLAYER);

    const response = await proxy(requestFor("/api/v1/evaluaciones"));

    expect(response.status).toBe(200);
  });
});

describe("cuenta incompleta", () => {
  it("redirige a completar registro cualquier pantalla de la aplicación", async () => {
    givenSupabaseConfigured(INCOMPLETE);

    const response = await proxy(requestFor("/calendario"));

    expect(response.status).toBe(TEMPORARY_REDIRECT);
    expect(redirectedTo(response)).toBe(COMPLETE_REGISTRATION_PATH);
  });

  it("responde 403 con el cuerpo de la convención a la API directa", async () => {
    givenSupabaseConfigured(INCOMPLETE);

    const response = await proxy(requestFor("/api/v1/evaluaciones"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "forbidden", message: expect.any(String) },
    });
  });

  it("deja llegar a la pantalla de completar registro", async () => {
    givenSupabaseConfigured(INCOMPLETE);

    const response = await proxy(requestFor(COMPLETE_REGISTRATION_PATH));

    expect(response.status).toBe(200);
    expect(redirectedTo(response)).toBeNull();
  });

  it("deja llegar al endpoint con el que completa su registro", async () => {
    givenSupabaseConfigured(INCOMPLETE);

    const response = await proxy(requestFor(ACCOUNT_API_PATH));

    expect(response.status).toBe(200);
  });

  it("deja llegar a cerrar sesión", async () => {
    givenSupabaseConfigured(INCOMPLETE);

    const response = await proxy(requestFor("/api/v1/auth/session"));

    expect(response.status).toBe(200);
  });
});

describe("cuenta activa que pide completar registro", () => {
  it("aterriza en el panel principal", async () => {
    givenSupabaseConfigured(ACTIVE_PLAYER);

    const response = await proxy(requestFor(COMPLETE_REGISTRATION_PATH));

    expect(response.status).toBe(TEMPORARY_REDIRECT);
    expect(redirectedTo(response)).toBe(DASHBOARD_PATH);
  });
});

describe("frontera de sesión sin Supabase configurado", () => {
  beforeEach(() => {
    createSessionClient.mockReturnValue({
      kind: "unconfigured",
      missingKeys: ["NEXT_PUBLIC_SUPABASE_URL"],
    });
  });

  it("cierra la frontera en vez de abrirla", async () => {
    const response = await proxy(requestFor("/calendario"));

    expect(response.status).toBe(TEMPORARY_REDIRECT);
    expect(readSessionState).not.toHaveBeenCalled();
  });
});

describe("cookies del refresco de token", () => {
  it("las copia a la respuesta que sale, o el refresco se perdería", async () => {
    givenSupabaseConfigured(ACTIVE_PLAYER);

    const response = await proxy(requestFor("/calendario"));

    expect(applySessionCookies).toHaveBeenCalledWith(
      response,
      expect.anything(),
    );
  });
});
