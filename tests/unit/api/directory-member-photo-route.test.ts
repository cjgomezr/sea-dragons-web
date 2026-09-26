import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { DIRECTORY_MEMBER_PHOTO_API_PATH } from "@/lib/auth/routes";
import type { DirectoryMemberRecord } from "@/lib/directory/directory";
import type { MemberPhotoGateways } from "@/lib/directory/member-photo";

/**
 * La foto grande de un socio por API (#353). La alcanza cualquier cuenta
 * activa, como el directorio del que cuelga, y la regla de quién ve a quién
 * es la del directorio. La petición entra por el proxy y sólo llega al
 * handler si la frontera la deja seguir, como en producción.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const MEMBER_ID = "cccccccc-0000-4000-8000-00000000000c";
const UNKNOWN_ID = "eeeeeeee-0000-4000-8000-00000000000e";

const THUMBNAIL_PATH = `${MEMBER_ID}/foto-thumb.webp`;
const LARGE_PATH = `${MEMBER_ID}/foto-large.webp`;

const readSessionState = vi.fn();
const readAuthenticatedUserId = vi.fn();

type Club = {
  callerRole: Role;
  member: DirectoryMemberRecord;
};

let club: Club;

function memberRecord(
  overrides: Partial<DirectoryMemberRecord> = {},
): DirectoryMemberRecord {
  return {
    userId: MEMBER_ID,
    fullName: "María Ñíguez",
    country: "AU",
    experienceLevel: null,
    role: "Player",
    positionId: null,
    status: "active",
    aufNumber: null,
    aufExpiry: null,
    isAufVerified: false,
    photoPath: THUMBNAIL_PATH,
    ...overrides,
  };
}

function fakeGateways(): MemberPhotoGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Quien pregunta",
        role: club.callerRole,
      }),
    },
    directory: { findDirectoryMembers: async () => [club.member] },
    photos: {
      signPhotoUrls: async (photoPaths) =>
        new Map(
          photoPaths.map((path) => [path, `https://storage.test/${path}`]),
        ),
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

vi.mock("@/lib/directory/supabase-directory-gateways", () => ({
  createSupabaseDirectoryGateways: () => ({
    kind: "ready",
    gateways: fakeGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const { GET, POST } = await import("@/app/api/v1/directory/[id]/photo/route");

async function throughBoundary(
  memberId: string,
  method: "GET" | "POST" = "GET",
): Promise<Response> {
  const request = new NextRequest(
    new URL(DIRECTORY_MEMBER_PHOTO_API_PATH.replace("[id]", memberId), ORIGIN),
    { method },
  );
  const boundaryResponse = await proxy(request);
  if (boundaryResponse.headers.get(CONTINUE_HEADER) !== "1") {
    return boundaryResponse;
  }
  const context = { params: Promise.resolve({ id: memberId }) };
  return method === "GET" ? GET(request, context) : POST(request);
}

beforeEach(() => {
  vi.clearAllMocks();
  readSessionState.mockResolvedValue({ kind: "active", role: "Player" });
  readAuthenticatedUserId.mockResolvedValue(CALLER_ID);
  club = { callerRole: "Player", member: memberRecord() };
});

describe("GET /api/v1/directory/{id}/photo", () => {
  it("responde 200 con la dirección firmada de la versión grande a un Player del club", async () => {
    const response = await throughBoundary(MEMBER_ID);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { photoUrl: `https://storage.test/${LARGE_PATH}` },
    });
  });

  it("responde con la única versión de una foto subida antes de los dos tamaños", async () => {
    const singleSizePath = `${MEMBER_ID}/antigua.webp`;
    club.member = memberRecord({ photoPath: singleSizePath });

    const response = await throughBoundary(MEMBER_ID);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { photoUrl: `https://storage.test/${singleSizePath}` },
    });
  });

  it("responde null a la foto de un socio que no tiene", async () => {
    club.member = memberRecord({ photoPath: null });

    const response = await throughBoundary(MEMBER_ID);

    await expect(response.json()).resolves.toEqual({
      data: { photoUrl: null },
    });
  });

  it("responde 404 a un Player que pide la foto de un socio dado de baja", async () => {
    club.member = memberRecord({ status: "inactive" });

    const response = await throughBoundary(MEMBER_ID);

    expect(response.status).toBe(404);
  });

  it("responde 200 a un Admin que pide la foto de un socio dado de baja", async () => {
    readSessionState.mockResolvedValue({ kind: "active", role: "Admin" });
    club = {
      callerRole: "Admin",
      member: memberRecord({ status: "inactive" }),
    };

    const response = await throughBoundary(MEMBER_ID);

    expect(response.status).toBe(200);
  });

  it("responde 404 a un socio que no está en el club", async () => {
    const response = await throughBoundary(UNKNOWN_ID);

    expect(response.status).toBe(404);
  });

  it("responde 404 a un id que no es un uuid, sin leer el club", async () => {
    const response = await throughBoundary("no-es-un-id");

    expect(response.status).toBe(404);
  });

  it("responde 401 a quien no tiene sesión", async () => {
    readSessionState.mockResolvedValue({ kind: "anonymous" });
    readAuthenticatedUserId.mockResolvedValue(null);

    const response = await throughBoundary(MEMBER_ID);

    expect(response.status).toBe(401);
  });

  it("responde 405 a un método que no es GET", async () => {
    const response = await throughBoundary(MEMBER_ID, "POST");

    expect(response.status).toBe(405);
  });
});
