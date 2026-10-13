import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  NEWS_POST_MANAGE_API_PATH,
  NEWS_POST_PIN_API_PATH,
  NEWS_PUBLISH_API_PATH,
} from "@/lib/auth/routes";
import type { NewsPost } from "@/lib/news/news-posts";
import {
  CALLER_ID,
  type FakeClub,
  aPost,
  fakeClub,
} from "../helpers/news-club";

/**
 * Fijar y desfijar por la API (#592, RF-3 del PRD de E22). Qué decide cada
 * caso lo prueba el dominio; aquí, que cada uno sale con su código: 200 al
 * fijar, 204 al desfijar, 403 a quien no es Admin, 409 con motivo a una
 * retirada y 400 a una fecha pasada o mal formada.
 */

const ORIGIN = "http://localhost:3417";
const POST_ID = "d3d3d3d3-0000-4000-8000-00000000000d";
const FUTURE = "2999-01-01T00:00:00.000Z";

let club: FakeClub;

function mockWiring(role: Role, posts: readonly NewsPost[]): void {
  club = fakeClub({ callerRole: role, posts });
  vi.doMock("@/lib/news/supabase-news-gateways", () => ({
    createSupabaseNewsGateways: () => ({
      kind: "ready",
      gateways: club.gateways,
    }),
  }));
  vi.doMock("@/lib/supabase/session-client", () => ({
    readIncomingCookies: () => [],
    applySessionCookies: () => undefined,
    createSessionClient: () => ({
      kind: "ready",
      client: {},
      recorder: { recorded: () => ({ cookies: [], headers: {} }) },
    }),
  }));
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => CALLER_ID,
  }));
}

function routeContext(postId: string): {
  params: Promise<{ id: string }>;
} {
  return { params: Promise.resolve({ id: postId }) };
}

function pinUrl(postId: string): URL {
  return new URL(NEWS_POST_PIN_API_PATH.replace("[id]", postId), ORIGIN);
}

async function pin(body: unknown, postId: string = POST_ID): Promise<Response> {
  const { POST } = await import("@/app/api/v1/news/[id]/pin/route");
  return POST(
    new NextRequest(pinUrl(postId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    routeContext(postId),
  );
}

async function unpin(postId: string = POST_ID): Promise<Response> {
  const { DELETE } = await import("@/app/api/v1/news/[id]/pin/route");
  return DELETE(
    new NextRequest(pinUrl(postId), { method: "DELETE" }),
    routeContext(postId),
  );
}

async function expectError(
  response: Response,
  status: number,
  error: Record<string, string>,
): Promise<void> {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error });
}

function pinOf(id: string = POST_ID): NewsPost["pin"] {
  return club.posts.find((post) => post.id === id)?.pin ?? null;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/news/supabase-news-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
});

describe("POST /api/v1/news/{id}/pin", () => {
  it("responde 200 con la publicación fijada hasta la fecha pedida", async () => {
    mockWiring("Admin", [aPost({ id: POST_ID })]);

    const response = await pin({ until: FUTURE });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: POST_ID, isPinned: true, pinnedUntil: FUTURE, canPin: true },
    });
  });

  it("fija sin fecha de fin con until nulo", async () => {
    mockWiring("Admin", [aPost({ id: POST_ID })]);

    const response = await pin({ until: null });

    await expect(response.json()).resolves.toMatchObject({
      data: { isPinned: true, pinnedUntil: null },
    });
  });

  it.each<Role>(["Committee", "Coach", "Player"])(
    "responde 403 a un %s sin fijar nada",
    async (role) => {
      mockWiring(role, [aPost({ id: POST_ID })]);

      const response = await pin({ until: FUTURE });

      await expectError(response, 403, { code: "forbidden" });
      expect(pinOf()).toBeNull();
    },
  );

  it("responde 409 con su motivo a una publicación retirada", async () => {
    mockWiring("Admin", [aPost({ id: POST_ID, status: "withdrawn" })]);

    const response = await pin({ until: FUTURE });

    await expectError(response, 409, {
      code: "conflict",
      reason: "news_post_withdrawn",
    });
  });

  it.each([
    ["en el pasado", { until: "2000-01-01T00:00:00.000Z" }],
    ["mal formado", { until: "mañana" }],
    ["sin until", {}],
  ])("responde 400 a un until %s", async (_case, body) => {
    mockWiring("Admin", [aPost({ id: POST_ID })]);

    const response = await pin(body);

    await expectError(response, 400, { code: "validation_error" });
    expect(pinOf()).toBeNull();
  });

  it("responde 404 a una publicación que no existe", async () => {
    mockWiring("Admin", []);

    const response = await pin({ until: null });

    await expectError(response, 404, { code: "not_found" });
  });
});

