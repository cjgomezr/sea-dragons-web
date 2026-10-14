import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEWS_INLINE_IMAGE_API_PATH } from "@/lib/auth/routes";
import { newsInlineImagePathOf } from "@/lib/news/news-inline-images";
import {
  type FakeAttachmentClub,
  type FakeAttachmentClubOptions,
  fakeAttachmentClub,
} from "../helpers/news-attachments-club";
import {
  AUTHOR_ID,
  CALLER_ID,
  CLUB_ID,
  type FakeInlineImage,
  INLINE_IMAGE_SIGNED_URL_PREFIX,
  SENIOR_SQUAD_ID,
  aPost,
} from "../helpers/news-club";

/**
 * La dirección estable de una imagen del cuerpo (#603): redirige a una
 * firmada a quien puede verla y responde 404 a todo lo demás. Qué decide
 * cada caso lo prueba el dominio; aquí, que cada uno sale con su código.
 */

const ORIGIN = "http://localhost:3417";
const POST_ID = "d3d3d3d3-0000-4000-8000-00000000000d";
const IMAGE_ID = "1d1d1d1d-0000-4000-8000-000000000001";

let club: FakeAttachmentClub;

function linkedImage(): FakeInlineImage {
  return {
    id: IMAGE_ID,
    clubId: CLUB_ID,
    uploadedBy: AUTHOR_ID,
    postId: POST_ID,
    createdAt: "2026-10-13T10:00:00.000Z",
  };
}

function mockSession(callerId: string | null): void {
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
    readAuthenticatedUserId: async () => callerId,
  }));
}

function mockWiring(options: FakeAttachmentClubOptions): void {
  club = fakeAttachmentClub(options);
  vi.doMock("@/lib/news/supabase-news-gateways", () => ({
    createSupabaseNewsGateways: () => ({
      kind: "ready",
      gateways: club.gateways,
    }),
  }));
  mockSession(CALLER_ID);
}

async function requestImage(imageId: string = IMAGE_ID): Promise<Response> {
  const { GET } = await import("@/app/api/v1/news/images/[imageId]/route");
  return GET(
    new NextRequest(
      new URL(NEWS_INLINE_IMAGE_API_PATH.replace("[imageId]", imageId), ORIGIN),
    ),
    { params: Promise.resolve({ imageId }) },
  );
}

async function expectNotFound(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "not_found" },
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/news/supabase-news-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
});

describe("GET /api/v1/news/images/[imageId]", () => {
  it("redirige a la audiencia a la dirección firmada", async () => {
    mockWiring({
      posts: [aPost({ id: POST_ID })],
      inlineImages: [linkedImage()],
    });

    const response = await requestImage();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `${INLINE_IMAGE_SIGNED_URL_PREFIX}${newsInlineImagePathOf(linkedImage())}`,
    );
    expect(response.headers.get("cache-control")).toMatch(/^private, max-age=/);
  });

  it("responde 404 a quien no es la audiencia", async () => {
    mockWiring({
      posts: [
        aPost({
          id: POST_ID,
          audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        }),
      ],
      inlineImages: [linkedImage()],
    });

    await expectNotFound(await requestImage());
  });

  it("responde 404 si la publicación está retirada", async () => {
    mockWiring({
      posts: [aPost({ id: POST_ID, status: "withdrawn" })],
      inlineImages: [linkedImage()],
    });

    await expectNotFound(await requestImage());
  });

  it("responde 404 a un id que no es un uuid", async () => {
    mockWiring({});

    await expectNotFound(await requestImage("../../otra"));
  });

  it("responde 401 sin sesión", async () => {
    club = fakeAttachmentClub({});
    vi.doMock("@/lib/news/supabase-news-gateways", () => ({
      createSupabaseNewsGateways: () => ({
        kind: "ready",
        gateways: club.gateways,
      }),
    }));
    mockSession(null);

    const response = await requestImage();

    expect(response.status).toBe(401);
  });
});
