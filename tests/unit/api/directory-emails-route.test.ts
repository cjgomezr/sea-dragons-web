import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import { DIRECTORY_EMAILS_API_PATH } from "@/lib/auth/routes";
import type { Role } from "@/lib/auth/roles";
import type { SessionState } from "@/lib/auth/session-boundary";
import { DEFAULT_CLUB_BRAND } from "@/lib/club/club-brand";
import type {
  DirectoryEmailGateways,
  DirectoryEmailRecipient,
  DirectoryEmailReservation,
} from "@/lib/directory/directory-email";
import type { EmailProviderStatus } from "@/lib/email/email-delivery-availability";
import type { BatchEmailDelivery } from "@/lib/email/resend-email-sender";

/**
 * El correo del directorio por la API (#501, RF-6 y RF-7 del PRD de E19). La
 * petición entra por el proxy y sólo llega al handler si la frontera la deja
 * seguir, como en producción. Lo que hace el dominio lo prueba su test; aquí,
 * que cada caso sale con su código y su motivo.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const MEMBER_ID = "b0b0b0b0-0000-4000-8000-000000000001";
const REQUEST_ID = "7e7e7e7e-0000-4000-8000-000000000001";

const SENDER: DirectoryEmailRecipient = {
  userId: CALLER_ID,
  fullName: "Ana Admin",
  email: "ana@club.test",
  status: "active",
  locale: "es",
};
const MEMBER: DirectoryEmailRecipient = {
  userId: MEMBER_ID,
  fullName: "Bea Socia",
  email: "bea@club.test",
  status: "active",
  locale: "en",
};

const readSessionState = vi.fn();
const readAuthenticatedUserId = vi.fn();

type Wiring = {
  callerRole: Role;
  reservation: DirectoryEmailReservation;
  provider: EmailProviderStatus;
  deliveries: readonly BatchEmailDelivery[] | null;
  sentInWindow: number;
};

const wiring: Wiring = {
  callerRole: "Admin",
  reservation: { kind: "reserved", sendId: "envio-1" },
  provider: { kind: "reachable" },
  deliveries: null,
  sentInWindow: 0,
};
const batches: unknown[] = [];
const auditRows: AuditLogInsertRow[] = [];

function gateways(): DirectoryEmailGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: SENDER.fullName,
        role: wiring.callerRole,
      }),
    },
    recipients: {
      findEmailRecipients: async (_clubId, userIds) =>
        [SENDER, MEMBER].filter((member) => userIds.includes(member.userId)),
    },
    quota: {
      countSentSince: async () => wiring.sentInWindow,
      reserve: async () => wiring.reservation,
      settle: async () => undefined,
    },
    delivery: {
      connection: {
        kind: "connected",
        sender: {
          sendBatch: async (emails) => {
            batches.push(emails);
            return wiring.deliveries ?? emails.map(() => ({ kind: "sent" }));
          },
        },
      },
      provider: { probeProvider: async () => wiring.provider },
    },
    brand: { readClubBrand: async () => DEFAULT_CLUB_BRAND },
    audit: {
      insertAuditLogRow: async (row) => {
        auditRows.push(row);
        return { error: null };
      },
    },
    log: () => undefined,
  };
}

vi.mock("@/lib/supabase/session-client", () => ({
  readIncomingCookies: () => [],
  applySessionCookies: () => undefined,
  createSessionClient: () => ({
    kind: "ready",
    client: {},
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  }),
}));

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
  readAuthenticatedUserId: (...args: unknown[]) =>
    readAuthenticatedUserId(...args),
}));

vi.mock("@/lib/directory/supabase-directory-email-gateways", () => ({
  createSupabaseDirectoryEmailGateways: () => ({
    kind: "ready",
    gateways: gateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const { GET, POST, DELETE } =
  await import("@/app/api/v1/directory/emails/route");

const VALID_BODY = {
  requestId: REQUEST_ID,
  subject: "Entreno del sábado",
  message: "Nos vemos a las 8.",
  recipientIds: [MEMBER_ID],
};

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

function givenRole(role: Role): void {
  wiring.callerRole = role;
  givenSession({ kind: "active", role, membershipCurrent: true });
}

async function throughBoundary(
  request: NextRequest,
  handler: (request: NextRequest) => Promise<Response>,
): Promise<Response> {
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? handler(request)
    : boundaryResponse;
}

function postEmail(body: unknown = VALID_BODY): Promise<Response> {
  return throughBoundary(
    new NextRequest(new URL(DIRECTORY_EMAILS_API_PATH, ORIGIN), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    POST,
  );
}

function getQuota(): Promise<Response> {
  return throughBoundary(
    new NextRequest(new URL(DIRECTORY_EMAILS_API_PATH, ORIGIN)),
    GET,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  readAuthenticatedUserId.mockResolvedValue(CALLER_ID);
  givenRole("Admin");
  wiring.reservation = { kind: "reserved", sendId: "envio-1" };
  wiring.provider = { kind: "reachable" };
  wiring.deliveries = null;
  wiring.sentInWindow = 0;
  batches.length = 0;
  auditRows.length = 0;
});

describe("POST /api/v1/directory/emails", () => {
  it.each(["Admin", "Committee"] as const)(
    "responde 200 a un %s con cuántos salieron",
    async (role) => {
      givenRole(role);
      wiring.sentInWindow = 1;

      const response = await postEmail();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: { sentCount: 1, failed: [], remaining: 49 },
      });
      expect(batches).toHaveLength(1);
    },
  );

  it("responde 200 con a quiénes no llegó si falla a medias", async () => {
    wiring.deliveries = [{ kind: "failed", reason: "rebotado" }];

    const response = await postEmail();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        sentCount: 0,
        failed: [{ userId: MEMBER_ID, fullName: "Bea Socia" }],
      },
    });
  });

  it("responde 400 con su motivo a un asunto demasiado largo", async () => {
    const response = await postEmail({
      ...VALID_BODY,
      subject: "a".repeat(151),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error", reason: "invalid_directory_email" },
    });
    expect(batches).toEqual([]);
  });

  it("responde 400 a un cuerpo sin la clave de la petición", async () => {
    const response = await postEmail({ ...VALID_BODY, requestId: "otra" });

    expect(response.status).toBe(400);
  });

  it("responde 400 con su motivo si no queda nadie a quien mandar", async () => {
    const response = await postEmail({
      ...VALID_BODY,
      recipientIds: ["c0c0c0c0-0000-4000-8000-000000000009"],
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "no_recipients" },
    });
  });

  it("responde 401 sin sesión y no manda nada", async () => {
    givenSession({ kind: "anonymous" });

    const response = await postEmail();

    expect(response.status).toBe(401);
    expect(batches).toEqual([]);
  });

  it.each(["Coach", "Player"] as const)(
    "responde 403 con su motivo a un %s y no manda nada",
    async (role) => {
      givenRole(role);

      const response = await postEmail();

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "forbidden", reason: "directory_email_forbidden" },
      });
      expect(batches).toEqual([]);
    },
  );

  it("responde 403 a un Committee al que le quitaron el rol con el formulario abierto", async () => {
    givenSession({
      kind: "active",
      role: "Committee",
      membershipCurrent: true,
    });
    wiring.callerRole = "Player";

    const response = await postEmail();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "directory_email_forbidden" },
    });
  });

  it("responde 409 con su motivo si no caben, sin mandar nada", async () => {
    wiring.reservation = { kind: "exceeded", remaining: 0 };

    const response = await postEmail();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "conflict", reason: "directory_email_quota_exceeded" },
    });
    expect(batches).toEqual([]);
  });

  it("responde 409 a la misma petición repetida, sin mandar nada otra vez", async () => {
    wiring.reservation = { kind: "duplicate" };

    const response = await postEmail();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "conflict", reason: "directory_email_duplicate" },
    });
    expect(batches).toEqual([]);
  });

  it("responde 503 con su motivo si el proveedor está caído", async () => {
    wiring.provider = { kind: "unreachable", reason: "Resend respondió 500" };

    const response = await postEmail();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "service_unavailable", reason: "email_unavailable" },
    });
    expect(batches).toEqual([]);
  });

  it("deja la bitácora sin el cuerpo del correo", async () => {
    await postEmail();

    expect(auditRows).toHaveLength(1);
    expect(JSON.stringify(auditRows)).not.toContain("Nos vemos");
  });

  it("responde 405 a un método que no implementa", async () => {
    const response = await DELETE(
      new NextRequest(new URL(DIRECTORY_EMAILS_API_PATH, ORIGIN), {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(405);
  });
});

describe("GET /api/v1/directory/emails", () => {
  it("dice a un Committee cuántos correos del directorio quedan hoy", async () => {
    givenRole("Committee");
    wiring.sentInWindow = 12;

    const response = await getQuota();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { limit: 50, remaining: 38 },
    });
  });

  it("responde 403 con su motivo a un Coach", async () => {
    givenRole("Coach");

    const response = await getQuota();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "directory_email_forbidden" },
    });
  });
});
