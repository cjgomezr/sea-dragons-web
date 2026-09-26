import { z } from "zod";
import {
  type NewsAuthor,
  type NewsCategory,
  type NewsFeedPosition,
  type NewsFeedRow,
  type NewsGateways,
  findNewsReader,
  findReaderGroupIds,
} from "./news-posts";

/**
 * El feed de cada miembro (#327, RF-4 del PRD de E11): lo publicado para él,
 * de lo más reciente a lo más antiguo, de 20 en 20.
 *
 * Cada fila lleva un extracto y no el cuerpo entero: son 20 filas por página,
 * casi siempre en un móvil, y el cuerpo lo trae la publicación abierta.
 */

export const NEWS_FEED_PAGE_SIZE = 20;

/** Lo que cabe en dos o tres líneas de una fila del feed en un móvil. */
export const NEWS_EXCERPT_MAX_LENGTH = 200;

const ELLIPSIS = "…";
const WHITESPACE_RUN = /\s+/;
const TRAILING_SPACE_OR_PUNCTUATION = /[\s\p{P}]+$/u;

export type NewsFeedItem = {
  readonly id: string;
  readonly category: NewsCategory;
  readonly title: string;
  readonly excerpt: string;
  readonly author: NewsAuthor;
  readonly publishedAt: string;
  readonly attachmentCount: number;
};

/** `nextCursor` es nulo en la última página. Quien quiera la siguiente lo
 * devuelve tal cual: su contenido no es contrato. */
export type NewsFeedPage = {
  readonly posts: readonly NewsFeedItem[];
  readonly nextCursor: string | null;
};

export class InvalidNewsFeedCursorError extends Error {
  constructor() {
    super("El cursor no corresponde a ninguna página del feed.");
    this.name = "InvalidNewsFeedCursorError";
  }
}

const feedPositionSchema = z.object({
  publishedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

function encodeCursor(position: NewsFeedPosition): string {
  return Buffer.from(JSON.stringify(position)).toString("base64url");
}

function decodeCursor(cursor: string): NewsFeedPosition {
  try {
    const json: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    return feedPositionSchema.parse(json);
  } catch {
    // Un cursor inventado o recortado es una petición mal hecha, no un fallo
    // del servidor: el porqué exacto no le sirve a quien lo mandó.
    throw new InvalidNewsFeedCursorError();
  }
}

/**
 * El cuerpo en una línea, cortado sin partir una palabra. Sólo se corta en
 * medio de una palabra si la primera ya no cabe entera, porque no hay otro
 * sitio. Se cuenta en caracteres y no en unidades de UTF-16, para no partir
 * un emoji en dos.
 */
export function excerptNewsBody(body: string): string {
  const text = body.trim().split(WHITESPACE_RUN).join(" ");
  const characters = [...text];
  if (characters.length <= NEWS_EXCERPT_MAX_LENGTH) {
    return text;
  }
  // Un carácter de más: si es un espacio, la última palabra cabe entera.
  const head = characters.slice(0, NEWS_EXCERPT_MAX_LENGTH + 1).join("");
  const lastSpace = head.lastIndexOf(" ");
  const cut =
    lastSpace > 0
      ? head.slice(0, lastSpace).replace(TRAILING_SPACE_OR_PUNCTUATION, "")
      : "";
  const excerpt =
    cut === "" ? characters.slice(0, NEWS_EXCERPT_MAX_LENGTH).join("") : cut;
  return `${excerpt}${ELLIPSIS}`;
}

function toFeedItem(row: NewsFeedRow): NewsFeedItem {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    excerpt: excerptNewsBody(row.body),
    author: row.author,
    publishedAt: row.publishedAt,
    attachmentCount: row.attachmentCount,
  };
}

/** Una página del feed de quien llama. Se pide una fila de más para saber,
 * sin contar, si hay página siguiente. */
export async function listNewsFeed(
  gateways: NewsGateways,
  request: { readonly callerId: string; readonly cursor?: string },
): Promise<NewsFeedPage> {
  const after =
    request.cursor === undefined ? null : decodeCursor(request.cursor);
  const [caller, audienceGroupIds] = await Promise.all([
    findNewsReader(gateways, request.callerId),
    findReaderGroupIds(gateways, request.callerId),
  ]);
  const rows = await gateways.posts.findFeedPage({
    clubId: caller.clubId,
    audienceGroupIds,
    after,
    limit: NEWS_FEED_PAGE_SIZE + 1,
  });
  const page = rows.slice(0, NEWS_FEED_PAGE_SIZE);
  const last = page.at(-1);
  const hasMore = rows.length > NEWS_FEED_PAGE_SIZE && last !== undefined;
  return {
    posts: page.map(toFeedItem),
    nextCursor: hasMore
      ? encodeCursor({ publishedAt: last.publishedAt, id: last.id })
      : null,
  };
}
