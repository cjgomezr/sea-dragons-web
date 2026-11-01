import { afterEach, describe, expect, it, vi } from "vitest";
import { newsCoverPathsOf } from "@/lib/news/news-covers";
import { newsInlineImagePathOf } from "@/lib/news/news-inline-images";
import { NewsPostNotYoursError } from "@/lib/news/news-management";
import {
  NewsPostIsPublishedError,
  deleteNewsPost,
  removeDeletedNewsPostFiles,
} from "@/lib/news/news-post-deletion";
import {
  NewsForbiddenError,
  NewsPostNotFoundError,
  type NewsPost,
} from "@/lib/news/news-posts";
import {
  CALLER_ID,
  CLUB_ID,
  OTHER_CLUB_ID,
  type FakeClubOptions,
  aPost,
  fakeAttachmentPathOf,
  fakeClub,
} from "../helpers/news-club";

/**
 * Borrar para siempre una publicación ya retirada (#958): nunca una
 * publicada, sólo quien la publicó o un Admin, y la bitácora guarda el
 * título porque después no queda publicación que lo diga.
 */

const POST_ID = "d3d3d3d3-0000-4000-8000-00000000000d";
const COVER_ID = "c0c0c0c0-0000-4000-8000-0000000000c0";
const IMAGE_ID = "e1e1e1e1-0000-4000-8000-0000000000e1";
const ATTACHMENT_ID = "a7a7a7a7-0000-4000-8000-0000000000a7";
const UPLOADED_AT = "2026-09-26T09:00:00.000Z";

function withdrawnOwnPost(overrides: Partial<NewsPost> = {}): NewsPost {
  return aPost({
    id: POST_ID,
    title: "Prueba de portada",
    status: "withdrawn",
    author: { id: CALLER_ID, fullName: "Quien llama" },
    ...overrides,
  });
}

function clubWith(
  post: NewsPost,
  options: FakeClubOptions = {},
): ReturnType<typeof fakeClub> {
  return fakeClub({ callerRole: "Committee", posts: [post], ...options });
}

/** Una retirada con un adjunto, su portada y una imagen en el cuerpo. */
function clubWithEverything(): ReturnType<typeof fakeClub> {
  return clubWith(
    withdrawnOwnPost({
      coverUploadId: COVER_ID,
      attachments: [
        {
          id: ATTACHMENT_ID,
          fileName: "acta.pdf",
          contentType: "application/pdf",
          sizeBytes: 1024,
        },
      ],
    }),
    {
      covers: [
        {
          id: COVER_ID,
          clubId: CLUB_ID,
          uploadedBy: CALLER_ID,
          createdAt: UPLOADED_AT,
        },
      ],
      inlineImages: [
        {
          id: IMAGE_ID,
          clubId: CLUB_ID,
          uploadedBy: CALLER_ID,
          postId: POST_ID,
          createdAt: UPLOADED_AT,
        },
      ],
    },
  );
}

function remove(
  club: ReturnType<typeof fakeClub>,
): ReturnType<typeof deleteNewsPost> {
  return deleteNewsPost(club.gateways, {
    callerId: CALLER_ID,
    postId: POST_ID,
  });
}

