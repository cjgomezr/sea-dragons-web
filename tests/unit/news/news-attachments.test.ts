import { describe, expect, it } from "vitest";
import {
  NEWS_ATTACHMENT_MAX_BYTES,
  NEWS_ATTACHMENTS_MAX_PER_POST,
  NewsAttachmentNotFoundError,
  NewsAttachmentValidationError,
  attachNewsFile,
  removeNewsAttachment,
  serveNewsAttachment,
} from "@/lib/news/news-attachments";
import {
  NewsForbiddenError,
  NewsPostNotFoundError,
  type NewsPost,
} from "@/lib/news/news-posts";
import {
  type FakeAttachmentClubOptions,
  NEW_FILE_ID,
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
 * Los adjuntos de una publicación (#328, RF-3 del PRD de E11): subirlos con
 * sus límites, quitarlos y servirlos sólo a la audiencia con una dirección
 * firmada.
 */

const POST_ID = "d3d3d3d3-0000-4000-8000-00000000000d";
const ATTACHMENT_ID = attachmentIdFor(1);
const STORAGE_PATH = `${CLUB_ID}/${POST_ID}/aaaa.pdf`;

const PDF_BYTES = Uint8Array.from(Buffer.from("%PDF-1.7\n1 0 obj"));
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const GIF_BYTES = Uint8Array.from(Buffer.from("GIF89a......"));
const TEXT_BYTES = Uint8Array.from(Buffer.from("hola, soy un pdf"));

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

/** La publicación y sus filas de adjuntos, coherentes entre sí. */
function clubWithPost(
  post: Partial<NewsPost>,
  options: FakeAttachmentClubOptions & { attachmentCount?: number } = {},
): ReturnType<typeof fakeAttachmentClub> {
  const attachments = Array.from(
    { length: options.attachmentCount ?? 0 },
    (_, index) => storedAttachment(index + 1),
  );
  return fakeAttachmentClub({
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
}

function upload(
  club: ReturnType<typeof fakeAttachmentClub>,
  file: { fileName: string; bytes: Uint8Array },
): ReturnType<typeof attachNewsFile> {
  return attachNewsFile(club.gateways, {
    callerId: CALLER_ID,
    postId: POST_ID,
    ...file,
  });
}

async function expectRejection(
  attempt: Promise<unknown>,
  code: string,
): Promise<void> {
  const error: unknown = await attempt.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(NewsAttachmentValidationError);
  expect((error as NewsAttachmentValidationError).code).toBe(code);
}

describe("adjuntos", () => {
  it.each([
    ["un PDF", "acta.pdf", PDF_BYTES, "application/pdf", "pdf"],
    ["una imagen", "partido.PNG", PNG_BYTES, "image/png", "png"],
  ])(
    "guarda %s ligado a su publicación, con el tipo que dicen sus bytes",
    async (_name, fileName, bytes, contentType, extension) => {
      const club = clubWithPost({});

      const attachment = await upload(club, { fileName, bytes });

      const storagePath = `${CLUB_ID}/${POST_ID}/${NEW_FILE_ID}.${extension}`;
      expect(club.rows).toEqual([
        {
          id: attachment.id,
          postId: POST_ID,
          clubId: CLUB_ID,
          fileName,
          contentType,
          sizeBytes: bytes.length,
          storagePath,
        },
      ]);
      expect(club.files).toEqual(new Set([storagePath]));
      expect(attachment).toEqual({
        id: attachment.id,
        fileName,
        contentType,
        sizeBytes: bytes.length,
      });
    },
  );

  it("acepta un archivo justo en el límite de 10 MB", async () => {
    const club = clubWithPost({});
    const bytes = new Uint8Array(NEWS_ATTACHMENT_MAX_BYTES);
    bytes.set(PDF_BYTES);

    await upload(club, { fileName: "grande.pdf", bytes });

    expect(club.rows).toHaveLength(1);
  });

  it("rechaza un archivo de más de 10 MB sin guardar nada", async () => {
    const club = clubWithPost({});
    const bytes = new Uint8Array(NEWS_ATTACHMENT_MAX_BYTES + 1);
    bytes.set(PDF_BYTES);

    await expectRejection(
      upload(club, { fileName: "enorme.pdf", bytes }),
      "attachment_too_large",
    );
    expect(club.rows).toEqual([]);
    expect(club.files.size).toBe(0);
  });

  it("rechaza un archivo vacío", async () => {
    const club = clubWithPost({});

    await expectRejection(
      upload(club, { fileName: "vacio.pdf", bytes: new Uint8Array(0) }),
      "attachment_empty",
    );
  });

  it("rechaza un tipo que no está admitido sin guardar nada", async () => {
    const club = clubWithPost({});

    await expectRejection(
      upload(club, { fileName: "meme.gif", bytes: GIF_BYTES }),
      "attachment_type_unsupported",
    );
    expect(club.rows).toEqual([]);
    expect(club.files.size).toBe(0);
  });

  it("rechaza un archivo que se llama PDF pero no lo es por dentro", async () => {
    const club = clubWithPost({});

    await expectRejection(
      upload(club, { fileName: "acta.pdf", bytes: TEXT_BYTES }),
      "attachment_type_unsupported",
    );
    expect(club.files.size).toBe(0);
  });

  it("rechaza una imagen con nombre de PDF: el nombre tiene que decir lo mismo que los bytes", async () => {
    const club = clubWithPost({});

    await expectRejection(
      upload(club, { fileName: "acta.pdf", bytes: PNG_BYTES }),
      "attachment_type_mismatch",
    );
    expect(club.files.size).toBe(0);
  });

  it.each([
    ["vacío", "   "],
    ["con una barra", "actas/acta.pdf"],
    ["con caracteres de control", "acta\u0000.pdf"],
    ["demasiado largo", `${"a".repeat(252)}.pdf`],
  ])("rechaza un nombre %s", async (_case, fileName) => {
    const club = clubWithPost({});

    await expectRejection(
      upload(club, { fileName, bytes: PDF_BYTES }),
      "attachment_name_invalid",
    );
  });

  it("rechaza el sexto adjunto diciendo el límite, sin subir el archivo", async () => {
    const club = clubWithPost({}, { attachmentCount: 5 });
    const filesBefore = new Set(club.files);

    const error: unknown = await upload(club, {
      fileName: "sexto.pdf",
      bytes: PDF_BYTES,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NewsAttachmentValidationError);
    expect((error as Error).message).toContain(
      String(NEWS_ATTACHMENTS_MAX_PER_POST),
    );
    expect(club.files).toEqual(filesBefore);
  });

  it("borra el archivo subido si la base no guarda el adjunto", async () => {
    const club = clubWithPost({}, { failInsert: true });

    await expect(
      upload(club, { fileName: "acta.pdf", bytes: PDF_BYTES }),
    ).rejects.toThrow("la base no responde");
    expect(club.files.size).toBe(0);
  });

  it("borra el archivo subido si la base ve ya cinco (dos subidas a la vez)", async () => {
    const club = clubWithPost({});
    for (let index = 1; index <= NEWS_ATTACHMENTS_MAX_PER_POST; index += 1) {
      club.rows.push(storedAttachment(index));
    }

    await expectRejection(
      upload(club, { fileName: "acta.pdf", bytes: PDF_BYTES }),
      "attachment_limit_reached",
    );
    expect(club.files.has(`${CLUB_ID}/${POST_ID}/${NEW_FILE_ID}.pdf`)).toBe(
      false,
    );
  });

  it("responde que no existe a quien sube en una publicación de otro", async () => {
    const club = clubWithPost({
      author: { id: AUTHOR_ID, fullName: "Otra persona" },
    });

    await expect(
      upload(club, { fileName: "acta.pdf", bytes: PDF_BYTES }),
    ).rejects.toBeInstanceOf(NewsPostNotFoundError);
    expect(club.files.size).toBe(0);
  });

  it("quitar un adjunto borra su fila y su archivo del almacenamiento", async () => {
    const club = clubWithPost({}, { attachmentCount: 2 });

    await removeNewsAttachment(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
      attachmentId: ATTACHMENT_ID,
    });

    expect(club.rows.map((row) => row.id)).toEqual([attachmentIdFor(2)]);
    expect(club.files.has(storedAttachment(1).storagePath)).toBe(false);
    expect(club.files.has(storedAttachment(2).storagePath)).toBe(true);
  });

  it("quitar un adjunto que no es de esa publicación responde que no existe", async () => {
    const club = clubWithPost({}, { attachmentCount: 1 });

    await expect(
      removeNewsAttachment(club.gateways, {
        callerId: CALLER_ID,
        postId: POST_ID,
        attachmentId: "otro",
      }),
    ).rejects.toBeInstanceOf(NewsAttachmentNotFoundError);
  });
});

describe("permisos", () => {
  it.each(["Coach", "Player"] as const)(
    "un %s no puede subir un adjunto",
    async (role) => {
      const club = clubWithPost({}, { callerRole: role });

      await expect(
        upload(club, { fileName: "acta.pdf", bytes: PDF_BYTES }),
      ).rejects.toBeInstanceOf(NewsForbiddenError);
      expect(club.files.size).toBe(0);
    },
  );

  it.each(["Coach", "Player"] as const)(
    "un %s no puede quitar un adjunto",
    async (role) => {
      const club = clubWithPost({}, { callerRole: role, attachmentCount: 1 });

      await expect(
        removeNewsAttachment(club.gateways, {
          callerId: CALLER_ID,
          postId: POST_ID,
          attachmentId: ATTACHMENT_ID,
        }),
      ).rejects.toBeInstanceOf(NewsForbiddenError);
      expect(club.rows).toHaveLength(1);
    },
  );
});

describe("servir un adjunto", () => {
  function serve(
    club: ReturnType<typeof fakeAttachmentClub>,
    attachmentId = ATTACHMENT_ID,
  ): ReturnType<typeof serveNewsAttachment> {
    return serveNewsAttachment(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
      attachmentId,
    });
  }

  it("la audiencia recibe una dirección firmada del archivo", async () => {
    const club = clubWithPost(
      { author: { id: AUTHOR_ID, fullName: "Carla" } },
      { callerRole: "Player", attachmentCount: 1 },
    );

    await expect(serve(club)).resolves.toEqual({
      status: "available",
      fileName: "acta-1.pdf",
      url: `${SIGNED_URL_PREFIX}${storedAttachment(1).storagePath}`,
    });
  });

  it("quien no es la audiencia recibe que no existe", async () => {
    const club = clubWithPost(
      {
        author: { id: AUTHOR_ID, fullName: "Carla" },
        audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
      },
      { callerRole: "Player", attachmentCount: 1 },
    );

    await expect(serve(club)).rejects.toBeInstanceOf(NewsPostNotFoundError);
  });

  it.each([
    ["a su audiencia", AUTHOR_ID],
    ["ni a quien la publicó", CALLER_ID],
  ])(
    "una publicación retirada no sirve sus adjuntos %s",
    async (_case, authorId) => {
      const club = clubWithPost(
        { author: { id: authorId, fullName: "Carla" }, status: "withdrawn" },
        { callerRole: "Player", attachmentCount: 1 },
      );

      await expect(serve(club)).rejects.toBeInstanceOf(NewsPostNotFoundError);
    },
  );

  it("un adjunto de otra publicación responde que no existe", async () => {
    const club = clubWithPost({}, { attachmentCount: 1 });

    await expect(serve(club, "otro")).rejects.toBeInstanceOf(
      NewsAttachmentNotFoundError,
    );
  });

  it("el archivo que falta en el almacenamiento se reporta como no disponible", async () => {
    const club = clubWithPost(
      {},
      { attachmentCount: 1, storedFiles: [STORAGE_PATH] },
    );

    await expect(serve(club)).resolves.toEqual({
      status: "unavailable",
      fileName: "acta-1.pdf",
    });
  });
});
