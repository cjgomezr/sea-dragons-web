import { afterEach, describe, expect, it, vi } from "vitest";
import { NewsAttachmentValidationError } from "@/lib/news/news-attachments";
import {
  NEWS_COVER_MAX_BYTES,
  stageNewsCover,
  validateNewsCoverFile,
} from "@/lib/news/news-cover-uploads";
import { STALE_COVER_AGE_MS, newsCoverPathsOf } from "@/lib/news/news-covers";
import { listNewsFeed } from "@/lib/news/news-feed";
import { editNewsPost } from "@/lib/news/news-management";
import {
  type NewsDraft,
  NewsForbiddenError,
  type NewsPost,
  openNewsPost,
} from "@/lib/news/news-posts";
import { publishNewsPostWithUploads } from "@/lib/news/news-uploads";
import {
  type FakeAttachmentClubOptions,
  NEW_FILE_ID,
  SHRUNK_COVER_LARGE,
  fakeAttachmentClub,
} from "../helpers/news-attachments-club";
import {
  AUTHOR_ID,
  CALLER_ID,
  CLUB_ID,
  COVER_SIGNED_URL_PREFIX,
  type FakeCover,
  aPost,
} from "../helpers/news-club";

/**
 * La portada de una publicación (#591, RF-2 del PRD de E22): se sube por el
 * flujo de subidas de noticias, se guarda en dos versiones WebP, la
 * publicación la enlaza y el feed y el detalle la sirven firmada.
 */

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const PDF_BYTES = Uint8Array.from(Buffer.from("%PDF-1.7\n1 0 obj"));
const NOW = new Date("2026-10-13T10:00:00.000Z");
const POST_ID = "d3d3d3d3-0000-4000-8000-00000000000d";
const COVER_ID = "c0c0c0c0-0000-4000-8000-000000000001";
const OTHER_COVER_ID = "c0c0c0c0-0000-4000-8000-000000000002";

const DRAFT: NewsDraft = {
  category: "news",
  title: "Crónica del torneo",
  body: "Ganamos la final.",
  audience: { kind: "club" },
};

