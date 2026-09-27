import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NEWS_POST_MANAGE_API_PATH,
  NEWS_POST_STATUS_API_PATH,
} from "@/lib/auth/routes";
import type { NewsPost } from "@/lib/news/news-posts";
import {
  CALLER_ID,
  type FakeClub,
  type FakeClubOptions,
  SENIOR_SQUAD_ID,
  aPost,
  fakeClub,
} from "../helpers/news-club";

/**
 * Los endpoints de editar y retirar (#331, RF-6 del PRD de E11). Qué decide
 * cada caso lo prueba el dominio; aquí, que cada uno sale con su código de la
 * convención: 409 al pisar una edición, 403 a lo ajeno del Committee y a
 * Coach y Player, 404 a lo que no existe.
 */

const ORIGIN = "http://localhost:3417";
const POST_ID = "d3d3d3d3-0000-4000-8000-00000000000d";

const EDIT = {
  category: "announcement",
  title: "Cambia la piscina: MSAC",
  body: "El martes entrenamos en MSAC.",
  audience: { kind: "club" },
  expectedEditedAt: null,
};

let club: FakeClub;

const OWN_POST: NewsPost = aPost({
  id: POST_ID,
  author: { id: CALLER_ID, fullName: "Quien llama" },
});

function mockWiring(options: FakeClubOptions = {}): void {
  club = fakeClub({ callerRole: "Committee", posts: [OWN_POST], ...options });
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

async function readEditable(postId: string = POST_ID): Promise<Response> {
  const { GET } = await import("@/app/api/v1/news/publish/[id]/route");
  return GET(
    new NextRequest(
      new URL(NEWS_POST_MANAGE_API_PATH.replace("[id]", postId), ORIGIN),
    ),
    routeContext(postId),
  );
}

async function saveEdit(
  body: unknown,
  postId: string = POST_ID,
): Promise<Response> {
  const { PATCH } = await import("@/app/api/v1/news/publish/[id]/route");
  return PATCH(
    new NextRequest(
      new URL(NEWS_POST_MANAGE_API_PATH.replace("[id]", postId), ORIGIN),
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
    routeContext(postId),
  );
}

async function changeStatus(
  body: unknown,
  postId: string = POST_ID,
): Promise<Response> {
  const { PUT } = await import("@/app/api/v1/news/publish/[id]/status/route");
  return PUT(
    new NextRequest(
      new URL(NEWS_POST_STATUS_API_PATH.replace("[id]", postId), ORIGIN),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
    routeContext(postId),
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

describe("GET /api/v1/news/publish/[id]", () => {
  it("da a quien la publicó los valores que carga el formulario de editar", async () => {
    mockWiring({
      posts: [
        {
          ...OWN_POST,
          audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        },
      ],
    });

    const response = await readEditable();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        id: POST_ID,
        category: "news",
        title: "Cambia la piscina",
        body: "El martes entrenamos en MSAC.",
        audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        editedAt: null,
        status: "published",
      },
    });
  });

  it("responde 403 al Committee que pide la de otra persona", async () => {
    mockWiring({ posts: [aPost({ id: POST_ID })] });

    await expectErrorCode(await readEditable(), 403, "forbidden");
  });

  it("responde 404 a un id que no es un uuid", async () => {
    mockWiring();

    await expectErrorCode(await readEditable("no-es-un-id"), 404, "not_found");
  });
});

describe("PATCH /api/v1/news/publish/[id]", () => {
  it("responde 200 con la publicación editada y su marca", async () => {
    mockWiring();

    const response = await saveEdit(EDIT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: POST_ID,
        title: "Cambia la piscina: MSAC",
        editedAt: expect.any(String),
        canManage: true,
      },
    });
  });

  it("responde 409 sin escribir nada si otra persona guardó entretanto", async () => {
    mockWiring({ editedMeanwhileAt: "2026-09-27T09:29:00.000Z" });

    await expectErrorCode(await saveEdit(EDIT), 409, "conflict");
    expect(club.edits).toEqual([]);
  });

  it("responde 403 al Committee que edita la de otra persona", async () => {
    mockWiring({ posts: [aPost({ id: POST_ID })] });

    await expectErrorCode(await saveEdit(EDIT), 403, "forbidden");
  });

  it("deja al Admin editar la de otra persona", async () => {
    mockWiring({ callerRole: "Admin", posts: [aPost({ id: POST_ID })] });

    expect((await saveEdit(EDIT)).status).toBe(200);
  });

  it.each(["Coach", "Player"] as const)(
    "responde 403 a un %s",
    async (role) => {
      mockWiring({ callerRole: role });

      await expectErrorCode(await saveEdit(EDIT), 403, "forbidden");
    },
  );

  it("responde 404 a una publicación que no existe", async () => {
    mockWiring({ posts: [] });

    await expectErrorCode(await saveEdit(EDIT), 404, "not_found");
  });

  it.each([
    ["un título vacío", { ...EDIT, title: " " }],
    [
      "sin la edición que se tenía delante",
      { ...EDIT, expectedEditedAt: undefined },
    ],
    ["una edición que no es una fecha", { ...EDIT, expectedEditedAt: "ayer" }],
    ["una categoría desconocida", { ...EDIT, category: "gossip" }],
  ])("responde 400 a %s", async (_case, body) => {
    mockWiring();

    await expectErrorCode(await saveEdit(body), 400, "validation_error");
    expect(club.edits).toEqual([]);
  });
});

describe("PUT /api/v1/news/publish/[id]/status", () => {
  it("retira la publicación y responde con su estado", async () => {
    mockWiring();

    const response = await changeStatus({ status: "withdrawn" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: POST_ID, status: "withdrawn" },
    });
    expect(club.posts[0]?.status).toBe("withdrawn");
  });

  it("vuelve a publicar una retirada", async () => {
    mockWiring({ posts: [{ ...OWN_POST, status: "withdrawn" }] });

    const response = await changeStatus({ status: "published" });

    await expect(response.json()).resolves.toMatchObject({
      data: { status: "published" },
    });
  });

  it("responde 403 al Committee que retira la de otra persona", async () => {
    mockWiring({ posts: [aPost({ id: POST_ID })] });

    await expectErrorCode(
      await changeStatus({ status: "withdrawn" }),
      403,
      "forbidden",
    );
  });

  it.each(["Coach", "Player"] as const)(
    "responde 403 a un %s",
    async (role) => {
      mockWiring({ callerRole: role });

      await expectErrorCode(
        await changeStatus({ status: "withdrawn" }),
        403,
        "forbidden",
      );
    },
  );

  it("responde 400 a un estado desconocido", async () => {
    mockWiring();

    await expectErrorCode(
      await changeStatus({ status: "deleted" }),
      400,
      "validation_error",
    );
  });
});
