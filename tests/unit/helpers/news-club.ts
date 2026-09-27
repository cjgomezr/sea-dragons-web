import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import type {
  NewNewsPost,
  NewsPostEdit,
  NewsFeedQuery,
  NewsFeedRow,
  NewsGateways,
  NewsPost,
} from "@/lib/news/news-posts";

/**
 * Un club en memoria para los tests del dominio de noticias. El doble cumple
 * el contrato de los adaptadores: el feed trae sólo lo publicado del club que
 * va a todo el club o a alguno de los grupos que se le pasan, de la más
 * reciente a la más antigua, y a quien lo publicó también lo suyo retirado.
 * Editar sólo escribe si la publicación sigue en la edición que se tenía
 * delante, como la escritura condicional de verdad.
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
  /** Lo que quien llama cree que hay: la versión que se tenía delante deja
   * de valer justo antes de guardar, como si otra persona hubiera guardado. */
  readonly editedMeanwhileAt?: string;
};

export type FakeClub = {
  readonly gateways: NewsGateways;
  readonly inserted: NewNewsPost[];
  readonly feedQueries: NewsFeedQuery[];
  readonly deletedPostIds: string[];
  /** Las publicaciones como están ahora, con lo editado y lo retirado. */
  readonly posts: NewsPost[];
  readonly edits: NewsPostEdit[];
  readonly audited: AuditLogInsertRow[];
};

/** El id que recibe la publicación que guarda el doble. */
export const INSERTED_POST_ID = "c2c2c2c2-0000-4000-8000-00000000000c";

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

/** Lo publicado de su audiencia, y lo propio esté como esté. */
function isInFeedOf(post: NewsPost, query: NewsFeedQuery): boolean {
  if (post.author.id === query.readerId) {
    return true;
  }
  return post.status === "published" && reaches(post, query.audienceGroupIds);
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
    status: post.status,
    attachmentCount: post.attachments.length,
  };
}

function applyEdit(post: NewsPost, edit: NewsPostEdit): NewsPost {
  return {
    ...post,
    category: edit.category,
    title: edit.title,
    body: edit.body,
    audience: edit.audience,
    editedAt: edit.editedAt,
  };
}

export function fakeClub(options: FakeClubOptions = {}): FakeClub {
  const inserted: NewNewsPost[] = [];
  const feedQueries: NewsFeedQuery[] = [];
  const deletedPostIds: string[] = [];
  const edits: NewsPostEdit[] = [];
  const audited: AuditLogInsertRow[] = [];
  const posts = [...(options.posts ?? [])];
  const indexOf = (clubId: string, postId: string): number =>
    posts.findIndex((post) => post.id === postId && post.clubId === clubId);
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
          id: INSERTED_POST_ID,
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
              isInFeedOf(post, query) &&
              isAfter(post, query),
          )
          .sort(newestFirst)
          .slice(0, query.limit)
          .map(toFeedRow);
      },
      findPost: async ({ clubId, postId }) =>
        posts.find((post) => post.id === postId && post.clubId === clubId) ??
        null,
      deletePost: async (postId) => {
        deletedPostIds.push(postId);
      },
      updatePost: async (edit) => {
        const index = indexOf(edit.clubId, edit.postId);
        const current = posts[index];
        if (current === undefined) {
          throw new Error(`no existe ${edit.postId}`);
        }
        const editedAt = options.editedMeanwhileAt ?? current.editedAt;
        if (editedAt !== edit.expectedEditedAt) {
          return { kind: "changed" };
        }
        edits.push(edit);
        posts[index] = applyEdit(current, edit);
        return { kind: "updated" };
      },
      setPostStatus: async ({ clubId, postId, status }) => {
        const index = indexOf(clubId, postId);
        const current = posts[index];
        if (current === undefined) {
          throw new Error(`no existe ${postId}`);
        }
        posts[index] = { ...current, status };
      },
    },
    audit: {
      insertAuditLogRow: async (row) => {
        audited.push(row);
        return { error: null };
      },
    },
  };
  return {
    gateways,
    inserted,
    feedQueries,
    deletedPostIds,
    posts,
    edits,
    audited,
  };
}
