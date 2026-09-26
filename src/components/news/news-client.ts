import { z } from "zod";
import {
  type ApiRequestFailure,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  NEWS_API_PATH,
  NEWS_ATTACHMENT_API_PATH,
  NEWS_POST_API_PATH,
} from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import type { NewsAttachmentDownload } from "@/lib/news/news-attachments";
import type { NewsFeedPage } from "@/lib/news/news-feed";
import { NEWS_CATEGORIES, type NewsPostDetail } from "@/lib/news/news-posts";

/**
 * Lo que las pantallas de Noticias (#329) le piden a la API v1 (#327, #328) y
 * cómo reducen cada respuesta a algo que pintar.
 *
 * Nada habla con la base: el endpoint es el producto, y la aplicación nativa
 * de Release 2 va a usar estos mismos caminos (CON-002). Qué publicaciones ve
 * cada uno lo decide el servidor, así que aquí no se filtra nada. De un error
 * se guarda el código y no la frase, para que el aviso cambie de idioma con el
 * interruptor (E17).
 */

const CURSOR_PARAM = "cursor";

const authorSchema = z.object({ id: z.uuid(), fullName: z.string() });

const feedItemSchema = z.object({
  id: z.uuid(),
  category: z.enum(NEWS_CATEGORIES),
  title: z.string(),
  excerpt: z.string(),
  author: authorSchema,
  publishedAt: z.iso.datetime({ offset: true }),
  attachmentCount: z.number().int().nonnegative(),
});

const feedResponseSchema = z.object({
  data: z.object({
    posts: z.array(feedItemSchema),
    nextCursor: z.string().nullable(),
  }),
});

const postResponseSchema = z.object({
  data: z.object({
    id: z.uuid(),
    category: z.enum(NEWS_CATEGORIES),
    title: z.string(),
    body: z.string(),
    author: authorSchema,
    publishedAt: z.iso.datetime({ offset: true }),
    editedAt: z.iso.datetime({ offset: true }).nullable(),
    status: z.enum(["published", "withdrawn"]),
    attachments: z.array(
      z.object({
        id: z.uuid(),
        fileName: z.string(),
        contentType: z.string(),
        sizeBytes: z.number().int().nonnegative(),
      }),
    ),
  }),
});

// Sólo una dirección web: la pantalla navega a ella tal cual.
const downloadResponseSchema = z.object({
  data: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("available"),
      fileName: z.string(),
      url: z.url({ protocol: /^https?$/ }),
    }),
    z.object({ status: z.literal("unavailable"), fileName: z.string() }),
  ]),
});

export type NewsFailure = ApiRequestFailure;

export type NewsFeedLoad =
  { readonly kind: "loaded"; readonly page: NewsFeedPage } | NewsFailure;

export type NewsPostLoad =
  { readonly kind: "loaded"; readonly post: NewsPostDetail } | NewsFailure;

export type NewsAttachmentRequest =
  | { readonly kind: "loaded"; readonly download: NewsAttachmentDownload }
  | NewsFailure;

function feedPath(cursor: string | null): string {
  if (cursor === null) {
    return NEWS_API_PATH;
  }
  const params = new URLSearchParams({ [CURSOR_PARAM]: cursor });
  return `${NEWS_API_PATH}?${params.toString()}`;
}

/** Una página del feed: la primera sin cursor, las demás con el `nextCursor`
 * de la anterior. Nunca rechaza: un fallo de red sale como fallo. */
export async function loadNewsFeed(
  cursor: string | null,
): Promise<NewsFeedLoad> {
  const read = readApiPayload(
    await requestApi(feedPath(cursor)),
    feedResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", page: read.value.data };
}

export async function loadNewsPost(postId: string): Promise<NewsPostLoad> {
  const read = readApiPayload(
    await requestApi(
      NEWS_POST_API_PATH.replace("[id]", encodeURIComponent(postId)),
    ),
    postResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", post: read.value.data };
}

/** La dirección firmada de un adjunto. Caduca pronto, así que se pide al
 * pulsar y no al abrir la publicación. */
export async function requestNewsAttachment(
  postId: string,
  attachmentId: string,
): Promise<NewsAttachmentRequest> {
  const path = NEWS_ATTACHMENT_API_PATH.replace(
    "[id]",
    encodeURIComponent(postId),
  ).replace("[attachmentId]", encodeURIComponent(attachmentId));
  const read = readApiPayload(await requestApi(path), downloadResponseSchema);
  return read.kind === "failed"
    ? read
    : { kind: "loaded", download: read.value.data };
}

/** Por qué no se pudo leer, en el idioma de la pantalla. Sólo se lee, así que
 * lo que queda es haber perdido la sesión o un fallo del que cabe reintentar.
 * El 404 de una publicación no pasa por aquí: tiene su propia pantalla. */
export function describeNewsFailure(
  translate: Translator,
  { failure }: NewsFailure,
  unexpected: "news.error.unexpected" | "news.post.error.unexpected",
): string {
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "unauthenticated":
      return translate("news.error.signInRequired");
    default:
      return translate(unexpected);
  }
}
