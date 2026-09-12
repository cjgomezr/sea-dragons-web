import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import { COMPLETE_REGISTRATION_PATH, DASHBOARD_PATH } from "@/lib/auth/routes";
import {
  ACCOUNT_UNAVAILABLE_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
} from "@/lib/auth/sign-in";

const SESSION_URL = "http://localhost/api/v1/auth/session";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const CREDENTIALS = { email: "nerea@example.test", password: "bajoelagua" };

/** La cookie que el doble emite para comprobar que la respuesta la lleva:
 * aquí lo que se mira es que la ruta no se coma lo que Supabase escribe. */
const SESSION_COOKIE_NAME = "sb-seadragons-auth-token";

type WiringOptions = {
  readonly authenticated?: boolean;
  readonly accountStatus?: AccountStatus | null;
  readonly unconfigured?: readonly string[];
  /** Una consulta que revienta después de que Supabase ya haya autenticado:
   * RLS, la red, un tiempo agotado. */
  readonly failAccountLookup?: boolean;
};

const signOutCalls: string[] = [];

function mockWiring(options: WiringOptions = {}): void {
  vi.doMock("@/lib/auth/supabase-session-gateways", () => ({
    createSupabaseSessionGateways: () =>
      options.unconfigured
        ? { kind: "unconfigured", missingKeys: options.unconfigured }
        : {
            kind: "ready",
            gateways: {
              identities: {
                authenticate: async () =>
                  options.authenticated === false
                    ? { kind: "rejected" }
                    : { kind: "authenticated", userId: USER_ID },
                discardSession: async () => {
                  signOutCalls.push("discard");
                },
              },
              accounts: {
                findAccountStatus: async () => {
                  if (options.failAccountLookup) {
                    throw new Error("la base no contestó");
                  }
                  return options.accountStatus === undefined
                    ? "active"
                    : options.accountStatus;
                },
              },
            },
            signOut: async () => {
              signOutCalls.push("signOut");
            },
            applyCookies: (response: Response) => {
              response.headers.append(
                "set-cookie",
                `${SESSION_COOKIE_NAME}=abc; Path=/`,
              );
            },
            expireCookies: (response: Response) => {
              response.headers.append(
                "set-cookie",
                `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0`,
              );
            },
          },
  }));
}

async function postSession(body: unknown = CREDENTIALS): Promise<Response> {
  const { POST } = await import("@/app/api/v1/auth/session/route");
  return POST(
    new NextRequest(SESSION_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function deleteSession(): Promise<Response> {
  const { DELETE } = await import("@/app/api/v1/auth/session/route");
  return DELETE(new NextRequest(SESSION_URL, { method: "DELETE" }));
}

beforeEach(() => {
  signOutCalls.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/auth/supabase-session-gateways");
});

describe("inicio de sesión", () => {
  it("da sesión y manda al panel a una cuenta activa", async () => {
    mockWiring({ accountStatus: "active" });

    const response = await postSession();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { destination: DASHBOARD_PATH },
    });
    expect(response.headers.get("set-cookie")).toContain(SESSION_COOKIE_NAME);
  });

  it("manda a completar registro a una cuenta incompleta", async () => {
    mockWiring({ accountStatus: "incomplete" });

    const response = await postSession();

    await expect(response.json()).resolves.toEqual({
      data: { destination: COMPLETE_REGISTRATION_PATH },
    });
  });

  it("responde 401 con el mensaje neutro a unas credenciales que no valen", async () => {
    mockWiring({ authenticated: false });

    const response = await postSession();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthenticated",
        message: INVALID_CREDENTIALS_MESSAGE,
      },
    });
  });

  it("caduca las cookies cuando rechaza, en vez de entregar media sesión", async () => {
    mockWiring({ authenticated: false });

    const response = await postSession();

    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  // Supabase autentica antes de que nadie mire si esa cuenta puede operar, así
  // que a esta altura ya hay una sesión viva. Entregarla con un 403 dejaría
  // dentro a quien se acaba de rechazar, porque la frontera sólo pregunta si
  // hay sesión.
  it("caduca las cookies de la cuenta que no puede operar", async () => {
    mockWiring({ accountStatus: "inactive" });

    const response = await postSession();

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("caduca las cookies cuando algo falla después de autenticar", async () => {
    mockWiring({ failAccountLookup: true });

    const response = await postSession();

    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("responde 403 a una cuenta que no puede operar", async () => {
    mockWiring({ accountStatus: "inactive" });

    const response = await postSession();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "forbidden", message: ACCOUNT_UNAVAILABLE_MESSAGE },
    });
  });

  it("rechaza un cuerpo al que le falta la contraseña", async () => {
    mockWiring();

    const response = await postSession({ email: CREDENTIALS.email });

    expect(response.status).toBe(400);
  });

  it("responde 503 nombrando lo que falta cuando el entorno no está configurado", async () => {
    mockWiring({ unconfigured: ["NEXT_PUBLIC_SUPABASE_URL"] });

    const response = await postSession();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: expect.stringContaining("NEXT_PUBLIC_SUPABASE_URL") },
    });
  });
});

describe("cierre de sesión", () => {
  it("cierra la sesión y borra sus cookies", async () => {
    mockWiring();

    const response = await deleteSession();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { signedOut: true },
    });
    expect(signOutCalls).toEqual(["signOut"]);
    expect(response.headers.get("set-cookie")).toContain(SESSION_COOKIE_NAME);
  });
});

describe("métodos no soportados", () => {
  it("responde 405 a un GET sobre la sesión", async () => {
    mockWiring();
    const { GET } = await import("@/app/api/v1/auth/session/route");

    const response = await GET(new NextRequest(SESSION_URL));

    expect(response.status).toBe(405);
  });
});
