import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NEWS_ATTACHMENTS_MAX_PER_POST,
  NewsAttachmentNotFoundError,
  NewsAttachmentValidationError,
} from "@/lib/news/news-attachments";
import {
  EmptyNewsAudienceError,
  InvalidNewsTitleError,
  NewsForbiddenError,
  type NewsDraft,
} from "@/lib/news/news-posts";
import {
  STALE_UPLOAD_AGE_MS,
  discardNewsUpload,
  publishNewsPostWithUploads,
  stageNewsUpload,
} from "@/lib/news/news-uploads";
import {
  type FakeAttachmentClubOptions,
  NEW_FILE_ID,
  fakeAttachmentClub,
  uploadIdFor,
} from "../helpers/news-attachments-club";
import { CALLER_ID, CLUB_ID, INSERTED_POST_ID } from "../helpers/news-club";

/**
 * Los adjuntos que se suben mientras se escribe la publicación (#330, RF-3 del
 * PRD de E11). Se suben según se eligen, así que existen antes que la
 * publicación: esperan en la carpeta de quien publica, y publicar los copia a
 * la de la publicación.
 */

const PDF_BYTES = Uint8Array.from(Buffer.from("%PDF-1.7\n1 0 obj"));
const TEXT_BYTES = Uint8Array.from(Buffer.from("hola, soy un pdf"));
const NOW = new Date("2026-09-27T10:00:00.000Z");

const DRAFT: NewsDraft = {
  category: "announcement",
  title: "Cambia la piscina",
  body: "El martes entrenamos en MSAC.",
  audience: { kind: "club" },
};

function uploadPath(uploadId: string, uploaderId = CALLER_ID): string {
  return `${CLUB_ID}/uploads/${uploaderId}/${uploadId}`;
}

function committeeClub(
  options: FakeAttachmentClubOptions = {},
): ReturnType<typeof fakeAttachmentClub> {
  return fakeAttachmentClub({ callerRole: "Committee", ...options });
}

/** Un club con `count` subidas de quien llama esperando. */
function clubWithUploads(
  count: number,
  options: FakeAttachmentClubOptions = {},
): ReturnType<typeof fakeAttachmentClub> {
  return committeeClub({
    ...options,
    storedFiles: [
      ...Array.from({ length: count }, (_, index) => ({
        storagePath: uploadPath(uploadIdFor(index + 1)),
        fileName: `acta-${index + 1}.pdf`,
        contentType: "application/pdf" as const,
        sizeBytes: PDF_BYTES.length,
        createdAt: NOW.toISOString(),
      })),
      ...(options.storedFiles ?? []),
    ],
  });
}

function publish(
  club: ReturnType<typeof fakeAttachmentClub>,
  uploadIds: readonly string[],
  draft: NewsDraft = DRAFT,
): ReturnType<typeof publishNewsPostWithUploads> {
  return publishNewsPostWithUploads(club.gateways, {
    callerId: CALLER_ID,
    draft,
    uploadIds,
    now: NOW,
  });
}

