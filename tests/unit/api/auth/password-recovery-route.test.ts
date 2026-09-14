import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RECOVERY_REQUESTS_PER_WINDOW,
  PASSWORD_RECOVERY_WINDOW_MINUTES,
  type RecoveryEmail,
} from "@/lib/auth/password-recovery";

const ORIGIN = "http://localhost:3417";
const PASSWORD_RECOVERY_URL = `${ORIGIN}/api/v1/auth/password-recovery`;
const REGISTERED_EMAIL = "nerea@example.test";
const TOKEN_HASH = "hash-del-enlace";

type Probe = {
  sent: RecoveryEmail[];
  recordedRequests: number;
};

const probe: Probe = { sent: [], recordedRequests: 0 };

function mockWiring(
  options: {
    readonly unconfigured?: readonly string[];
    readonly senderConnected?: boolean;
    readonly requestsInWindow?: number;
    readonly deliveryFailure?: Error;
    readonly realSender?: boolean;
  } = {},
): void {
  vi.doMock("@/lib/auth/supabase-password-recovery", () => ({
    createSupabasePasswordRecoveryGateways: async () =>
      options.unconfigured
        ? { kind: "unconfigured", missingKeys: options.unconfigured }
        : {
            kind: "ready",
            gateways: {
              requests: {
                recordAndCountRecent: async () => {
                  probe.recordedRequests += 1;
                  return options.requestsInWindow ?? 1;
                },
              },
              tokens: {
                issueRecoveryToken: async (email: string) =>
                  email === REGISTERED_EMAIL
                    ? { kind: "issued", tokenHash: TOKEN_HASH }
                    : { kind: "no_account" },
              },
            },
          },
  }));
  if (options.realSender) {
    return;
  }
  vi.doMock("@/lib/auth/recovery-email-sender", () => ({
    connectRecoveryEmailSender: () =>
      options.senderConnected === false
        ? { kind: "not_connected", reason: "No hay proveedor de correo." }
        : {
            kind: "connected",
            sender: {
              sendRecoveryEmail: async (email: RecoveryEmail) => {
                if (options.deliveryFailure) {
                  throw options.deliveryFailure;
                }
                probe.sent.push(email);
              },
            },
          },
  }));
}

async function postRecovery(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/v1/auth/password-recovery/route");
  return POST(
    new NextRequest(PASSWORD_RECOVERY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/v1/auth/password-recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/auth/supabase-password-recovery");
    vi.doUnmock("@/lib/auth/recovery-email-sender");
    probe.sent = [];
    probe.recordedRequests = 0;
  });

  it("con un correo registrado manda el enlace a la pantalla de contraseña nueva y confirma el envío", async () => {
    mockWiring();

    const response = await postRecovery({ email: "  Nerea@Example.Test " });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { outcome: "recovery_requested", email: REGISTERED_EMAIL },
    });
    expect(probe.sent).toEqual([
      {
        to: REGISTERED_EMAIL,
        resetUrl: `${ORIGIN}/recuperar-contrasena/nueva?token_hash=${TOKEN_HASH}`,
      },
    ]);
  });

  it("con un correo inexistente responde exactamente lo mismo y no manda nada", async () => {
    mockWiring();

    const response = await postRecovery({ email: "nadie@example.test" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { outcome: "recovery_requested", email: "nadie@example.test" },
    });
    expect(probe.sent).toEqual([]);
  });

  it("superado el límite responde 429 pidiendo esperar", async () => {
    mockWiring({ requestsInWindow: MAX_RECOVERY_REQUESTS_PER_WINDOW + 1 });

    const response = await postRecovery({ email: REGISTERED_EMAIL });

    expect(response.status).toBe(429);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.message).toContain(
      `${PASSWORD_RECOVERY_WINDOW_MINUTES} minutos`,
    );
    expect(probe.sent).toEqual([]);
  });

  it("si el envío falla responde 500 y no dice que el correo salió", async () => {
    mockWiring({ deliveryFailure: new Error("el proveedor respondió 500") });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await postRecovery({ email: REGISTERED_EMAIL });

    expect(response.status).toBe(500);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain("recovery_requested");
    expect(String(logged.mock.calls.flat().join(" "))).toContain(
      "el proveedor respondió 500",
    );
  });

  it("responde 400 a un correo más largo que cualquier dirección válida, sin contarlo", async () => {
    mockWiring();

    const response = await postRecovery({
      email: `${"a".repeat(320)}@example.test`,
    });

    expect(response.status).toBe(400);
    expect(probe.recordedRequests).toBe(0);
  });

  it("responde 422 a una dirección sin forma de correo, sin contarla ni mirar la cuenta", async () => {
    mockWiring();

    const response = await postRecovery({ email: "nerea" });

    expect(response.status).toBe(422);
    expect(probe.recordedRequests).toBe(0);
  });

  it("sin proveedor de correo responde 503 a todos por igual, antes de mirar nada", async () => {
    mockWiring({ senderConnected: false });

    const registered = await postRecovery({ email: REGISTERED_EMAIL });
    const unknown = await postRecovery({ email: "nadie@example.test" });

    expect(registered.status).toBe(503);
    expect(await registered.json()).toEqual(await unknown.json());
    expect(probe.recordedRequests).toBe(0);
  });

  // Sin doble del envío: el que responde es el conector de verdad, leyendo un
  // entorno sin la clave, que es exactamente el de un preview.
  it("sin la clave de Resend responde 503 nombrando la variable y dónde se pone", async () => {
    mockWiring({ realSender: true });
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "Victoria Seadragons <seadragons@volleytip.com>");

    const response = await postRecovery({ email: REGISTERED_EMAIL });

    expect(response.status).toBe(503);
    const message = JSON.stringify(await response.json());
    expect(message).toContain("RESEND_API_KEY");
    expect(message).toContain("ámbito Production");
    expect(probe.recordedRequests).toBe(0);
    vi.unstubAllEnvs();
  });

  it("responde 503 nombrando las variables de Supabase que faltan", async () => {
    mockWiring({ unconfigured: ["SUPABASE_SERVICE_ROLE_KEY"] });

    const response = await postRecovery({ email: REGISTERED_EMAIL });

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).toContain(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
  });
});
