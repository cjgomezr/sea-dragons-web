import { describe, expect, it } from "vitest";
import { RECOVERY_LINK_LIFETIME_MINUTES } from "@/lib/auth/password-recovery";
import { connectRecoveryEmailSender } from "@/lib/auth/recovery-email-sender";
import {
  EMAIL_FROM_ENV,
  RESEND_API_KEY_ENV,
  RESEND_EMAILS_ENDPOINT,
} from "@/lib/email/resend-email-sender";

const FROM = "Victoria Seadragons <seadragons@volleytip.com>";
const RESET_URL =
  "https://victoria-seadragons.vercel.app/recuperar-contrasena/nueva?token_hash=abc";

type SentRequest = { readonly url: string; readonly body: unknown };

function recordingFetch(
  status: number,
  body: unknown,
): { readonly fetch: typeof fetch; readonly sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const implementation = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    sent.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status });
  };
  return { fetch: implementation, sent };
}

const CONFIGURED_ENV = {
  [RESEND_API_KEY_ENV]: "re_clave_de_mentira",
  [EMAIL_FROM_ENV]: FROM,
};

describe("correo de recuperación", () => {
  it("con la configuración de producción, sale por Resend con la plantilla de recuperación", async () => {
    const fake = recordingFetch(200, { id: "id-del-envio" });
    const connection = connectRecoveryEmailSender(CONFIGURED_ENV, fake.fetch);
    if (connection.kind !== "connected") {
      throw new Error(`no conectó: ${connection.reason}`);
    }

    await connection.sender.sendRecoveryEmail({
      to: "nerea@example.test",
      resetUrl: RESET_URL,
    });

    expect(fake.sent.map((request) => request.url)).toEqual([
      RESEND_EMAILS_ENDPOINT,
    ]);
    expect(fake.sent[0]?.body).toMatchObject({
      from: FROM,
      to: ["nerea@example.test"],
      text: expect.stringContaining(RESET_URL),
    });
    expect(fake.sent[0]?.body).toMatchObject({
      text: expect.stringContaining(
        `${RECOVERY_LINK_LIFETIME_MINUTES} minutos`,
      ),
    });
  });

  it("si el proveedor responde con error, el envío falla en vez de darse por hecho", async () => {
    const fake = recordingFetch(500, { name: "internal_server_error" });
    const connection = connectRecoveryEmailSender(CONFIGURED_ENV, fake.fetch);
    if (connection.kind !== "connected") {
      throw new Error(`no conectó: ${connection.reason}`);
    }

    await expect(
      connection.sender.sendRecoveryEmail({
        to: "nerea@example.test",
        resetUrl: RESET_URL,
      }),
    ).rejects.toThrow(/Resend.*500/);
  });

  it("sin la credencial no conecta, y el motivo nombra la variable y dónde se pone", () => {
    const connection = connectRecoveryEmailSender({ [EMAIL_FROM_ENV]: FROM });

    expect(connection.kind).toBe("not_connected");
    if (connection.kind !== "not_connected") return;
    expect(connection.reason).toContain(RESEND_API_KEY_ENV);
    expect(connection.reason).toContain("Vercel");
  });
});
