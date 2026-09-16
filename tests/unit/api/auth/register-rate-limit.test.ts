import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentityCreation } from "@/lib/auth/register-member";
import {
  MAX_REGISTRATIONS_PER_BUCKET_PER_WINDOW,
  MAX_REGISTRATIONS_PER_EMAIL_PER_WINDOW,
  REGISTRATION_WINDOW_MINUTES,
  type RegistrationSubject,
} from "@/lib/auth/registration-rate-limit";

/**
 * El límite de `POST /api/v1/auth/register` visto desde fuera (#173). Sin él,
 * 80 peticiones con direcciones inventadas agotan el cupo propio de correos y
 * dejan al club 24 horas sin confirmaciones.
 */

const REGISTER_URL = "http://localhost/api/v1/auth/register";
const CLUB_ID = "6f1d2c3b-4a59-4e6f-8b70-1c2d3e4f5a6b";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const EMAIL = "nerea@example.test";
const IP = "203.0.113.7";
const OTHER_IP = "198.51.100.4";

/** El contador vive fuera de `mockWiring` porque la ruta rehace la raíz de
 * composición en cada petición, y el límite tiene que recordar las anteriores. */
const counts = new Map<string, number>();
const calls: string[] = [];
const scheduledWork: (() => Promise<void>)[] = [];
const insertedEmails: string[] = [];
const requestedEmails: string[] = [];

function keyOf(subject: RegistrationSubject): string {
  return `${subject.kind}:${subject.value}`;
}

type WiringOptions = {
  readonly identityCreation?: IdentityCreation;
  readonly rateLimitLogFails?: Error;
};

function mockWiring(options: WiringOptions = {}): void {
  vi.doMock("@/lib/api/after-response", () => ({
    runAfterResponse: (work: () => Promise<void>) => {
      scheduledWork.push(work);
    },
  }));
  vi.doMock("@/lib/auth/supabase-auth-gateways", () => ({
    DEFAULT_CLUB_SLUG: "victoria-seadragons",
    describeMissingAuthKeys: () => "sin configurar",
    createSupabaseAuthGateways: () => ({
      kind: "ready",
      gateways: {
        clubs: { findClubIdBySlug: async () => CLUB_ID },
        registration: {
          identities: {
            createIdentity: async () => {
              calls.push("createIdentity");
              return (
                options.identityCreation ?? {
                  kind: "created",
                  userId: USER_ID,
                }
              );
            },
            deleteIdentity: async () => {},
          },
          members: {
            insertMember: async (row: { readonly email: string }) => {
              calls.push("insertMember");
              insertedEmails.push(row.email);
            },
          },
          confirmationEmail: {
            requestConfirmationEmail: async (email: string) => {
              calls.push("requestConfirmationEmail");
              requestedEmails.push(email);
              return { kind: "requested" };
            },
          },
        },
        registrationRequestsForClub: () => ({
          recordAndCountRecent: async (input: {
            readonly subject: RegistrationSubject;
          }) => {
            calls.push(`recordAndCountRecent:${input.subject.kind}`);
            if (options.rateLimitLogFails) {
              throw options.rateLimitLogFails;
            }
            const key = keyOf(input.subject);
            const next = (counts.get(key) ?? 0) + 1;
            counts.set(key, next);
            return next;
          },
        }),
        emailDeliveryForClub: () => ({
          checkAvailability: async () => {
            // Es la llamada que anota en el cupo propio de correos: si ocurre,
            // la petición gastó cupo.
            calls.push("checkAvailability");
            return { kind: "available" };
          },
        }),
      },
    }),
  }));
}

function bodyWith(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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

type RawResponse = { readonly status: number; readonly text: string };

async function postRegistration(
  options: {
    readonly ip?: string | null;
    readonly body?: Record<string, unknown>;
  } = {},
): Promise<RawResponse> {
  const { POST } = await import("@/app/api/v1/auth/register/route");
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const ip = options.ip === undefined ? IP : options.ip;
  if (ip !== null) {
    headers["x-forwarded-for"] = ip;
  }
  const response = await POST(
    new NextRequest(REGISTER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(options.body ?? bodyWith()),
    }),
  );
  return { status: response.status, text: await response.text() };
}

