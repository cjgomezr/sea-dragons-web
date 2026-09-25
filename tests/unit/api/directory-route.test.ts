import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryMemberRecord } from "@/lib/directory/directory";
import type { Role } from "@/lib/auth/roles";
import { DIRECTORY_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import {
  DEFENDER,
  FORWARD,
  SEEDED_POSITIONS,
  asDirectoryPosition,
} from "../helpers/seeded-positions";

/**
 * El directorio del club por API (#238, FR-015 a FR-019). Lo alcanza
 * cualquier cuenta activa, así que no está en `RESTRICTED_ROUTES`: lo que es
 * del Admin (el AUF y los dados de baja) lo decide el handler leyendo el rol
 * de quien llama.
 */

const ORIGIN = "http://localhost:3417";
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
  aufNumber: "AUF-7",
  aufExpiry: "2020-01-31",
  isAufVerified: true,
  photoPath: null,
};

const BAJA: DirectoryMemberRecord = {
  userId: "dddddddd-0000-4000-8000-00000000000d",
  fullName: "Zoe Zapata",
  country: "AU",
  experienceLevel: null,
  role: "Committee",
  positionId: FORWARD.id,
  status: "inactive",
  aufNumber: null,
  aufExpiry: null,
  isAufVerified: false,
  photoPath: null,
};

const databaseCalls: string[] = [];

function mockSessionClient(): void {
  vi.doMock("@/lib/supabase/session-client", () => ({
    readIncomingCookies: () => [],
    applySessionCookies: () => undefined,
    createSessionClient: () => ({
      kind: "ready",
      client: {},
      recorder: { recorded: () => ({ cookies: [], headers: {} }) },
    }),
  }));
}

function mockWiring(callerRole: Role = "Player"): void {
  vi.doMock("@/lib/directory/supabase-directory-gateways", () => ({
    createSupabaseDirectoryGateways: () => ({
      kind: "ready",
      gateways: {
        members: {
          findRoleRequestMember: async () => ({
            clubId: CLUB_ID,
            fullName: "Quien pregunta",
            role: callerRole,
          }),
        },
        positions: { findClubPositions: async () => SEEDED_POSITIONS },
        directory: {
          findDirectoryMembers: async (clubId: string) => {
            databaseCalls.push(`list ${clubId}`);
            return [MARIA, BAJA];
          },
        },
        photos: { signPhotoUrls: async () => new Map() },
      },
    }),
  }));
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => CALLER_ID,
    readSessionState: async () => ({ kind: "active", role: callerRole }),
  }));
}

function mockAnonymousCaller(): void {
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => null,
  }));
}

async function getDirectory(search = ""): Promise<Response> {
  const { GET } = await import("@/app/api/v1/directory/route");
  return GET(
    new NextRequest(new URL(`${DIRECTORY_API_PATH}${search}`, ORIGIN)),
  );
}

async function expectErrorCode(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error: { code } });
}

