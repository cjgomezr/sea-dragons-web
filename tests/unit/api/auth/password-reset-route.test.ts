import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecoveryTokenRedemption } from "@/lib/auth/password-recovery";
import { describeAuthIssue } from "@/lib/auth/issue-messages";
import { validatePasswordField } from "@/lib/auth/registration";
import { createTranslator } from "@/lib/i18n/translator";

const PASSWORD_RESET_URL = "http://localhost:3417/api/v1/auth/password-reset";
const USER_ID = "5f1a1d6e-7f2b-4f0d-9a4c-1b2c3d4e5f60";

const audited: string[] = [];

function mockWiring(
  options: {
    readonly unconfigured?: readonly string[];
    readonly redemption?: RecoveryTokenRedemption;
  } = {},
): void {
  vi.doMock("@/lib/auth/supabase-password-recovery", () => ({
    createSupabasePasswordRecoveryGateways: async () =>
      options.unconfigured
        ? { kind: "unconfigured", missingKeys: options.unconfigured }
        : {
            kind: "ready",
            gateways: {
              redeemer: {
                redeemRecoveryToken: async () =>
                  options.redemption ?? {
                    kind: "password_changed",
                    userId: USER_ID,
                  },
              },
              audit: {
                recordPasswordChanged: async (userId: string) => {
                  audited.push(userId);
                },
              },
            },
          },
  }));
}

async function postReset(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/v1/auth/password-reset/route");
  return POST(
    new NextRequest(PASSWORD_RESET_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/v1/auth/password-reset", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/auth/supabase-password-recovery");
    audited.length = 0;
  });

  it("cambia la contraseña con un enlace válido y lo deja en la bitácora", async () => {
    mockWiring();

    const response = await postReset({
      tokenHash: "hash-del-enlace",
      password: "bajoelagua-nueva",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { outcome: "password_changed" },
    });
    expect(audited).toEqual([USER_ID]);
  });

  it("rechaza con 422 la contraseña de 7 caracteres con el mensaje del registro", async () => {
    mockWiring();
    const registrationRule = validatePasswordField("1234567");
    const spanish = createTranslator("es");

    const response = await postReset({
      tokenHash: "hash-del-enlace",
      password: "1234567",
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { message: string } };
    expect(registrationRule.ok).toBe(false);
    expect(body.error.message).toContain(
      registrationRule.ok
        ? ""
        : describeAuthIssue(spanish, registrationRule.code),
    );
  });

  it("responde 410 al enlace ya usado o caducado, ofreciendo pedir otro", async () => {
    mockWiring({ redemption: { kind: "link_unusable" } });

    const response = await postReset({
      tokenHash: "hash-del-enlace",
      password: "bajoelagua-nueva",
    });

    expect(response.status).toBe(410);
    const body = (await response.json()) as {
      error: { code: string; reason: string; message: string };
    };
    expect(body.error.code).toBe("gone");
    expect(body.error.reason).toBe("link_unusable");
    expect(body.error.message).toMatch(/pide otro/i);
    expect(body.error.message).not.toContain("otp_expired");
  });

  it("responde 410 si el servicio no acepta la contraseña, porque el enlace ya se gastó al intentarlo", async () => {
    mockWiring({ redemption: { kind: "password_rejected" } });

    const response = await postReset({
      tokenHash: "hash-del-enlace",
      password: "bajoelagua-nueva",
    });

    expect(response.status).toBe(410);
    const body = (await response.json()) as {
      error: { code: string; reason: string; message: string };
    };
    expect(body.error.code).toBe("gone");
    expect(body.error.reason).toBe("password_rejected");
    expect(body.error.message).toMatch(/igual a la anterior o demasiado débil/);
    expect(body.error.message).toMatch(/pide otro enlace/i);
    expect(body.error.message).not.toContain("password:");
    expect(audited).toEqual([]);
  });

  it("responde 400 a un token más largo que cualquier enlace real", async () => {
    mockWiring();

    const response = await postReset({
      tokenHash: "a".repeat(2_000),
      password: "bajoelagua-nueva",
    });

    expect(response.status).toBe(400);
  });

  it("responde 400 si falta el token", async () => {
    mockWiring();

    const response = await postReset({ password: "bajoelagua-nueva" });

    expect(response.status).toBe(400);
  });

  it("responde 503 nombrando las variables que faltan", async () => {
    mockWiring({ unconfigured: ["SUPABASE_SERVICE_ROLE_KEY"] });

    const response = await postReset({
      tokenHash: "hash-del-enlace",
      password: "bajoelagua-nueva",
    });

    expect(response.status).toBe(503);
  });
});
