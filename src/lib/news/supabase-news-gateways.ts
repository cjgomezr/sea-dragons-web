import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { createSupabaseMemberGroupsGateway } from "@/lib/groups/supabase-member-groups-gateway";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import {
  NEWS_CATEGORIES,
  type NewNewsPost,
  type NewsAudience,
  type NewsFeedQuery,
  type NewsFeedRow,
  type NewsGateways,
  type NewsPost,
} from "./news-posts";

/**
 * Las publicaciones contra Supabase (#327).
 *
 * Van por la llave de servicio. Escribir no lo puede hacer `authenticated`
 * (`0029_news_posts.sql`), y leer tampoco le basta: la RLS sólo le deja ver
 * su propia fila de `members`, así que no podría leer el nombre del autor, y
 * esconde lo retirado también a quien lo publicó (RF-5). Por eso cada consulta
 * filtra por el club de quien llama y la audiencia la aplica el servidor, con
 * los grupos que devuelve la consulta de E4.
 *
 * El feed es una sola consulta: el autor, la cuenta de adjuntos y los grupos
 * de la audiencia vienen embebidos, sin una consulta por publicación.
 */

const POSTS_TABLE = "news_posts";
const POST_GROUPS_TABLE = "news_post_groups";
const GROUPS_TABLE = "groups";

/** El autor por la clave compuesta que lo ata al club, nombrada para que
 * PostgREST no tenga que deducir la relación. */
const AUTHOR_EMBED =
  "author:members!news_posts_author_same_club_fkey(full_name)";

const POST_COLUMNS = [
  "id, club_id, category, title, body, author_id, published_at, edited_at",
  "status, audience",
  AUTHOR_EMBED,
  "news_post_groups(group_id)",
  "news_post_attachments(id, file_name, content_type, size_bytes, created_at)",
].join(", ");

/** `news_post_groups` va embebido sólo para filtrar por él: la fila de un
 * grupo del lector hace que la publicación le alcance. */
const FEED_COLUMNS = [
  "id, category, title, body, author_id, published_at",
  AUTHOR_EMBED,
  "news_post_attachments(count)",
  "news_post_groups(group_id)",
].join(", ");

const READER_GROUP_FILTER = "news_post_groups.group_id";
const AUDIENCE_FILTER = "audience.eq.club,news_post_groups.not.is.null";

type Environment = Readonly<Record<string, string | undefined>>;

const authorSchema = z.object({ full_name: z.string() });

const postRowSchema = z.object({
  id: z.string(),
  club_id: z.string(),
  category: z.enum(NEWS_CATEGORIES),
  title: z.string(),
  body: z.string(),
  author_id: z.string(),
  published_at: z.string(),
  edited_at: z.string().nullable(),
  status: z.enum(["published", "withdrawn"]),
  audience: z.enum(["club", "groups"]),
  author: authorSchema,
  news_post_groups: z.array(z.object({ group_id: z.string() })),
  news_post_attachments: z.array(
    z.object({
      id: z.string(),
      file_name: z.string(),
      content_type: z.string(),
      size_bytes: z.number().int(),
      created_at: z.string(),
    }),
  ),
});

const feedRowSchema = z.object({
  id: z.string(),
  category: z.enum(NEWS_CATEGORIES),
  title: z.string(),
  body: z.string(),
  author_id: z.string(),
  published_at: z.string(),
  author: authorSchema,
  news_post_attachments: z.tuple([z.object({ count: z.number().int() })]),
});

function toAudience(
  audience: "club" | "groups",
  groups: readonly { readonly group_id: string }[],
): NewsAudience {
  return audience === "club"
    ? { kind: "club" }
    : { kind: "groups", groupIds: groups.map((row) => row.group_id) };
}

function toNewsPost(row: unknown): NewsPost {
  const parsed = postRowSchema.parse(row);
  const attachments = [...parsed.news_post_attachments].sort((first, second) =>
    first.created_at.localeCompare(second.created_at),
  );
  return {
    id: parsed.id,
    clubId: parsed.club_id,
    category: parsed.category,
    title: parsed.title,
    body: parsed.body,
    author: { id: parsed.author_id, fullName: parsed.author.full_name },
    publishedAt: parsed.published_at,
    editedAt: parsed.edited_at,
    status: parsed.status,
    audience: toAudience(parsed.audience, parsed.news_post_groups),
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      fileName: attachment.file_name,
      contentType: attachment.content_type,
      sizeBytes: attachment.size_bytes,
    })),
  };
}

function toFeedRow(row: unknown): NewsFeedRow {
  const parsed = feedRowSchema.parse(row);
  return {
    id: parsed.id,
    category: parsed.category,
    title: parsed.title,
    body: parsed.body,
    author: { id: parsed.author_id, fullName: parsed.author.full_name },
    publishedAt: parsed.published_at,
    attachmentCount: parsed.news_post_attachments[0].count,
  };
}

