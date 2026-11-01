import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { NEWS_POST_MANAGE_API_PATH } from "@/lib/auth/routes";
import { newsCoverPathsOf } from "@/lib/news/news-covers";
import type { NewsPost } from "@/lib/news/news-posts";
import {
  CALLER_ID,
  CLUB_ID,
  type FakeClub,
  type FakeClubOptions,
  OTHER_CLUB_ID,
  aPost,
  fakeClub,
} from "../helpers/news-club";

/**
 * Borrar para siempre una publicación retirada (#958): `DELETE` sobre la
 * ruta de editar. Qué decide cada caso lo prueba el dominio; aquí, que cada
 * uno sale con su código: 204 al borrar, 409 a una publicada, 403 a lo ajeno
 * del Committee y al Player, 404 a lo que no existe.
 */

const ORIGIN = "http://localhost:3417";
const POST_ID = "d3d3d3d3-0000-4000-8000-00000000000d";
const COVER_ID = "c0c0c0c0-0000-4000-8000-000000000001";

let club: FakeClub;

const OWN_WITHDRAWN: NewsPost = aPost({
  id: POST_ID,
  status: "withdrawn",
  author: { id: CALLER_ID, fullName: "Quien llama" },
});

function mockWiring(options: FakeClubOptions = {}): void {
  club = fakeClub({
    callerRole: "Committee",
    posts: [OWN_WITHDRAWN],
    ...options,
  });
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

async function deletePost(postId: string = POST_ID): Promise<Response> {
  const { DELETE } = await import("@/app/api/v1/news/publish/[id]/route");
  return DELETE(
    new NextRequest(
      new URL(NEWS_POST_MANAGE_API_PATH.replace("[id]", postId), ORIGIN),
      { method: "DELETE" },
    ),
    { params: Promise.resolve({ id: postId }) },
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

describe("DELETE /api/v1/news/publish/[id]", () => {
  it("borra la retirada de quien la publicó y responde 204 sin cuerpo", async () => {
    mockWiring();

    const response = await deletePost();

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
    expect(club.posts).toEqual([]);
  });

  it("borra también los ficheros de su portada del almacenamiento", async () => {
    mockWiring({
      posts: [{ ...OWN_WITHDRAWN, coverUploadId: COVER_ID }],
      covers: [
        {
          id: COVER_ID,
          clubId: CLUB_ID,
          uploadedBy: CALLER_ID,
          createdAt: "2026-09-26T09:00:00.000Z",
        },
      ],
    });
    const cover = newsCoverPathsOf({ id: COVER_ID, clubId: CLUB_ID });

    await deletePost();

    expect(club.coverFiles.has(cover.thumbnail)).toBe(false);
    expect(club.coverFiles.has(cover.large)).toBe(false);
  });

  it("responde igual si un fichero no se pudo borrar, y lo deja en el log", async () => {
    mockWiring({ posts: [{ ...OWN_WITHDRAWN, coverUploadId: COVER_ID }] });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    club.gateways.covers.removeFiles = async () => {
      throw new Error("Storage caído");
    };

    const response = await deletePost();

    expect(response.status).toBe(204);
    expect(club.posts).toEqual([]);
    expect(errorLog).toHaveBeenCalled();
  });

  it("responde 409 a una publicada, sin borrar nada", async () => {
    mockWiring({ posts: [{ ...OWN_WITHDRAWN, status: "published" }] });

    const response = await deletePost();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "conflict", message: "Withdraw it first." },
    });
    expect(club.posts).toHaveLength(1);
  });

  it("responde 403 al Committee sobre la retirada de otra persona", async () => {
    mockWiring({ posts: [aPost({ id: POST_ID, status: "withdrawn" })] });

    await expectErrorCode(await deletePost(), 403, "forbidden");
    expect(club.posts).toHaveLength(1);
  });

  it.each<Role>(["Player", "Coach"])("responde 403 a un %s", async (role) => {
    mockWiring({ callerRole: role });

    await expectErrorCode(await deletePost(), 403, "forbidden");
    expect(club.posts).toHaveLength(1);
  });

  it("responde 404 a una que no existe", async () => {
    mockWiring({ posts: [] });

    await expectErrorCode(await deletePost(), 404, "not_found");
  });

  it("responde 404 a una de otro club", async () => {
    mockWiring({ posts: [{ ...OWN_WITHDRAWN, clubId: OTHER_CLUB_ID }] });

    await expectErrorCode(await deletePost(), 404, "not_found");
  });

  it("responde 404 a un id que no es uuid", async () => {
    mockWiring();

    await expectErrorCode(await deletePost("no-es-un-id"), 404, "not_found");
  });

  it("de dos borrados seguidos, el segundo responde 404 y no 500", async () => {
    mockWiring();

    const first = await deletePost();
    const second = await deletePost();

    expect(first.status).toBe(204);
    await expectErrorCode(second, 404, "not_found");
  });
});
