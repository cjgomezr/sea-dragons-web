import { describe, expect, it } from "vitest";
import {
  type BatchEmailSender,
  EMAIL_FROM_ENV,
  EmailDeliveryError,
  RESEND_API_KEY_ENV,
  RESEND_BATCH_ENDPOINT,
  type ReplyableEmail,
  connectResendBatchEmailSender,
} from "@/lib/email/resend-email-sender";

/**
 * El envío por lotes de Resend que usa el correo del directorio (#501): una
 * sola petición con un correo propio por socio, cada uno con su `reply_to`.
 * Ningún test de aquí sale a la red.
 */

const API_KEY = "re_clave_de_mentira";
const FROM = "Victoria Seadragons <seadragons@volleytip.com>";
const CONFIGURED_ENV = {
  [RESEND_API_KEY_ENV]: API_KEY,
  [EMAIL_FROM_ENV]: FROM,
};
const IDEMPOTENCY_KEY = "7e7e7e7e-0000-4000-8000-000000000001";

function email(to: string): ReplyableEmail {
  return {
    to,
    subject: "Entreno",
    html: "<p>Hola</p>",
    text: "Hola",
    replyTo: "ana@club.test",
  };
}

type RecordedRequest = {
  readonly url: string;
  readonly init: RequestInit | undefined;
};

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

function connectedSender(fetchImplementation: typeof fetch): BatchEmailSender {
  const connection = connectResendBatchEmailSender(
    CONFIGURED_ENV,
    fetchImplementation,
  );
  if (connection.kind !== "connected") {
    throw new Error("la configuración de prueba debería conectar");
  }
  return connection.sender;
}

function headersOf(request: RecordedRequest | undefined): Headers {
  return new Headers(request?.init?.headers);
}

describe("connectResendBatchEmailSender", () => {
  it("sin clave ni remitente no conecta y nombra lo que falta", () => {
    const connection = connectResendBatchEmailSender({});

    expect(connection).toMatchObject({ kind: "not_connected" });
    expect(connection.kind === "not_connected" && connection.reason).toContain(
      RESEND_API_KEY_ENV,
    );
  });

  it("manda una sola petición con un correo por destinatario, desde el club y con su respuesta", async () => {
    const { fetch, requests } = fakeFetch(async () =>
      jsonResponse(200, { data: [{ id: "a" }, { id: "b" }], errors: [] }),
    );

    await connectedSender(fetch).sendBatch(
      [email("uno@example.test"), email("dos@example.test")],
      IDEMPOTENCY_KEY,
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(RESEND_BATCH_ENDPOINT);
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual([
      {
        from: FROM,
        to: ["uno@example.test"],
        reply_to: "ana@club.test",
        subject: "Entreno",
        html: "<p>Hola</p>",
        text: "Hola",
      },
      {
        from: FROM,
        to: ["dos@example.test"],
        reply_to: "ana@club.test",
        subject: "Entreno",
        html: "<p>Hola</p>",
        text: "Hola",
      },
    ]);
  });

  it("pide la validación permisiva y lleva la clave de idempotencia", async () => {
    const { fetch, requests } = fakeFetch(async () =>
      jsonResponse(200, { data: [{ id: "a" }], errors: [] }),
    );

    await connectedSender(fetch).sendBatch(
      [email("uno@example.test")],
      IDEMPOTENCY_KEY,
    );

    const headers = headersOf(requests[0]);
    expect(headers.get("x-batch-validation")).toBe("permissive");
    expect(headers.get("idempotency-key")).toBe(IDEMPOTENCY_KEY);
    expect(headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
  });

  it("devuelve, en el orden de los correos, cuáles salieron y cuáles no", async () => {
    const { fetch } = fakeFetch(async () =>
      jsonResponse(200, {
        data: [{ id: "a" }, { id: "c" }],
        errors: [{ index: 1, message: "Invalid `to` field." }],
      }),
    );

    const deliveries = await connectedSender(fetch).sendBatch(
      [email("uno@example.test"), email("mal"), email("tres@example.test")],
      IDEMPOTENCY_KEY,
    );

    expect(deliveries).toEqual([
      { kind: "sent" },
      { kind: "failed", reason: "Invalid `to` field." },
      { kind: "sent" },
    ]);
  });

  it("lanza un fallo de entrega si Resend rechaza el lote", async () => {
    const { fetch } = fakeFetch(async () =>
      jsonResponse(429, { name: "rate_limit_exceeded", message: "Too many" }),
    );

    await expect(
      connectedSender(fetch).sendBatch(
        [email("uno@example.test")],
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it("lanza un fallo de entrega si no puede hablar con Resend", async () => {
    const { fetch } = fakeFetch(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(
      connectedSender(fetch).sendBatch(
        [email("uno@example.test")],
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it("lanza un fallo de entrega si la respuesta no dice qué pasó con cada correo", async () => {
    const { fetch } = fakeFetch(async () => jsonResponse(200, { ok: true }));

    await expect(
      connectedSender(fetch).sendBatch(
        [email("uno@example.test")],
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toBeInstanceOf(EmailDeliveryError);
  });
});
