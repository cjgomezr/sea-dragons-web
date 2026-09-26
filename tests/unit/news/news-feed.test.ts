import { describe, expect, it } from "vitest";
import {
  InvalidNewsFeedCursorError,
  NEWS_EXCERPT_MAX_LENGTH,
  NEWS_FEED_PAGE_SIZE,
  excerptNewsBody,
  listNewsFeed,
} from "@/lib/news/news-feed";
import type { NewsPost } from "@/lib/news/news-posts";
import {
  AUTHOR,
  CALLER_ID,
  CLUB_ID,
  MASTERS_SQUAD_ID,
  OTHER_CLUB_ID,
  SENIOR_SQUAD_ID,
  aPost,
  fakeClub,
} from "../helpers/news-club";

/**
 * El feed de cada miembro (#327, RF-4 del PRD de E11): lo dirigido a él, de
 * lo más reciente a lo más antiguo, de 20 en 20, con un extracto en vez del
 * cuerpo entero.
 */

function postId(index: number): string {
  return `d3d3d3d3-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/** Una publicación por minuto: la `index` más alta es la más reciente. */
function postAtMinute(
  index: number,
  overrides: Partial<NewsPost> = {},
): NewsPost {
  const minute = String(index).padStart(2, "0");
  return aPost({
    id: postId(index),
    title: `Publicación ${index}`,
    publishedAt: `2026-09-26T10:${minute}:00.000000+00:00`,
    ...overrides,
  });
}

describe("el feed de cada miembro", () => {
  it("trae sólo lo dirigido a él: todo el club y sus grupos", async () => {
    const club = fakeClub({
      callerGroupIds: [SENIOR_SQUAD_ID],
      posts: [
        postAtMinute(1),
        postAtMinute(2, {
          audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        }),
        postAtMinute(3, {
          audience: { kind: "groups", groupIds: [MASTERS_SQUAD_ID] },
        }),
      ],
    });

    const feed = await listNewsFeed(club.gateways, { callerId: CALLER_ID });

    expect(feed.posts.map((post) => post.id)).toEqual([postId(2), postId(1)]);
  });

  it("busca en el club de quien llama con sus grupos de E4", async () => {
    const club = fakeClub({ callerGroupIds: [SENIOR_SQUAD_ID] });

    await listNewsFeed(club.gateways, { callerId: CALLER_ID });

    expect(club.feedQueries).toEqual([
      {
        clubId: CLUB_ID,
        audienceGroupIds: [SENIOR_SQUAD_ID],
        after: null,
        limit: NEWS_FEED_PAGE_SIZE + 1,
      },
    ]);
  });

  it("deja fuera lo retirado y lo de otro club", async () => {
    const club = fakeClub({
      posts: [
        postAtMinute(1),
        postAtMinute(2, { status: "withdrawn" }),
        postAtMinute(3, { clubId: OTHER_CLUB_ID }),
      ],
    });

    const feed = await listNewsFeed(club.gateways, { callerId: CALLER_ID });

    expect(feed.posts.map((post) => post.id)).toEqual([postId(1)]);
  });

  it("ordena de la más reciente a la más antigua", async () => {
    const club = fakeClub({
      posts: [postAtMinute(1), postAtMinute(3), postAtMinute(2)],
    });

    const feed = await listNewsFeed(club.gateways, { callerId: CALLER_ID });

    expect(feed.posts.map((post) => post.id)).toEqual([
      postId(3),
      postId(2),
      postId(1),
    ]);
  });

  it("da de cada fila la categoría, el título, el extracto, el autor, la fecha y cuántos adjuntos tiene", async () => {
    const attachment = {
      id: "e4e4e4e4-0000-4000-8000-00000000000e",
      fileName: "horario.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
    };
    const club = fakeClub({
      posts: [
        postAtMinute(1, {
          category: "document",
          body: "Horario nuevo.",
          attachments: [attachment, { ...attachment, id: postId(99) }],
        }),
      ],
    });

    const feed = await listNewsFeed(club.gateways, { callerId: CALLER_ID });

    expect(feed.posts).toEqual([
      {
        id: postId(1),
        category: "document",
        title: "Publicación 1",
        excerpt: "Horario nuevo.",
        author: AUTHOR,
        publishedAt: "2026-09-26T10:01:00.000000+00:00",
        attachmentCount: 2,
      },
    ]);
  });

  it("devuelve una lista vacía, y no un error, a quien no tiene publicaciones", async () => {
    const club = fakeClub({
      posts: [
        postAtMinute(1, {
          audience: { kind: "groups", groupIds: [MASTERS_SQUAD_ID] },
        }),
      ],
    });

    const feed = await listNewsFeed(club.gateways, { callerId: CALLER_ID });

    expect(feed).toEqual({ posts: [], nextCursor: null });
  });

  it("trae las 20 más recientes y una forma de pedir las siguientes", async () => {
    const club = fakeClub({
      posts: Array.from({ length: 25 }, (_, index) => postAtMinute(index + 1)),
    });

    const firstPage = await listNewsFeed(club.gateways, {
      callerId: CALLER_ID,
    });
    const secondPage = await listNewsFeed(club.gateways, {
      callerId: CALLER_ID,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(firstPage.posts).toHaveLength(NEWS_FEED_PAGE_SIZE);
    expect(firstPage.posts[0]?.id).toBe(postId(25));
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(secondPage.posts.map((post) => post.id)).toEqual([
      postId(5),
      postId(4),
      postId(3),
      postId(2),
      postId(1),
    ]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("no ofrece página siguiente cuando hay justo 20", async () => {
    const club = fakeClub({
      posts: Array.from({ length: NEWS_FEED_PAGE_SIZE }, (_, index) =>
        postAtMinute(index + 1),
      ),
    });

    const feed = await listNewsFeed(club.gateways, { callerId: CALLER_ID });

    expect(feed.posts).toHaveLength(NEWS_FEED_PAGE_SIZE);
    expect(feed.nextCursor).toBeNull();
  });

  it("no repite ni salta publicaciones del mismo instante entre páginas", async () => {
    const sameInstant = "2026-09-26T10:00:00.000000+00:00";
    const club = fakeClub({
      posts: Array.from({ length: NEWS_FEED_PAGE_SIZE + 2 }, (_, index) =>
        postAtMinute(index + 1, { publishedAt: sameInstant }),
      ),
    });

    const firstPage = await listNewsFeed(club.gateways, {
      callerId: CALLER_ID,
    });
    const secondPage = await listNewsFeed(club.gateways, {
      callerId: CALLER_ID,
      cursor: firstPage.nextCursor ?? undefined,
    });

    const seen = [...firstPage.posts, ...secondPage.posts].map(
      (post) => post.id,
    );
    expect(new Set(seen).size).toBe(NEWS_FEED_PAGE_SIZE + 2);
  });

  it.each(["no-es-un-cursor", "", btoa('{"publishedAt":"ayer","id":"x"}')])(
    "rechaza un cursor que no salió de una página (%j)",
    async (cursor) => {
      const club = fakeClub();

      await expect(
        listNewsFeed(club.gateways, { callerId: CALLER_ID, cursor }),
      ).rejects.toBeInstanceOf(InvalidNewsFeedCursorError);
    },
  );
});

describe("el extracto del feed", () => {
  it("deja entero un cuerpo corto", () => {
    expect(excerptNewsBody("El martes entrenamos en MSAC.")).toBe(
      "El martes entrenamos en MSAC.",
    );
  });

  it("junta los saltos de línea y los espacios repetidos en uno", () => {
    expect(excerptNewsBody("  Hola,\n\nequipo.\t Nos vemos.  ")).toBe(
      "Hola, equipo. Nos vemos.",
    );
  });

  it("corta un cuerpo largo sin partir una palabra y lo marca con puntos suspensivos", () => {
    const word = "piscina";
    const body = Array.from({ length: 60 }, () => word).join(" ");

    const excerpt = excerptNewsBody(body);

    expect(excerpt.endsWith("…")).toBe(true);
    expect([...excerpt].length).toBeLessThanOrEqual(
      NEWS_EXCERPT_MAX_LENGTH + 1,
    );
    expect(
      excerpt
        .slice(0, -1)
        .split(" ")
        .every((part) => part === word),
    ).toBe(true);
  });

  it("no deja un espacio ni una coma colgando antes de los puntos suspensivos", () => {
    const body = `${"a".repeat(NEWS_EXCERPT_MAX_LENGTH - 5)}, bb ${"c".repeat(20)}`;

    expect(excerptNewsBody(body)).toBe(
      `${"a".repeat(NEWS_EXCERPT_MAX_LENGTH - 5)}, bb…`,
    );
  });

  it("corta una sola palabra más larga que el extracto, porque no hay dónde más", () => {
    const excerpt = excerptNewsBody("x".repeat(NEWS_EXCERPT_MAX_LENGTH * 2));

    expect(excerpt).toBe(`${"x".repeat(NEWS_EXCERPT_MAX_LENGTH)}…`);
  });

  it("cuenta en caracteres, no en unidades de UTF-16", () => {
    const body = "🤿".repeat(NEWS_EXCERPT_MAX_LENGTH);

    expect(excerptNewsBody(body)).toBe(body);
  });
});
