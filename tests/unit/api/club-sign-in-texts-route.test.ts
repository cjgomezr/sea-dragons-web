import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import { CLUB_SIGN_IN_TEXTS_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import {
  NO_SIGN_IN_TEXTS,
  type SignInTexts,
  type SignInTextsGateways,
} from "@/lib/club/sign-in-texts";

/**
 * Los textos del inicio de sesión por la API (#301, RF-5 del PRD de E18a).
 * La petición entra por el proxy y sólo llega al handler si la frontera la
 * deja seguir, como en producción: el 401 y el 403 son los de verdad.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const CLUB_TEXTS: SignInTexts = {
  en: { tagline: "Dive in.", welcome: "Train with us." },
  es: { tagline: "Al agua.", welcome: null },
};

const readSessionState = vi.fn();
const invalidateClubBrand = vi.fn();
const writes: string[] = [];
let callerRole: Role = "Admin";
let stored: SignInTexts = NO_SIGN_IN_TEXTS;

function signInTextsGateways(): SignInTextsGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Ana Admin",
        role: callerRole,
      }),
    },
    signInTexts: {
      findSignInTexts: async () => stored,
      replaceSignInTexts: async (_clubId, texts) => {
        writes.push("texts");
        stored = texts;
        return texts;
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

vi.mock("@/lib/club/supabase-sign-in-texts-gateways", () => ({
  createSupabaseSignInTextsGateways: () => ({
    kind: "ready",
    gateways: signInTextsGateways(),
  }),
}));

vi.mock("@/lib/club/supabase-club-brand", () => ({
  invalidateClubBrand: () => invalidateClubBrand(),
}));

const { proxy } = await import("@/proxy");
const { GET, PUT, PATCH } =
  await import("@/app/api/v1/club/settings/sign-in-texts/route");

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

function putTexts(body: unknown): Promise<Response> {
  const request = new NextRequest(
    new URL(CLUB_SIGN_IN_TEXTS_API_PATH, ORIGIN),
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return throughBoundary(request, PUT);
}

function getTexts(): Promise<Response> {
  return throughBoundary(
    new NextRequest(new URL(CLUB_SIGN_IN_TEXTS_API_PATH, ORIGIN)),
    GET,
  );
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
  stored = NO_SIGN_IN_TEXTS;
  givenSession({ kind: "active", role: "Admin" });
});

describe("endpoint", () => {
  describe("GET", () => {
    it("responde 200 con los textos del club a un Admin", async () => {
      stored = CLUB_TEXTS;

      const response = await getTexts();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: CLUB_TEXTS });
    });

    it.each(["Coach", "Committee", "Player"] as const)(
      "responde 403 a un %s",
      async (role) => {
        givenSession({ kind: "active", role });

        const response = await getTexts();

        expect(response.status).toBe(403);
      },
    );
  });

  describe("PUT", () => {
    it("responde 200 con lo guardado, lo anota e invalida la caché de la marca", async () => {
      const response = await putTexts(CLUB_TEXTS);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: CLUB_TEXTS });
      expect(writes).toEqual(["texts", "audit club.sign_in_texts_changed"]);
      expect(invalidateClubBrand).toHaveBeenCalledOnce();
    });

    it("con los textos vacíos vuelven los de la aplicación", async () => {
      stored = CLUB_TEXTS;

      const response = await putTexts({
        en: { tagline: "", welcome: "" },
        es: { tagline: null, welcome: null },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: NO_SIGN_IN_TEXTS,
      });
    });

    it.each(["Coach", "Committee", "Player"] as const)(
      "responde 403 a un %s sin escribir nada",
      async (role) => {
        givenSession({ kind: "active", role });

        const response = await putTexts(CLUB_TEXTS);

        expect(response.status).toBe(403);
        expect(writes).toEqual([]);
      },
    );

    it("responde 401 sin sesión", async () => {
      givenSession({ kind: "anonymous" });

      const response = await putTexts(CLUB_TEXTS);

      expect(response.status).toBe(401);
      expect(writes).toEqual([]);
    });

    it("responde 400 con un lema demasiado largo, nombrando el campo", async () => {
      const response = await putTexts({
        ...CLUB_TEXTS,
        es: { tagline: "a".repeat(141), welcome: null },
      });

      expect(response.status).toBe(400);
      await expect(errorOf(response)).resolves.toMatchObject({
        code: "validation_error",
        reason: "es.tagline_too_long",
      });
      expect(writes).toEqual([]);
    });

    it("responde 400 con un párrafo demasiado largo", async () => {
      const response = await putTexts({
        ...CLUB_TEXTS,
        en: { tagline: null, welcome: "b".repeat(321) },
      });

      expect(response.status).toBe(400);
      await expect(errorOf(response)).resolves.toMatchObject({
        reason: "en.welcome_too_long",
      });
    });

    it("responde 400 a un cuerpo sin uno de los idiomas", async () => {
      const response = await putTexts({ en: CLUB_TEXTS.en });

      expect(response.status).toBe(400);
      expect(writes).toEqual([]);
    });

    it("responde 400 a un campo que no es de esta pantalla", async () => {
      const response = await putTexts({ ...CLUB_TEXTS, eyebrow: "Hola" });

      expect(response.status).toBe(400);
    });
  });

  it("no admite PATCH", async () => {
    const request = new NextRequest(
      new URL(CLUB_SIGN_IN_TEXTS_API_PATH, ORIGIN),
      { method: "PATCH" },
    );

    const response = await PATCH(request);

    expect(response.status).toBe(405);
  });
});
