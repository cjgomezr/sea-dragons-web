import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { CLUB_LOGO_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import {
  CLUB_LOGO_MAX_BYTES,
  type ClubLogoGateways,
} from "@/lib/club/club-logo";

/**
 * El logo del club por la API (#295, RF-4 del PRD de E18a). La petición
 * entra por el proxy y sólo llega al handler si la frontera la deja seguir,
 * como en producción: el 401 y el 403 son los de verdad.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const OLD_PATH = `${CLUB_ID}/anterior.png`;
const PUBLIC_BASE = "https://storage.example.test/club-logos/";

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

const readSessionState = vi.fn();
const invalidateClubBrand = vi.fn();
const writes: string[] = [];
let callerRole: Role = "Admin";
let isDecodable = true;

function clubLogoGateways(): ClubLogoGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Ana Admin",
        role: callerRole,
      }),
    },
    logos: {
      findLogoPath: async () => OLD_PATH,
      saveLogoPath: async (_clubId, write) => {
        writes.push(`save ${String(write.path)}`);
        return { kind: "saved" };
      },
    },
    storage: {
      upload: async (path) => {
        writes.push(`upload ${path}`);
      },
      remove: async (path) => {
        writes.push(`remove ${path}`);
      },
      publicUrl: (path) => `${PUBLIC_BASE}${path}`,
    },
    images: { isDecodable: async () => isDecodable },
    audit: {
      insertAuditLogRow: async () => {
        writes.push("audit");
        return { error: null };
      },
    },
    newFileId: () => "nuevo",
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
  readAuthenticatedUserId: async () => ADMIN_ID,
}));

vi.mock("@/lib/club/supabase-club-logo-gateways", () => ({
  createSupabaseClubLogoGateways: () => ({
    kind: "ready",
    gateways: clubLogoGateways(),
  }),
}));

vi.mock("@/lib/club/supabase-club-brand", () => ({
  invalidateClubBrand: () => invalidateClubBrand(),
}));

const { proxy } = await import("@/proxy");
const { PUT, DELETE, POST } =
  await import("@/app/api/v1/club/settings/logo/route");

function givenSession(session: SessionState): void {
  if (session.kind === "active") {
    callerRole = session.role;
  }
  readSessionState.mockResolvedValue(session);
}

async function throughBoundary(
  request: NextRequest,
  handle: (request: NextRequest) => Promise<Response>,
): Promise<Response> {
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? handle(request)
    : boundaryResponse;
}

function logoRequest(method: string, body?: Uint8Array): NextRequest {
  return new NextRequest(new URL(CLUB_LOGO_API_PATH, ORIGIN), {
    method,
    headers: { "content-type": "image/png" },
    body: body === undefined ? undefined : Buffer.from(body),
  });
}

function putLogo(bytes: Uint8Array): Promise<Response> {
  return throughBoundary(logoRequest("PUT", bytes), PUT);
}

function deleteLogo(): Promise<Response> {
  return throughBoundary(logoRequest("DELETE"), DELETE);
}

async function errorOf(
  response: Response,
): Promise<{ code: string; reason?: string }> {
  const body = (await response.json()) as {
    error: { code: string; reason?: string };
  };
  return body.error;
}

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  isDecodable = true;
  givenSession({ kind: "active", role: "Admin" });
});

describe("endpoint del logo", () => {
  describe("PUT: subir o cambiar", () => {
    it("responde 200 con la dirección pública del logo nuevo", async () => {
      const response = await putLogo(PNG_BYTES);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: { logoUrl: `${PUBLIC_BASE}${CLUB_ID}/nuevo.png` },
      });
      expect(writes).toContain(`remove ${OLD_PATH}`);
    });

    it("invalida la caché de la marca para que la cabecera lo vea", async () => {
      await putLogo(PNG_BYTES);

      expect(invalidateClubBrand).toHaveBeenCalled();
    });

    it.each([
      ["un JPEG", JPEG_BYTES, "logo_type_unsupported"],
      ["un fichero vacío", new Uint8Array(), "logo_empty"],
    ])("responde 400 a %s sin guardar nada", async (_name, bytes, reason) => {
      const response = await putLogo(bytes);

      expect(response.status).toBe(400);
      await expect(errorOf(response)).resolves.toMatchObject({
        code: "validation_error",
        reason,
      });
      expect(writes).toEqual([]);
    });

    it("responde 400 a un logo de más de 512 KB sin guardar nada", async () => {
      const heavy = new Uint8Array(CLUB_LOGO_MAX_BYTES + 1);
      heavy.set(PNG_BYTES);

      const response = await putLogo(heavy);

      expect(response.status).toBe(400);
      await expect(errorOf(response)).resolves.toMatchObject({
        reason: "logo_too_large",
      });
      expect(writes).toEqual([]);
    });

    it("responde 400 a un PNG que no se decodifica sin guardar nada", async () => {
      isDecodable = false;

      const response = await putLogo(PNG_BYTES);

      expect(response.status).toBe(400);
      await expect(errorOf(response)).resolves.toMatchObject({
        reason: "logo_undecodable",
      });
      expect(writes).toEqual([]);
    });

    it("responde 401 sin sesión", async () => {
      givenSession({ kind: "anonymous" });

      const response = await putLogo(PNG_BYTES);

      expect(response.status).toBe(401);
      expect(writes).toEqual([]);
    });

    it.each(["Coach", "Committee", "Player"] as const)(
      "responde 403 a un %s sin guardar nada",
      async (role) => {
        givenSession({ kind: "active", role });

        const response = await putLogo(PNG_BYTES);

        expect(response.status).toBe(403);
        expect(writes).toEqual([]);
      },
    );
  });

  describe("DELETE: quitar", () => {
    it("responde 200 sin logo, lo borra e invalida la caché", async () => {
      const response = await deleteLogo();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: { logoUrl: null },
      });
      expect(writes).toEqual(["save null", "audit", `remove ${OLD_PATH}`]);
      expect(invalidateClubBrand).toHaveBeenCalled();
    });

    it.each(["Coach", "Committee", "Player"] as const)(
      "responde 403 a un %s sin borrar nada",
      async (role) => {
        givenSession({ kind: "active", role });

        const response = await deleteLogo();

        expect(response.status).toBe(403);
        expect(writes).toEqual([]);
      },
    );
  });

  it("no acepta otro método", async () => {
    const response = await throughBoundary(logoRequest("POST"), POST);

    expect(response.status).toBe(405);
  });
});
