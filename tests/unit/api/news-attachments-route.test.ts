import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NEWS_ATTACHMENT_API_PATH,
  NEWS_ATTACHMENT_MANAGE_API_PATH,
  NEWS_ATTACHMENTS_UPLOAD_API_PATH,
} from "@/lib/auth/routes";
import { NEWS_ATTACHMENT_MAX_BYTES } from "@/lib/news/news-attachments";
import type { NewsPost } from "@/lib/news/news-posts";
import {
  type FakeAttachmentClub,
  type FakeAttachmentClubOptions,
  SIGNED_URL_PREFIX,
  type StoredAttachment,
  attachmentIdFor,
  fakeAttachmentClub,
} from "../helpers/news-attachments-club";
import {
  AUTHOR_ID,
  CALLER_ID,
  CLUB_ID,
  SENIOR_SQUAD_ID,
  aPost,
} from "../helpers/news-club";

/**
 * Los endpoints de adjuntos (#328): subir, quitar y pedir la dirección
 * firmada. Qué decide cada caso lo prueba el dominio; aquí se prueba que cada
 * uno sale con su código de la convención, que quien no es audiencia recibe
 * 404 y no 403, y que un fichero que falta no es un error del servidor.
 */

const ORIGIN = "http://localhost:3417";
const POST_ID = "d3d3d3d3-0000-4000-8000-00000000000d";
const ATTACHMENT_ID = attachmentIdFor(1);
const FILE_NAME_PARAM = "name";

const PDF_BYTES = Uint8Array.from(Buffer.from("%PDF-1.7\n1 0 obj"));
const TEXT_BYTES = Uint8Array.from(Buffer.from("hola, soy un pdf"));

let club: FakeAttachmentClub;

function storedAttachment(index: number): StoredAttachment {
  return {
    id: attachmentIdFor(index),
    postId: POST_ID,
    clubId: CLUB_ID,
    fileName: `acta-${index}.pdf`,
    contentType: "application/pdf",
    sizeBytes: PDF_BYTES.length,
    storagePath: `${CLUB_ID}/${POST_ID}/file-${index}.pdf`,
  };
}

function mockWiring(
  post: Partial<NewsPost> = {},
  options: FakeAttachmentClubOptions & { attachmentCount?: number } = {},
): void {
  const attachments = Array.from(
    { length: options.attachmentCount ?? 0 },
    (_, index) => storedAttachment(index + 1),
  );
  club = fakeAttachmentClub({
    callerRole: "Committee",
    attachments,
    ...options,
    posts: [
      aPost({
        id: POST_ID,
        author: { id: CALLER_ID, fullName: "Quien llama" },
        attachments: attachments.map((row) => ({
          id: row.id,
          fileName: row.fileName,
          contentType: row.contentType,
          sizeBytes: row.sizeBytes,
        })),
        ...post,
      }),
    ],
  });
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

function uploadUrl(fileName: string | null): URL {
  const url = new URL(
    NEWS_ATTACHMENTS_UPLOAD_API_PATH.replace("[id]", POST_ID),
    ORIGIN,
  );
  if (fileName !== null) {
    url.searchParams.set(FILE_NAME_PARAM, fileName);
  }
  return url;
}

async function upload(
  fileName: string | null,
  bytes: Uint8Array,
): Promise<Response> {
  const { POST } =
    await import("@/app/api/v1/news/publish/[id]/attachments/route");
  return POST(
    new NextRequest(uploadUrl(fileName), {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: bytes.slice(),
    }),
    { params: Promise.resolve({ id: POST_ID }) },
  );
}

async function removeAttachment(): Promise<Response> {
  const { DELETE } =
    await import("@/app/api/v1/news/publish/[id]/attachments/[attachmentId]/route");
  const path = NEWS_ATTACHMENT_MANAGE_API_PATH.replace("[id]", POST_ID).replace(
    "[attachmentId]",
    ATTACHMENT_ID,
  );
  return DELETE(new NextRequest(new URL(path, ORIGIN), { method: "DELETE" }), {
    params: Promise.resolve({ id: POST_ID, attachmentId: ATTACHMENT_ID }),
  });
}

async function requestAttachment(
  attachmentId: string = ATTACHMENT_ID,
): Promise<Response> {
  const { GET } =
    await import("@/app/api/v1/news/[id]/attachments/[attachmentId]/route");
  const path = NEWS_ATTACHMENT_API_PATH.replace("[id]", POST_ID).replace(
    "[attachmentId]",
    attachmentId,
  );
  return GET(new NextRequest(new URL(path, ORIGIN)), {
    params: Promise.resolve({ id: POST_ID, attachmentId }),
  });
}

async function expectErrorCode(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error: { code } });
}