function aCover(overrides: Partial<FakeCover> & { id: string }): FakeCover {
  return {
    clubId: CLUB_ID,
    uploadedBy: CALLER_ID,
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

function signed(path: string): string {
  return `${COVER_SIGNED_URL_PREFIX}${path}`;
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
  coverUploadId: string | null,
): ReturnType<typeof publishNewsPostWithUploads> {
  return publishNewsPostWithUploads(club.gateways, {
    callerId: CALLER_ID,
    draft: DRAFT,
    uploadIds: [],
    coverUploadId,
    now: NOW,
  });
}

function edit(
  club: ReturnType<typeof fakeAttachmentClub>,
  cover: Parameters<typeof editNewsPost>[1]["cover"],
): ReturnType<typeof editNewsPost> {
  return editNewsPost(club.gateways, {
    callerId: CALLER_ID,
    postId: POST_ID,
    draft: DRAFT,
    expectedEditedAt: null,
    cover,
    now: NOW,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateNewsCoverFile", () => {
  it("admite una imagen PNG", () => {
    expect(validateNewsCoverFile("portada.png", PNG_BYTES)).toBe("portada.png");
  });

  it("rechaza un PDF con su código y un mensaje que dice qué tipos admite", () => {
    const attempt = (): unknown => validateNewsCoverFile("acta.pdf", PDF_BYTES);

    expect(attempt).toThrow(NewsAttachmentValidationError);
    expect(attempt).toThrow(/JPEG, PNG o WebP/);
    expect(attempt).toThrow(
      expect.objectContaining({ code: "cover_type_unsupported" }),
    );
  });

  it("rechaza una portada de más de 10 MB con el código de tamaño", () => {
    const huge = new Uint8Array(NEWS_COVER_MAX_BYTES + 1);
    huge.set(PNG_BYTES);

    expect(() => validateNewsCoverFile("enorme.png", huge)).toThrow(
      expect.objectContaining({ code: "cover_too_large" }),
    );
  });

  it("rechaza un archivo vacío", () => {
    expect(() => validateNewsCoverFile("vacia.png", new Uint8Array())).toThrow(
      expect.objectContaining({ code: "cover_empty" }),
    );
  });
});

describe("stageNewsCover", () => {
  it("guarda la miniatura y la grande en WebP, apunta la subida y devuelve su id", async () => {
    const club = committeeClub();

    const staged = await stageNewsCover(club.gateways, {
      callerId: CALLER_ID,
      fileName: "portada.png",
      bytes: PNG_BYTES,
    });

    const paths = newsCoverPathsOf({ clubId: CLUB_ID, id: NEW_FILE_ID });
    expect(staged).toEqual({
      id: NEW_FILE_ID,
      fileName: "portada.png",
      contentType: "image/webp",
      sizeBytes: SHRUNK_COVER_LARGE.length,
    });
    expect([...club.coverFiles]).toEqual([paths.thumbnail, paths.large]);
    expect(club.covers).toEqual([
      expect.objectContaining({
        id: NEW_FILE_ID,
        clubId: CLUB_ID,
        uploadedBy: CALLER_ID,
      }),
    ]);
  });

  it("no guarda el original subido", async () => {
    const club = committeeClub();

    await stageNewsCover(club.gateways, {
      callerId: CALLER_ID,
      fileName: "portada.png",
      bytes: PNG_BYTES,
    });

    expect(club.files.size).toBe(0);
    expect([...club.coverFiles].every((path) => path.endsWith(".webp"))).toBe(
      true,
    );
  });

  it("rechaza como tipo no admitido una imagen que no se puede decodificar, sin guardar nada", async () => {
    const club = committeeClub({ undecodableCover: true });

    const attempt = stageNewsCover(club.gateways, {
      callerId: CALLER_ID,
      fileName: "rota.png",
      bytes: PNG_BYTES,
    });

    await expect(attempt).rejects.toMatchObject({
      code: "cover_type_unsupported",
    });
    expect(club.coverFiles.size).toBe(0);
    expect(club.covers).toEqual([]);
  });

  it("no deja subir una portada a quien no puede publicar", async () => {
    const club = fakeAttachmentClub({ callerRole: "Player" });

    const attempt = stageNewsCover(club.gateways, {
      callerId: CALLER_ID,
      fileName: "portada.png",
      bytes: PNG_BYTES,
    });

    await expect(attempt).rejects.toBeInstanceOf(NewsForbiddenError);
    expect(club.coverFiles.size).toBe(0);
  });
});

describe("publicar con portada", () => {
  it("enlaza la portada subida por quien publica", async () => {
    const club = committeeClub({ covers: [aCover({ id: COVER_ID })] });

    await publish(club, COVER_ID);

    expect(club.inserted[0]?.coverUploadId).toBe(COVER_ID);
  });

  it("publica sin portada con coverUploadId null", async () => {
    const club = committeeClub();

    const post = await publish(club, null);

    expect(club.inserted[0]?.coverUploadId).toBeNull();
    expect(post.coverUrl).toBeNull();
  });

  it("devuelve la dirección firmada de la grande de la portada recién enlazada", async () => {
    const club = committeeClub({ covers: [aCover({ id: COVER_ID })] });

    const post = await publish(club, COVER_ID);

    const paths = newsCoverPathsOf({ clubId: CLUB_ID, id: COVER_ID });
    expect(post.coverUrl).toBe(signed(paths.large));
  });

  it.each([
    ["que no existe", []],
    [
      "que subió otra persona",
      [aCover({ id: COVER_ID, uploadedBy: AUTHOR_ID })],
    ],
  ])(
    "rechaza una portada %s sin publicar nada",
    async (_, covers: readonly FakeCover[]) => {
      const club = committeeClub({ covers });

      await expect(publish(club, COVER_ID)).rejects.toMatchObject({
        code: "cover_upload_missing",
      });
      expect(club.inserted).toEqual([]);
    },
  );

  it("rechaza una portada que ya usa otra publicación", async () => {
    const club = committeeClub({
      covers: [aCover({ id: COVER_ID })],
      posts: [ownPost({ coverUploadId: COVER_ID })],
    });

    await expect(publish(club, COVER_ID)).rejects.toMatchObject({
      code: "cover_upload_missing",
    });
    expect(club.inserted).toEqual([]);
  });

  it("borra las portadas propias abandonadas hace más de un día, y nada más", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const longAgo = new Date(NOW.getTime() - STALE_COVER_AGE_MS - 1);
    const abandoned = aCover({
      id: COVER_ID,
      createdAt: longAgo.toISOString(),
    });
    const linked = aCover({
      id: OTHER_COVER_ID,
      createdAt: longAgo.toISOString(),
    });
    const club = committeeClub({
      covers: [abandoned, linked],
      posts: [ownPost({ coverUploadId: OTHER_COVER_ID })],
    });

    await publish(club, null);

    const abandonedPaths = newsCoverPathsOf(abandoned);
    expect(club.covers.map((cover) => cover.id)).toEqual([OTHER_COVER_ID]);
    expect(club.coverFiles.has(abandonedPaths.large)).toBe(false);
    expect(club.coverFiles.has(newsCoverPathsOf(linked).large)).toBe(true);
  });
});

describe("editar la portada", () => {
  it("cambia la portada y borra la anterior con sus archivos", async () => {
    const club = committeeClub({
      covers: [aCover({ id: COVER_ID }), aCover({ id: OTHER_COVER_ID })],
      posts: [ownPost({ coverUploadId: COVER_ID })],
    });

    const post = await edit(club, {
      kind: "replace",
      coverUploadId: OTHER_COVER_ID,
    });

    const oldPaths = newsCoverPathsOf({ clubId: CLUB_ID, id: COVER_ID });
    const newPaths = newsCoverPathsOf({ clubId: CLUB_ID, id: OTHER_COVER_ID });
    expect(club.posts[0]?.coverUploadId).toBe(OTHER_COVER_ID);
    expect(club.covers.map((cover) => cover.id)).toEqual([OTHER_COVER_ID]);
    expect([...club.coverFiles]).toEqual([newPaths.thumbnail, newPaths.large]);
    expect(club.coverFiles.has(oldPaths.large)).toBe(false);
    expect(post.coverUrl).toBe(signed(newPaths.large));
  });

  it("quita la portada con null y borra sus archivos", async () => {
    const club = committeeClub({
      covers: [aCover({ id: COVER_ID })],
      posts: [ownPost({ coverUploadId: COVER_ID })],
    });

    const post = await edit(club, { kind: "replace", coverUploadId: null });

    expect(club.posts[0]?.coverUploadId).toBeNull();
    expect(club.covers).toEqual([]);
    expect(club.coverFiles.size).toBe(0);
    expect(post.coverUrl).toBeNull();
  });

  it("deja la portada como estaba si la edición no la menciona", async () => {
    const club = committeeClub({
      covers: [aCover({ id: COVER_ID })],
      posts: [ownPost({ coverUploadId: COVER_ID })],
    });

    await edit(club, { kind: "keep" });

    expect(club.posts[0]?.coverUploadId).toBe(COVER_ID);
    expect(club.covers).toHaveLength(1);
    expect(club.coverFiles.size).toBe(2);
  });

  it("no borra nada si se manda la misma portada que ya tiene", async () => {
    const club = committeeClub({
      covers: [aCover({ id: COVER_ID })],
      posts: [ownPost({ coverUploadId: COVER_ID })],
    });

    await edit(club, { kind: "replace", coverUploadId: COVER_ID });

    expect(club.posts[0]?.coverUploadId).toBe(COVER_ID);
    expect(club.coverFiles.size).toBe(2);
  });

  it("rechaza una portada ajena sin tocar la publicación", async () => {
    const club = committeeClub({
      covers: [aCover({ id: OTHER_COVER_ID, uploadedBy: AUTHOR_ID })],
      posts: [ownPost()],
    });

    const attempt = edit(club, {
      kind: "replace",
      coverUploadId: OTHER_COVER_ID,
    });

    await expect(attempt).rejects.toMatchObject({
      code: "cover_upload_missing",
    });
    expect(club.edits).toEqual([]);
  });
});

describe("servir la portada", () => {
  it("trae en el feed la miniatura y la grande firmadas de cada publicación con portada", async () => {
    const club = committeeClub({
      covers: [aCover({ id: COVER_ID })],
      posts: [ownPost({ coverUploadId: COVER_ID })],
    });

    const feed = await listNewsFeed(club.gateways, { callerId: CALLER_ID });

    const paths = newsCoverPathsOf({ clubId: CLUB_ID, id: COVER_ID });
    expect(feed.posts[0]).toMatchObject({
      coverThumbnailUrl: signed(paths.thumbnail),
      coverUrl: signed(paths.large),
    });
  });

  it("trae null en las dos direcciones de una publicación sin portada", async () => {
    const club = committeeClub({ posts: [ownPost()] });

    const feed = await listNewsFeed(club.gateways, { callerId: CALLER_ID });

    expect(feed.posts[0]).toMatchObject({
      coverThumbnailUrl: null,
      coverUrl: null,
    });
  });

  it("trae null si Storage ya no tiene el archivo de la portada", async () => {
    const club = committeeClub({
      covers: [aCover({ id: COVER_ID })],
      posts: [ownPost({ coverUploadId: COVER_ID })],
    });
    club.coverFiles.clear();

    const feed = await listNewsFeed(club.gateways, { callerId: CALLER_ID });

    expect(feed.posts[0]).toMatchObject({
      coverThumbnailUrl: null,
      coverUrl: null,
    });
  });

  it("trae en el detalle la grande firmada", async () => {
    const club = committeeClub({
      covers: [aCover({ id: COVER_ID })],
      posts: [ownPost({ coverUploadId: COVER_ID })],
    });

    const post = await openNewsPost(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
    });

    const paths = newsCoverPathsOf({ clubId: CLUB_ID, id: COVER_ID });
    expect(post.coverUrl).toBe(signed(paths.large));
  });

  it("trae null en el detalle de una publicación sin portada", async () => {
    const club = committeeClub({ posts: [ownPost()] });

    const post = await openNewsPost(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
    });

    expect(post.coverUrl).toBeNull();
  });

  it("no sirve la portada de una retirada a quien no la publicó", async () => {
    const club = fakeAttachmentClub({
      callerRole: "Player",
      covers: [aCover({ id: COVER_ID, uploadedBy: AUTHOR_ID })],
      posts: [
        aPost({ id: POST_ID, status: "withdrawn", coverUploadId: COVER_ID }),
      ],
    });

    const feed = await listNewsFeed(club.gateways, { callerId: CALLER_ID });

    expect(feed.posts).toEqual([]);
    await expect(
      openNewsPost(club.gateways, { callerId: CALLER_ID, postId: POST_ID }),
    ).rejects.toThrow();
  });
});
