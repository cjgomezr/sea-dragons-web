import type { NewsFeedItem, NewsPinnedFeedItem } from "./news-feed";

/**
 * Cómo se recoloca el feed ya cargado al fijar o desfijar desde él (#595),
 * sin volver a pedirlo: volver a pedirlo perdería las páginas de "Cargar más"
 * y lo no leído, que se mide contra la visita de antes de abrir.
 *
 * La que deja de estar fijada vuelve a la lista en su sitio por fecha, con el
 * mismo orden que el servidor (fecha y luego id, de mayor a menor). Si es más
 * antigua que todo lo cargado y aún quedan páginas, no se pone: llegará con
 * "Cargar más", y ponerla ahora la repetiría.
 */

export type PinnableFeed = {
  readonly pinned: NewsPinnedFeedItem | null;
  readonly posts: readonly NewsFeedItem[];
  readonly nextCursor: string | null;
};

type FeedArrangement = Pick<PinnableFeed, "pinned" | "posts">;

function isNewerThan(post: NewsFeedItem, other: NewsFeedItem): boolean {
  if (post.publishedAt !== other.publishedAt) {
    return post.publishedAt > other.publishedAt;
  }
  return post.id > other.id;
}

function withoutPin(pinned: NewsPinnedFeedItem): NewsFeedItem {
  // Se separa para quitarlo: una fila de la lista no lleva fecha de fin.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pinnedUntil, ...post } = pinned;
  return post;
}

function returnToList(
  feed: PinnableFeed,
  posts: readonly NewsFeedItem[],
  returning: NewsFeedItem,
): readonly NewsFeedItem[] {
  const position = posts.findIndex((post) => isNewerThan(returning, post));
  if (position === -1) {
    return feed.nextCursor === null ? [...posts, returning] : posts;
  }
  return [...posts.slice(0, position), returning, ...posts.slice(position)];
}

/** `postId` pasa a ser la fijada y la que lo era vuelve a la lista. Una
 * publicación que no está en la lista deja el feed como estaba. */
export function arrangeAfterPin(
  feed: PinnableFeed,
  postId: string,
  pinnedUntil: string | null,
): FeedArrangement {
  const post = feed.posts.find((candidate) => candidate.id === postId);
  if (post === undefined) {
    return feed;
  }
  const rest = feed.posts.filter((candidate) => candidate.id !== postId);
  return {
    pinned: { ...post, pinnedUntil },
    posts:
      feed.pinned === null
        ? rest
        : returnToList(feed, rest, withoutPin(feed.pinned)),
  };
}

/** La fijada vuelve a la lista y ya no hay ninguna. */
export function arrangeAfterUnpin(feed: PinnableFeed): FeedArrangement {
  if (feed.pinned === null) {
    return feed;
  }
  return {
    pinned: null,
    posts: returnToList(feed, feed.posts, withoutPin(feed.pinned)),
  };
}
