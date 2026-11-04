import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import { CLUB_SOCIAL_LINKS_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import {
  NO_SOCIAL_LINKS,
  type SocialLinks,
  type SocialLinksGateways,
} from "@/lib/club/social-links";

/**
 * Las redes del club por la API (#963, RF-1 del PRD de E37). La petición
 * entra por el proxy y sólo llega al handler si la frontera la deja seguir,
 * como en producción: el 401 y el 403 son los de verdad.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const CLUB_LINKS: SocialLinks = {
  ...NO_SOCIAL_LINKS,
  instagram: "https://www.instagram.com/victoriaseadragons",
  whatsapp: "https://wa.me/61400000000",
};

const readSessionState = vi.fn();
const invalidateClubBrand = vi.fn();
const writes: string[] = [];
let callerRole: Role = "Admin";
let stored: SocialLinks = NO_SOCIAL_LINKS;

function socialLinksGateways(): SocialLinksGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Ana Admin",
        role: callerRole,
      }),
    },
    socialLinks: {
      findClubIdBySlug: async () => CLUB_ID,
      findSocialLinks: async () => stored,
      replaceSocialLinks: async (_clubId, links) => {
        writes.push("links");
        stored = links;
        return links;
      },
    },
    audit: {
      insertAuditLogRow: async (row: AuditLogInsertRow) => {
        writes.push(`audit ${row.action}`);
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
  readAuthenticatedUserId: async () => ADMIN_ID,
}));

vi.mock("@/lib/club/supabase-social-links-gateways", () => ({
  createSupabaseSocialLinksGateways: () => ({
    kind: "ready",
    gateways: socialLinksGateways(),
  }),
}));

vi.mock("@/lib/club/supabase-club-brand", () => ({
  invalidateClubBrand: () => invalidateClubBrand(),
}));

const { proxy } = await import("@/proxy");
const { GET, PUT, PATCH } =
  await import("@/app/api/v1/club/settings/social-links/route");

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

function putLinks(body: unknown): Promise<Response> {
  const request = new NextRequest(new URL(CLUB_SOCIAL_LINKS_API_PATH, ORIGIN), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return throughBoundary(request, PUT);
}

function getLinks(): Promise<Response> {
  return throughBoundary(
    new NextRequest(new URL(CLUB_SOCIAL_LINKS_API_PATH, ORIGIN)),
    GET,
  );
}

type ErrorBody = {
  code: string;
  reason?: string;
  issues?: readonly { network: string; code: string }[];
};

async function errorOf(response: Response): Promise<ErrorBody> {
  const body = (await response.json()) as { error: ErrorBody };
  return body.error;
}

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  stored = NO_SOCIAL_LINKS;
  givenSession({ kind: "active", role: "Admin", membershipCurrent: true });
});

describe("GET/PUT /api/v1/club/settings/social-links", () => {
  describe("GET", () => {
    it("responde 200 con las redes puestas sin sesión: son públicas", async () => {
      givenSession({ kind: "anonymous" });
      stored = CLUB_LINKS;

      const response = await getLinks();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: CLUB_LINKS });
    });

    it.each(["Admin", "Coach", "Committee", "Player"] as const)(
      "responde 200 a un %s",
      async (role) => {
        givenSession({ kind: "active", role, membershipCurrent: true });
        stored = CLUB_LINKS;

        const response = await getLinks();

        expect(response.status).toBe(200);
      },
    );
  });

  describe("PUT", () => {
    it("guarda las redes del Admin y lo anota", async () => {
      const response = await putLinks(CLUB_LINKS);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: CLUB_LINKS });
      expect(writes).toEqual(["links", "audit club.social_links_changed"]);
    });

    // #964: la entrada lee las redes con la marca; sin esto seguiría con las
    // de antes hasta que caducara su caché.
    it("al guardar invalida la caché de la marca", async () => {
      const response = await putLinks(CLUB_LINKS);

      expect(response.status).toBe(200);
      expect(invalidateClubBrand).toHaveBeenCalledOnce();
    });

    it("quita las redes que llegan vacías", async () => {
      stored = CLUB_LINKS;

      const response = await putLinks({ ...CLUB_LINKS, instagram: "" });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: { ...CLUB_LINKS, instagram: null },
      });
    });

    it.each(["Coach", "Committee", "Player"] as const)(
      "responde 403 a un %s sin cambiar nada",
      async (role) => {
        givenSession({ kind: "active", role, membershipCurrent: true });

        const response = await putLinks(CLUB_LINKS);

        expect(response.status).toBe(403);
        expect(writes).toEqual([]);
        expect(invalidateClubBrand).not.toHaveBeenCalled();
      },
    );

    it("responde 401 sin sesión", async () => {
      givenSession({ kind: "anonymous" });

      const response = await putLinks(CLUB_LINKS);

      expect(response.status).toBe(401);
      expect(writes).toEqual([]);
    });

    it("responde 400 con el error por campo y no guarda ninguna", async () => {
      const response = await putLinks({
        ...CLUB_LINKS,
        tiktok: "https://instagram.com.evil.example/x",
        website: "http://seadragons.example",
      });

      expect(response.status).toBe(400);
      await expect(errorOf(response)).resolves.toMatchObject({
        code: "validation_error",
        reason: "tiktok.wrong_domain",
        issues: [
          { network: "tiktok", code: "wrong_domain" },
          { network: "website", code: "not_https" },
        ],
      });
      expect(writes).toEqual([]);
    });

    it("responde 400 a un cuerpo sin una de las redes", async () => {
      const withoutWebsite = Object.fromEntries(
        Object.entries(CLUB_LINKS).filter(([network]) => network !== "website"),
      );

      const response = await putLinks(withoutWebsite);

      expect(response.status).toBe(400);
      expect(writes).toEqual([]);
    });

    it("responde 400 a una red que no es de las seis", async () => {
      const response = await putLinks({ ...CLUB_LINKS, myspace: null });

      expect(response.status).toBe(400);
    });
  });

  it("no admite PATCH", async () => {
    const request = new NextRequest(
      new URL(CLUB_SOCIAL_LINKS_API_PATH, ORIGIN),
      { method: "PATCH" },
    );

    const response = await PATCH(request);

    expect(response.status).toBe(405);
  });
});
