import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEWS_UPLOAD_API_PATH, NEWS_UPLOADS_API_PATH } from "@/lib/auth/routes";
import { NEWS_ATTACHMENT_MAX_BYTES } from "@/lib/news/news-attachments";
import {
  type FakeAttachmentClub,
  type FakeAttachmentClubOptions,
  NEW_FILE_ID,
  fakeAttachmentClub,
  uploadIdFor,
} from "../helpers/news-attachments-club";
import { CALLER_ID, CLUB_ID } from "../helpers/news-club";

/**
 * Los endpoints de las subidas previas (#330): subir un archivo mientras se
 * escribe la publicación y quitarlo antes de publicar. Qué decide cada caso
 * lo prueba el dominio; aquí, que cada uno sale con su código.
 */

const ORIGIN = "http://localhost:3417";
const FILE_NAME_PARAM = "name";

const PDF_BYTES = Uint8Array.from(Buffer.from("%PDF-1.7\n1 0 obj"));
const TEXT_BYTES = Uint8Array.from(Buffer.from("hola, soy un pdf"));

let club: FakeAttachmentClub;

function mockWiring(options: FakeAttachmentClubOptions = {}): void {
  club = fakeAttachmentClub({ callerRole: "Committee", ...options });
  vi.doMock("@/lib/news/supabase-news-attachment-gateways", () => ({
    createSupabaseNewsAttachmentGateways: () => ({
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

async function stage(
  fileName: string | null,
  bytes: Uint8Array,
): Promise<Response> {
  const { POST } = await import("@/app/api/v1/news/publish/uploads/route");
  const url = new URL(NEWS_UPLOADS_API_PATH, ORIGIN);
  if (fileName !== null) {
    url.searchParams.set(FILE_NAME_PARAM, fileName);
  }
  return POST(
    new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: bytes.slice(),
    }),
  );
}

async function discard(uploadId: string): Promise<Response> {
  const { DELETE } =
    await import("@/app/api/v1/news/publish/uploads/[uploadId]/route");
  const path = NEWS_UPLOAD_API_PATH.replace("[uploadId]", uploadId);
  return DELETE(new NextRequest(new URL(path, ORIGIN), { method: "DELETE" }), {
    params: Promise.resolve({ uploadId }),
  });
}

async function expectRejectedFile(
  response: Response,
  reason: string,
): Promise<void> {
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "validation_error", reason },
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/news/supabase-news-attachment-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("POST /api/v1/news/publish/uploads", () => {
  it("responde 201 con la subida y su id", async () => {
    mockWiring();

    const response = await stage("acta.pdf", PDF_BYTES);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: {
        id: NEW_FILE_ID,
        fileName: "acta.pdf",
        contentType: "application/pdf",
        sizeBytes: PDF_BYTES.length,
      },
    });
  });

  it("responde 400 con su motivo a un tipo no admitido", async () => {
    mockWiring();

    await expectRejectedFile(
      await stage("acta.pdf", TEXT_BYTES),
      "attachment_type_unsupported",
    );
    expect(club.files.size).toBe(0);
  });

  it("responde 400 a un archivo de más de 10 MB", async () => {
    mockWiring();
    const bytes = new Uint8Array(NEWS_ATTACHMENT_MAX_BYTES + 1);
    bytes.set(PDF_BYTES);

    await expectRejectedFile(
      await stage("acta.pdf", bytes),
      "attachment_too_large",
    );
  });

  it("responde 403 a un Player", async () => {
    mockWiring({ callerRole: "Player" });

    const response = await stage("acta.pdf", PDF_BYTES);

    expect(response.status).toBe(403);
  });
});

describe("DELETE /api/v1/news/publish/uploads/[uploadId]", () => {
  it("responde 204 y borra la subida", async () => {
    const storagePath = `${CLUB_ID}/uploads/${CALLER_ID}/${uploadIdFor(1)}`;
    mockWiring({
      storedFiles: [
        {
          storagePath,
          fileName: "acta.pdf",
          contentType: "application/pdf",
          sizeBytes: PDF_BYTES.length,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const response = await discard(uploadIdFor(1));

    expect(response.status).toBe(204);
    expect(club.files.has(storagePath)).toBe(false);
  });

  it("responde 404 a una subida que no existe", async () => {
    mockWiring();

    const response = await discard(uploadIdFor(1));

    expect(response.status).toBe(404);
  });

  it("responde 404 a un id que no es un uuid", async () => {
    mockWiring();

    const response = await discard("../otra-carpeta");

    expect(response.status).toBe(404);
  });
});
