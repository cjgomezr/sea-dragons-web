import { describe, expect, it } from "vitest";
import {
  EMAIL_FROM_ENV,
  RESEND_API_KEY_ENV,
  RESEND_PROBE_ENDPOINT,
  createResendProviderProbe,
} from "@/lib/email/resend-email-sender";

const API_KEY = "re_clave_de_mentira";
const CONFIGURED_ENV = {
  [RESEND_API_KEY_ENV]: API_KEY,
  [EMAIL_FROM_ENV]: "Victoria Seadragons <seadragons@volleytip.com>",
};

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

function textResponse(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { "content-type": "text/html" },
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("sonda del proveedor de correo", () => {
  it("pregunta a Resend con la clave y sin mandar ningún correo", async () => {
    const fake = fakeFetch(async () => jsonResponse(200, { data: [] }));

    await createResendProviderProbe(CONFIGURED_ENV, fake.fetch).probeProvider();

    expect(fake.requests).toHaveLength(1);
    const [request] = fake.requests;
    expect(request?.url).toBe(RESEND_PROBE_ENDPOINT);
    expect(request?.init?.method).toBe("GET");
    expect(request?.init?.body).toBeUndefined();
    expect(new Headers(request?.init?.headers).get("authorization")).toBe(
      `Bearer ${API_KEY}`,
    );
  });

  it("un 200 es un proveedor que contesta", async () => {
    const fake = fakeFetch(async () => jsonResponse(200, { data: [] }));

    const status = await createResendProviderProbe(
      CONFIGURED_ENV,
      fake.fetch,
    ).probeProvider();

    expect(status).toEqual({ kind: "reachable" });
  });

  // La clave de producción sólo puede enviar: a cualquier otra consulta Resend
  // responde 401 restricted_api_key. Eso ya prueba que está en pie y que la
  // clave vale.
  it("un 401 de clave de sólo envío es un proveedor que contesta", async () => {
    const fake = fakeFetch(async () =>
      jsonResponse(401, {
        name: "restricted_api_key",
        message: "This API key is restricted to only send emails.",
      }),
    );

    const status = await createResendProviderProbe(
      CONFIGURED_ENV,
      fake.fetch,
    ).probeProvider();

    expect(status).toEqual({ kind: "reachable" });
  });

  it("un 429 por peticiones por segundo es un proveedor que contesta", async () => {
    const fake = fakeFetch(async () =>
      jsonResponse(429, { name: "rate_limit_exceeded", message: "Too many" }),
    );

    const status = await createResendProviderProbe(
      CONFIGURED_ENV,
      fake.fetch,
    ).probeProvider();

    expect(status).toEqual({ kind: "reachable" });
  });

  it.each([
    [500, "application_error"],
    [503, "service_unavailable"],
  ])("un %i (%s) es un proveedor caído", async (statusCode, name) => {
    const fake = fakeFetch(async () =>
      jsonResponse(statusCode, { name, message: "caído" }),
    );

    const status = await createResendProviderProbe(
      CONFIGURED_ENV,
      fake.fetch,
    ).probeProvider();

    expect(status.kind).toBe("unreachable");
    expect(status.kind === "unreachable" && status.reason).toContain(
      String(statusCode),
    );
  });

  it("una clave suspendida (403) deja el envío sin proveedor", async () => {
    const fake = fakeFetch(async () =>
      jsonResponse(403, {
        name: "suspended_api_key",
        message: "This API key is suspended",
      }),
    );

    const status = await createResendProviderProbe(
      CONFIGURED_ENV,
      fake.fetch,
    ).probeProvider();

    expect(status.kind).toBe("unreachable");
    expect(status.kind === "unreachable" && status.reason).toContain(
      "suspended_api_key",
    );
  });

  it("sin red es un proveedor caído, con el motivo", async () => {
    const fake = fakeFetch(async () => {
      throw new TypeError("fetch failed");
    });

    const status = await createResendProviderProbe(
      CONFIGURED_ENV,
      fake.fetch,
    ).probeProvider();

    expect(status).toEqual({
      kind: "unreachable",
      reason: "No se pudo hablar con Resend: fetch failed",
    });
  });

  it("sin la clave no sale a la red y nombra la variable", async () => {
    const fake = fakeFetch(async () => jsonResponse(200, {}));

    const status = await createResendProviderProbe(
      {},
      fake.fetch,
    ).probeProvider();

    expect(fake.requests).toEqual([]);
    expect(status.kind === "unreachable" && status.reason).toContain(
      RESEND_API_KEY_ENV,
    );
  });

  // La sonda pregunta si Resend contesta y si la clave sirve, así que su regla
  // es una lista negra: sólo un 5xx o un error que hable de la clave dejan sin
  // envío. Equivocarse hacia "en pie" devuelve el texto neutro del #147;
  // equivocarse hacia "caído" deja a todo el mundo sin poder registrarse.
  it.each([
    [403, "restricted_api_key"],
    [404, "not_found"],
    [400, "validation_error"],
  ])(
    "un %i (%s) no habla de una clave rota, así que el proveedor contesta",
    async (statusCode, name) => {
      const fake = fakeFetch(async () =>
        jsonResponse(statusCode, { name, message: "lo que sea" }),
      );

      const status = await createResendProviderProbe(
        CONFIGURED_ENV,
        fake.fetch,
      ).probeProvider();

      expect(status).toEqual({ kind: "reachable" });
    },
  );

  it("un 404 con un cuerpo que no es JSON sigue siendo un proveedor que contesta", async () => {
    const fake = fakeFetch(async () => textResponse(404, "<html>Not Found"));

    const status = await createResendProviderProbe(
      CONFIGURED_ENV,
      fake.fetch,
    ).probeProvider();

    expect(status).toEqual({ kind: "reachable" });
  });

  // La documentación de Resend mezcla mayúsculas en los nombres de sus
  // errores, así que la comparación no puede depender de ellas.
  it("reconoce la clave inválida aunque el nombre venga con mayúsculas", async () => {
    const fake = fakeFetch(async () =>
      jsonResponse(401, {
        name: "invalid_api_Key",
        message: "API key is invalid",
      }),
    );

    const status = await createResendProviderProbe(
      CONFIGURED_ENV,
      fake.fetch,
    ).probeProvider();

    expect(status.kind).toBe("unreachable");
  });

  it("una clave inválida (401) deja el envío sin proveedor", async () => {
    const fake = fakeFetch(async () =>
      jsonResponse(401, {
        name: "invalid_api_key",
        message: "API key is invalid",
      }),
    );

    const status = await createResendProviderProbe(
      CONFIGURED_ENV,
      fake.fetch,
    ).probeProvider();

    expect(status.kind).toBe("unreachable");
    expect(status.kind === "unreachable" && status.reason).toContain(
      "invalid_api_key",
    );
  });

  // Sin esto, cada registro gasta las dos peticiones por segundo que permite
  // Resend: la sonda y el envío de verdad.
  it("recuerda unos segundos que el proveedor está en pie y no vuelve a preguntar", async () => {
    const fake = fakeFetch(async () => jsonResponse(200, { data: [] }));
    const probe = createResendProviderProbe(
      CONFIGURED_ENV,
      fake.fetch,
      () => 1_000,
    );

    await probe.probeProvider();
    const status = await probe.probeProvider();

    expect(status).toEqual({ kind: "reachable" });
    expect(fake.requests).toHaveLength(1);
  });

  it("vuelve a preguntar cuando el recuerdo caduca", async () => {
    const fake = fakeFetch(async () => jsonResponse(200, { data: [] }));
    let ahora = 1_000;
    const probe = createResendProviderProbe(
      CONFIGURED_ENV,
      fake.fetch,
      () => ahora,
    );

    await probe.probeProvider();
    ahora += 60_000;
    await probe.probeProvider();

    expect(fake.requests).toHaveLength(2);
  });

  // Una caída tiene que poder recuperarse en la petición siguiente.
  it("no recuerda una caída", async () => {
    const fake = fakeFetch(async () =>
      jsonResponse(500, { name: "application_error", message: "caído" }),
    );
    const probe = createResendProviderProbe(
      CONFIGURED_ENV,
      fake.fetch,
      () => 1_000,
    );

    await probe.probeProvider();
    await probe.probeProvider();

    expect(fake.requests).toHaveLength(2);
  });
});
