import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConfirmationEmailOutcome,
  IdentityCreation,
  RequestedConfirmationEmail,
} from "@/lib/auth/register-member";
import type { EmailDeliveryAvailability } from "@/lib/email/email-delivery-availability";

/**
 * El aviso de "ahora no podemos mandar correos" (#154) contra la trampa del
 * #147: ninguna respuesta puede distinguir una dirección de otra. Las rutas no
 * reciben el tipo de dirección; les llega sólo por lo que contestan los
 * servicios, que es lo que estos dobles fijan.
 */

const CLUB_ID = "6f1d2c3b-4a59-4e6f-8b70-1c2d3e4f5a6b";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const EMAIL = "nerea@example.test";
const SEND_FAILURE_REASON = "503: Resend no contestó";
const UNAVAILABLE_REASON = "Resend respondió 503 (service_unavailable)";

type AddressType = "sin cuenta" | "confirmada" | "sin confirmar";

const ADDRESS_TYPES: readonly AddressType[] = [
  "sin cuenta",
  "confirmada",
  "sin confirmar",
];

const DELIVERY_STATES: Readonly<Record<string, EmailDeliveryAvailability>> = {
  disponible: { kind: "available" },
  "no disponible": { kind: "unavailable", reason: UNAVAILABLE_REASON },
};

const FAILED_SEND: RequestedConfirmationEmail = {
  kind: "failed",
  reason: SEND_FAILURE_REASON,
};

/** Crear la identidad: sólo una dirección sin cuenta la crea. */
function identityFor(address: AddressType): IdentityCreation {
  return address === "sin cuenta"
    ? { kind: "created", userId: USER_ID }
    : { kind: "already_registered" };
}

/** Pedir el reenvío: sólo una cuenta sin confirmar llega a intentar el envío
 * (`internal/api/resend.go`). */
function resendFor(
  address: AddressType,
  unconfirmedSend: RequestedConfirmationEmail,
): ConfirmationEmailOutcome {
  return address === "sin confirmar"
    ? unconfirmedSend
    : { kind: "not_requested" };
}

const scheduledWork: (() => Promise<void>)[] = [];
const availabilityArguments: unknown[][] = [];
const requestedEmails: string[] = [];

function mockWiring(options: {
  readonly address: AddressType;
  readonly delivery: EmailDeliveryAvailability;
  readonly unconfirmedSend?: RequestedConfirmationEmail;
}): void {
  const send = options.unconfirmedSend ?? FAILED_SEND;
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
            createIdentity: async () => identityFor(options.address),
            deleteIdentity: async () => {},
          },
          members: { insertMember: async () => {} },
          confirmationEmail: {
            requestConfirmationEmail: async (email: string) => {
              requestedEmails.push(email);
              return send;
            },
          },
        },
        confirmationEmail: {
          requestConfirmationEmail: async (email: string) => {
            requestedEmails.push(email);
            return resendFor(options.address, send);
          },
        },
        confirmationEmailRequestsForClub: () => ({
          recordAndCountRecent: async () => 1,
        }),
        emailDeliveryForClub: () => ({
          checkAvailability: async (...args: unknown[]) => {
            availabilityArguments.push(args);
            return options.delivery;
          },
        }),
      },
    }),
  }));
}

type Endpoint = "registro" | "reenvío";

const ENDPOINTS: readonly Endpoint[] = ["registro", "reenvío"];

async function post(endpoint: Endpoint): Promise<Response> {
  if (endpoint === "registro") {
    const { POST } = await import("@/app/api/v1/auth/register/route");
    return POST(
      jsonRequest("http://localhost/api/v1/auth/register", {
        fullName: "Nerea Silva",
        email: EMAIL,
        country: "AU",
        password: "bajoelagua",
        membershipType: "Full",
        dateOfBirth: "1994-03-02",
      }),
    );
  }
  const { POST } = await import("@/app/api/v1/auth/confirmation-email/route");
  return POST(
    jsonRequest("http://localhost/api/v1/auth/confirmation-email", {
      email: EMAIL,
    }),
  );
}

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type RawResponse = { readonly status: number; readonly text: string };

/** Sondea un endpoint como lo haría cualquiera desde fuera, y corre después
 * lo que la ruta dejó para cuando la respuesta ya salió. */
