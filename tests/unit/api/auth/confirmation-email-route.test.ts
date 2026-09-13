import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestedConfirmationEmail } from "@/lib/auth/register-member";

const CONFIRMATION_EMAIL_URL =
  "http://localhost/api/v1/auth/confirmation-email";
const EMAIL = "nerea@example.test";

const requestedEmails: string[] = [];

function mockWiring(
  options: {
    readonly unconfigured?: readonly string[];
    readonly confirmationEmail?: RequestedConfirmationEmail;
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
    expect(requestedEmails).toEqual([EMAIL]);
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
} as const satisfies Record<string, RequestedConfirmationEmail>;

const SEND_RESULTS: Readonly<Record<string, RequestedConfirmationEmail>> = {
  salió: { kind: "requested" },
  ...FAILED_SENDS,
};

/** El estado de la cuenta no es una entrada de la ruta: sólo cambia lo que
 * Supabase contesta. Por eso cada estado se cruza con los tres resultados, y
 * si la ruta llegara a distinguir alguno la matriz dejaría de ser uniforme. */
const ACCOUNT_STATES = ["sin cuenta", "confirmada", "sin confirmar"] as const;

type RawResponse = { readonly status: number; readonly text: string };

async function resendWith(
  confirmationEmail: RequestedConfirmationEmail,
): Promise<RawResponse> {
  vi.resetModules();
  mockWiring({ confirmationEmail });
  const response = await postConfirmationEmail({ email: EMAIL });
  return { status: response.status, text: await response.text() };
}

describe("matriz de respuestas del reenvío", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/auth/supabase-auth-gateways");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("responde idéntico byte a byte para cualquier envío y cualquier estado de la cuenta", async () => {
    const responses: RawResponse[] = [];
    for (const accountState of ACCOUNT_STATES) {
      for (const [sendResult, outcome] of Object.entries(SEND_RESULTS)) {
        responses.push(await resendWith(outcome));
        expect(
          responses.at(-1)?.status,
          `${accountState} / ${sendResult}`,
        ).toBe(200);
      }
    }

    expect(responses).toHaveLength(9);
    expect(new Set(responses.map((response) => response.text)).size).toBe(1);
  });
});

describe("registro del motivo en el reenvío", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/auth/supabase-auth-gateways");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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
