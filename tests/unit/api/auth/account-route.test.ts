import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberAccountRecord } from "@/lib/auth/account-activation";
import type { CompletedValues } from "@/lib/auth/complete-registration";

/**
 * El endpoint con el que una cuenta `incomplete` sabe qué le falta y lo
 * guarda. Es el único que esa cuenta puede usar además de los públicos, así
 * que si aquí se cuela algo, la puerta del ticket no cierra.
 */

const ACCOUNT_URL = "http://localhost/api/v1/auth/account";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const MEMBER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const SESSION_COOKIE_NAME = "sb-seadragons-auth-token";

type ProfileWrite = {
  readonly memberId: string;
  readonly values: CompletedValues;
};

const profileWrites: ProfileWrite[] = [];
/** Los miembros que quedaron activados. Se guarda el id, no sólo que hubo
 * escritura: lo que hay que fijar es SOBRE QUÉ fila escribe el endpoint. */
const activations: string[] = [];

type WiringOptions = {
  readonly callerId?: string | null;
  readonly record?: MemberAccountRecord | null;
  readonly emailConfirmed?: boolean;
  readonly unconfiguredAuth?: readonly string[];
  readonly unconfiguredSession?: readonly string[];
};

const INCOMPLETE_RECORD: MemberAccountRecord = {
  memberId: MEMBER_ID,
  clubId: "5c1ab000-0000-4000-8000-000000000001",
  accountStatus: "incomplete",
  profile: {
    country: "AU",
    dateOfBirth: "1994-03-08",
    membershipType: null,
    guardianConsentAt: null,
    registeredAt: "2026-09-12T00:00:00.000Z",
  },
};

function mockWiring(options: WiringOptions = {}): void {
  const record =
    options.record === undefined ? INCOMPLETE_RECORD : options.record;
  const profile = { ...record?.profile };

  vi.doMock("@/lib/auth/supabase-auth-gateways", () => ({
    describeMissingAuthKeys: (keys: readonly string[]) =>
      `faltan ${keys.join(", ")}`,
    createSupabaseAuthGateways: () =>
      options.unconfiguredAuth
        ? { kind: "unconfigured", missingKeys: options.unconfiguredAuth }
        : {
            kind: "ready",
            gateways: {
              accounts: {
                findByUserId: async () =>
                  record === null ? null : { ...record, profile },
                updateProfile: async (
                  memberId: string,
                  values: CompletedValues,
                ) => {
                  profileWrites.push({ memberId, values });
                  Object.assign(profile, values);
                },
                activateMember: async (memberId: string) => {
                  activations.push(memberId);
                },
              },
              identities: {
                isEmailConfirmed: async () => options.emailConfirmed ?? true,
              },
            },
          },
  }));

  vi.doMock("@/lib/supabase/session-client", () => ({
    readIncomingCookies: () => [],
    applySessionCookies: (response: Response) => {
      response.headers.append(
        "set-cookie",
        `${SESSION_COOKIE_NAME}=abc; Path=/`,
      );
    },
    createSessionClient: () =>
      options.unconfiguredSession
        ? { kind: "unconfigured", missingKeys: options.unconfiguredSession }
        : { kind: "ready", client: {}, recorder: { recorded: () => ({}) } },
  }));

  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () =>
      options.callerId === undefined ? USER_ID : options.callerId,
  }));
}

async function getAccount(): Promise<Response> {
  const { GET } = await import("@/app/api/v1/auth/account/route");
  return GET(new NextRequest(ACCOUNT_URL, { method: "GET" }));
}