/** Lo anterior a la última fila de la página: más antiguo, o del mismo
 * instante con un id menor. Los dos valores ya los validó el dominio al leer
 * el cursor, así que no pueden romper la sintaxis del filtro. */
function olderThanFilter(after: NonNullable<NewsFeedQuery["after"]>): string {
  const instant = `"${after.publishedAt}"`;
  return `published_at.lt.${instant},and(published_at.eq.${instant},id.lt.${after.id})`;
}

async function findPost(
  serviceClient: SupabaseClient,
  query: { readonly clubId: string; readonly postId: string },
): Promise<NewsPost | null> {
  const { data, error } = await serviceClient
    .from(POSTS_TABLE)
    .select(POST_COLUMNS)
    .eq("id", query.postId)
    .eq("club_id", query.clubId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer la publicación ${query.postId}: ${error.message}`,
    );
  }
  return data === null ? null : toNewsPost(data);
}

async function insertAudienceGroups(
  serviceClient: SupabaseClient,
  post: { readonly id: string; readonly clubId: string },
  groupIds: readonly string[],
): Promise<void> {
  const { error } = await serviceClient.from(POST_GROUPS_TABLE).insert(
    groupIds.map((groupId) => ({
      post_id: post.id,
      group_id: groupId,
      club_id: post.clubId,
    })),
  );
  if (!error) {
    return;
  }
  // PostgREST no abre una transacción entre dos peticiones: si la audiencia
  // no entra (un grupo borrado justo entre la comprobación y aquí), se borra
  // la publicación para no dejarla a medias con otra audiencia.
  const cleanup = await serviceClient
    .from(POSTS_TABLE)
    .delete()
    .eq("id", post.id);
  const cleanupNote = cleanup.error
    ? ` Tampoco se pudo borrar la publicación a medias: ${cleanup.error.message}`
    : "";
  throw new Error(
    `No se pudo guardar la audiencia de la publicación ${post.id}: ${error.message}.${cleanupNote}`,
  );
}

async function insertPost(
  serviceClient: SupabaseClient,
  post: NewNewsPost,
): Promise<NewsPost> {
  const { data, error } = await serviceClient
    .from(POSTS_TABLE)
    .insert({
      club_id: post.clubId,
      author_id: post.authorId,
      category: post.category,
      title: post.title,
      body: post.body,
      audience: post.audience.kind,
    })
    .select("id")
    .single();
  if (error) {
    throw new Error(
      `No se pudo guardar la publicación en el club ${post.clubId}: ${error.message}`,
    );
  }
  const saved = { id: z.string().parse(data.id), clubId: post.clubId };
  if (post.audience.kind === "groups") {
    await insertAudienceGroups(serviceClient, saved, post.audience.groupIds);
  }
  const stored = await findPost(serviceClient, {
    clubId: saved.clubId,
    postId: saved.id,
  });
  if (stored === null) {
    throw new Error(
      `La publicación ${saved.id} no aparece justo después de guardarla.`,
    );
  }
  return stored;
}

export function createNewsGateways(
  serviceClient: SupabaseClient,
): NewsGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    // La consulta de E4 filtra por el socio, así que con la llave de servicio
    // devuelve igual sólo sus grupos.
    memberGroups: createSupabaseMemberGroupsGateway(serviceClient),
    posts: {
      async findClubGroupIds({ clubId, groupIds }) {
        const { data, error } = await serviceClient
          .from(GROUPS_TABLE)
          .select("id")
          .eq("club_id", clubId)
          .in("id", groupIds);
        if (error) {
          throw new Error(
            `No se pudieron leer los grupos de la audiencia en el club ${clubId}: ${error.message}`,
          );
        }
        return new Set(data.map((row) => z.string().parse(row.id)));
      },

      insertPost: (post) => insertPost(serviceClient, post),

      async findFeedPage({ clubId, audienceGroupIds, after, limit }) {
        let query = serviceClient
          .from(POSTS_TABLE)
          .select(FEED_COLUMNS)
          .eq("club_id", clubId)
          .eq("status", "published")
          .in(READER_GROUP_FILTER, audienceGroupIds)
          .or(AUDIENCE_FILTER);
        if (after !== null) {
          query = query.or(olderThanFilter(after));
        }
        const { data, error } = await query
          .order("published_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(limit);
        if (error) {
          throw new Error(
            `No se pudo leer el feed del club ${clubId}: ${error.message}`,
          );
        }
        return data.map(toFeedRow);
      },

      findPost: (query) => findPost(serviceClient, query),
    },
  };
}

export type NewsGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: NewsGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición para los endpoints de noticias. Devuelve las variables
 * que faltan en vez de lanzar, como las demás. */
export function createSupabaseNewsGateways(
  env: Environment,
): NewsGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createNewsGateways(createServiceRoleClient(env)),
  };
}
