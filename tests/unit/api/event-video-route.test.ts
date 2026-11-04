import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_VIDEO_API_PATH } from "@/lib/auth/routes";
import {
  CLUB_VIDEO_EVENT,
  type FakeVideoClub,
  type FakeVideoClubOptions,
  VIDEO_CALLER_ID,
  VIDEO_EVENT_ID,
  VIDEO_URL,
  fakeVideoClub,
} from "../helpers/session-video-club";

/**
 * El endpoint del vídeo de una sesión (#965, RF-4 y D8 del PRD de E37). Qué
 * decide cada caso lo prueba el dominio; aquí se prueba que cada uno sale con
 * su código: 200, 204, 400, 401, 403, 404 y 409.
 */

const ORIGIN = "http://localhost:3417";

let club: FakeVideoClub;

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

function mockWiring(options: FakeVideoClubOptions = {}): void {
  club = fakeVideoClub(options);
  vi.doMock("@/lib/events/supabase-session-video-gateways", () => ({
    createSupabaseSessionVideoGateways: () => ({
      kind: "ready",
      gateways: club.gateways,
    }),
  }));
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => VIDEO_CALLER_ID,
  }));
}

function mockAnonymousCaller(): void {
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => null,
  }));
}

function videoRequest(
  method: "PUT" | "DELETE",
  eventId: string,
  body?: unknown,
): NextRequest {
  return new NextRequest(
    new URL(EVENT_VIDEO_API_PATH.replace("[id]", eventId), ORIGIN),
    body === undefined
      ? { method }
      : {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}

async function putVideo(
  body: unknown,
  eventId: string = VIDEO_EVENT_ID,
): Promise<Response> {
  const { PUT } = await import("@/app/api/v1/events/[id]/video/route");
  return PUT(videoRequest("PUT", eventId, body), {
    params: Promise.resolve({ id: eventId }),
  });
}

async function deleteVideo(
  eventId: string = VIDEO_EVENT_ID,
): Promise<Response> {
  const { DELETE } = await import("@/app/api/v1/events/[id]/video/route");
  return DELETE(videoRequest("DELETE", eventId), {
    params: Promise.resolve({ id: eventId }),
  });
}

async function expectError(
  response: Response,
  status: number,
  error: { readonly code: string; readonly reason?: string },
): Promise<void> {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/events/supabase-session-video-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("PUT /api/v1/events/[id]/video", () => {
  it("responde 200 con el vídeo guardado", async () => {
    mockWiring({ role: "Coach" });

    const response = await putVideo({ url: VIDEO_URL });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { eventId: VIDEO_EVENT_ID, url: VIDEO_URL },
    });
    expect(club.videos.get(VIDEO_EVENT_ID)).toBe(VIDEO_URL);
  });

  it("responde 400 sin enlace en el cuerpo", async () => {
    mockWiring();

    const response = await putVideo({ link: VIDEO_URL });

    await expectError(response, 400, { code: "validation_error" });
  });

  it("responde 400 con el motivo a un enlace que no es de un vídeo de YouTube", async () => {
    mockWiring();

    const response = await putVideo({ url: "https://vimeo.com/1" });

    await expectError(response, 400, {
      code: "validation_error",
      reason: "not_youtube_video",
    });
    expect(club.videos.get(VIDEO_EVENT_ID)).toBeNull();
  });

  it("responde 400 con el motivo a un enlace de más de 300 caracteres", async () => {
    mockWiring();

    const response = await putVideo({
      url: `https://youtu.be/${"a".repeat(300)}`,
    });

    await expectError(response, 400, {
      code: "validation_error",
      reason: "too_long",
    });
  });

  it("responde 401 sin sesión", async () => {
    mockAnonymousCaller();

    const response = await putVideo({ url: VIDEO_URL });

    await expectError(response, 401, { code: "unauthenticated" });
  });

  it("responde 403 a un Player", async () => {
    mockWiring({ role: "Player" });

    const response = await putVideo({ url: VIDEO_URL });

    await expectError(response, 403, { code: "forbidden" });
  });

  it("responde 404 a un evento que no existe o es de otro club", async () => {
    mockWiring({ role: "Admin", events: [] });

    const response = await putVideo({ url: VIDEO_URL });

    await expectError(response, 404, { code: "not_found" });
  });

  it("responde 404 a un id que no es un uuid", async () => {
    mockWiring({ role: "Admin" });

    const response = await putVideo({ url: VIDEO_URL }, "no-es-un-uuid");

    await expectError(response, 404, { code: "not_found" });
  });

  it("responde 409 a un evento cancelado", async () => {
    mockWiring({
      role: "Admin",
      events: [{ ...CLUB_VIDEO_EVENT, status: "cancelled" }],
    });

    const response = await putVideo({ url: VIDEO_URL });

    await expectError(response, 409, {
      code: "conflict",
      reason: "video_event_cancelled",
    });
  });
});

describe("DELETE /api/v1/events/[id]/video", () => {
  it("responde 204 y quita el vídeo", async () => {
    mockWiring({
      role: "Committee",
      events: [{ ...CLUB_VIDEO_EVENT, videoUrl: VIDEO_URL }],
    });

    const response = await deleteVideo();

    expect(response.status).toBe(204);
    expect(club.videos.get(VIDEO_EVENT_ID)).toBeNull();
  });

  it("responde 204 aunque no tuviera vídeo", async () => {
    mockWiring({ role: "Admin" });

    const response = await deleteVideo();

    expect(response.status).toBe(204);
  });

  it("responde 401 sin sesión", async () => {
    mockAnonymousCaller();

    const response = await deleteVideo();

    await expectError(response, 401, { code: "unauthenticated" });
  });

  it("responde 403 a un Player", async () => {
    mockWiring({
      role: "Player",
      events: [{ ...CLUB_VIDEO_EVENT, videoUrl: VIDEO_URL }],
    });

    const response = await deleteVideo();

    await expectError(response, 403, { code: "forbidden" });
    expect(club.videos.get(VIDEO_EVENT_ID)).toBe(VIDEO_URL);
  });

  it("responde 404 a un evento que no existe o es de otro club", async () => {
    mockWiring({ role: "Admin", events: [] });

    const response = await deleteVideo();

    await expectError(response, 404, { code: "not_found" });
  });
});