async function patchAccount(body: unknown): Promise<Response> {
  const { PATCH } = await import("@/app/api/v1/auth/account/route");
  return PATCH(
    new NextRequest(ACCOUNT_URL, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  profileWrites.length = 0;
  activations.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/auth/supabase-auth-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
});

describe("consultar qué le falta a la cuenta", () => {
  it("devuelve el estado y la lista de pendientes", async () => {
    mockWiring();

    const response = await getAccount();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { accountStatus: "incomplete", pending: ["membershipType"] },
    });
  });

  it("no devuelve ningún dato personal de la fila, sólo lo que falta", async () => {
    mockWiring();

    const payload = (await (await getAccount()).json()) as {
      data: Record<string, unknown>;
    };

    expect(Object.keys(payload.data).sort()).toEqual([
      "accountStatus",
      "pending",
    ]);
  });

  it("responde 401 a quien no trae sesión", async () => {
    mockWiring({ callerId: null });

    const response = await getAccount();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthenticated", message: expect.any(String) },
    });
  });

  it("responde 403 a una sesión que no corresponde a ningún socio", async () => {
    mockWiring({ record: null });

    const response = await getAccount();

    expect(response.status).toBe(403);
  });

  it("responde 503 nombrando las variables que faltan", async () => {
    mockWiring({ unconfiguredAuth: ["SUPABASE_SERVICE_ROLE_KEY"] });

    const response = await getAccount();

    expect(response.status).toBe(503);
    const payload = (await response.json()) as {
      error: { message: string };
    };
    expect(payload.error.message).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("responde 405 con la forma de la convención a un método que no implementa", async () => {
    mockWiring();
    const { POST } = await import("@/app/api/v1/auth/account/route");

    const response = await POST(
      new NextRequest(ACCOUNT_URL, { method: "POST" }),
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: { code: "method_not_allowed", message: expect.any(String) },
    });
  });
});

describe("guardar lo que falta", () => {
  it("guarda el dato y devuelve la cuenta ya activa", async () => {
    mockWiring();

    const response = await patchAccount({ membershipType: "Student" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { accountStatus: "active", pending: [] },
    });
    expect(profileWrites).toEqual([
      { memberId: MEMBER_ID, values: { membershipType: "Student" } },
    ]);
    expect(activations).toEqual([MEMBER_ID]);
  });

  it("responde 422 nombrando el campo cuando el valor no vale", async () => {
    mockWiring();

    const response = await patchAccount({ membershipType: "Platinum" });

    expect(response.status).toBe(422);
    const payload = (await response.json()) as { error: { message: string } };
    expect(payload.error.message).toContain("membershipType");
    expect(profileWrites).toEqual([]);
  });

  it("responde 400 a un campo con un tipo que no es texto", async () => {
    mockWiring();

    const response = await patchAccount({ membershipType: 7 });

    expect(response.status).toBe(400);
    expect(profileWrites).toEqual([]);
  });

  it("responde 409 a una cuenta que ya no tiene nada que completar", async () => {
    mockWiring({
      record: {
        ...INCOMPLETE_RECORD,
        accountStatus: "active",
        profile: { ...INCOMPLETE_RECORD.profile, membershipType: "Full" },
      },
    });

    const response = await patchAccount({ membershipType: "Student" });

    expect(response.status).toBe(409);
    expect(profileWrites).toEqual([]);
  });

  it("responde 401 a quien no trae sesión, sin tocar nada", async () => {
    mockWiring({ callerId: null });

    const response = await patchAccount({ membershipType: "Student" });

    expect(response.status).toBe(401);
    expect(profileWrites).toEqual([]);
  });

  // FR-082: el consentimiento sólo entra por su propio endpoint, con los datos
  // del tutor. Una marca de tiempo mandada aquí no registra nada.
  it("no registra un consentimiento de tutor que llegue en el cuerpo", async () => {
    mockWiring();

    await patchAccount({
      membershipType: "Student",
      guardianConsentAt: "2026-09-12T00:00:00Z",
    });

    expect(profileWrites).toEqual([
      { memberId: MEMBER_ID, values: { membershipType: "Student" } },
    ]);
  });

  // AC-039: nadie mueve la fila de otra persona, ni su propio estado de
  // cuenta, mandándolo en el cuerpo. Lo que se fija aquí es la fila SOBRE LA
  // QUE se escribe, no sólo los valores: con el id del cuerpo, el endpoint
  // habría escrito igual de bien unos valores correctos en la cuenta ajena.
  it("no se fía de ningún id del cuerpo: escribe sobre la cuenta de quien pide", async () => {
    mockWiring();
    const OTHER_ID = "00000000-0000-4000-8000-000000000000";

    await patchAccount({
      membershipType: "Student",
      userId: OTHER_ID,
      memberId: OTHER_ID,
      id: OTHER_ID,
      accountStatus: "active",
      role: "Admin",
    });

    expect(profileWrites).toEqual([
      { memberId: MEMBER_ID, values: { membershipType: "Student" } },
    ]);
    expect(activations).toEqual([MEMBER_ID]);
  });
});