/** Un archivo rechazado: 400 con el motivo en `reason`, que la pantalla
 * traduce. */
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

describe("POST /api/v1/news/publish/[id]/attachments", () => {
  it("responde 201 con el adjunto guardado", async () => {
    mockWiring();

    const response = await upload("acta.pdf", PDF_BYTES);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        fileName: "acta.pdf",
        contentType: "application/pdf",
        sizeBytes: PDF_BYTES.length,
      },
    });
    expect(club.files.size).toBe(1);
  });

  it("responde 400 sin el nombre del archivo", async () => {
    mockWiring();

    await expectRejectedFile(
      await upload(null, PDF_BYTES),
      "attachment_name_invalid",
    );
  });

  it("responde 400 a un archivo de más de 10 MB sin guardar nada", async () => {
    mockWiring();
    const bytes = new Uint8Array(NEWS_ATTACHMENT_MAX_BYTES + 1);
    bytes.set(PDF_BYTES);

    await expectRejectedFile(
      await upload("enorme.pdf", bytes),
      "attachment_too_large",
    );
    expect(club.files.size).toBe(0);
  });

  it("responde 400 a un archivo que dice ser PDF y no lo es", async () => {
    mockWiring();

    await expectRejectedFile(
      await upload("acta.pdf", TEXT_BYTES),
      "attachment_type_unsupported",
    );
  });

  it("responde 400 al sexto adjunto diciendo el límite", async () => {
    mockWiring({}, { attachmentCount: 5 });

    const response = await upload("sexto.pdf", PDF_BYTES);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "validation_error",
        reason: "attachment_limit_reached",
        message: expect.stringContaining("5"),
      },
    });
  });

  it.each(["Coach", "Player"] as const)(
    "responde 403 a un %s",
    async (role) => {
      mockWiring({}, { callerRole: role });

      await expectErrorCode(
        await upload("acta.pdf", PDF_BYTES),
        403,
        "forbidden",
      );
      expect(club.files.size).toBe(0);
    },
  );

  it("responde 404 en una publicación de otro", async () => {
    mockWiring({ author: { id: AUTHOR_ID, fullName: "Carla" } });

    await expectErrorCode(
      await upload("acta.pdf", PDF_BYTES),
      404,
      "not_found",
    );
  });
});

describe("DELETE /api/v1/news/publish/[id]/attachments/[attachmentId]", () => {
  it("responde 204 y el archivo sale del almacenamiento", async () => {
    mockWiring({}, { attachmentCount: 1 });

    const response = await removeAttachment();

    expect(response.status).toBe(204);
    expect(club.files.size).toBe(0);
    expect(club.rows).toEqual([]);
  });
});

describe("GET /api/v1/news/[id]/attachments/[attachmentId]", () => {
  it("responde 200 con una dirección firmada a la audiencia", async () => {
    mockWiring(
      { author: { id: AUTHOR_ID, fullName: "Carla" } },
      { callerRole: "Player", attachmentCount: 1 },
    );

    const response = await requestAttachment();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        status: "available",
        fileName: "acta-1.pdf",
        url: `${SIGNED_URL_PREFIX}${storedAttachment(1).storagePath}`,
      },
    });
  });

  it("responde 404, no 403, a quien no es la audiencia", async () => {
    mockWiring(
      {
        author: { id: AUTHOR_ID, fullName: "Carla" },
        audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
      },
      { callerRole: "Player", attachmentCount: 1 },
    );

    await expectErrorCode(await requestAttachment(), 404, "not_found");
  });

  it("responde 404 si la publicación está retirada", async () => {
    mockWiring({ status: "withdrawn" }, { attachmentCount: 1 });

    await expectErrorCode(await requestAttachment(), 404, "not_found");
  });

  it("responde 404 a un id de adjunto que no es un uuid", async () => {
    mockWiring({}, { attachmentCount: 1 });

    await expectErrorCode(
      await requestAttachment("no-es-un-uuid"),
      404,
      "not_found",
    );
  });

  it("responde 200 con no disponible si el archivo ya no está", async () => {
    mockWiring({}, { attachmentCount: 1, storedFiles: [] });

    const response = await requestAttachment();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { status: "unavailable", fileName: "acta-1.pdf" },
    });
  });
});
