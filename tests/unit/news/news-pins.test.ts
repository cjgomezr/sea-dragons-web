import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { NEWS_FEED_PAGE_SIZE, listNewsFeed } from "@/lib/news/news-feed";
import { editNewsPost } from "@/lib/news/news-management";
import { InvalidNewsPinUntilError } from "@/lib/news/news-pin-rule";
import {
  NewsPinForbiddenError,
  NewsPinWithdrawnPostError,
  pinNewsPost,
  unpinNewsPost,
} from "@/lib/news/news-pins";
import {
  type NewsPost,
  NewsPostNotFoundError,
  openNewsPost,
} from "@/lib/news/news-posts";
import { publishNewsPostWithUploads } from "@/lib/news/news-uploads";
import { fakeAttachmentClub } from "../helpers/news-attachments-club";
import {
  CALLER_ID,
  CLUB_ID,
  INSERTED_POST_ID,
  SENIOR_SQUAD_ID,
  aPost,
  fakeClub,
} from "../helpers/news-club";

/**
 * Fijar y desfijar (#592, RF-3 del PRD de E22). Solo el Admin fija (D1), cabe
 * una por club, la caducidad se calcula al leer (D7) y la bitácora guarda
 * quién, cuál y hasta cuándo.
 */

const NOW = new Date("2026-10-13T10:00:00.000Z");
const UNTIL = "2026-10-27T10:00:00.000Z";
const PAST = "2026-10-12T10:00:00.000Z";
const PINNED_AT = "2026-10-10T10:00:00.000Z";

const POST_ID = "d3d3d3d3-0000-4000-8000-00000000000d";
const OTHER_POST_ID = "d3d3d3d3-0000-4000-8000-00000000000e";

