import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { createSupabaseMemberGroupsGateway } from "@/lib/groups/supabase-member-groups-gateway";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import { createNewsCoversGateway } from "./supabase-news-covers-gateway";
import {
  NEWS_CATEGORIES,
  type NewNewsPost,
  type NewsAudience,
  type NewsFeedQuery,
  type NewsFeedRow,
  type NewsGateways,
  type NewsPinCommand,
  type NewsPinOutcome,
  type NewsPinnedFeedRow,
  type NewsPinnedQuery,
  type NewsPost,
  type NewsPostEdit,
  type NewsPostStatus,
  type NewsPostUpdate,
  type NewsUnpinOutcome,
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
  "status, audience, cover_upload_id, pinned_at, pinned_until",
  AUTHOR_EMBED,
  "news_post_groups(group_id)",
  "news_post_attachments(id, file_name, content_type, size_bytes, created_at)",
].join(", ");

/** `news_post_groups` va embebido sólo para filtrar por él: la fila de un
 * grupo del lector hace que la publicación le alcance. */
const FEED_COLUMNS = [
  "id, category, title, body, author_id, published_at, status",
  "cover_upload_id",
  AUTHOR_EMBED,
  "news_post_attachments(count)",
  "news_post_groups(group_id)",
].join(", ");

const PINNED_FEED_COLUMNS = `${FEED_COLUMNS}, pinned_until`;

const READER_GROUP_FILTER = "news_post_groups.group_id";

/** Las funciones de `0064_news_post_pins.sql`, que comprueban al Admin y
 * sustituyen la fijada en una transacción. */
const PIN_FUNCTION = "pin_news_post";
const UNPIN_FUNCTION = "unpin_news_post";

/** Lo que va a todo el club o a alguno de sus grupos, y lo suyo esté como
 * esté (#331): quien publicó ve lo retirado, marcado, y nadie más. El id sale
 * de la sesión, así que no puede romper la sintaxis del filtro. */
function audienceFilter(readerId: string): string {
  return `audience.eq.club,news_post_groups.not.is.null,author_id.eq.${readerId}`;
}

function statusFilter(readerId: string): string {
  return `status.eq.published,author_id.eq.${readerId}`;
}

/** Sin fijar ahora: nunca fijada, o con su fecha de fin ya pasada (D7). La
 * hora la formatea el dominio con `toISOString`, así que no puede romper la
 * sintaxis del filtro. */
function notPinnedNowFilter(now: string): string {
  return `pinned_at.is.null,pinned_until.lte."${now}"`;
}

function pinStillRunsFilter(now: string): string {
  return `pinned_until.is.null,pinned_until.gt."${now}"`;
}

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
  cover_upload_id: z.string().nullable(),
  pinned_at: z.string().nullable(),
  pinned_until: z.string().nullable(),
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
  status: z.enum(["published", "withdrawn"]),
  cover_upload_id: z.string().nullable(),
  author: authorSchema,
  news_post_attachments: z.tuple([z.object({ count: z.number().int() })]),
});

const pinnedFeedRowSchema = z.object({ pinned_until: z.string().nullable() });

const pinOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("pinned"),
    replaced_post_id: z.string().nullable(),
    replaced_pinned_until: z.string().nullable(),
  }),
  z.object({
    outcome: z.enum(["forbidden", "not_found", "withdrawn", "invalid_until"]),
  }),
]);

const unpinOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("unpinned"),
    pinned_until: z.string().nullable(),
  }),
  z.object({ outcome: z.enum(["not_pinned", "forbidden", "not_found"]) }),
]);

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
    coverUploadId: parsed.cover_upload_id,
    pin:
      parsed.pinned_at === null
        ? null
        : { pinnedAt: parsed.pinned_at, pinnedUntil: parsed.pinned_until },
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
    status: parsed.status,
    attachmentCount: parsed.news_post_attachments[0].count,
    coverUploadId: parsed.cover_upload_id,
  };
}

/** Lo anterior a la última fila de la página: más antiguo, o del mismo
 * instante con un id menor. Los dos valores ya los validó el dominio al leer
 * el cursor, así que no pueden romper la sintaxis del filtro. */
