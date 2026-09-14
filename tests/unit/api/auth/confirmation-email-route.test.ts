import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConfirmationEmailOutcome,
  RequestedConfirmationEmail,
} from "@/lib/auth/register-member";

const CONFIRMATION_EMAIL_URL =
  "http://localhost/api/v1/auth/confirmation-email";
const EMAIL = "nerea@example.test";

const requestedEmails: string[] = [];
const requestedAppUrls: string[] = [];
const recordedRequests = { count: 0 };
const CLUB_ID = "6f1d2c3b-4a59-4e6f-8b70-1c2d3e4f5a6b";

function mockWiring(
  options: {
    readonly unconfigured?: readonly string[];
    readonly confirmationEmail?: ConfirmationEmailOutcome;
    readonly requestsInWindow?: number;
  } = {},
): void {
  vi.doMock("@/lib/auth/supabase-auth-gateways", () => ({
    DEFAULT_CLUB_SLUG: "victoria-seadragons",
    describeMissingAuthKeys: (missingKeys: readonly string[]) =>
      `El servicio de cuentas no está configurado: faltan ${missingKeys.join(", ")}.`,
    createSupabaseAuthGateways: () =>
      options.unconfigured
        ? { kind: "unconfigured", missingKeys: options.unconfigured }
        : {
            kind: "ready",
            gateways: {
              clubs: { findClubIdBySlug: async () => CLUB_ID },
              confirmationEmailRequestsForClub: () => ({
                recordAndCountRecent: async () => {
                  recordedRequests.count += 1;
                  return options.requestsInWindow ?? 1;
                },
              }),
              confirmationEmail: {
                requestConfirmationEmail: async (
                  email: string,
                  appUrl: string,
                ) => {
                  requestedEmails.push(email);
                  requestedAppUrls.push(appUrl);
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
    requestedAppUrls.length = 0;
    recordedRequests.count = 0;
  });

  // Antes el tope lo ponía sin querer el servicio incorporado de Supabase. Con
  // Resend, sin este límite, un bucle contra el endpoint llena un buzón ajeno
  // y agota el cupo que comparte la recuperación de contraseña.
  it("superado el límite responde 429 pidiendo esperar, sin pedir ningún correo", async () => {
    mockWiring({ requestsInWindow: 4 });

    const response = await postConfirmationEmail({ email: EMAIL });

    expect(response.status).toBe(429);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.message).toContain("15 minutos");
    expect(requestedEmails).toEqual([]);
  });

  it("cuenta la petición antes de pedir el correo", async () => {
    mockWiring();

    await postConfirmationEmail({ email: EMAIL });

    expect(recordedRequests.count).toBe(1);
    expect(requestedEmails).toEqual([EMAIL]);
  });

  it("no cuenta una dirección sin forma de correo", async () => {
    mockWiring();

    await postConfirmationEmail({ email: "nerea" });

    expect(recordedRequests.count).toBe(0);
  });

  it("reenvía la confirmación a la dirección normalizada", async () => {
    mockWiring();

    const response = await postConfirmationEmail({
      email: "  Nerea@Example.Test ",
    });

    expect(response.status).toBe(200);
    expect(requestedEmails).toEqual([EMAIL]);
  });

  it("pide el enlace con la dirección de la petición, para que vuelva a este despliegue", async () => {
    mockWiring();

    await postConfirmationEmail({ email: EMAIL });

    expect(requestedAppUrls).toEqual([CONFIRMATION_EMAIL_URL]);
  });

  it("no registra nada cuando no había confirmación pendiente que mandar", async () => {
    mockWiring({ confirmationEmail: { kind: "not_requested" } });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await postConfirmationEmail({ email: EMAIL });

    expect(response.status).toBe(200);
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("no delata si esa dirección tiene cuenta: el cuerpo sólo repite el correo", async () => {
    mockWiring();

    const response = await postConfirmationEmail({
      email: "desconocida@example.test",
    });

    await expect(response.json()).resolves.toEqual({
      data: {
        outcome: "confirmation_pending",
        email: "desconocida@example.test",
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

    const response = await postConfirmationEmail({ email: EMAIL });

    expect(response.status).toBe(503);
  });
});

const FAILED_SENDS = {
  "rechazo 400": {
    kind: "failed",
    reason: '400: Email address "<correo>" is invalid',
  },
  "rechazo 429": {
    kind: "rate_limited",
    reason: "429: email rate limit exceeded",
  },
  "rechazo 429 por dirección": {
    kind: "rate_limited",
    reason:
      "429: For security purposes, you can only request this after 60 seconds.",
  },
} as const satisfies Record<string, RequestedConfirmationEmail>;

/** Lo que Supabase contesta en cada estado de la cuenta
 * (`internal/api/resend.go`): sin cuenta o ya confirmada responde 200 sin
 * intentar el envío, y sólo una cuenta sin confirmar puede fallar. El estado no
 * es una entrada de la ruta, así que llega a ella sólo a través de esto. */
const SUPABASE_ANSWERS_BY_ACCOUNT_STATE: Readonly<
  Record<string, readonly RequestedConfirmationEmail[]>
> = {
  "sin cuenta": [{ kind: "requested" }],
  confirmada: [{ kind: "requested" }],
  "sin confirmar": [{ kind: "requested" }, ...Object.values(FAILED_SENDS)],
};

type RawResponse = { readonly status: number; readonly text: string };

async function resendWith(
  confirmationEmail: RequestedConfirmationEmail,
): Promise<RawResponse> {
  vi.resetModules();
  mockWiring({ confirmationEmail });
  const response = await postConfirmationEmail({ email: EMAIL });
  return { status: response.status, text: await response.text() };
}

describe("envío del correo de confirmación en el reenvío", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/auth/supabase-auth-gateways");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("matriz de respuestas del reenvío", () => {
    it("responde idéntico byte a byte para cualquier envío y cualquier estado de la cuenta", async () => {
      const responses: RawResponse[] = [];
      for (const answers of Object.values(SUPABASE_ANSWERS_BY_ACCOUNT_STATE)) {
        for (const outcome of answers) {
          responses.push(await resendWith(outcome));
        }
      }

      expect(responses).toHaveLength(6);
      expect(new Set(responses.map((response) => response.status))).toEqual(
        new Set([200]),
      );
      expect(new Set(responses.map((response) => response.text)).size).toBe(1);
    });
  });

  describe("registro del motivo en el reenvío", () => {
    it.each(Object.entries(FAILED_SENDS))(
      "con un %s el motivo de Supabase llega al log sin la dirección",
      async (_sendResult, outcome) => {
        mockWiring({ confirmationEmail: outcome });

        await postConfirmationEmail({ email: EMAIL });

        const logged = vi.mocked(console.error).mock.calls.flat().map(String);
        expect(logged).toContain(outcome.reason);
        expect(logged.join(" ")).not.toContain(EMAIL);
      },
    );
  });
});
