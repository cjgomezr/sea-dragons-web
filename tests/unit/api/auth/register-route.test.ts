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
const requestedAppUrls: string[] = [];
const calls: string[] = [];
const scheduledWork: (() => Promise<void>)[] = [];

type WiringOptions = {
  readonly identityCreation?: IdentityCreation;
  readonly unconfigured?: readonly string[];
  readonly confirmationEmail?: RequestedConfirmationEmail;
  readonly createIdentityFails?: Error;
  readonly confirmationEmailFails?: Error;
};

/** Sustituye la raíz de composición y `after` por dobles: este test mira los
 * códigos y los cuerpos que devuelve la ruta, y qué deja para después, no si
 * Supabase responde. */
function mockWiring(options: WiringOptions = {}): void {
  vi.doMock("@/lib/api/after-response", () => ({
    runAfterResponse: (work: () => Promise<void>) => {
      scheduledWork.push(work);
    },
  }));
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
                  createIdentity: async () => {
                    calls.push("createIdentity");
                    if (options.createIdentityFails) {
                      throw options.createIdentityFails;
                    }
                    return (
                      options.identityCreation ?? {
                        kind: "created",
                        userId: USER_ID,
                      }
                    );
                  },
                  deleteIdentity: async (userId: string) => {
                    deletedUserIds.push(userId);
                  },
                },
                members: {
                  insertMember: async (row: NewMemberRow) => {
                    calls.push("insertMember");
                    insertedRows.push(row);
                  },
                },
                confirmationEmail: {
                  requestConfirmationEmail: async (
                    email: string,
                    appUrl: string,
                  ) => {
                    calls.push("requestConfirmationEmail");
                    requestedEmails.push(email);
                    requestedAppUrls.push(appUrl);
                    if (options.confirmationEmailFails) {
                      throw options.confirmationEmailFails;
                    }
                    return options.confirmationEmail ?? { kind: "requested" };
                  },
                },
              },
              emailDeliveryForClub: () => ({
                checkAvailability: async () => ({ kind: "available" }),
              }),
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

/** Lo que la ruta dejó para después de responder. En producción lo corre
 * `after` de Next.js; aquí se corre a mano, y sólo después de la respuesta. */
async function runScheduledWork(): Promise<void> {
  for (const work of scheduledWork.splice(0)) {
    await work();
  }
}

/** Registra y corre el trabajo diferido, para los tests que miran el efecto
 * final y no el momento. */
async function registerAndDeliver(body: unknown): Promise<Response> {
  const response = await postRegistration(body);
  await runScheduledWork();
  return response;
}

type ErrorBody = { error: { code: string; message: string } };

async function errorBodyOf(response: Response): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}

function resetRecorded(): void {
  insertedRows.length = 0;
  deletedUserIds.length = 0;
  requestedEmails.length = 0;
  requestedAppUrls.length = 0;
  calls.length = 0;
  scheduledWork.length = 0;
}

function loggedErrors(): string {
  return vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
}

function resetModulesAndRecorded(): void {
  vi.resetModules();
  vi.doUnmock("@/lib/auth/supabase-auth-gateways");
  vi.doUnmock("@/lib/api/after-response");
  resetRecorded();
}

describe("POST /api/v1/auth/register", () => {
  beforeEach(resetModulesAndRecorded);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("crea la cuenta y responde con la envoltura data", async () => {
    mockWiring();

    const response = await registerAndDeliver(validBody());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { outcome: "confirmation_pending", email: EMAIL },
    });
  });

  it("pide el correo de confirmación con la dirección de la petición", async () => {
    mockWiring();

    await registerAndDeliver(validBody());

    expect(requestedAppUrls).toEqual([REGISTER_URL]);
  });

  it("escribe la fila del socio con el rol Player y el estado incomplete", async () => {
    mockWiring();

    await registerAndDeliver(validBody({ membershipType: "Casual" }));

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

    await registerAndDeliver(validBody());

    expect(insertedRows).toEqual([]);
  });

  it("no pide el correo cuando la dirección ya tiene cuenta", async () => {
    mockWiring({ identityCreation: { kind: "already_registered" } });

    await registerAndDeliver(validBody());

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

    const response = await registerAndDeliver(
      validBody({ password: "secretodelclub" }),
    );

    expect(await response.text()).not.toContain("secretodelclub");
  });
});