function olderThanFilter(after: NonNullable<NewsFeedQuery["after"]>): string {
  const instant = `"${after.publishedAt}"`;
  return `published_at.lt.${instant},and(published_at.eq.${instant},id.lt.${after.id})`;
}

function toPinnedFeedRow(row: unknown): NewsPinnedFeedRow {
  return {
    ...toFeedRow(row),
    pinnedUntil: pinnedFeedRowSchema.parse(row).pinned_until,
  };
}

/** Lo del club que le alcanza a quien lee: lo publicado de su audiencia y lo
 * suyo esté como esté. Lo comparten el feed y la fijada. */
function selectReadable(
  serviceClient: SupabaseClient,
  query: NewsPinnedQuery & { readonly columns: string },
) {
  return serviceClient
    .from(POSTS_TABLE)
    .select(query.columns)
    .eq("club_id", query.clubId)
    .or(statusFilter(query.readerId))
    .in(READER_GROUP_FILTER, query.audienceGroupIds)
    .or(audienceFilter(query.readerId));
}

async function findFeedPage(
  serviceClient: SupabaseClient,
  query: NewsFeedQuery,
): Promise<readonly NewsFeedRow[]> {
  let page = selectReadable(serviceClient, {
    ...query,
    columns: FEED_COLUMNS,
  }).or(notPinnedNowFilter(query.now));
  if (query.after !== null) {
    page = page.or(olderThanFilter(query.after));
  }
  const { data, error } = await page
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(query.limit);
  if (error) {
    throw new Error(
      `No se pudo leer el feed del club ${query.clubId}: ${error.message}`,
    );
  }
  return data.map(toFeedRow);
}

/** Sólo una publicada puede estar fijada (`news_posts_pin_check`), y sólo
 * una por club. */
async function findPinnedFeedRow(
  serviceClient: SupabaseClient,
  query: NewsPinnedQuery,
): Promise<NewsPinnedFeedRow | null> {
  const { data, error } = await selectReadable(serviceClient, {
    ...query,
    columns: PINNED_FEED_COLUMNS,
  })
    .not("pinned_at", "is", null)
    .or(pinStillRunsFilter(query.now))
    .limit(1);
  if (error) {
    throw new Error(
      `No se pudo leer la publicación fijada del club ${query.clubId}: ${error.message}`,
    );
  }
  const [row] = data;
  return row === undefined ? null : toPinnedFeedRow(row);
}

/** `invalid_until` no debería llegar: el dominio valida la fecha antes. Si
 * llega, el reloj del servidor y el de la base no coinciden, y es un fallo. */
async function pinPost(
  serviceClient: SupabaseClient,
  command: NewsPinCommand & { readonly until: string | null },
): Promise<NewsPinOutcome> {
  const { data, error } = await serviceClient.rpc(PIN_FUNCTION, {
    acting_club_id: command.clubId,
    acting_user_id: command.actingUserId,
    target_post_id: command.postId,
    pin_until: command.until,
  });
  if (error) {
    throw new Error(
      `No se pudo fijar la publicación ${command.postId}: ${error.message}`,
    );
  }
  const outcome = pinOutcomeSchema.parse(data);
  if (outcome.outcome === "invalid_until") {
    throw new Error(
      `La base rechazó la fecha de fin ${String(command.until)} al fijar la publicación ${command.postId}.`,
    );
  }
  if (outcome.outcome !== "pinned") {
    return { kind: outcome.outcome };
  }
  return {
    kind: "pinned",
    replaced:
      outcome.replaced_post_id === null
        ? null
        : {
            postId: outcome.replaced_post_id,
            pinnedUntil: outcome.replaced_pinned_until,
          },
  };
}

