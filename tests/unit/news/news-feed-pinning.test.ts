import { describe, expect, it } from "vitest";
import type { NewsFeedItem, NewsPinnedFeedItem } from "@/lib/news/news-feed";
import {
  arrangeAfterPin,
  arrangeAfterUnpin,
} from "@/lib/news/news-feed-pinning";

/**
 * El feed ya cargado, recolocado al fijar o desfijar desde él (#595): la
 * fijada sale de la lista y la que lo era vuelve en su sitio por fecha.
 */

function anItem(id: string, publishedAt: string): NewsFeedItem {
  return {
    id,
    category: "news",
    title: `Post ${id}`,
    excerpt: "",
    author: { id: "author", fullName: "Sofía Castro" },
    publishedAt,
    status: "published",
    attachmentCount: 0,
    coverThumbnailUrl: null,
    coverUrl: null,
  };
}

const NEWEST = anItem("c", "2026-09-24T08:00:00.000Z");
const MIDDLE = anItem("b", "2026-09-22T08:00:00.000Z");
const OLDEST = anItem("a", "2026-09-19T08:00:00.000Z");

function pinnedFrom(post: NewsFeedItem): NewsPinnedFeedItem {
  return { ...post, pinnedUntil: null };
}

const ids = (posts: readonly NewsFeedItem[]): string[] =>
  posts.map((post) => post.id);

describe("al fijar desde el feed", () => {
  it("la elegida sale de la lista y queda fijada hasta la fecha recibida", () => {
    const result = arrangeAfterPin(
      { pinned: null, posts: [NEWEST, MIDDLE], nextCursor: null },
      MIDDLE.id,
      "2026-10-03T08:00:00.000Z",
    );

    expect(result.pinned).toEqual({
      ...MIDDLE,
      pinnedUntil: "2026-10-03T08:00:00.000Z",
    });
    expect(ids(result.posts)).toEqual([NEWEST.id]);
  });

  it("la que estaba fijada vuelve a la lista en su sitio por fecha, sin su fecha de fin", () => {
    const result = arrangeAfterPin(
      { pinned: pinnedFrom(MIDDLE), posts: [NEWEST, OLDEST], nextCursor: null },
      NEWEST.id,
      null,
    );

    expect(ids(result.posts)).toEqual([MIDDLE.id, OLDEST.id]);
    expect(result.posts[0]).toEqual(MIDDLE);
  });

  it("con la misma fecha desempata por id, como el servidor", () => {
    const twin = anItem("bb", MIDDLE.publishedAt);

    const result = arrangeAfterUnpin({
      pinned: pinnedFrom(twin),
      posts: [NEWEST, MIDDLE, OLDEST],
      nextCursor: null,
    });

    expect(ids(result.posts)).toEqual([
      NEWEST.id,
      twin.id,
      MIDDLE.id,
      OLDEST.id,
    ]);
  });

  it("una publicación que no está en la lista deja el feed como estaba", () => {
    const feed = { pinned: null, posts: [NEWEST], nextCursor: null };

    expect(arrangeAfterPin(feed, "otra", null)).toEqual(feed);
  });
});

describe("al desfijar desde el feed", () => {
  it("la fijada vuelve a la lista y no queda ninguna", () => {
    const result = arrangeAfterUnpin({
      pinned: pinnedFrom(MIDDLE),
      posts: [NEWEST, OLDEST],
      nextCursor: null,
    });

    expect(result.pinned).toBeNull();
    expect(ids(result.posts)).toEqual([NEWEST.id, MIDDLE.id, OLDEST.id]);
  });

  it("en la última página, la más antigua de todas va al final", () => {
    const result = arrangeAfterUnpin({
      pinned: pinnedFrom(OLDEST),
      posts: [NEWEST, MIDDLE],
      nextCursor: null,
    });

    expect(ids(result.posts)).toEqual([NEWEST.id, MIDDLE.id, OLDEST.id]);
  });

  it("si aún quedan páginas, la más antigua que lo cargado espera a Cargar más", () => {
    const result = arrangeAfterUnpin({
      pinned: pinnedFrom(OLDEST),
      posts: [NEWEST, MIDDLE],
      nextCursor: "pagina-2",
    });

    expect(ids(result.posts)).toEqual([NEWEST.id, MIDDLE.id]);
  });
});
