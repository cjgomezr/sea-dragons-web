import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import { DIRECTORY_EXPORT_API_PATH } from "@/lib/auth/routes";
import type { Role } from "@/lib/auth/roles";
import type { SessionState } from "@/lib/auth/session-boundary";
import { DEFAULT_CLUB_BRAND } from "@/lib/club/club-brand";
import type { DirectoryMemberRecord } from "@/lib/directory/directory";
import type { DirectoryExportGateways } from "@/lib/directory/directory-export";
import { LOCALE_COOKIE_NAME } from "@/lib/i18n/locale";
import { DEFENDER, SEEDED_POSITIONS } from "../helpers/seeded-positions";

/**
 * La exportación del directorio por la API (#500, RF-5 del PRD de E19). La
 * petición entra por el proxy y sólo llega al handler si la frontera la deja
 * seguir, como en producción. Lo que hace el dominio lo prueba su test; aquí,
 * que el archivo sale como archivo y cada rechazo con su código.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const MARIA: DirectoryMemberRecord = {
  userId: "cccccccc-0000-4000-8000-00000000000c",
  fullName: "María Ñíguez",
  country: "AU",
  experienceLevel: "Intermediate",
  role: "Player",
  positionId: DEFENDER.id,
  status: "active",
  registeredAt: "2024-03-06T01:00:00.000Z",
  hasDateOfBirth: true,
  aufNumber: "AUF-7",
  aufExpiry: "2027-01-31",
  isAufVerified: true,
  photoPath: null,
  isEvaluated: true,
  membershipStatus: "active",
  groupIds: [],
  email: "maria@club.test",
  phone: null,
  emergencyContact: null,
};

const TOMAS: DirectoryMemberRecord = {
  ...MARIA,
  userId: "dddddddd-0000-4000-8000-00000000000d",
  fullName: "Tomás Gil",
  phone: "0412 345 678",
};

const readSessionState = vi.fn();
const readAuthenticatedUserId = vi.fn();

const wiring: { callerRole: Role } = { callerRole: "Admin" };
const auditRows: AuditLogInsertRow[] = [];
const directoryReads: string[] = [];

function gateways(): DirectoryExportGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Quien exporta",
        role: wiring.callerRole,
      }),
    },
    directory: {
      findDirectoryMembers: async (clubId) => {
        directoryReads.push(clubId);
        return [MARIA, TOMAS];
      },
    },
    positions: { findClubPositions: async () => SEEDED_POSITIONS },
    photos: { signPhotoUrls: async () => new Map() },
    attendance: { findMemberAttendance: async () => new Map() },
    brand: { readClubBrand: async () => DEFAULT_CLUB_BRAND },
    audit: {
      insertAuditLogRow: async (row) => {
        auditRows.push(row);
        return { error: null };
      },
    },
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

vi.mock("@/lib/directory/supabase-directory-export-gateways", () => ({
  createSupabaseDirectoryExportGateways: () => ({
    kind: "ready",
    gateways: gateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const { GET, POST } = await import("@/app/api/v1/directory/export/route");

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

function exportDirectory(search = "", locale = "es"): Promise<Response> {
  return throughBoundary(
    new NextRequest(new URL(`${DIRECTORY_EXPORT_API_PATH}${search}`, ORIGIN), {
      headers: { cookie: `${LOCALE_COOKIE_NAME}=${locale}` },
    }),
    GET,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  readAuthenticatedUserId.mockResolvedValue(CALLER_ID);
  givenRole("Admin");
  auditRows.length = 0;
  directoryReads.length = 0;
});

describe("GET /api/v1/directory/export", () => {
  it.each(["Admin", "Committee"] as const)(
    "responde 200 a un %s con el CSV como descarga",
    async (role) => {
      givenRole(role);

      const response = await exportDirectory();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "text/csv; charset=utf-8",
      );
      expect(response.headers.get("content-disposition")).toMatch(
        /^attachment; filename="victoria-seadragons-directorio-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      const csv = await response.text();
      expect(csv).toContain("María Ñíguez");
      expect(csv).toContain("Tomás Gil");
    },
  );

  it("escribe las cabeceras en el idioma de quien exporta", async () => {
    const response = await exportDirectory("", "en");

    const csv = await response.text();
    expect(csv.split("\r\n")[0]).toMatch(/^Name,Country,/);
    expect(response.headers.get("content-disposition")).toContain(
      "-directory-",
    );
  });

  it("respeta los filtros, igual que el directorio", async () => {
    const response = await exportDirectory("?withoutPhone=true");

    const csv = await response.text();
    expect(csv).toContain("María Ñíguez");
    expect(csv).not.toContain("Tomás Gil");
  });

  it("con socios marcados exporta sólo a esos (#552)", async () => {
    const response = await exportDirectory("?member=dddddddd-0000-4000-8000-00000000000d");

    const csv = await response.text();
    expect(csv).toContain("Tomás Gil");
    expect(csv).not.toContain("María Ñíguez");
  });

  it("responde 400 a un socio marcado que no es un uuid", async () => {
    const response = await exportDirectory("?member=abc");

    expect(response.status).toBe(400);
    expect(auditRows).toEqual([]);
  });

  it("apunta la exportación en la bitácora con los filtros y el total", async () => {
    await exportDirectory("?withoutPhone=true");

    expect(auditRows).toMatchObject([
      {
        actor_id: CALLER_ID,
        action: "directory.exported",
        metadata: { filters: { withoutPhone: "true" }, memberCount: 1 },
      },
    ]);
  });

  it("responde 401 sin sesión y no lee nada", async () => {
    givenSession({ kind: "anonymous" });

    const response = await exportDirectory();

    expect(response.status).toBe(401);
    expect(directoryReads).toEqual([]);
  });

  it.each(["Coach", "Player"] as const)(
    "responde 403 con su motivo a un %s sin leer el directorio",
    async (role) => {
      givenRole(role);

      const response = await exportDirectory();

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "forbidden", reason: "directory_export_forbidden" },
      });
      expect(directoryReads).toEqual([]);
      expect(auditRows).toEqual([]);
    },
  );

  it("responde 403 con su motivo al Committee que pide un filtro de Admin", async () => {
    givenRole("Committee");

    const response = await exportDirectory("?auf=missing");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "directory_filter_forbidden" },
    });
  });

  it("responde 403 al Committee que pide los socios dados de baja", async () => {
    givenRole("Committee");

    const response = await exportDirectory("?includeInactive=true");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
    expect(auditRows).toEqual([]);
  });

  it("no deja que nada guarde una copia del archivo", async () => {
    const response = await exportDirectory();

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("responde 400 con su motivo a una consulta mal escrita", async () => {
    const response = await exportDirectory("?sort=altura");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "invalid_directory_query" },
    });
  });

  it("responde 405 a otro método", async () => {
    const response = await POST(
      new NextRequest(new URL(DIRECTORY_EXPORT_API_PATH, ORIGIN), {
        method: "POST",
      }),
    );

    expect(response.status).toBe(405);
  });
});