async function probe(
  endpoint: Endpoint,
  options: Parameters<typeof mockWiring>[0],
): Promise<RawResponse> {
  vi.resetModules();
  mockWiring(options);
  const response = await post(endpoint);
  const raw = { status: response.status, text: await response.text() };
  for (const work of scheduledWork.splice(0)) {
    await work();
  }
  return raw;
}

function loggedErrors(): string {
  return vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
}

beforeEach(() => {
  vi.resetModules();
  scheduledWork.length = 0;
  availabilityArguments.length = 0;
  requestedEmails.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.doUnmock("@/lib/auth/supabase-auth-gateways");
  vi.doUnmock("@/lib/api/after-response");
  vi.restoreAllMocks();
});

describe("matriz de enumeración", () => {
  for (const endpoint of ENDPOINTS) {
    for (const [state, delivery] of Object.entries(DELIVERY_STATES)) {
      it(`${endpoint} con el envío ${state}: las tres direcciones responden idéntico byte a byte`, async () => {
        const responses: RawResponse[] = [];
        for (const address of ADDRESS_TYPES) {
          responses.push(await probe(endpoint, { address, delivery }));
        }

        expect(new Set(responses.map((response) => response.status))).toEqual(
          new Set([200]),
        );
        expect(new Set(responses.map((response) => response.text)).size).toBe(
          1,
        );
      });
    }
  }

  it.each(ENDPOINTS)(
    "%s con el envío no disponible dice que ahora no se pueden mandar correos",
    async (endpoint) => {
      const response = await probe(endpoint, {
        address: "sin confirmar",
        delivery: DELIVERY_STATES["no disponible"]!,
      });

      expect(JSON.parse(response.text)).toEqual({
        data: { outcome: "email_unavailable", email: EMAIL },
      });
    },
  );

  it.each(ENDPOINTS)(
    "%s con el envío disponible responde el recibo neutro del #147",
    async (endpoint) => {
      const response = await probe(endpoint, {
        address: "sin confirmar",
        delivery: DELIVERY_STATES.disponible!,
      });

      expect(JSON.parse(response.text)).toEqual({
        data: { outcome: "confirmation_pending", email: EMAIL },
      });
    },
  );

  it.each(ENDPOINTS)(
    "%s pregunta por la disponibilidad sin darle la dirección",
    async (endpoint) => {
      await probe(endpoint, {
        address: "sin confirmar",
        delivery: DELIVERY_STATES.disponible!,
      });

      expect(availabilityArguments).toHaveLength(1);
      expect(availabilityArguments[0]).toEqual([expect.any(Date)]);
    },
  );
});

describe("fallo del envío a una cuenta concreta", () => {
  it.each(ENDPOINTS)(
    "%s con el envío disponible responde igual salga o falle el correo",
    async (endpoint) => {
      const delivery = DELIVERY_STATES.disponible!;
      const address = "sin confirmar";

      const sent = await probe(endpoint, {
        address,
        delivery,
        unconfirmedSend: { kind: "requested" },
      });
      const failed = await probe(endpoint, {
        address,
        delivery,
        unconfirmedSend: FAILED_SEND,
      });

      expect(failed).toEqual(sent);
    },
  );

  it.each(ENDPOINTS)(
    "%s deja el motivo del fallo sólo en el registro del servidor",
    async (endpoint) => {
      const response = await probe(endpoint, {
        address: endpoint === "registro" ? "sin cuenta" : "sin confirmar",
        delivery: DELIVERY_STATES.disponible!,
      });

      expect(loggedErrors()).toContain(SEND_FAILURE_REASON);
      expect(response.text).not.toContain(SEND_FAILURE_REASON);
    },
  );
});

describe("envío no disponible", () => {
  it.each(ENDPOINTS)(
    "%s deja el motivo en el registro del servidor y no en la respuesta",
    async (endpoint) => {
      const response = await probe(endpoint, {
        address: "sin confirmar",
        delivery: DELIVERY_STATES["no disponible"]!,
      });

      expect(loggedErrors()).toContain(UNAVAILABLE_REASON);
      expect(response.text).not.toContain(UNAVAILABLE_REASON);
    },
  );

  // Un enlace nuevo invalida el anterior, y emitirlo sin poder mandarlo le
  // rompería a la persona el que ya tenía.
  it.each(ENDPOINTS)(
    "%s no pide ningún correo mientras no se puede mandar",
    async (endpoint) => {
      await probe(endpoint, {
        address: "sin cuenta",
        delivery: DELIVERY_STATES["no disponible"]!,
      });

      expect(requestedEmails).toEqual([]);
    },
  );
});
