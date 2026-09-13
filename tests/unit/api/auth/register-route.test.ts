import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  IdentityCreation,
  NewMemberRow,
  RequestedConfirmationEmail,
} from "@/lib/auth/register-member";

const REGISTER_URL = "http://localhost/api/v1/auth/register";
const CLUB_ID = "6f1d2c3b-4a59-4e6f-8b70-1c2d3e4f5a6b";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const EMAIL = "nerea@example.test";

type Body = Record<string, unknown>;

function validBody(overrides: Body = {}): Body {
  return {
    fullName: "Nerea Silva",
    email: EMAIL,
    country: "AU",
    password: "bajoelagua",
    membershipType: "Full",
    dateOfBirth: "1994-03-02",
    ...overrides,
  };
}

const insertedRows: NewMemberRow[] = [];
const deletedUserIds: string[] = [];
const requestedEmails: string[] = [];

type WiringOptions = {
  readonly identityCreation?: IdentityCreation;
  readonly unconfigured?: readonly string[];
  readonly confirmationEmail?: RequestedConfirmationEmail;
};

/** Sustituye la raíz de composición por dobles: este test mira los códigos y
 * los cuerpos que devuelve la ruta, no si Supabase responde. */
function mockWiring(options: WiringOptions = {}): void {
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
              registration: {
                identities: {
                  createIdentity: async () =>
                    options.identityCreation ?? {
                      kind: "created",
                      userId: USER_ID,
                    },
                  deleteIdentity: async (userId: string) => {
                    deletedUserIds.push(userId);
                  },
                },
                members: {
                  insertMember: async (row: NewMemberRow) => {
                    insertedRows.push(row);
                  },
                },
                confirmationEmail: {
                  requestConfirmationEmail: async (email: string) => {
                    requestedEmails.push(email);
                    return options.confirmationEmail ?? { kind: "requested" };
                  },
                },
              },
            },
          },
  }));
}

async function postRegistration(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/v1/auth/register/route");
  return POST(
    new NextRequest(REGISTER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

type ErrorBody = { error: { code: string; message: string } };

async function errorBodyOf(response: Response): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}

function resetRecorded(): void {
  insertedRows.length = 0;
  deletedUserIds.length = 0;
  requestedEmails.length = 0;
}

describe("POST /api/v1/auth/register", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/auth/supabase-auth-gateways");
    resetRecorded();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("crea la cuenta y responde con la envoltura data", async () => {
    mockWiring();

    const response = await postRegistration(validBody());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { outcome: "confirmation_pending", email: EMAIL },
    });
  });

  it("escribe la fila del socio con el rol Player y el estado incomplete", async () => {
    mockWiring();

    await postRegistration(validBody({ membershipType: "Casual" }));

    expect(insertedRows).toEqual([
      {
        club_id: CLUB_ID,
        user_id: USER_ID,
        full_name: "Nerea Silva",
        email: EMAIL,
        country: "AU",
        date_of_birth: "1994-03-02",
        membership_type: "Casual",
        role: "Player",
        account_status: "incomplete",
      },
    ]);
  });

  it("responde 422 nombrando el campo cuando el tipo de membresía no existe", async () => {
    mockWiring();

    const response = await postRegistration(
      validBody({ membershipType: "Platinum" }),
    );

    expect(response.status).toBe(422);
    const body = await errorBodyOf(response);
    expect(body.error.code).toBe("business_rule");
    expect(body.error.message).toContain("membershipType");
  });

  it("responde 422 y nombra el mínimo de 8 con una contraseña de 7 caracteres", async () => {
    mockWiring();

    const response = await postRegistration(validBody({ password: "1234567" }));

    expect(response.status).toBe(422);
    expect((await errorBodyOf(response)).error.message).toContain("8");
  });

  it("rechaza una fecha de nacimiento futura en el servidor", async () => {
    mockWiring();

    const response = await postRegistration(
      validBody({ dateOfBirth: "3026-01-01" }),
    );

    expect(response.status).toBe(422);
    expect((await errorBodyOf(response)).error.message).toContain(
      "dateOfBirth",
    );
    expect(insertedRows).toEqual([]);
  });

  it("rechaza el registro sin país", async () => {
    mockWiring();

    const response = await postRegistration(validBody({ country: "" }));

    expect(response.status).toBe(422);
    expect((await errorBodyOf(response)).error.message).toContain("country");
  });

  it("responde 400 si al cuerpo le falta un campo entero", async () => {
    mockWiring();
    const sinPais = validBody();
    delete sinPais.country;

    const response = await postRegistration(sinPais);

    expect(response.status).toBe(400);
    expect((await errorBodyOf(response)).error.code).toBe("validation_error");
  });

  it("responde 400 si el cuerpo no es JSON", async () => {
    mockWiring();

    const response = await postRegistration("{no es json");

    expect(response.status).toBe(400);
  });

  it("no crea una segunda fila de socio cuando el correo ya tiene cuenta", async () => {
    mockWiring({ identityCreation: { kind: "already_registered" } });

    await postRegistration(validBody());

    expect(insertedRows).toEqual([]);
  });

  it("no pide el correo cuando la dirección ya tiene cuenta", async () => {
    mockWiring({ identityCreation: { kind: "already_registered" } });

    await postRegistration(validBody());

    expect(requestedEmails).toEqual([]);
  });

  it("responde 503 nombrando las variables que faltan", async () => {
    mockWiring({ unconfigured: ["SUPABASE_SERVICE_ROLE_KEY"] });

    const response = await postRegistration(validBody());

    expect(response.status).toBe(503);
    expect((await errorBodyOf(response)).error.message).toContain(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
  });

  it("responde 405 a un método que el endpoint no implementa", async () => {
    mockWiring();
    const { GET } = await import("@/app/api/v1/auth/register/route");

    const response = await GET(new NextRequest(REGISTER_URL));

    expect(response.status).toBe(405);
  });

  it("no devuelve la contraseña en ninguna respuesta", async () => {
    mockWiring();

    const response = await postRegistration(
      validBody({ password: "secretodelclub" }),
    );

    expect(await response.text()).not.toContain("secretodelclub");
  });
});