/** Olvida lo apuntado sin tocar los contadores del límite: lo que gastó el
 * cupo es preparación, y lo que el test mira es sólo la petición siguiente. */
function clearRecorded(): void {
  calls.length = 0;
  scheduledWork.length = 0;
  insertedEmails.length = 0;
  requestedEmails.length = 0;
}

/** Gasta el cupo de la procedencia sin tocar el de ninguna dirección: cada
 * intento usa un correo distinto. */
async function exhaustBucket(ip: string = IP): Promise<void> {
  for (
    let attempt = 0;
    attempt < MAX_REGISTRATIONS_PER_BUCKET_PER_WINDOW;
    attempt++
  ) {
    await postRegistration({
      ip,
      body: bodyWith({ email: `socio${attempt}@example.test` }),
    });
  }
}

/** Gasta el cupo de la dirección repartiendo los intentos entre procedencias,
 * para que no sea el límite por IP el que acabe rechazando. */
async function exhaustEmail(): Promise<void> {
  for (
    let attempt = 0;
    attempt < MAX_REGISTRATIONS_PER_EMAIL_PER_WINDOW;
    attempt++
  ) {
    await postRegistration({ ip: `198.51.100.${attempt + 10}` });
  }
}

function reset(): void {
  vi.resetModules();
  vi.doUnmock("@/lib/auth/supabase-auth-gateways");
  vi.doUnmock("@/lib/api/after-response");
  counts.clear();
  calls.length = 0;
  scheduledWork.length = 0;
  insertedEmails.length = 0;
  requestedEmails.length = 0;
}

function loggedErrors(): string {
  return vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
}