async function expectIssue(
  attempt: Promise<unknown>,
  code: string,
): Promise<void> {
  const error: unknown = await attempt.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(NewsAttachmentValidationError);
  expect((error as NewsAttachmentValidationError).code).toBe(code);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("subir un adjunto antes de publicar", () => {
  it("lo guarda en la carpeta de quien publica, con su nombre", async () => {
    const club = committeeClub();

    const upload = await stageNewsUpload(club.gateways, {
      callerId: CALLER_ID,
      fileName: "acta.pdf",
      bytes: PDF_BYTES,
    });

    expect(upload).toEqual({
      id: NEW_FILE_ID,
      fileName: "acta.pdf",
      contentType: "application/pdf",
      sizeBytes: PDF_BYTES.length,
    });
    expect(club.fileInfo.get(uploadPath(NEW_FILE_ID))).toMatchObject({
      fileName: "acta.pdf",
      contentType: "application/pdf",
    });
  });

  it("rechaza un tipo no admitido sin subir nada", async () => {
    const club = committeeClub();

    await expectIssue(
      stageNewsUpload(club.gateways, {
        callerId: CALLER_ID,
        fileName: "acta.pdf",
        bytes: TEXT_BYTES,
      }),
      "attachment_type_unsupported",
    );
    expect(club.files.size).toBe(0);
  });

  it.each(["Coach", "Player"] as const)(
    "niega la subida a un %s",
    async (callerRole) => {
      const club = fakeAttachmentClub({ callerRole });

      await expect(
        stageNewsUpload(club.gateways, {
          callerId: CALLER_ID,
          fileName: "acta.pdf",
          bytes: PDF_BYTES,
        }),
      ).rejects.toBeInstanceOf(NewsForbiddenError);
      expect(club.files.size).toBe(0);
    },
  );
});

describe("quitar un adjunto antes de publicar", () => {
  it("lo borra del almacenamiento", async () => {
    const club = clubWithUploads(2);

    await discardNewsUpload(club.gateways, {
      callerId: CALLER_ID,
      uploadId: uploadIdFor(1),
    });

    expect(club.files).toEqual(new Set([uploadPath(uploadIdFor(2))]));
  });

  it("responde que no existe si no está en la carpeta de quien llama", async () => {
    const club = committeeClub({
      storedFiles: [
        {
          storagePath: uploadPath(uploadIdFor(1), "otra-persona"),
          fileName: "acta.pdf",
          contentType: "application/pdf",
          sizeBytes: PDF_BYTES.length,
          createdAt: NOW.toISOString(),
        },
      ],
    });

    await expect(
      discardNewsUpload(club.gateways, {
        callerId: CALLER_ID,
        uploadId: uploadIdFor(1),
      }),
    ).rejects.toBeInstanceOf(NewsAttachmentNotFoundError);
    expect(club.files.size).toBe(1);
  });

  it("niega quitar a un Player", async () => {
    const club = clubWithUploads(1, { callerRole: "Player" });

    await expect(
      discardNewsUpload(club.gateways, {
        callerId: CALLER_ID,
        uploadId: uploadIdFor(1),
      }),
    ).rejects.toBeInstanceOf(NewsForbiddenError);
  });
});

describe("publicar con adjuntos", () => {
  it("publica sin adjuntos igual que antes", async () => {
    const club = committeeClub();

    const post = await publish(club, []);

    expect(post.attachments).toEqual([]);
    expect(club.inserted).toHaveLength(1);
  });

  it("copia cada subida a la carpeta de la publicación y la liga a ella", async () => {
    const club = clubWithUploads(2);

    const post = await publish(club, [uploadIdFor(1), uploadIdFor(2)]);

    expect(post.attachments.map((file) => file.fileName)).toEqual([
      "acta-1.pdf",
      "acta-2.pdf",
    ]);
    expect(club.rows.map((row) => row.storagePath)).toEqual([
      `${CLUB_ID}/${INSERTED_POST_ID}/${uploadIdFor(1)}.pdf`,
      `${CLUB_ID}/${INSERTED_POST_ID}/${uploadIdFor(2)}.pdf`,
    ]);
    expect(club.rows.every((row) => row.postId === INSERTED_POST_ID)).toBe(
      true,
    );
  });

  it("vacía la carpeta de subidas de lo que publicó", async () => {
    const club = clubWithUploads(1);

    await publish(club, [uploadIdFor(1)]);

    expect(club.files).toEqual(
      new Set([`${CLUB_ID}/${INSERTED_POST_ID}/${uploadIdFor(1)}.pdf`]),
    );
  });

  it("borra las subidas abandonadas de quien publica y deja las recientes", async () => {
    const stale = new Date(NOW.getTime() - STALE_UPLOAD_AGE_MS - 1);
    const club = clubWithUploads(1, {
      storedFiles: [
        {
          storagePath: uploadPath(uploadIdFor(8)),
          fileName: "viejo.pdf",
          contentType: "application/pdf",
          sizeBytes: PDF_BYTES.length,
          createdAt: stale.toISOString(),
        },
        {
          storagePath: uploadPath(uploadIdFor(9)),
          fileName: "de-otra-pestana.pdf",
          contentType: "application/pdf",
          sizeBytes: PDF_BYTES.length,
          createdAt: NOW.toISOString(),
        },
      ],
    });

    await publish(club, []);

    expect(club.files.has(uploadPath(uploadIdFor(8)))).toBe(false);
    expect(club.files.has(uploadPath(uploadIdFor(9)))).toBe(true);
  });

  it("publica igual aunque la limpieza de lo abandonado falle", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const club = clubWithUploads(0, { failList: true });

    const post = await publish(club, []);

    expect(post.id).toBe(INSERTED_POST_ID);
    expect(console.error).toHaveBeenCalled();
  });

  it("rechaza una subida que no está, sin publicar nada", async () => {
    const club = clubWithUploads(1);

    await expectIssue(
      publish(club, [uploadIdFor(1), uploadIdFor(7)]),
      "attachment_upload_missing",
    );
    expect(club.inserted).toEqual([]);
  });

  it("rechaza más de cinco adjuntos, sin publicar nada", async () => {
    const count = NEWS_ATTACHMENTS_MAX_PER_POST + 1;
    const club = clubWithUploads(count);

    await expectIssue(
      publish(
        club,
        Array.from({ length: count }, (_, index) => uploadIdFor(index + 1)),
      ),
      "attachment_limit_reached",
    );
    expect(club.inserted).toEqual([]);
  });

  it("cuenta una subida repetida una sola vez", async () => {
    const club = clubWithUploads(1);

    const post = await publish(club, [uploadIdFor(1), uploadIdFor(1)]);

    expect(post.attachments).toHaveLength(1);
  });

  it("valida la publicación antes de mirar los adjuntos", async () => {
    const club = clubWithUploads(1);

    await expect(
      publish(club, [uploadIdFor(1)], { ...DRAFT, title: " " }),
    ).rejects.toBeInstanceOf(InvalidNewsTitleError);
    await expect(
      publish(club, [uploadIdFor(1)], {
        ...DRAFT,
        audience: { kind: "groups", groupIds: [] },
      }),
    ).rejects.toBeInstanceOf(EmptyNewsAudienceError);
    expect(club.inserted).toEqual([]);
  });

  it("si un adjunto no entra, retira la publicación y deja las subidas para reintentar", async () => {
    const club = clubWithUploads(2, { failInsert: true });

    await expect(
      publish(club, [uploadIdFor(1), uploadIdFor(2)]),
    ).rejects.toThrow();

    expect(club.deletedPostIds).toEqual([INSERTED_POST_ID]);
    expect(club.files).toEqual(
      new Set([uploadPath(uploadIdFor(1)), uploadPath(uploadIdFor(2))]),
    );
  });

  it("niega publicar a un Coach", async () => {
    const club = clubWithUploads(1, { callerRole: "Coach" });

    await expect(publish(club, [uploadIdFor(1)])).rejects.toBeInstanceOf(
      NewsForbiddenError,
    );
    expect(club.inserted).toEqual([]);
  });
});
