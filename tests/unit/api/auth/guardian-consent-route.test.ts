import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { MemberAccountRecord } from "@/lib/auth/account-activation";
import type { GuardianConsent } from "@/lib/auth/guardian-consent";

/**
 * El endpoint con el que queda registrado el consentimiento del tutor de un
 * socio menor (FR-082). La marca de tiempo la pone el servidor y los datos del
 * tutor son obligatorios: sin ellos, marcar el consentimiento atacando la API
 * directamente se rechaza.
 */

const CONSENT_URL = "http://localhost/api/v1/auth/account/guardian-consent";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const MEMBER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const MINOR_RECORD: MemberAccountRecord = {
  memberId: MEMBER_ID,
  clubId: CLUB_ID,
  accountStatus: "incomplete",
  profile: {
    country: "AU",
    dateOfBirth: "2010-05-20",
    membershipType: "Full",
    guardianConsentAt: null,
    registeredAt: "2026-09-12T00:00:00.000Z",
  },
};

const VALID_BODY = {
  guardianName: "Marta Silva",
  guardianEmail: "marta.silva@example.test",
  consent: true,
};

type ConsentWrite = {
  readonly memberId: string;
  readonly consent: GuardianConsent;
};

const consentWrites: ConsentWrite[] = [];
const audits: AuditLogInsertRow[] = [];
const activations: string[] = [];

type WiringOptions = {
  readonly callerId?: string | null;
  readonly record?: MemberAccountRecord | null;
};

function mockWiring(options: WiringOptions = {}): void {
  const record = options.record === undefined ? MINOR_RECORD : options.record;
  const profile = { ...record?.profile };

  vi.doMock("@/lib/auth/supabase-auth-gateways", () => ({
    describeMissingAuthKeys: (keys: readonly string[]) =>
      `faltan ${keys.join(", ")}`,
    createSupabaseAuthGateways: () => ({
      kind: "ready",
      gateways: {
        accounts: {
          findByUserId: async () =>
            record === null ? null : { ...record, profile },
          activateMember: async (memberId: string) => {
            activations.push(memberId);
          },
          updateProfile: async () => undefined,
          recordGuardianConsent: async (
            memberId: string,
            consent: GuardianConsent,
          ) => {
            consentWrites.push({ memberId, consent });
            Object.assign(profile, { guardianConsentAt: consent.consentedAt });
            return "recorded";
          },
        },
        identities: { isEmailConfirmed: async () => true },
        audit: {
          insertAuditLogRow: async (row: AuditLogInsertRow) => {
            audits.push(row);
            return { error: null };
          },
        },
      },
    }),
  }));

  vi.doMock("@/lib/supabase/session-client", () => ({
    readIncomingCookies: () => [],
    applySessionCookies: () => undefined,
    createSessionClient: () => ({
      kind: "ready",
      client: {},
      recorder: { recorded: () => ({}) },
    }),
  }));

  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () =>
      options.callerId === undefined ? USER_ID : options.callerId,
  }));
}

async function postConsent(body: unknown): Promise<Response> {
  const { POST } =
    await import("@/app/api/v1/auth/account/guardian-consent/route");
  return POST(
    new NextRequest(CONSENT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  consentWrites.length = 0;
  audits.length = 0;
  activations.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/auth/supabase-auth-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
});

describe("registrar el consentimiento del tutor por la API", () => {
  it("lo guarda sobre la cuenta de quien pide y devuelve la cuenta activa", async () => {
    mockWiring();

    const response = await postConsent(VALID_BODY);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { accountStatus: "active", pending: [] },
    });
    expect(consentWrites.map((write) => write.memberId)).toEqual([MEMBER_ID]);
    expect(activations).toEqual([MEMBER_ID]);
    expect(audits).toHaveLength(1);
  });

  it.each([
    ["sin ningún dato del tutor", { consent: true }],
    ["sin el correo del tutor", { guardianName: "Marta Silva", consent: true }],
    [
      "sin decir que hay consentimiento",
      { guardianName: "Marta Silva", guardianEmail: "marta@example.test" },
    ],
  ])("responde 400 %s, sin guardar nada", async (_case, body) => {
    mockWiring();

    const response = await postConsent(body);

    expect(response.status).toBe(400);
    expect(consentWrites).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("responde 422 nombrando el campo cuando el consentimiento viene en falso", async () => {
    mockWiring();

    const response = await postConsent({ ...VALID_BODY, consent: false });

    expect(response.status).toBe(422);
    const payload = (await response.json()) as { error: { message: string } };
    expect(payload.error.message).toContain("consent");
    expect(consentWrites).toEqual([]);
  });

  it("pone la marca de tiempo del servidor, no la que llegue en el cuerpo", async () => {
    mockWiring();
    const before = Date.now();

    await postConsent({ ...VALID_BODY, consentedAt: "2000-01-01T00:00:00Z" });

    const consentedAt = Date.parse(consentWrites[0]?.consent.consentedAt ?? "");
    expect(consentedAt).toBeGreaterThanOrEqual(before);
    expect(consentedAt).toBeLessThanOrEqual(Date.now());
  });

  it("no se fía de ningún id del cuerpo", async () => {
    mockWiring();
    const OTHER_ID = "00000000-0000-4000-8000-000000000000";

    await postConsent({ ...VALID_BODY, memberId: OTHER_ID, userId: OTHER_ID });

    expect(consentWrites.map((write) => write.memberId)).toEqual([MEMBER_ID]);
  });

  it("responde 409 a quien era mayor de edad el día del registro", async () => {
    mockWiring({
      record: {
        ...MINOR_RECORD,
        profile: { ...MINOR_RECORD.profile, dateOfBirth: "1994-03-08" },
      },
    });

    const response = await postConsent(VALID_BODY);

    expect(response.status).toBe(409);
    expect(consentWrites).toEqual([]);
  });

  it("responde 409 cuando el consentimiento ya estaba registrado", async () => {
    mockWiring({
      record: {
        ...MINOR_RECORD,
        profile: {
          ...MINOR_RECORD.profile,
          guardianConsentAt: "2026-09-13T00:00:00.000Z",
        },
      },
    });

    const response = await postConsent(VALID_BODY);

    expect(response.status).toBe(409);
    expect(consentWrites).toEqual([]);
  });

  it("responde 401 a quien no trae sesión, sin tocar nada", async () => {
    mockWiring({ callerId: null });

    const response = await postConsent(VALID_BODY);

    expect(response.status).toBe(401);
    expect(consentWrites).toEqual([]);
  });

  it("responde 403 a una sesión que no corresponde a ningún socio", async () => {
    mockWiring({ record: null });

    const response = await postConsent(VALID_BODY);

    expect(response.status).toBe(403);
  });

  it("responde 405 a un método que no implementa", async () => {
    mockWiring();
    const { GET } =
      await import("@/app/api/v1/auth/account/guardian-consent/route");

    const response = await GET(new NextRequest(CONSENT_URL, { method: "GET" }));

    expect(response.status).toBe(405);
  });
});