function postId(index: number): string {
  return `d4d4d4d4-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/** Una publicación de `index` días antes de `NOW`, para ordenar el feed. */
function datedPost(index: number, overrides: Partial<NewsPost> = {}): NewsPost {
  const publishedAt = new Date(NOW.getTime() - index * 86_400_000);
  return aPost({
    id: postId(index),
    publishedAt: publishedAt.toISOString(),
    ...overrides,
  });
}

function pinned(pinnedUntil: string | null = null): NewsPost["pin"] {
  return { pinnedAt: PINNED_AT, pinnedUntil };
}

function clubAs(
  role: Role,
  posts: readonly NewsPost[],
): ReturnType<typeof fakeClub> {
  return fakeClub({ callerRole: role, posts });
}

function pin(
  club: ReturnType<typeof fakeClub>,
  overrides: Partial<Parameters<typeof pinNewsPost>[1]> = {},
): ReturnType<typeof pinNewsPost> {
  return pinNewsPost(club.gateways, {
    callerId: CALLER_ID,
    postId: POST_ID,
    until: UNTIL,
    now: NOW,
    ...overrides,
  });
}

function unpin(
  club: ReturnType<typeof fakeClub>,
  id: string = POST_ID,
): ReturnType<typeof unpinNewsPost> {
  return unpinNewsPost(club.gateways, { callerId: CALLER_ID, postId: id });
}

function pinOf(club: ReturnType<typeof fakeClub>, id: string): NewsPost["pin"] {
  return club.posts.find((post) => post.id === id)?.pin ?? null;
}

describe("fijar una publicación", () => {
  it("la deja fijada hasta la fecha que pide el Admin y responde su estado", async () => {
    const club = clubAs("Admin", [aPost({ id: POST_ID })]);

    const post = await pin(club);

    expect(post).toMatchObject({
      id: POST_ID,
      isPinned: true,
      pinnedUntil: UNTIL,
      canPin: true,
    });
    expect(pinOf(club, POST_ID)).toMatchObject({ pinnedUntil: UNTIL });
  });

  it("la deja fijada sin fecha de fin cuando el Admin no la pone", async () => {
    const club = clubAs("Admin", [aPost({ id: POST_ID })]);

    const post = await pin(club, { until: null });

    expect(post).toMatchObject({ isPinned: true, pinnedUntil: null });
  });

  it("desfija la anterior al fijar otra", async () => {
    const club = clubAs("Admin", [
      aPost({ id: OTHER_POST_ID, pin: pinned() }),
      aPost({ id: POST_ID }),
    ]);

    await pin(club);

    expect(pinOf(club, OTHER_POST_ID)).toBeNull();
    expect(pinOf(club, POST_ID)).not.toBeNull();
  });

  it("guarda en la bitácora quién fijó cuál y hasta cuándo", async () => {
    const club = clubAs("Admin", [aPost({ id: POST_ID })]);

    await pin(club);

    expect(club.audited).toEqual([
      expect.objectContaining({
        actor_id: CALLER_ID,
        club_id: CLUB_ID,
        action: "news_post.pinned",
        entity_type: "news_post",
        entity_id: POST_ID,
        metadata: { until: UNTIL },
      }),
    ]);
  });

  it("guarda en la bitácora que la anterior se desfijó al reemplazarla", async () => {
    const club = clubAs("Admin", [
      aPost({ id: OTHER_POST_ID, pin: pinned(UNTIL) }),
      aPost({ id: POST_ID }),
    ]);

    await pin(club, { until: null });

    expect(club.audited).toEqual([
      expect.objectContaining({
        action: "news_post.unpinned",
        entity_id: OTHER_POST_ID,
        metadata: { until: UNTIL },
      }),
      expect.objectContaining({
        action: "news_post.pinned",
        entity_id: POST_ID,
        metadata: { until: null },
      }),
    ]);
  });

  it.each<Role>(["Committee", "Coach", "Player"])(
    "no deja fijar a un %s ni cambia nada",
    async (role) => {
      const club = clubAs(role, [aPost({ id: POST_ID })]);

      await expect(pin(club)).rejects.toBeInstanceOf(NewsPinForbiddenError);

      expect(pinOf(club, POST_ID)).toBeNull();
      expect(club.audited).toEqual([]);
    },
  );

  it("no fija una publicación retirada", async () => {
    const club = clubAs("Admin", [aPost({ id: POST_ID, status: "withdrawn" })]);

    await expect(pin(club)).rejects.toBeInstanceOf(NewsPinWithdrawnPostError);

    expect(pinOf(club, POST_ID)).toBeNull();
    expect(club.audited).toEqual([]);
  });

  it("no fija con una fecha de fin que ya pasó", async () => {
    const club = clubAs("Admin", [aPost({ id: POST_ID })]);

    await expect(pin(club, { until: PAST })).rejects.toBeInstanceOf(
      InvalidNewsPinUntilError,
    );

    expect(pinOf(club, POST_ID)).toBeNull();
  });

  it("responde como inexistente a una publicación de otro club", async () => {
    const club = clubAs("Admin", [aPost({ id: POST_ID, clubId: "otro" })]);

    await expect(pin(club)).rejects.toBeInstanceOf(NewsPostNotFoundError);
  });
});

describe("desfijar una publicación", () => {
  it("la desfija y lo guarda en la bitácora con la fecha de fin que tenía", async () => {
    const club = clubAs("Admin", [aPost({ id: POST_ID, pin: pinned(UNTIL) })]);

    await unpin(club);

    expect(pinOf(club, POST_ID)).toBeNull();
    expect(club.audited).toEqual([
      expect.objectContaining({
        actor_id: CALLER_ID,
        action: "news_post.unpinned",
        entity_id: POST_ID,
        metadata: { until: UNTIL },
      }),
    ]);
  });

  it("no falla ni deja rastro si no estaba fijada", async () => {
    const club = clubAs("Admin", [aPost({ id: POST_ID })]);

    await expect(unpin(club)).resolves.toBeUndefined();

    expect(club.audited).toEqual([]);
  });

  it.each<Role>(["Committee", "Coach", "Player"])(
    "no deja desfijar a un %s ni cambia nada",
    async (role) => {
      const club = clubAs(role, [aPost({ id: POST_ID, pin: pinned() })]);

      await expect(unpin(club)).rejects.toBeInstanceOf(NewsPinForbiddenError);

      expect(pinOf(club, POST_ID)).not.toBeNull();
    },
  );
});

describe("el feed con la fijada", () => {
  it("trae la fijada vigente aparte y no la repite en la lista", async () => {
    const club = clubAs("Player", [
      datedPost(1),
      datedPost(2, { pin: pinned(UNTIL) }),
      datedPost(3),
    ]);

    const page = await listNewsFeed(club.gateways, {
      callerId: CALLER_ID,
      now: NOW,
    });

    expect(page.pinned).toMatchObject({ id: postId(2), pinnedUntil: UNTIL });
    expect(page.posts.map((post) => post.id)).toEqual([postId(1), postId(3)]);
  });

  it("no la repite en ninguna página siguiente", async () => {
    const posts = Array.from({ length: NEWS_FEED_PAGE_SIZE + 3 }, (_, index) =>
      datedPost(
        index + 1,
        index === NEWS_FEED_PAGE_SIZE + 1 ? { pin: pinned() } : {},
      ),
    );
    const club = clubAs("Player", posts);

    const first = await listNewsFeed(club.gateways, {
      callerId: CALLER_ID,
      now: NOW,
    });
    const second = await listNewsFeed(club.gateways, {
      callerId: CALLER_ID,
      cursor: first.nextCursor ?? "",
      now: NOW,
    });

    const listed = [...first.posts, ...second.posts].map((post) => post.id);
    expect(first.pinned?.id).toBe(postId(NEWS_FEED_PAGE_SIZE + 2));
    expect(listed).not.toContain(postId(NEWS_FEED_PAGE_SIZE + 2));
    expect(listed).toHaveLength(NEWS_FEED_PAGE_SIZE + 2);
  });

  it("trae pinned nulo a quien no es audiencia de la fijada", async () => {
    const club = fakeClub({
      callerRole: "Player",
      callerGroupIds: [],
      posts: [
        datedPost(1),
        datedPost(2, {
          pin: pinned(),
          audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        }),
      ],
    });

    const page = await listNewsFeed(club.gateways, {
      callerId: CALLER_ID,
      now: NOW,
    });

    expect(page.pinned).toBeNull();
    expect(page.posts.map((post) => post.id)).toEqual([postId(1)]);
  });

  it("cuenta como no fijada la que ya caducó y la deja en la lista", async () => {
    const club = clubAs("Player", [
      datedPost(1),
      datedPost(2, { pin: pinned(PAST) }),
    ]);

    const page = await listNewsFeed(club.gateways, {
      callerId: CALLER_ID,
      now: NOW,
    });

    expect(page.pinned).toBeNull();
    expect(page.posts.map((post) => post.id)).toEqual([postId(1), postId(2)]);
  });
});

describe("el detalle con el fijado", () => {
  it("dice si está fijada y hasta cuándo, y que el Admin puede fijar", async () => {
    const club = clubAs("Admin", [aPost({ id: POST_ID, pin: pinned(UNTIL) })]);

    const post = await openNewsPost(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
      now: NOW,
    });

    expect(post).toMatchObject({
      isPinned: true,
      pinnedUntil: UNTIL,
      canPin: true,
    });
  });

  it.each<Role>(["Committee", "Coach", "Player"])(
    "no deja fijar a un %s",
    async (role) => {
      const club = clubAs(role, [aPost({ id: POST_ID, pin: pinned() })]);

      const post = await openNewsPost(club.gateways, {
        callerId: CALLER_ID,
        postId: POST_ID,
        now: NOW,
      });

      expect(post).toMatchObject({
        isPinned: true,
        pinnedUntil: null,
        canPin: false,
      });
    },
  );

  it("una caducada no está fijada ni trae fecha de fin", async () => {
    const club = clubAs("Admin", [aPost({ id: POST_ID, pin: pinned(PAST) })]);

    const post = await openNewsPost(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
      now: NOW,
    });

    expect(post).toMatchObject({ isPinned: false, pinnedUntil: null });
  });
});

describe("fijar al editar", () => {
  const DRAFT = {
    category: "news",
    title: "Cambia la piscina",
    body: "El martes entrenamos en MSAC.",
    audience: { kind: "club" },
  } as const;

  function edit(
    club: ReturnType<typeof fakeAttachmentClub>,
    pinChange: Parameters<typeof editNewsPost>[1]["pin"],
  ): ReturnType<typeof editNewsPost> {
    return editNewsPost(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
      draft: DRAFT,
      expectedEditedAt: null,
      cover: { kind: "keep" },
      pin: pinChange,
      now: NOW,
    });
  }

  it("fija con la misma regla si el Admin manda pin", async () => {
    const club = fakeAttachmentClub({
      callerRole: "Admin",
      posts: [
        aPost({ id: POST_ID }),
        aPost({ id: OTHER_POST_ID, pin: pinned() }),
      ],
    });

    const post = await edit(club, { kind: "pin", until: UNTIL });

    expect(post).toMatchObject({ isPinned: true, pinnedUntil: UNTIL });
    expect(pinOf(club, OTHER_POST_ID)).toBeNull();
    expect(club.audited.map((row) => row.action)).toEqual([
      "news_post.edited",
      "news_post.unpinned",
      "news_post.pinned",
    ]);
  });

  it("desfija si el Admin manda pin nulo", async () => {
    const club = fakeAttachmentClub({
      callerRole: "Admin",
      posts: [aPost({ id: POST_ID, pin: pinned() })],
    });

    const post = await edit(club, { kind: "unpin" });

    expect(post).toMatchObject({ isPinned: false });
    expect(pinOf(club, POST_ID)).toBeNull();
  });

  it("no deja a un Committee mandar pin, y no guarda nada", async () => {
    const club = fakeAttachmentClub({
      callerRole: "Committee",
      posts: [
        aPost({ id: POST_ID, author: { id: CALLER_ID, fullName: "Yo" } }),
      ],
    });

    await expect(
      edit(club, { kind: "pin", until: null }),
    ).rejects.toBeInstanceOf(NewsPinForbiddenError);

    expect(club.edits).toEqual([]);
    expect(club.audited).toEqual([]);
  });

  it("no deja a un Committee desfijar al editar", async () => {
    const club = fakeAttachmentClub({
      callerRole: "Committee",
      posts: [
        aPost({
          id: POST_ID,
          author: { id: CALLER_ID, fullName: "Yo" },
          pin: pinned(),
        }),
      ],
    });

    await expect(edit(club, { kind: "unpin" })).rejects.toBeInstanceOf(
      NewsPinForbiddenError,
    );

    expect(club.edits).toEqual([]);
    expect(pinOf(club, POST_ID)).not.toBeNull();
  });

  it("deja fijada la que un Committee edita sin mandar pin", async () => {
    const club = fakeAttachmentClub({
      callerRole: "Committee",
      posts: [
        aPost({
          id: POST_ID,
          author: { id: CALLER_ID, fullName: "Yo" },
          pin: pinned(UNTIL),
        }),
      ],
    });

    const post = await edit(club, { kind: "keep" });

    expect(post).toMatchObject({ isPinned: true, pinnedUntil: UNTIL });
  });

  it("no guarda la edición si el Admin fija una retirada", async () => {
    const club = fakeAttachmentClub({
      callerRole: "Admin",
      posts: [aPost({ id: POST_ID, status: "withdrawn" })],
    });

    await expect(
      edit(club, { kind: "pin", until: UNTIL }),
    ).rejects.toBeInstanceOf(NewsPinWithdrawnPostError);

    expect(club.edits).toEqual([]);
    expect(club.audited).toEqual([]);
  });

  it("rechaza una fecha de fin pasada antes de guardar nada", async () => {
    const club = fakeAttachmentClub({
      callerRole: "Admin",
      posts: [aPost({ id: POST_ID })],
    });

    await expect(
      edit(club, { kind: "pin", until: PAST }),
    ).rejects.toBeInstanceOf(InvalidNewsPinUntilError);

    expect(club.edits).toEqual([]);
  });
});

describe("fijar al publicar", () => {
  const DRAFT = {
    category: "announcement",
    title: "Cierre de inscripciones",
    body: "Hasta el viernes.",
    audience: { kind: "club" },
  } as const;

  function publish(
    club: ReturnType<typeof fakeAttachmentClub>,
    pinChange: Parameters<typeof publishNewsPostWithUploads>[1]["pin"],
  ): ReturnType<typeof publishNewsPostWithUploads> {
    return publishNewsPostWithUploads(club.gateways, {
      callerId: CALLER_ID,
      draft: DRAFT,
      uploadIds: [],
      coverUploadId: null,
      pin: pinChange,
      now: NOW,
    });
  }

  it("publica fijada si el Admin manda pin", async () => {
    const club = fakeAttachmentClub({ callerRole: "Admin" });

    const post = await publish(club, { kind: "pin", until: UNTIL });

    expect(post).toMatchObject({
      id: INSERTED_POST_ID,
      isPinned: true,
      pinnedUntil: UNTIL,
    });
    expect(club.audited).toEqual([
      expect.objectContaining({
        action: "news_post.pinned",
        entity_id: INSERTED_POST_ID,
      }),
    ]);
  });

  it("no deja a un Committee publicar con pin, y no guarda nada", async () => {
    const club = fakeAttachmentClub({ callerRole: "Committee" });

    await expect(
      publish(club, { kind: "pin", until: UNTIL }),
    ).rejects.toBeInstanceOf(NewsPinForbiddenError);

    expect(club.inserted).toEqual([]);
  });

  it("publica sin fijar si nadie manda pin", async () => {
    const club = fakeAttachmentClub({ callerRole: "Committee" });

    const post = await publish(club, { kind: "keep" });

    expect(post).toMatchObject({ isPinned: false, canPin: false });
  });
});