describe("deleteNewsPost", () => {
  it("borra una retirada con su portada y sus imágenes del cuerpo", async () => {
    const club = clubWithEverything();

    await remove(club);

    expect(club.posts).toEqual([]);
    expect(club.covers).toEqual([]);
    expect(club.inlineImages).toEqual([]);
  });

  it("devuelve las rutas de almacenamiento a limpiar: adjuntos, las dos WebP de la portada y las imágenes", async () => {
    const club = clubWithEverything();
    const cover = newsCoverPathsOf({ id: COVER_ID, clubId: CLUB_ID });

    const deleted = await remove(club);

    expect([...deleted.storagePaths].sort()).toEqual(
      [
        fakeAttachmentPathOf(POST_ID, ATTACHMENT_ID),
        cover.thumbnail,
        cover.large,
        newsInlineImagePathOf({ id: IMAGE_ID, clubId: CLUB_ID }),
      ].sort(),
    );
  });

  it("no devuelve rutas de una retirada sin ficheros", async () => {
    const club = clubWith(withdrawnOwnPost());

    const deleted = await remove(club);

    expect(deleted.storagePaths).toEqual([]);
  });

  it("rechaza una publicada sin borrar nada", async () => {
    const club = clubWith(withdrawnOwnPost({ status: "published" }));

    await expect(remove(club)).rejects.toBeInstanceOf(NewsPostIsPublishedError);
    expect(club.posts).toHaveLength(1);
    expect(club.audited).toEqual([]);
  });

  it("niega al Committee borrar la retirada de otra persona", async () => {
    const club = clubWith(aPost({ id: POST_ID, status: "withdrawn" }));

    await expect(remove(club)).rejects.toBeInstanceOf(NewsPostNotYoursError);
    expect(club.posts).toHaveLength(1);
  });

  it("deja al Admin borrar la retirada de otra persona", async () => {
    const club = clubWith(aPost({ id: POST_ID, status: "withdrawn" }), {
      callerRole: "Admin",
    });

    await remove(club);

    expect(club.posts).toEqual([]);
  });

  it("niega a un Player aunque la hubiera publicado", async () => {
    const club = clubWith(withdrawnOwnPost(), { callerRole: "Player" });

    await expect(remove(club)).rejects.toBeInstanceOf(NewsForbiddenError);
    expect(club.posts).toHaveLength(1);
  });

  it("responde que no existe a una que no está", async () => {
    const club = fakeClub({ callerRole: "Admin" });

    await expect(remove(club)).rejects.toBeInstanceOf(NewsPostNotFoundError);
  });

  it("responde que no existe a una de otro club", async () => {
    const club = clubWith(withdrawnOwnPost({ clubId: OTHER_CLUB_ID }), {
      callerRole: "Admin",
    });

    await expect(remove(club)).rejects.toBeInstanceOf(NewsPostNotFoundError);
    expect(club.posts).toHaveLength(1);
  });

  it("responde que no existe si otro borrado se le adelantó", async () => {
    const club = clubWith(withdrawnOwnPost());
    const lateGateways = {
      ...club.gateways,
      posts: {
        ...club.gateways.posts,
        deleteWithdrawnPost: async () => ({ kind: "missing" }) as const,
      },
    };

    await expect(
      deleteNewsPost(lateGateways, { callerId: CALLER_ID, postId: POST_ID }),
    ).rejects.toBeInstanceOf(NewsPostNotFoundError);
    expect(club.audited).toEqual([]);
  });

  it("rechaza una que alguien volvió a publicar justo antes de borrar", async () => {
    const club = clubWith(withdrawnOwnPost());
    const republished = {
      ...club.gateways,
      posts: {
        ...club.gateways.posts,
        deleteWithdrawnPost: async () => ({ kind: "published" }) as const,
      },
    };

    await expect(
      deleteNewsPost(republished, { callerId: CALLER_ID, postId: POST_ID }),
    ).rejects.toBeInstanceOf(NewsPostIsPublishedError);
    expect(club.audited).toEqual([]);
  });

  it("registra en la bitácora quién la borró y su título", async () => {
    const club = clubWith(withdrawnOwnPost());

    await remove(club);

    expect(club.audited).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: CALLER_ID,
        action: "news_post.deleted",
        entity_type: "news_post",
        entity_id: POST_ID,
        result: "success",
        metadata: { title: "Prueba de portada" },
      },
    ]);
  });
});

describe("si la bitácora falla después de borrar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deja en el log las rutas que quedaron sin limpiar y lanza el error", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const club = clubWithEverything();
    const failingAudit = {
      ...club.gateways,
      audit: {
        insertAuditLogRow: async () => ({
          error: { message: "audit_log caído" },
        }),
      },
    };

    await expect(
      deleteNewsPost(failingAudit, { callerId: CALLER_ID, postId: POST_ID }),
    ).rejects.toThrow();

    expect(club.posts).toEqual([]);
    const logged = errorLog.mock.calls.map((call) => String(call[0])).join();
    expect(logged).toContain(fakeAttachmentPathOf(POST_ID, ATTACHMENT_ID));
  });
});

describe("removeDeletedNewsPostFiles", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("borra todas las rutas", async () => {
    const removed: string[] = [];
    const remover = {
      removeFiles: async (paths: readonly string[]) => {
        removed.push(...paths);
      },
    };

    await removeDeletedNewsPostFiles(remover, ["a.pdf", "b.webp", "c.webp"]);

    expect(removed).toEqual(["a.pdf", "b.webp", "c.webp"]);
  });

  it("si una falla, sigue con las demás, la deja en el log y no lanza", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const removed: string[] = [];
    const remover = {
      removeFiles: async (paths: readonly string[]) => {
        if (paths.includes("b.webp")) {
          throw new Error("Storage caído");
        }
        removed.push(...paths);
      },
    };

    await expect(
      removeDeletedNewsPostFiles(remover, ["a.pdf", "b.webp", "c.webp"]),
    ).resolves.toBeUndefined();

    expect(removed).toEqual(["a.pdf", "c.webp"]);
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0]?.[0])).toContain("b.webp");
  });
});
