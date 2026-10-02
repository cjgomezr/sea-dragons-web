import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_NEWS_SEEN_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { NewsSeenGateway } from "@/lib/news/news-seen";

/**
 * La marca de visita a Noticias (#424, D2 del PRD de E14): de ella sale la
 * cuenta de noticias sin leer del dashboard. Siempre sobre quien identifica
 * la cookie de sesión. La petición entra por el proxy, como en producción.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const NOW = new Date("2026-09-30T08:00:00.000Z");

const readSessionState = vi.fn();
let memberExists: boolean;
const marks: { userId: string; seenAt: string }[] = [];

function newsSeenGateway(): NewsSeenGateway {
  return {
    markNewsSeen: async (mark) => {
      if (!memberExists) {
        return "not_found";
      }
      marks.push(mark);
      return "marked";
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
  readAuthenticatedUserId: async () => USER_ID,
}));

vi.mock("@/lib/news/supabase-news-seen-gateway", () => ({
  createSupabaseNewsSeenGateway: () => ({
    kind: "ready",
    gateway: newsSeenGateway(),
  }),
}));

const { proxy } = await import("@/proxy");
const route = await import("@/app/api/v1/account/news-seen/route");

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

async function postNewsSeen(): Promise<Response> {
  const request = new NextRequest(new URL(ACCOUNT_NEWS_SEEN_API_PATH, ORIGIN), {
    method: "POST",
  });
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? route.POST(request)
    : boundaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  memberExists = true;
  marks.length = 0;
});

describe("POST /api/v1/account/news-seen", () => {
  it("pone la marca de quien llama en ahora y responde 204", async () => {
    givenSession({ kind: "active", role: "Player", membershipCurrent: true });

    const response = await postNewsSeen();

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(marks).toEqual([
      { userId: USER_ID, seenAt: "2026-09-30T08:00:00.000Z" },
    ]);
  });

  it("responde 401 sin sesión y no marca nada", async () => {
    givenSession({ kind: "anonymous" });

    const response = await postNewsSeen();

    expect(response.status).toBe(401);
    expect(marks).toEqual([]);
  });

  it("responde 403 a una cuenta incompleta y no marca nada", async () => {
    givenSession({ kind: "incomplete" });

    const response = await postNewsSeen();

    expect(response.status).toBe(403);
    expect(marks).toEqual([]);
  });

  it("responde 403 a una sesión que no corresponde a ningún socio", async () => {
    givenSession({ kind: "active", role: "Player", membershipCurrent: true });
    memberExists = false;

    const response = await postNewsSeen();

    expect(response.status).toBe(403);
  });

  it("no acepta lecturas", async () => {
    const response = await route.GET(
      new NextRequest(new URL(ACCOUNT_NEWS_SEEN_API_PATH, ORIGIN)),
    );

    expect(response.status).toBe(405);
  });
});