describe("registro con entrega diferida", () => {
  beforeEach(resetModulesAndRecorded);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Saber si la dirección ya tiene cuenta exige intentar crear la identidad.
  // Si la respuesta esperara a eso, lo que tarda delataría la cuenta.
  it("responde sin crear la identidad, ni escribir la fila, ni pedir el correo", async () => {
    mockWiring();

    const response = await postRegistration(validBody());

    expect(response.status).toBe(200);
    expect(calls).toEqual([]);
    expect(scheduledWork).toHaveLength(1);
  });

  it("el trabajo diferido crea la identidad, escribe la fila y pide el correo, en ese orden", async () => {
    mockWiring();

    await registerAndDeliver(validBody());

    expect(calls).toEqual([
      "createIdentity",
      "insertMember",
      "requestConfirmationEmail",
    ]);
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
  "rechazo 429 por dirección": {
    kind: "rate_limited",
    reason:
      "429: For security purposes, you can only request this after 60 seconds.",
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

type RawResponse = {
  readonly status: number;
  readonly text: string;
  readonly scheduledWork: number;
};

async function registerWith(options: WiringOptions): Promise<RawResponse> {
  resetModulesAndRecorded();
  mockWiring(options);
  const response = await postRegistration(validBody());
  return {
    status: response.status,
    text: await response.text(),
    scheduledWork: scheduledWork.length,
  };
}

describe("envío del correo de confirmación en el registro", () => {
  beforeEach(() => {
    resetModulesAndRecorded();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("matriz de tiempo del registro", () => {
    it("una dirección nueva y una ya registrada dejan un trabajo diferido cada una y responden idéntico", async () => {
      const nueva = await registerWith({
        identityCreation: ADDRESS_STATES.nueva,
      });
      const registrada = await registerWith({
        identityCreation: ADDRESS_STATES["ya registrada"],
      });

      expect(nueva.scheduledWork).toBe(1);
      expect(registrada).toEqual(nueva);
    });
  });

  describe("matriz de respuestas del registro", () => {
    it("responde idéntico byte a byte para cualquier envío y cualquier estado de la dirección", async () => {
      const responses: RawResponse[] = [];
      for (const confirmationEmail of Object.values(SEND_RESULTS)) {
        for (const identityCreation of Object.values(ADDRESS_STATES)) {
          responses.push(
            await registerWith({ confirmationEmail, identityCreation }),
          );
        }
      }

      expect(responses).toHaveLength(8);
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
    it.each(Object.entries(FAILED_SENDS))(
      "con un %s el motivo de Supabase llega al log sin la dirección",
      async (_sendResult, outcome) => {
        mockWiring({ confirmationEmail: outcome });

        await registerAndDeliver(validBody());

        const logged = vi.mocked(console.error).mock.calls.flat().map(String);
        expect(logged).toContain(outcome.reason);
        expect(logged.join(" ")).not.toContain(EMAIL);
      },
    );

    it("un envío que sale no deja nada en el log de errores", async () => {
      mockWiring({ confirmationEmail: { kind: "requested" } });

      await registerAndDeliver(validBody());

      expect(console.error).not.toHaveBeenCalled();
    });
  });

  describe("cuenta tras un envío fallido", () => {
    it.each(Object.entries(FAILED_SENDS))(
      "con un %s la identidad no se deshace y la fila del socio queda escrita",
      async (_sendResult, confirmationEmail) => {
        mockWiring({ confirmationEmail });

        await registerAndDeliver(validBody());

        expect(insertedRows).toHaveLength(1);
        expect(deletedUserIds).toEqual([]);
      },
    );
  });
});

describe("fallo diferido del registro", () => {
  beforeEach(() => {
    resetModulesAndRecorded();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  type DeferredFailure = {
    readonly options: WiringOptions;
    readonly rootCause: string;
  };

  const FAILURES: Readonly<Record<string, DeferredFailure>> = {
    Supabase: {
      options: {
        createIdentityFails: new Error(`no se pudo crear ${EMAIL}`, {
          cause: new Error("ECONNRESET en auth"),
        }),
      },
      rootCause: "ECONNRESET en auth",
    },
    Resend: {
      options: {
        confirmationEmailFails: new Error(`Resend rechazó ${EMAIL}`, {
          cause: new Error("fetch failed: ETIMEDOUT"),
        }),
      },
      rootCause: "fetch failed: ETIMEDOUT",
    },
  };

  it.each(Object.entries(FAILURES))(
    "un error de %s llega al registro sin la dirección y con su causa",
    async (_service, failure) => {
      mockWiring(failure.options);

      await registerAndDeliver(validBody());

      const log = loggedErrors();
      expect(log).toContain(`Causado por: Error: ${failure.rootCause}`);
      expect(log).not.toContain(EMAIL);
    },
  );

  it.each(Object.entries(FAILURES))(
    "un error de %s no cambia la respuesta ya enviada",
    async (_service, failure) => {
      const sano = await registerWith({});
      const fallido = await registerWith(failure.options);

      await expect(runScheduledWork()).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalledOnce();
      expect(fallido).toEqual(sano);
    },
  );
});

describe("validación del registro", () => {
  beforeEach(resetModulesAndRecorded);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  type InvalidForm = { readonly body: unknown; readonly status: 400 | 422 };

  const INVALID_FORMS: Readonly<Record<string, InvalidForm>> = {
    "sin un campo": {
      body: { ...validBody(), country: undefined },
      status: 400,
    },
    "con un correo sin forma": {
      body: validBody({ email: "nerea" }),
      status: 422,
    },
    "con una fecha de nacimiento futura": {
      body: validBody({ dateOfBirth: "3026-01-01" }),
      status: 422,
    },
    "con un tipo de membresía que no existe": {
      body: validBody({ membershipType: "Platinum" }),
      status: 422,
    },
  };

  it.each(Object.entries(INVALID_FORMS))(
    "un formulario %s responde con su error y no deja trabajo diferido",
    async (_form, form) => {
      mockWiring();

      const response = await postRegistration(form.body);

      expect(response.status).toBe(form.status);
      expect(scheduledWork).toEqual([]);
      expect(calls).toEqual([]);
    },
  );
});
