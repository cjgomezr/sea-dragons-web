import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfirmationEmailOutcome } from "@/lib/auth/register-member";

const CONFIRMATION_EMAIL_URL =
  "http://localhost/api/v1/auth/confirmation-email";

const requestedEmails: string[] = [];

function mockWiring(
  options: {
    readonly unconfigured?: readonly string[];
    readonly confirmationEmail?: ConfirmationEmailOutcome;
  } = {},
): void {
  vi.doMock("@/lib/auth/supabase-auth-gateways", () => ({
    describeMissingAuthKeys: (missingKeys: readonly string[]) =>
      `El servicio de cuentas no está configurado: faltan ${missingKeys.join(", ")}.`,
    createSupabaseAuthGateways: () =>
      options.unconfigured
        ? { kind: "unconfigured", missingKeys: options.unconfigured }
        : {
            kind: "ready",
            gateways: {
              confirmationEmail: {
                requestConfirmationEmail: async (email: string) => {
                  requestedEmails.push(email);
                  return options.confirmationEmail ?? { kind: "requested" };
                },
              },
            },
          },
  }));
}

async function postConfirmationEmail(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/v1/auth/confirmation-email/route");
  return POST(
    new NextRequest(CONFIRMATION_EMAIL_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/v1/auth/confirmation-email", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/auth/supabase-auth-gateways");
    requestedEmails.length = 0;
  });

  it("reenvía la confirmación a la dirección normalizada", async () => {
    mockWiring();

    const response = await postConfirmationEmail({
      email: "  Nerea@Example.Test ",
    });

    expect(response.status).toBe(200);
    expect(requestedEmails).toEqual(["nerea@example.test"]);
  });

  it("no delata si esa dirección tiene cuenta: el cuerpo sólo repite el correo y el envío", async () => {
    mockWiring();

    const response = await postConfirmationEmail({
      email: "desconocida@example.test",
    });

    await expect(response.json()).resolves.toEqual({
      data: {
        outcome: "confirmation_pending",
        email: "desconocida@example.test",
        confirmationEmail: "requested",
      },
    });
  });

  it("responde 422 con una dirección que no tiene forma de correo", async () => {
    mockWiring();

    const response = await postConfirmationEmail({ email: "nerea" });

    expect(response.status).toBe(422);
    expect(requestedEmails).toEqual([]);
  });

  it("responde 503 nombrando las variables que faltan", async () => {
    mockWiring({ unconfigured: ["SUPABASE_SERVICE_ROLE_KEY"] });

    const response = await postConfirmationEmail({
      email: "nerea@example.test",
    });

    expect(response.status).toBe(503);
  });
});

describe("reenvío", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/auth/supabase-auth-gateways");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("un rechazo de Supabase no se reporta como enviado", async () => {
    mockWiring({
      confirmationEmail: {
        kind: "failed",
        reason: "400: Email address is invalid",
      },
    });

    const response = await postConfirmationEmail({
      email: "nerea@example.test",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        outcome: "confirmation_pending",
        email: "nerea@example.test",
        confirmationEmail: "failed",
      },
    });
  });

  it("un 429 se distingue igual que en el registro y su motivo se registra", async () => {
    const reason = "429: email rate limit exceeded";
    mockWiring({ confirmationEmail: { kind: "rate_limited", reason } });

    const response = await postConfirmationEmail({
      email: "nerea@example.test",
    });

    const body = (await response.json()) as {
      data: { confirmationEmail: string };
    };
    expect(body.data.confirmationEmail).toBe("rate_limited");
    expect(console.error).toHaveBeenCalledWith(expect.any(String), reason);
  });
});