async function unpinPost(
  serviceClient: SupabaseClient,
  command: NewsPinCommand,
): Promise<NewsUnpinOutcome> {
  const { data, error } = await serviceClient.rpc(UNPIN_FUNCTION, {
    acting_club_id: command.clubId,
    acting_user_id: command.actingUserId,
    target_post_id: command.postId,
  });
  if (error) {
    throw new Error(
      `No se pudo desfijar la publicación ${command.postId}: ${error.message}`,
    );
  }
  const outcome = unpinOutcomeSchema.parse(data);
  return outcome.outcome === "unpinned"
    ? { kind: "unpinned", pinnedUntil: outcome.pinned_until }
    : { kind: outcome.outcome };
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
      cover_upload_id: post.coverUploadId,
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

/**
 * Una edición (#331). La fila se escribe sólo si sigue en la marca de
 * editada que se tenía delante: si otra persona guardó entretanto, no se
 * escribe nada y es un conflicto.
 *
 * La audiencia va después, en dos peticiones más: PostgREST no abre una
 * transacción entre peticiones. Primero se quitan los grupos que salen y
 * luego se añaden los que entran. Si algo falla a medias, la publicación
 * alcanza a menos gente de la que debería, nunca a alguien que se quitó.
 */
async function updatePost(
  serviceClient: SupabaseClient,
  edit: NewsPostEdit,
): Promise<NewsPostUpdate> {
  const update = serviceClient
    .from(POSTS_TABLE)
    .update({
      category: edit.category,
      title: edit.title,
      body: edit.body,
      audience: edit.audience.kind,
      edited_at: edit.editedAt,
      ...(edit.cover.kind === "replace"
        ? { cover_upload_id: edit.cover.coverUploadId }
        : {}),
    })
    .eq("id", edit.postId)
    .eq("club_id", edit.clubId);
  const { data, error } = await (
    edit.expectedEditedAt === null
      ? update.is("edited_at", null)
      : update.eq("edited_at", edit.expectedEditedAt)
  ).select("id");
  if (error) {
    throw new Error(
      `No se pudo editar la publicación ${edit.postId}: ${error.message}`,
    );
  }
  if (data.length === 0) {
    return { kind: "changed" };
  }
  await replaceAudienceGroups(serviceClient, edit);
  return { kind: "updated" };
}

async function replaceAudienceGroups(
  serviceClient: SupabaseClient,
  edit: NewsPostEdit,
): Promise<void> {
  const groupIds =
    edit.audience.kind === "groups" ? edit.audience.groupIds : [];
  let removal = serviceClient
    .from(POST_GROUPS_TABLE)
    .delete()
    .eq("post_id", edit.postId);
  if (groupIds.length > 0) {
    removal = removal.not("group_id", "in", `(${groupIds.join(",")})`);
  }
  const removed = await removal;
  if (removed.error) {
    throw new Error(
      `No se pudo quitar la audiencia anterior de la publicación ${edit.postId}: ${removed.error.message}`,
    );
  }
  if (groupIds.length === 0) {
    return;
  }
  const { error } = await serviceClient.from(POST_GROUPS_TABLE).upsert(
    groupIds.map((groupId) => ({
      post_id: edit.postId,
      group_id: groupId,
      club_id: edit.clubId,
    })),
    { onConflict: "post_id,group_id", ignoreDuplicates: true },
  );
  if (error) {
    throw new Error(
      `No se pudo guardar la audiencia nueva de la publicación ${edit.postId}: ${error.message}`,
    );
  }
}

async function setPostStatus(
  serviceClient: SupabaseClient,
  change: {
    readonly clubId: string;
    readonly postId: string;
    readonly status: NewsPostStatus;
  },
): Promise<void> {
  const { error } = await serviceClient
    .from(POSTS_TABLE)
    .update({ status: change.status })
    .eq("id", change.postId)
    .eq("club_id", change.clubId);
  if (error) {
    throw new Error(
      `No se pudo cambiar el estado de la publicación ${change.postId}: ${error.message}`,
    );
  }
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

      findFeedPage: (query) => findFeedPage(serviceClient, query),

      findPost: (query) => findPost(serviceClient, query),

      async deletePost(postId) {
        const { error } = await serviceClient
          .from(POSTS_TABLE)
          .delete()
          .eq("id", postId);
        if (error) {
          throw new Error(
            `No se pudo borrar la publicación ${postId}: ${error.message}`,
          );
        }
      },

      updatePost: (edit) => updatePost(serviceClient, edit),

      setPostStatus: (change) => setPostStatus(serviceClient, change),

      findPinnedFeedRow: (query) => findPinnedFeedRow(serviceClient, query),

      pinPost: (command) => pinPost(serviceClient, command),

      unpinPost: (command) => unpinPost(serviceClient, command),
    },
    covers: createNewsCoversGateway(serviceClient),
    audit: createSupabaseAuditLogWriter(serviceClient),
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
