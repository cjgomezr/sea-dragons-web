import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NEWS_API_PATH,
  NEWS_POST_API_PATH,
  NEWS_PUBLISH_API_PATH,
} from "@/lib/auth/routes";
import {
  CALLER_ID,
  type FakeClub,
  type FakeClubOptions,
  MASTERS_SQUAD_ID,
  SENIOR_SQUAD_ID,
  aPost,
  fakeClub,
} from "../helpers/news-club";

/**
 * Los endpoints de noticias (#327): publicar, el feed y la publicación
 * abierta. Qué decide cada caso lo prueba el dominio; aquí se prueba que cada
 * uno sale con su código de la convención, y sobre todo que quien no es
 * audiencia recibe 404 y no 403.
 */

const ORIGIN = "http://localhost:3417";
const POST_ID = "d3d3d3d3-0000-4000-8000-00000000000d";

const DRAFT = {
  category: "announcement",
  title: "Cambia la piscina",
  body: "El martes entrenamos en MSAC.",
  audience: { kind: "club" },
};

let club: FakeClub;

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

function mockWiring(options: FakeClubOptions = {}): void {
  club = fakeClub(options);
  vi.doMock("@/lib/news/supabase-news-gateways", () => ({
    createSupabaseNewsGateways: () => ({
      kind: "ready",
      gateways: club.gateways,
    }),
  }));
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => CALLER_ID,
  }));
}

function mockAnonymousCaller(): void {
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => null,
  }));
}

async function readFeed(query = ""): Promise<Response> {
  const { GET } = await import("@/app/api/v1/news/route");
  return GET(new NextRequest(new URL(`${NEWS_API_PATH}${query}`, ORIGIN)));
}

async function openPost(postId: string = POST_ID): Promise<Response> {
  const { GET } = await import("@/app/api/v1/news/[id]/route");
  return GET(
    new NextRequest(
      new URL(NEWS_POST_API_PATH.replace("[id]", postId), ORIGIN),
    ),
    { params: Promise.resolve({ id: postId }) },
  );
}

async function publish(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/v1/news/publish/route");
  return POST(
    new NextRequest(new URL(NEWS_PUBLISH_API_PATH, ORIGIN), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
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
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/news/supabase-news-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("POST /api/v1/news/publish", () => {
  it("responde 201 con la publicación guardada", async () => {
    mockWiring({ callerRole: "Committee" });

    const response = await publish(DRAFT);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        title: "Cambia la piscina",
        author: { id: CALLER_ID },
        status: "published",
        editedAt: null,
      },
    });
  });

  it("guarda una audiencia de grupos", async () => {
    mockWiring({ callerRole: "Admin" });

    const response = await publish({
      ...DRAFT,
      audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
    });

    expect(response.status).toBe(201);
    expect(club.inserted[0]?.audience).toEqual({
      kind: "groups",
      groupIds: [SENIOR_SQUAD_ID],
    });
  });

  it("responde 400 a una audiencia de grupos vacía", async () => {
    mockWiring({ callerRole: "Admin" });

    const response = await publish({
      ...DRAFT,
      audience: { kind: "groups", groupIds: [] },
    });

    await expectErrorCode(response, 400, "validation_error");
    expect(club.inserted).toEqual([]);
  });

  it("responde 400 sin escribir nada a un grupo de otro club", async () => {
    mockWiring({ callerRole: "Admin", clubGroupIds: [SENIOR_SQUAD_ID] });

    const response = await publish({
      ...DRAFT,
      audience: { kind: "groups", groupIds: [MASTERS_SQUAD_ID] },
    });

    await expectErrorCode(response, 400, "validation_error");
    expect(club.inserted).toEqual([]);
  });

  it.each([
    ["una categoría desconocida", { ...DRAFT, category: "gossip" }],
    ["un título vacío", { ...DRAFT, title: "  " }],
    ["un cuerpo vacío", { ...DRAFT, body: "\n" }],
    [
      "un grupo que no es un uuid",
      { ...DRAFT, audience: { kind: "groups", groupIds: ["senior"] } },
    ],
    ["una audiencia sin forma", { ...DRAFT, audience: "club" }],
  ])("responde 400 a %s", async (_case, body) => {
    mockWiring({ callerRole: "Admin" });

    const response = await publish(body);

    await expectErrorCode(response, 400, "validation_error");
    expect(club.inserted).toEqual([]);
  });

  it.each(["Coach", "Player"] as const)(
    "responde 403 a un %s aunque la frontera lo dejara pasar",
    async (role) => {
      mockWiring({ callerRole: role });

      const response = await publish(DRAFT);

      await expectErrorCode(response, 403, "forbidden");
      expect(club.inserted).toEqual([]);
    },
  );

  it("responde 401 sin sesión", async () => {
    mockAnonymousCaller();

    const response = await publish(DRAFT);

    await expectErrorCode(response, 401, "unauthenticated");
  });
});