describe("DELETE /api/v1/news/{id}/pin", () => {
  it("responde 204 y la desfija", async () => {
    mockWiring("Admin", [
      aPost({ id: POST_ID, pin: { pinnedAt: FUTURE, pinnedUntil: null } }),
    ]);

    const response = await unpin();

    expect(response.status).toBe(204);
    expect(pinOf()).toBeNull();
  });

  it("responde 204 también si no estaba fijada", async () => {
    mockWiring("Admin", [aPost({ id: POST_ID })]);

    const response = await unpin();

    expect(response.status).toBe(204);
  });

  it.each<Role>(["Committee", "Coach", "Player"])(
    "responde 403 a un %s sin desfijar nada",
    async (role) => {
      mockWiring(role, [
        aPost({ id: POST_ID, pin: { pinnedAt: FUTURE, pinnedUntil: null } }),
      ]);

      const response = await unpin();

      await expectError(response, 403, { code: "forbidden" });
      expect(pinOf()).not.toBeNull();
    },
  );
});

describe("pin al publicar y al editar", () => {
  const DRAFT = {
    category: "announcement",
    title: "Cierre de inscripciones",
    body: "Hasta el viernes.",
    audience: { kind: "club" },
  };

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

  async function edit(body: unknown): Promise<Response> {
    const { PATCH } = await import("@/app/api/v1/news/publish/[id]/route");
    return PATCH(
      new NextRequest(
        new URL(NEWS_POST_MANAGE_API_PATH.replace("[id]", POST_ID), ORIGIN),
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
      routeContext(POST_ID),
    );
  }

  it("deja a un Admin editar y desfijar con pin nulo", async () => {
    mockWiring("Admin", [
      aPost({ id: POST_ID, pin: { pinnedAt: FUTURE, pinnedUntil: null } }),
    ]);

    const response = await edit({
      ...DRAFT,
      expectedEditedAt: null,
      pin: null,
    });

    expect(response.status).toBe(200);
    expect(pinOf()).toBeNull();
  });

  it("responde 403 a un Committee que edita con pin, sin guardar nada", async () => {
    mockWiring("Committee", [
      aPost({ id: POST_ID, author: { id: CALLER_ID, fullName: "Yo" } }),
    ]);

    const response = await edit({
      ...DRAFT,
      expectedEditedAt: null,
      pin: { until: null },
    });

    await expectError(response, 403, { code: "forbidden" });
    expect(club.edits).toEqual([]);
  });

  it("responde 403 a un Committee que publica con pin, sin guardar nada", async () => {
    mockWiring("Committee", []);
    vi.doMock("@/lib/news/news-attachments-api", async (importOriginal) => ({
      ...(await importOriginal<
        typeof import("@/lib/news/news-attachments-api")
      >()),
      requireNewsPublishGateways: () => club.gateways,
    }));

    const response = await publish({ ...DRAFT, pin: { until: FUTURE } });

    await expectError(response, 403, { code: "forbidden" });
    expect(club.inserted).toEqual([]);
    vi.doUnmock("@/lib/news/news-attachments-api");
  });
});
