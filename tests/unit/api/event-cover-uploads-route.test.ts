import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_COVER_UPLOADS_API_PATH } from "@/lib/auth/routes";
import type { Role } from "@/lib/auth/roles";
import { NEWS_COVER_MAX_BYTES } from "@/lib/news/news-cover-uploads";
import {
  COVER_CALLER_ID,
  type FakeCoverUploadClub,
  NEW_COVER_ID,
  fakeCoverUploadClub,
} from "../helpers/event-covers-club";

/**
 * `POST /api/v1/events/manage/uploads` (#644, RF-3 del PRD de E24): el cuerpo
 * son los bytes de la imagen. Qué decide cada caso lo prueba el dominio;
 * aquí, que cada uno sale con su código: 201, 422 con el motivo, 401 y 403.
 */

const ORIGIN = "http://localhost:3417";
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const PDF_BYTES = Uint8Array.from(Buffer.from("%PDF-1.7\n1 0 obj"));

let club: FakeCoverUploadClub;

function mockCaller(callerId: string | null): void {
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

function mockWiring(
  options: { callerRole?: Role; undecodable?: boolean } = {},
): void {
  club = fakeCoverUploadClub(options);
  vi.doMock("@/lib/events/supabase-event-covers-gateway", () => ({
    createSupabaseEventCoverUploadGateways: () => ({
      kind: "ready",
      gateways: club.gateways,
    }),
  }));
  mockCaller(COVER_CALLER_ID);
}

async function upload(bytes: Uint8Array): Promise<Response> {
  const { POST } = await import("@/app/api/v1/events/manage/uploads/route");
  return POST(
    new NextRequest(new URL(EVENT_COVER_UPLOADS_API_PATH, ORIGIN), {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: bytes.slice(),
    }),
  );
}

async function expectRejected(
  response: Response,
  reason: string,
): Promise<void> {
  expect(response.status).toBe(422);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "business_rule", reason },
  });
  expect(club.files.size).toBe(0);
  expect(club.inserted).toEqual([]);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/events/supabase-event-covers-gateway");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("POST /api/v1/events/manage/uploads", () => {
  it("responde 201 con el id de la imagen guardada", async () => {
    mockWiring();

    const response = await upload(PNG_BYTES);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: { id: NEW_COVER_ID },
    });
    expect(club.files.size).toBe(2);
  });

  it("responde 422 con event_cover_type_unsupported a otro tipo de archivo", async () => {
    mockWiring();

    await expectRejected(
      await upload(PDF_BYTES),
      "event_cover_type_unsupported",
    );
  });

  it("responde 422 con event_cover_too_large a un archivo de más", async () => {
    mockWiring();

    await expectRejected(
      await upload(new Uint8Array(NEWS_COVER_MAX_BYTES + 1).fill(0x89)),
      "event_cover_too_large",
    );
  });

  it("responde 422 con event_cover_type_unsupported a una imagen corrupta", async () => {
    mockWiring({ undecodable: true });

    await expectRejected(
      await upload(PNG_BYTES),
      "event_cover_type_unsupported",
    );
  });

  it("responde 403 a quien no organiza eventos", async () => {
    mockWiring({ callerRole: "Player" });

    const response = await upload(PNG_BYTES);

    expect(response.status).toBe(403);
    expect(club.files.size).toBe(0);
  });

  it("responde 401 sin sesión", async () => {
    mockWiring();
    mockCaller(null);

    const response = await upload(PNG_BYTES);

    expect(response.status).toBe(401);
  });
});
