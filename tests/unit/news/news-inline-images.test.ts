import { afterEach, describe, expect, it, vi } from "vitest";
import { NewsAttachmentValidationError } from "@/lib/news/news-attachments";
import {
  NEWS_INLINE_IMAGE_MAX_BYTES,
  NewsInlineImageNotFoundError,
  STALE_INLINE_IMAGE_AGE_MS,
  newsInlineImagePathOf,
  serveNewsInlineImage,
  stageNewsInlineImage,
  validateNewsInlineImageFile,
} from "@/lib/news/news-inline-images";
import { newsInlineImageUrlOf } from "@/lib/news/news-inline-image-urls";
import { editNewsPost } from "@/lib/news/news-management";
import {
  type NewsDraft,
  NewsForbiddenError,
  type NewsPost,
} from "@/lib/news/news-posts";
import { publishNewsPostWithUploads } from "@/lib/news/news-uploads";
import {
  type FakeAttachmentClubOptions,
  NEW_FILE_ID,
  SHRUNK_INLINE_IMAGE,
  fakeAttachmentClub,
} from "../helpers/news-attachments-club";
import {
  AUTHOR_ID,
  CALLER_ID,
  CLUB_ID,
  type FakeInlineImage,
  INLINE_IMAGE_SIGNED_URL_PREFIX,
  INSERTED_POST_ID,
  OTHER_CLUB_ID,
  SENIOR_SQUAD_ID,
  aPost,
} from "../helpers/news-club";

/**
 * Las imágenes dentro del cuerpo de una noticia (#603, RF-14 del PRD de
 * E22): se suben por el flujo de subidas con `kind=inline_image`, se guardan
 * reducidas a un WebP, el cuerpo las nombra con una dirección estable de la
 * API, y guardar la publicación las liga a ella. Se sirven con la regla de
 * audiencia de los adjuntos.
 */

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const PDF_BYTES = Uint8Array.from(Buffer.from("%PDF-1.7\n1 0 obj"));
const NOW = new Date("2026-10-13T10:00:00.000Z");
const POST_ID = "d3d3d3d3-0000-4000-8000-00000000000d";
const OTHER_POST_ID = "d3d3d3d3-0000-4000-8000-00000000000e";
const IMAGE_ID = "1d1d1d1d-0000-4000-8000-000000000001";
const OTHER_IMAGE_ID = "1d1d1d1d-0000-4000-8000-000000000002";

