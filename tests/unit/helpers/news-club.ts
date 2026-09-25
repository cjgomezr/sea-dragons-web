import type { Role } from "@/lib/auth/roles";
import type {
  NewNewsPost,
  NewsFeedQuery,
  NewsFeedRow,
  NewsGateways,
  NewsPost,
} from "@/lib/news/news-posts";

/**
 * Un club en memoria para los tests del dominio de noticias. El doble cumple
 * el contrato de los adaptadores: el feed trae sólo lo publicado del club que
 * va a todo el club o a alguno de los grupos que se le pasan, de la más
 * reciente a la más antigua.
 */

export const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
export const AUTHOR_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
export const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
export const OTHER_CLUB_ID = "5c1ab000-0000-4000-8000-000000000002";
export const SENIOR_SQUAD_ID = "9a9a9a9a-0000-4000-8000-000000000009";
export const MASTERS_SQUAD_ID = "8b8b8b8b-0000-4000-8000-000000000008";

export const AUTHOR = { id: AUTHOR_ID, fullName: "Carla Committee" };

export type FakeClubOptions = {
  readonly callerRole?: Role;
  readonly callerGroupIds?: readonly string[];
  readonly clubGroupIds?: readonly string[];
  readonly posts?: readonly NewsPost[];
  readonly callerIsMember?: false;
};

export type FakeClub = {
  readonly gateways: NewsGateways;
  readonly inserted: NewNewsPost[];
  readonly feedQueries: NewsFeedQuery[];
};

const PUBLISHED_AT = "2026-09-26T10:00:00.000000+00:00";

export function aPost(overrides: Partial<NewsPost> & { id: string }): NewsPost {
  return {
    category: "news",
    title: "Cambia la piscina",
    body: "El martes entrenamos en MSAC.",
    author: AUTHOR,
    publishedAt: PUBLISHED_AT,
    editedAt: null,
    status: "published",
    audience: { kind: "club" },
    clubId: CLUB_ID,
    attachments: [],
    ...overrides,
  };
}

function reaches(post: NewsPost, groupIds: readonly string[]): boolean {
  return (
    post.audience.kind === "club" ||
    post.audience.groupIds.some((id) => groupIds.includes(id))
  );
}

function isAfter(post: NewsPost, query: NewsFeedQuery): boolean {
  if (query.after === null) {
    return true;
  }
  return (
    post.publishedAt < query.after.publishedAt ||
    (post.publishedAt === query.after.publishedAt && post.id < query.after.id)
  );
}

function newestFirst(first: NewsPost, second: NewsPost): number {
  if (first.publishedAt !== second.publishedAt) {
    return first.publishedAt < second.publishedAt ? 1 : -1;
  }
  return first.id < second.id ? 1 : -1;
}

function toFeedRow(post: NewsPost): NewsFeedRow {
  return {
    id: post.id,
    category: post.category,
    title: post.title,
    body: post.body,
    author: post.author,
    publishedAt: post.publishedAt,
    attachmentCount: post.attachments.length,
  };
}

export function fakeClub(options: FakeClubOptions = {}): FakeClub {
  const inserted: NewNewsPost[] = [];
  const feedQueries: NewsFeedQuery[] = [];
  const posts = options.posts ?? [];
  const clubGroupIds = options.clubGroupIds ?? [
    SENIOR_SQUAD_ID,
    MASTERS_SQUAD_ID,
  ];
  const gateways: NewsGateways = {
    members: {
      findRoleRequestMember: async () =>
        options.callerIsMember === false
          ? null
          : {
              clubId: CLUB_ID,
              fullName: "Quien llama",
              role: options.callerRole ?? "Player",
            },
    },
    memberGroups: {
      listGroupsOf: async () =>
        (options.callerGroupIds ?? []).map((id) => ({ id, name: id })),
    },
    posts: {
      findClubGroupIds: async ({ clubId, groupIds }) =>
        new Set(
          clubId === CLUB_ID
            ? groupIds.filter((id) => clubGroupIds.includes(id))
            : [],
        ),
      insertPost: async (post) => {
        inserted.push(post);
        return {
          id: "c2c2c2c2-0000-4000-8000-00000000000c",
          clubId: post.clubId,
          category: post.category,
          title: post.title,
          body: post.body,
          author: { id: post.authorId, fullName: "Quien llama" },
          publishedAt: PUBLISHED_AT,
          editedAt: null,
          status: "published",
          audience: post.audience,
          attachments: [],
        };
      },
      findFeedPage: async (query) => {
        feedQueries.push(query);
        return posts
          .filter(
            (post) =>
              post.clubId === query.clubId &&
              post.status === "published" &&
              reaches(post, query.audienceGroupIds) &&
              isAfter(post, query),
          )
          .sort(newestFirst)
          .slice(0, query.limit)
          .map(toFeedRow);
      },
      findPost: async ({ clubId, postId }) =>
        posts.find((post) => post.id === postId && post.clubId === clubId) ??
        null,
    },
  };
  return { gateways, inserted, feedQueries };
}