describe("GET /api/v1/news", () => {
  it("responde 200 con la página del feed y su cursor", async () => {
    mockWiring({ posts: [aPost({ id: POST_ID })] });

    const response = await readFeed();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        posts: [
          expect.objectContaining({
            id: POST_ID,
            excerpt: "El martes entrenamos en MSAC.",
            attachmentCount: 0,
          }),
        ],
        nextCursor: null,
      },
    });
  });

  it("no manda el cuerpo entero en el feed", async () => {
    mockWiring({ posts: [aPost({ id: POST_ID })] });

    const response = await readFeed();

    const payload = (await response.json()) as {
      data: { posts: Record<string, unknown>[] };
    };
    expect(payload.data.posts[0]).not.toHaveProperty("body");
  });

  it("responde 200 con una lista vacía a quien no tiene publicaciones", async () => {
    mockWiring();

    const response = await readFeed();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { posts: [], nextCursor: null },
    });
  });

  it("pide la página siguiente con el cursor", async () => {
    mockWiring();
    const cursor = Buffer.from(
      JSON.stringify({
        publishedAt: "2026-09-26T10:00:00.000000+00:00",
        id: POST_ID,
      }),
    ).toString("base64url");

    await readFeed(`?cursor=${cursor}`);

    expect(club.feedQueries[0]?.after).toEqual({
      publishedAt: "2026-09-26T10:00:00.000000+00:00",
      id: POST_ID,
    });
  });

  it("responde 400 a un cursor inventado", async () => {
    mockWiring();

    const response = await readFeed("?cursor=inventado");

    await expectErrorCode(response, 400, "validation_error");
  });

  it("responde 401 sin sesión", async () => {
    mockAnonymousCaller();

    const response = await readFeed();

    await expectErrorCode(response, 401, "unauthenticated");
  });
});

describe("GET /api/v1/news/{id}", () => {
  it("responde 200 con la publicación entera a su audiencia", async () => {
    mockWiring({ posts: [aPost({ id: POST_ID })] });

    const response = await openPost();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: POST_ID,
        body: "El martes entrenamos en MSAC.",
        status: "published",
        editedAt: null,
        attachments: [],
      },
    });
  });

  it("responde 404, y no 403, a quien no es su audiencia", async () => {
    mockWiring({
      posts: [
        aPost({
          id: POST_ID,
          audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        }),
      ],
    });

    const response = await openPost();

    await expectErrorCode(response, 404, "not_found");
  });

  it("responde 404 a una retirada", async () => {
    mockWiring({ posts: [aPost({ id: POST_ID, status: "withdrawn" })] });

    const response = await openPost();

    await expectErrorCode(response, 404, "not_found");
  });

  it("responde 404 a un id que no es un uuid", async () => {
    mockWiring();

    const response = await openPost("no-es-un-id");

    await expectErrorCode(response, 404, "not_found");
  });

  it("responde 401 sin sesión", async () => {
    mockAnonymousCaller();

    const response = await openPost();

    await expectErrorCode(response, 401, "unauthenticated");
  });
});