beforeEach(() => {
  databaseCalls.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/directory/supabase-directory-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("GET /api/v1/directory", () => {
  it("responde 200 con los socios activos del club de quien llama", async () => {
    mockWiring();

    const response = await getDirectory();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        kind: "member",
        members: [
          {
            userId: MARIA.userId,
            fullName: "María Ñíguez",
            country: "AU",
            experienceLevel: "Intermediate",
            role: "Player",
            position: asDirectoryPosition(DEFENDER),
            status: "active",
            photoUrl: null,
          },
        ],
      },
    });
    expect(databaseCalls).toEqual([`list ${CLUB_ID}`]);
  });

  it("responde 200 con la lista vacía cuando la búsqueda no encuentra a nadie", async () => {
    mockWiring();

    const response = await getDirectory("?q=nadie");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { kind: "member", members: [] },
    });
  });

  it("añade el AUF y su vencimiento cuando pregunta un Admin", async () => {
    mockWiring("Admin");

    const response = await getDirectory();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        kind: "admin",
        members: [
          {
            fullName: "María Ñíguez",
            aufNumber: "AUF-7",
            aufExpiry: "2020-01-31",
            isAufVerified: true,
            isAufExpired: true,
          },
        ],
      },
    });
  });

  it("deja que un Admin pida también a los dados de baja", async () => {
    mockWiring("Admin");

    const response = await getDirectory("?includeInactive=true");

    const body = (await response.json()) as {
      data: { members: readonly { fullName: string; status: string }[] };
    };
    expect(
      body.data.members.map((member) => [member.fullName, member.status]),
    ).toContainEqual(["Zoe Zapata", "inactive"]);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s que pide los dados de baja, sin leer el directorio",
    async (callerRole) => {
      mockWiring(callerRole);

      const response = await getDirectory("?includeInactive=true");

      await expectErrorCode(response, 403, "forbidden");
      expect(databaseCalls).toEqual([]);
    },
  );

  it.each([
    ["un rol que no existe", "?role=Trainer"],
    ["un orden que no existe", "?sort=country"],
    ["una dirección que no existe", "?direction=descending"],
    // Pedir las bajas es cosa de un Admin: la bandera se escribe entera y no
    // se adivina desde un "1" ni desde la mera presencia del parámetro.
    ["un incluir inactivos que no es booleano", "?includeInactive=1"],
  ])("responde 400 a %s sin tocar la base", async (_case, search) => {
    mockWiring();

    const response = await getDirectory(search);

    await expectErrorCode(response, 400, "validation_error");
    expect(databaseCalls).toEqual([]);
  });

  it("responde 401 sin sesión", async () => {
    mockAnonymousCaller();

    const response = await getDirectory();

    await expectErrorCode(response, 401, "unauthenticated");
  });

  it("responde 405 a un método que el endpoint no implementa", async () => {
    mockWiring();
    const { POST } = await import("@/app/api/v1/directory/route");

    const response = await POST(
      new NextRequest(new URL(DIRECTORY_API_PATH, ORIGIN), { method: "POST" }),
    );

    await expectErrorCode(response, 405, "method_not_allowed");
  });
});

describe("privacidad del directorio", () => {
  const RESERVED_FIELDS = [
    "aufNumber",
    "aufExpiry",
    "isAufExpired",
    "dateOfBirth",
    "guardianName",
    "guardianEmail",
    "membershipType",
    "email",
  ];

  it.each(["Coach", "Committee", "Player"] as const)(
    "la respuesta de un %s no trae el AUF ni los datos reservados",
    async (callerRole) => {
      mockWiring(callerRole);

      const response = await getDirectory();

      const body = (await response.json()) as {
        data: { members: readonly Record<string, unknown>[] };
      };
      expect(body.data.members).not.toHaveLength(0);
      for (const member of body.data.members) {
        for (const field of RESERVED_FIELDS) {
          expect(member).not.toHaveProperty(field);
        }
      }
    },
  );
});

describe("el directorio en la frontera", () => {
  /** Lo que hace Next con la respuesta del proxy: si sigue, llega a la ruta. */
  const CONTINUE_HEADER = "x-middleware-next";

  async function boundaryResponse(session: SessionState): Promise<Response> {
    mockSessionClient();
    vi.doMock("@/lib/auth/session-reader", () => ({
      readSessionState: async () => session,
    }));
    const { proxy } = await import("@/proxy");
    return proxy(new NextRequest(new URL(DIRECTORY_API_PATH, ORIGIN)));
  }

  it("responde 401 sin sesión", async () => {
    const response = await boundaryResponse({ kind: "anonymous" });

    await expectErrorCode(response, 401, "unauthenticated");
  });

  it("responde 403 a una cuenta incompleta", async () => {
    const response = await boundaryResponse({ kind: "incomplete" });

    await expectErrorCode(response, 403, "forbidden");
  });

  it.each(["Admin", "Coach", "Committee", "Player"] as const)(
    "deja pasar a un %s",
    async (role) => {
      const response = await boundaryResponse({ kind: "active", role });

      expect(response.headers.get(CONTINUE_HEADER)).toBe("1");
    },
  );
});