/** Lo que devuelve el adaptador de Supabase en cada caso real del 12 de
 * septiembre de 2026. El motivo ya llega sin la dirección. */
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

const ADDRESS_STATES: Readonly<Record<string, IdentityCreation>> = {
  nueva: { kind: "created", userId: USER_ID },
  "ya registrada": { kind: "already_registered" },
};

type RawResponse = { readonly status: number; readonly text: string };

async function registerWith(options: WiringOptions): Promise<RawResponse> {
  vi.resetModules();
  mockWiring(options);
  const response = await postRegistration(validBody());
  return { status: response.status, text: await response.text() };
}

describe("matriz de respuestas del registro", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/auth/supabase-auth-gateways");
    resetRecorded();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("responde idéntico byte a byte para cualquier envío y cualquier estado de la dirección", async () => {
    const responses: RawResponse[] = [];
    for (const confirmationEmail of Object.values(SEND_RESULTS)) {
      for (const identityCreation of Object.values(ADDRESS_STATES)) {
        responses.push(
          await registerWith({ confirmationEmail, identityCreation }),
        );
      }
    }

    expect(responses).toHaveLength(6);
    expect(new Set(responses.map((response) => response.status))).toEqual(
      new Set([200]),
    );
    expect(new Set(responses.map((response) => response.text)).size).toBe(1);
  });

  it("ningún campo del cuerpo habla del envío", async () => {
    const response = await registerWith({
      confirmationEmail: FAILED_SENDS["rechazo 429"],
    });

    const body = JSON.parse(response.text) as { data: Body };
    expect(Object.keys(body.data).sort()).toEqual(["email", "outcome"]);
  });
});

describe("registro del motivo", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/auth/supabase-auth-gateways");
    resetRecorded();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(Object.entries(FAILED_SENDS))(
    "con un %s el motivo de Supabase llega al log sin la dirección",
    async (_sendResult, outcome) => {
      mockWiring({ confirmationEmail: outcome });

      await postRegistration(validBody());

      const logged = vi.mocked(console.error).mock.calls.flat().map(String);
      expect(logged).toContain(outcome.reason);
      expect(logged.join(" ")).not.toContain(EMAIL);
    },
  );

  it("un envío que sale no deja nada en el log de errores", async () => {
    mockWiring({ confirmationEmail: { kind: "requested" } });

    await postRegistration(validBody());

    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("cuenta tras un envío fallido", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/auth/supabase-auth-gateways");
    resetRecorded();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(Object.entries(FAILED_SENDS))(
    "con un %s la identidad no se deshace y la fila del socio queda escrita",
    async (_sendResult, confirmationEmail) => {
      mockWiring({ confirmationEmail });

      await postRegistration(validBody());

      expect(insertedRows).toHaveLength(1);
      expect(deletedUserIds).toEqual([]);
    },
  );
});
