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
  tokenRequests: number;
  scheduled: (() => Promise<void>)[];
};

const probe: Probe = {
  sent: [],
  recordedRequests: 0,
  tokenRequests: 0,
  scheduled: [],
};

function mockWiring(
  options: {
    readonly unconfigured?: readonly string[];
    readonly senderConnected?: boolean;
    readonly requestsInWindow?: number;
    readonly deliveryFailure?: Error;
    readonly realSender?: boolean;
  } = {},
): void {
  vi.doMock("@/lib/api/after-response", () => ({
    runAfterResponse: (work: () => Promise<void>) => {
      probe.scheduled.push(work);
    },
  }));
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
                issueRecoveryToken: async (email: string) => {
                  probe.tokenRequests += 1;
                  return email === REGISTERED_EMAIL
                    ? { kind: "issued", tokenHash: TOKEN_HASH }
                    : { kind: "no_account" };
                },
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

/** Lo que la ruta dejó para después de responder. En producción lo corre
 * `after` de Next.js; aquí se corre a mano, y sólo después de la respuesta. */
async function runScheduledWork(): Promise<void> {
  for (const work of probe.scheduled.splice(0)) {
    await work();
  }
}

describe("POST /api/v1/auth/password-recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/auth/supabase-password-recovery");
    vi.doUnmock("@/lib/auth/recovery-email-sender");
    vi.doUnmock("@/lib/api/after-response");
    probe.sent = [];
    probe.recordedRequests = 0;
    probe.tokenRequests = 0;
    probe.scheduled = [];
  });

  it("con un correo registrado manda el enlace a la pantalla de contraseña nueva y confirma el envío", async () => {
    mockWiring();

    const response = await postRecovery({ email: "  Nerea@Example.Test " });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { outcome: "recovery_requested", email: REGISTERED_EMAIL },
    });
    await runScheduledWork();
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
    await runScheduledWork();
    expect(probe.sent).toEqual([]);
  });

  it("superado el límite responde 429 pidiendo esperar", async () => {
    mockWiring({ requestsInWindow: MAX_RECOVERY_REQUESTS_PER_WINDOW + 1 });

    const response = await postRecovery({ email: REGISTERED_EMAIL });

    expect(response.status).toBe(429);
    expect(probe.scheduled).toEqual([]);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.message).toContain(
      `${PASSWORD_RECOVERY_WINDOW_MINUTES} minutos`,
    );
    expect(probe.sent).toEqual([]);
  });

  // Antes respondía 500. Como el correo sólo sale para cuentas reales, ese 500
  // delataba cuáles lo son en cuanto fallaba el proveedor. Ahora la respuesta
  // ya salió cuando se intenta mandar, y el fallo queda donde lo lee quien lo
  // arregla.
  it("si el envío falla responde lo mismo que si saliera y deja el fallo en el registro", async () => {
    mockWiring({ deliveryFailure: new Error("el proveedor respondió 500") });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await postRecovery({ email: REGISTERED_EMAIL });
    await runScheduledWork();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { outcome: "recovery_requested", email: REGISTERED_EMAIL },
    });
    expect(String(logged.mock.calls.flat().join(" "))).toContain(
      "el proveedor respondió 500",
    );
    logged.mockRestore();
  });

  // Supabase y Resend a veces citan la dirección en sus mensajes ("Email
  // address ... is invalid"), y el registro del servidor no es sitio para un
  // dato personal.
  it("el fallo registrado no incluye la dirección de correo", async () => {
    mockWiring({
      deliveryFailure: new Error(
        `Email address "${REGISTERED_EMAIL}" is invalid`,
      ),
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await postRecovery({ email: REGISTERED_EMAIL });
    await runScheduledWork();

    const log = logged.mock.calls.flat().map(String).join(" ");
    expect(log).toContain("is invalid");
    expect(log).not.toContain(REGISTERED_EMAIL);
    logged.mockRestore();
  });

  // Lo que tarda la respuesta no puede depender de la cuenta: si esperara al
  // envío, que sólo ocurre para cuentas reales, las delataría.
  it("responde antes de mirar la cuenta y de mandar el correo", async () => {
    mockWiring();

    const response = await postRecovery({ email: REGISTERED_EMAIL });

    expect(response.status).toBe(200);
    expect(probe.scheduled).toHaveLength(1);
    expect(probe.tokenRequests).toBe(0);
    expect(probe.sent).toEqual([]);
  });

  it("deja una entrega pendiente tanto para un correo registrado como para uno inexistente", async () => {
    mockWiring();

    await postRecovery({ email: REGISTERED_EMAIL });
    await postRecovery({ email: "nadie@example.test" });

    expect(probe.scheduled).toHaveLength(2);
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
  // entorno sin la clave, que es exactamente el de un preview. El nombre de la
  // variable y dónde se pone van al registro del servidor, que es donde lo lee
  // quien lo arregla; a la pantalla del socio le llega un texto para personas.
  it("sin la clave de Resend responde 503 para personas y registra la variable y dónde se pone", async () => {
    mockWiring({ realSender: true });
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "Victoria Seadragons <seadragons@volleytip.com>");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await postRecovery({ email: REGISTERED_EMAIL });

    expect(response.status).toBe(503);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain("RESEND_API_KEY");
    expect(body).not.toContain("Vercel");
    expect(body).toContain("escribe al club");
    const log = logged.mock.calls.flat().map(String).join(" ");
    expect(log).toContain("RESEND_API_KEY");
    expect(log).toContain("ámbito Production");
    expect(probe.recordedRequests).toBe(0);
    logged.mockRestore();
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