beforeEach(() => {
  reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("límite del registro por IP", () => {
  it("deja pasar las peticiones que caben en la ventana", async () => {
    mockWiring();

    await exhaustBucket();

    expect(calls.filter((call) => call === "checkAvailability")).toHaveLength(
      MAX_REGISTRATIONS_PER_BUCKET_PER_WINDOW,
    );
  });

  it("rechaza la siguiente diciendo cuánto esperar", async () => {
    mockWiring();
    await exhaustBucket();

    const response = await postRegistration({
      body: bodyWith({ email: "ultima@example.test" }),
    });

    expect(response.status).toBe(429);
    const body = JSON.parse(response.text) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.message).toContain(String(REGISTRATION_WINDOW_MINUTES));
  });

  it("no crea ninguna cuenta con la petición rechazada", async () => {
    mockWiring();
    await exhaustBucket();
    clearRecorded();

    await postRegistration({
      body: bodyWith({ email: "ultima@example.test" }),
    });
    for (const work of scheduledWork.splice(0)) {
      await work();
    }

    expect(insertedEmails).toEqual([]);
    expect(calls).not.toContain("createIdentity");
  });

  it("deja pasar la misma cuenta desde otra IP", async () => {
    mockWiring();
    await exhaustBucket();

    const response = await postRegistration({ ip: OTHER_IP });

    expect(response.status).toBe(200);
  });
});

describe("límite del registro por dirección", () => {
  it("rechaza la siguiente aunque venga de otra IP", async () => {
    mockWiring();
    await exhaustEmail();

    const response = await postRegistration({ ip: "198.51.100.200" });

    expect(response.status).toBe(429);
  });

  it("deja pasar otra dirección desde la misma IP", async () => {
    mockWiring();
    await exhaustEmail();

    const response = await postRegistration({
      ip: "198.51.100.200",
      body: bodyWith({ email: "otra@example.test" }),
    });

    expect(response.status).toBe(200);
  });
});

describe("el límite no gasta el cupo de correos", () => {
  it("una petición rechazada no pregunta por la disponibilidad del envío", async () => {
    mockWiring();
    await exhaustBucket();
    clearRecorded();

    await postRegistration({
      body: bodyWith({ email: "ultima@example.test" }),
    });

    expect(calls).not.toContain("checkAvailability");
  });

  it("una petición rechazada no toca Supabase ni Resend", async () => {
    mockWiring();
    await exhaustBucket();
    clearRecorded();

    await postRegistration({
      body: bodyWith({ email: "ultima@example.test" }),
    });
    for (const work of scheduledWork.splice(0)) {
      await work();
    }

    expect(requestedEmails).toEqual([]);
    expect(calls).toEqual(["recordAndCountRecent:ip"]);
  });

  it("cuenta el límite antes de mirar el cupo, para que una ráfaga no lo agote", async () => {
    mockWiring();

    await postRegistration();

    expect(calls.slice(0, 3)).toEqual([
      "recordAndCountRecent:ip",
      "recordAndCountRecent:email",
      "checkAvailability",
    ]);
  });

  it("una solicitud inválida no llega ni a contar: se valida antes", async () => {
    mockWiring();

    const response = await postRegistration({
      body: bodyWith({ membershipType: "Platinum" }),
    });

    expect(response.status).toBe(422);
    expect(calls).toEqual([]);
  });
});

describe("el límite no delata cuentas", () => {
  it("responde idéntico byte a byte con una dirección nueva y una ya registrada", async () => {
    const responses: RawResponse[] = [];
    for (const identityCreation of [
      { kind: "created", userId: USER_ID },
      { kind: "already_registered" },
    ] satisfies IdentityCreation[]) {
      reset();
      mockWiring({ identityCreation });
      await exhaustBucket();
      responses.push(
        await postRegistration({
          body: bodyWith({ email: "ultima@example.test" }),
        }),
      );
    }

    expect(responses[0]?.status).toBe(429);
    expect(responses[1]).toEqual(responses[0]);
  });

  it("no hace ningún trabajo que dependa de la cuenta, así que tampoco tarda distinto", async () => {
    mockWiring({ identityCreation: { kind: "already_registered" } });
    await exhaustBucket();
    clearRecorded();

    await postRegistration({
      body: bodyWith({ email: "ultima@example.test" }),
    });

    expect(scheduledWork).toEqual([]);
    expect(calls).toEqual(["recordAndCountRecent:ip"]);
  });
});

describe("el registro del rechazo no lleva direcciones", () => {
  it("no deja el correo en el registro del servidor", async () => {
    mockWiring();
    await exhaustEmail();

    const response = await postRegistration({ ip: "198.51.100.200" });

    expect(response.status).toBe(429);
    expect(loggedErrors()).not.toContain(EMAIL);
  });

  it("tampoco lo deja en el cuerpo de la respuesta", async () => {
    mockWiring();
    await exhaustEmail();

    const response = await postRegistration({ ip: "198.51.100.200" });

    expect(response.text).not.toContain(EMAIL);
  });
});

describe("peticiones sin IP identificable", () => {
  it("caen todas en el mismo cubo en vez de saltarse el límite", async () => {
    mockWiring();

    for (
      let attempt = 0;
      attempt < MAX_REGISTRATIONS_PER_BUCKET_PER_WINDOW;
      attempt++
    ) {
      await postRegistration({
        ip: null,
        body: bodyWith({ email: `socio${attempt}@example.test` }),
      });
    }
    const response = await postRegistration({
      ip: null,
      body: bodyWith({ email: "ultima@example.test" }),
    });

    expect(response.status).toBe(429);
  });
});

describe("la tabla del límite no responde", () => {
  it("falla ruidosamente con 500 en vez de dejar pasar la petición sin contarla", async () => {
    mockWiring({ rateLimitLogFails: new Error("permission denied") });

    const response = await postRegistration();

    expect(response.status).toBe(500);
    expect(calls).not.toContain("checkAvailability");
    expect(scheduledWork).toEqual([]);
  });

  it("no filtra el motivo al cliente pero lo deja en el registro del servidor", async () => {
    mockWiring({ rateLimitLogFails: new Error("permission denied") });

    const response = await postRegistration();

    expect(response.text).not.toContain("permission denied");
    expect(loggedErrors()).toContain("permission denied");
  });
});
