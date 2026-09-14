import { describe, expect, it } from "vitest";
import {
  EMAIL_FROM_ENV,
  EmailDeliveryError,
  type EmailSender,
  type OutgoingEmail,
  RESEND_API_KEY_ENV,
  RESEND_EMAILS_ENDPOINT,
  connectResendEmailSender,
} from "@/lib/email/resend-email-sender";

const API_KEY = "re_clave_de_mentira";
const FROM = "Victoria Seadragons <seadragons@volleytip.com>";
const CONFIGURED_ENV = {
  [RESEND_API_KEY_ENV]: API_KEY,
  [EMAIL_FROM_ENV]: FROM,
};

const EMAIL: OutgoingEmail = {
  to: "nerea@example.test",
  subject: "Asunto",
  html: "<p>Hola</p>",
  text: "Hola",
};

type RecordedRequest = {
  readonly url: string;
  readonly init: RequestInit | undefined;
};

/** Un `fetch` de mentira que contesta lo que se le pida y apunta lo que
 * recibió. Ningún test de aquí sale a la red. */
function fakeFetch(answer: () => Promise<Response>): {
  readonly fetch: typeof fetch;
  readonly requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const implementation = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    requests.push({ url: String(input), init });
    return answer();
  };
  return { fetch: implementation, requests };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function connectedSender(fetchImplementation: typeof fetch): EmailSender {
  const connection = connectResendEmailSender(
    CONFIGURED_ENV,
    fetchImplementation,
  );
  if (connection.kind !== "connected") {
    throw new Error(`no conectó: ${connection.reason}`);
  }
  return connection.sender;
}

describe("envío por Resend", () => {
  it("manda con el remitente configurado y devuelve el identificador del envío", async () => {
    const fake = fakeFetch(async () =>
      jsonResponse(200, { id: "id-del-envio" }),
    );

    const sent = await connectedSender(fake.fetch).sendEmail(EMAIL);

    expect(sent).toEqual({ id: "id-del-envio" });
    expect(fake.requests).toHaveLength(1);
    const [request] = fake.requests;
    expect(request?.url).toBe(RESEND_EMAILS_ENDPOINT);
    expect(request?.init?.method).toBe("POST");
    expect(new Headers(request?.init?.headers).get("authorization")).toBe(
      `Bearer ${API_KEY}`,
    );
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      from: FROM,
      to: [EMAIL.to],
      subject: EMAIL.subject,
      html: EMAIL.html,
      text: EMAIL.text,
    });
  });

  it("un error del proveedor sube con contexto y no se traga", async () => {
    const fake = fakeFetch(async () =>
      jsonResponse(422, {
        statusCode: 422,
        name: "validation_error",
        message: "The domain is not verified.",
      }),
    );

    const sending = connectedSender(fake.fetch).sendEmail(EMAIL);

    await expect(sending).rejects.toBeInstanceOf(EmailDeliveryError);
    await expect(sending).rejects.toMatchObject({
      status: 422,
      message: expect.stringMatching(
        /Resend.*422.*validation_error.*The domain is not verified\./,
      ),
    });
  });

  it("un error del proveedor sin cuerpo legible sube igual, con su estado", async () => {
    const fake = fakeFetch(
      async () => new Response("<html>bad gateway</html>", { status: 502 }),
    );

    await expect(
      connectedSender(fake.fetch).sendEmail(EMAIL),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("502"),
    });
  });

  it("una caída de red sube con contexto y conserva la causa", async () => {
    const cause = new TypeError("fetch failed");
    const fake = fakeFetch(async () => {
      throw cause;
    });

    const sending = connectedSender(fake.fetch).sendEmail(EMAIL);

    await expect(sending).rejects.toBeInstanceOf(EmailDeliveryError);
    await expect(sending).rejects.toMatchObject({
      cause,
      message: expect.stringContaining("fetch failed"),
    });
  });

  it("una respuesta sin identificador no cuenta como envío", async () => {
    const fake = fakeFetch(async () => jsonResponse(200, {}));

    await expect(
      connectedSender(fake.fetch).sendEmail(EMAIL),
    ).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it("sin credencial, el fallo nombra la variable que falta y dónde se pone", () => {
    const connection = connectResendEmailSender({ [EMAIL_FROM_ENV]: FROM });

    expect(connection.kind).toBe("not_connected");
    if (connection.kind !== "not_connected") return;
    expect(connection.reason).toContain(RESEND_API_KEY_ENV);
    expect(connection.reason).not.toContain(EMAIL_FROM_ENV);
    expect(connection.reason).toContain("ámbito Production");
  });

  it("sin remitente, el fallo nombra esa variable", () => {
    const connection = connectResendEmailSender({
      [RESEND_API_KEY_ENV]: API_KEY,
    });

    expect(connection.kind).toBe("not_connected");
    if (connection.kind !== "not_connected") return;
    expect(connection.reason).toContain(EMAIL_FROM_ENV);
    expect(connection.reason).not.toContain(RESEND_API_KEY_ENV);
  });

  it("una variable en blanco cuenta como ausente", () => {
    const connection = connectResendEmailSender({
      [RESEND_API_KEY_ENV]: "   ",
      [EMAIL_FROM_ENV]: FROM,
    });

    expect(connection.kind).toBe("not_connected");
  });

  it("el motivo nunca lleva el valor de la credencial", () => {
    const connection = connectResendEmailSender({
      [RESEND_API_KEY_ENV]: API_KEY,
    });

    expect(JSON.stringify(connection)).not.toContain(API_KEY);
  });
});