function anImage(
  overrides: Partial<FakeInlineImage> & { id: string },
): FakeInlineImage {
  return {
    clubId: CLUB_ID,
    uploadedBy: CALLER_ID,
    postId: null,
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

function bodyWith(...imageIds: readonly string[]): string {
  return [
    "Ganamos la final.",
    ...imageIds.map((id) => `![El equipo](${newsInlineImageUrlOf(id)})`),
  ].join("\n\n");
}

function draftWith(body: string): NewsDraft {
  return {
    category: "news",
    title: "Crónica del torneo",
    body,
    audience: { kind: "club" },
  };
}

function committeeClub(
  options: FakeAttachmentClubOptions = {},
): ReturnType<typeof fakeAttachmentClub> {
  return fakeAttachmentClub({ callerRole: "Committee", ...options });
}

function ownPost(overrides: Partial<NewsPost> = {}): NewsPost {
  return aPost({
    id: POST_ID,
    author: { id: CALLER_ID, fullName: "Quien llama" },
    ...overrides,
  });
}

function publish(
  club: ReturnType<typeof fakeAttachmentClub>,
  body: string,
): ReturnType<typeof publishNewsPostWithUploads> {
  return publishNewsPostWithUploads(club.gateways, {
    callerId: CALLER_ID,
    draft: draftWith(body),
    uploadIds: [],
    coverUploadId: null,
    pin: { kind: "keep" },
    now: NOW,
  });
}

function edit(
  club: ReturnType<typeof fakeAttachmentClub>,
  body: string,
): ReturnType<typeof editNewsPost> {
  return editNewsPost(club.gateways, {
    callerId: CALLER_ID,
    postId: POST_ID,
    draft: draftWith(body),
    expectedEditedAt: null,
    cover: { kind: "keep" },
    pin: { kind: "keep" },
    now: NOW,
  });
}

function serve(
  club: ReturnType<typeof fakeAttachmentClub>,
  imageId: string,
): Promise<string> {
  return serveNewsInlineImage(club.gateways, { callerId: CALLER_ID, imageId });
}

function signed(image: { id: string; clubId: string }): string {
  return `${INLINE_IMAGE_SIGNED_URL_PREFIX}${newsInlineImagePathOf(image)}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateNewsInlineImageFile", () => {
  it("admite una imagen PNG", () => {
    expect(validateNewsInlineImageFile("foto.png", PNG_BYTES)).toBe("foto.png");
  });

  it.each([
    ["un PDF", "acta.pdf", PDF_BYTES, "inline_image_type_unsupported"],
    ["un archivo vacío", "foto.png", new Uint8Array(0), "inline_image_empty"],
    [
      "una imagen de más de 10 MB",
      "foto.png",
      new Uint8Array(NEWS_INLINE_IMAGE_MAX_BYTES + 1),
      "inline_image_too_large",
    ],
  ])("rechaza %s con su código", (_case, name, bytes, code) => {
    expect(() => validateNewsInlineImageFile(name, bytes)).toThrow(
      expect.objectContaining({ code }),
    );
  });
});

describe("stageNewsInlineImage", () => {
  it("guarda la versión reducida en WebP y una fila sin publicación", async () => {
    const club = committeeClub();

    const upload = await stageNewsInlineImage(club.gateways, {
      callerId: CALLER_ID,
      fileName: "equipo.png",
      bytes: PNG_BYTES,
    });

    expect(upload).toEqual({
      id: NEW_FILE_ID,
      fileName: "equipo.png",
      contentType: "image/webp",
      sizeBytes: SHRUNK_INLINE_IMAGE.length,
    });
    expect(club.inlineImageFiles).toEqual(
      new Set([`${CLUB_ID}/inline-images/${NEW_FILE_ID}.webp`]),
    );
    expect(club.inlineImages).toEqual([
      expect.objectContaining({
        id: NEW_FILE_ID,
        clubId: CLUB_ID,
        uploadedBy: CALLER_ID,
        postId: null,
      }),
    ]);
  });

  it("rechaza una imagen que sharp no entiende sin guardar nada", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const club = committeeClub({ undecodableInlineImage: true });

    await expect(
      stageNewsInlineImage(club.gateways, {
        callerId: CALLER_ID,
        fileName: "rota.png",
        bytes: PNG_BYTES,
      }),
    ).rejects.toThrow(
      new NewsAttachmentValidationError("inline_image_type_unsupported"),
    );
    expect(club.inlineImageFiles.size).toBe(0);
    expect(club.inlineImages).toEqual([]);
  });

  it("no deja subir a quien no puede publicar", async () => {
    const club = fakeAttachmentClub({ callerRole: "Player" });

    await expect(
      stageNewsInlineImage(club.gateways, {
        callerId: CALLER_ID,
        fileName: "foto.png",
        bytes: PNG_BYTES,
      }),
    ).rejects.toThrow(NewsForbiddenError);
  });
});

describe("publicar con imágenes en el cuerpo", () => {
  it("liga a la publicación las imágenes propias que el cuerpo nombra", async () => {
    const club = committeeClub({
      inlineImages: [anImage({ id: IMAGE_ID })],
    });

    await publish(club, bodyWith(IMAGE_ID));

    expect(club.inlineImages).toEqual([
      expect.objectContaining({ id: IMAGE_ID, postId: INSERTED_POST_ID }),
    ]);
  });

  it("no liga la imagen de otra persona ni la de otra publicación", async () => {
    const club = committeeClub({
      posts: [aPost({ id: OTHER_POST_ID })],
      inlineImages: [
        anImage({ id: IMAGE_ID, uploadedBy: AUTHOR_ID }),
        anImage({ id: OTHER_IMAGE_ID, postId: OTHER_POST_ID }),
      ],
    });

    await publish(club, bodyWith(IMAGE_ID, OTHER_IMAGE_ID));

    expect(club.inlineImages).toEqual([
      expect.objectContaining({ id: IMAGE_ID, postId: null }),
      expect.objectContaining({ id: OTHER_IMAGE_ID, postId: OTHER_POST_ID }),
    ]);
  });

  it("si no se pueden ligar, deshace la publicación", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const club = committeeClub({
      inlineImages: [anImage({ id: IMAGE_ID })],
      failLinkInlineImages: true,
    });

    await expect(publish(club, bodyWith(IMAGE_ID))).rejects.toThrow(
      "la base no responde",
    );
    expect(club.deletedPostIds).toEqual([INSERTED_POST_ID]);
    expect(club.notices).toEqual([]);
  });

  it("borra las imágenes propias que nadie ligó en más de un día", async () => {
    const staleAt = new Date(
      NOW.getTime() - STALE_INLINE_IMAGE_AGE_MS - 1,
    ).toISOString();
    const club = committeeClub({
      inlineImages: [
        anImage({ id: IMAGE_ID, createdAt: staleAt }),
        anImage({ id: OTHER_IMAGE_ID }),
      ],
    });

    await publish(club, "Sin imágenes.");

    expect(club.inlineImages.map((image) => image.id)).toEqual([
      OTHER_IMAGE_ID,
    ]);
    expect(club.inlineImageFiles).toEqual(
      new Set([newsInlineImagePathOf({ id: OTHER_IMAGE_ID, clubId: CLUB_ID })]),
    );
  });
});

describe("editar con imágenes en el cuerpo", () => {
  it("liga las imágenes nuevas y conserva las que siguen en el cuerpo", async () => {
    const club = committeeClub({
      posts: [ownPost({ body: bodyWith(IMAGE_ID) })],
      inlineImages: [
        anImage({ id: IMAGE_ID, postId: POST_ID }),
        anImage({ id: OTHER_IMAGE_ID }),
      ],
    });

    await edit(club, bodyWith(IMAGE_ID, OTHER_IMAGE_ID));

    expect(club.inlineImages).toEqual([
      expect.objectContaining({ id: IMAGE_ID, postId: POST_ID }),
      expect.objectContaining({ id: OTHER_IMAGE_ID, postId: POST_ID }),
    ]);
  });

  it("la imagen cuya línea se quitó deja de existir", async () => {
    const club = committeeClub({
      posts: [ownPost({ body: bodyWith(IMAGE_ID, OTHER_IMAGE_ID) })],
      inlineImages: [
        anImage({ id: IMAGE_ID, postId: POST_ID }),
        anImage({ id: OTHER_IMAGE_ID, postId: POST_ID }),
      ],
    });

    await edit(club, bodyWith(OTHER_IMAGE_ID));

    expect(club.inlineImages.map((image) => image.id)).toEqual([
      OTHER_IMAGE_ID,
    ]);
    expect(club.inlineImageFiles).toEqual(
      new Set([newsInlineImagePathOf({ id: OTHER_IMAGE_ID, clubId: CLUB_ID })]),
    );
    await expect(serve(club, IMAGE_ID)).rejects.toThrow(
      NewsInlineImageNotFoundError,
    );
  });

  it("una edición que no se guarda no borra ninguna imagen", async () => {
    const club = committeeClub({
      posts: [ownPost({ body: bodyWith(IMAGE_ID) })],
      inlineImages: [anImage({ id: IMAGE_ID, postId: POST_ID })],
      editedMeanwhileAt: "2026-10-13T09:00:00.000Z",
    });

    await expect(edit(club, "Sin la imagen.")).rejects.toThrow();

    expect(club.inlineImages.map((image) => image.id)).toEqual([IMAGE_ID]);
  });
});

describe("serveNewsInlineImage", () => {
  it("firma la imagen de una publicación para su audiencia", async () => {
    const image = anImage({
      id: IMAGE_ID,
      uploadedBy: AUTHOR_ID,
      postId: POST_ID,
    });
    const club = fakeAttachmentClub({
      posts: [aPost({ id: POST_ID })],
      inlineImages: [image],
    });

    await expect(serve(club, IMAGE_ID)).resolves.toBe(signed(image));
  });

  it("no la sirve a quien no es la audiencia", async () => {
    const club = fakeAttachmentClub({
      posts: [
        aPost({
          id: POST_ID,
          audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        }),
      ],
      inlineImages: [
        anImage({ id: IMAGE_ID, uploadedBy: AUTHOR_ID, postId: POST_ID }),
      ],
    });

    await expect(serve(club, IMAGE_ID)).rejects.toThrow(
      NewsInlineImageNotFoundError,
    );
  });

  it("la de una publicación retirada no se sirve ni a quien la publicó", async () => {
    const club = committeeClub({
      posts: [ownPost({ status: "withdrawn" })],
      inlineImages: [anImage({ id: IMAGE_ID, postId: POST_ID })],
    });

    await expect(serve(club, IMAGE_ID)).rejects.toThrow(
      NewsInlineImageNotFoundError,
    );
  });

  it("antes de publicar, la ve quien la subió para la vista previa", async () => {
    const image = anImage({ id: IMAGE_ID });
    const club = committeeClub({ inlineImages: [image] });

    await expect(serve(club, IMAGE_ID)).resolves.toBe(signed(image));
  });

  it("antes de publicar, nadie más la ve", async () => {
    const club = committeeClub({
      inlineImages: [anImage({ id: IMAGE_ID, uploadedBy: AUTHOR_ID })],
    });

    await expect(serve(club, IMAGE_ID)).rejects.toThrow(
      NewsInlineImageNotFoundError,
    );
  });

  it.each([
    ["una que no existe", []],
    ["la de otro club", [anImage({ id: IMAGE_ID, clubId: OTHER_CLUB_ID })]],
  ])("%s responde que no está", async (_case, inlineImages) => {
    const club = committeeClub({ inlineImages });

    await expect(serve(club, IMAGE_ID)).rejects.toThrow(
      NewsInlineImageNotFoundError,
    );
  });

  it("si el fichero ya no está, responde que no está", async () => {
    const club = committeeClub({ inlineImages: [anImage({ id: IMAGE_ID })] });
    club.inlineImageFiles.clear();

    await expect(serve(club, IMAGE_ID)).rejects.toThrow(
      NewsInlineImageNotFoundError,
    );
  });
});
