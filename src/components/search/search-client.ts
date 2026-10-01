import { z } from "zod";
import { readApiPayload, requestApi } from "@/lib/api/request-api";
import { SEARCH_API_PATH } from "@/lib/auth/routes";
import { EVENT_TYPES } from "@/lib/events/event-creation";
import { NEWS_CATEGORIES } from "@/lib/news/news-posts";
import type { SearchResults } from "@/lib/search/search";

/**
 * La búsqueda global de la cabecera (#427) habla con `GET /api/v1/search`
 * (#425, CON-002): lo que quien tiene la sesión vería en cada sección.
 */

const positionSchema = z.object({
  id: z.string(),
  names: z.object({ en: z.string().nullable(), es: z.string().nullable() }),
});

const memberSchema = z.object({
  kind: z.literal("member"),
  userId: z.string(),
  fullName: z.string(),
  position: positionSchema.nullable(),
  photoUrl: z.string().nullable(),
});

const eventSchema = z.object({
  kind: z.literal("event"),
  id: z.string(),
  title: z.string(),
  startsOn: z.iso.date(),
  startTime: z.string(),
  location: z.string(),
  eventType: z.enum(EVENT_TYPES),
  isCancelled: z.boolean(),
});

const newsSchema = z.object({
  kind: z.literal("news"),
  id: z.string(),
  title: z.string(),
  category: z.enum(NEWS_CATEGORIES),
  publishedAt: z.string(),
});

function groupOf<Item extends z.ZodType>(
  item: Item,
): z.ZodObject<{
  total: z.ZodNumber;
  items: z.ZodArray<Item>;
}> {
  return z.object({
    total: z.number().int().nonnegative(),
    items: z.array(item),
  });
}

const searchSchema = z.object({
  data: z.object({
    members: groupOf(memberSchema),
    events: groupOf(eventSchema),
    news: groupOf(newsSchema),
  }),
});

/** La pantalla no distingue por qué falló: dice que no se pudo buscar y
 * ofrece reintentar, sea la red o el servidor. */
export type SearchOutcome =
  | { readonly kind: "found"; readonly results: SearchResults }
  | { readonly kind: "failed" };

export async function fetchSearchResults(
  text: string,
  signal: AbortSignal,
): Promise<SearchOutcome> {
  const read = readApiPayload(
    await requestApi(`${SEARCH_API_PATH}?q=${encodeURIComponent(text)}`, {
      signal,
    }),
    searchSchema,
  );
  return read.kind === "failed"
    ? { kind: "failed" }
    : { kind: "found", results: read.value.data };
}
