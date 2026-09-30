import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { cachedClubPositions } from "@/lib/club/supabase-club-positions";
import {
  DIRECTORY_COLUMNS,
  toDirectoryMemberRecord,
} from "@/lib/directory/supabase-directory-gateways";
import { EVENT_TYPES } from "@/lib/events/event-creation";
import { toHoursAndMinutes } from "@/lib/events/supabase-event-management-gateways";
import { createSupabaseMemberGroupsGateway } from "@/lib/groups/supabase-member-groups-gateway";
import { signProfilePhotoUrls } from "@/lib/members/supabase-profile-photo-gateways";
import { NEWS_CATEGORIES } from "@/lib/news/news-posts";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  EventMatch,
  EventSearchQuery,
  NewsMatch,
  NewsSearchQuery,
  SearchGateways,
  SearchMatches,
} from "./search";

/**
 * Adaptador entre la búsqueda global (#425) y Supabase.
 *
 * Va por la llave de servicio, como las tres secciones que busca. Cada grupo
 * es una sola llamada a su función de `0049_search.sql`, que normaliza y
 * escapa el texto en la base. La audiencia de eventos y noticias también la
 * aplican esas funciones, con lo que decide el dominio: PostgREST no deja
 * filtrar con un `or` sobre lo embebido en el resultado de una función, que
 * es como lo hacen la agenda y el feed.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const MEMBERS_FUNCTION = "search_members";
const EVENTS_FUNCTION = "search_events";
const NEWS_FUNCTION = "search_news_posts";

// `starts_at` sólo sirve para ordenar, pero tiene que ir en la lista: sobre
// el resultado de una función, PostgREST no ordena por una columna que no
// selecciona ("column events.starts_at does not exist").
const EVENT_COLUMNS =
  "id, title, starts_on, start_time, starts_at, location, event_type, status";
const NEWS_COLUMNS = "id, title, category, published_at";

const eventMatchSchema = z.object({
  id: z.string(),
  title: z.string(),
  starts_on: z.string(),
  start_time: z.string(),
  location: z.string(),
  event_type: z.enum(EVENT_TYPES),
  status: z.enum(["scheduled", "cancelled"]),
});

const newsMatchSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.enum(NEWS_CATEGORIES),
  published_at: z.string(),
});

type SearchArguments = { readonly p_club_id: string; readonly p_text: string };

function searchArguments(clubId: string, text: string): SearchArguments {
  return { p_club_id: clubId, p_text: text };
}

/** La visibilidad que decidió el dominio, como la entiende la función. */
function eventSearchArguments(query: EventSearchQuery): SearchArguments & {
  readonly p_whole_club: boolean;
  readonly p_group_ids: readonly string[];
} {
  const base = searchArguments(query.clubId, query.text);
  return query.visibility.kind === "club"
    ? { ...base, p_whole_club: true, p_group_ids: [] }
    : { ...base, p_whole_club: false, p_group_ids: query.visibility.groupIds };
}

function toEventMatch(row: unknown): EventMatch {
  const parsed = eventMatchSchema.parse(row);
  return {
    id: parsed.id,
    title: parsed.title,
    startsOn: parsed.starts_on,
    startTime: toHoursAndMinutes(parsed.start_time),
    location: parsed.location,
    eventType: parsed.event_type,
    status: parsed.status,
  };
}

function toNewsMatch(row: unknown): NewsMatch {
  const parsed = newsMatchSchema.parse(row);
  return {
    id: parsed.id,
    title: parsed.title,
    category: parsed.category,
    publishedAt: parsed.published_at,
  };
}

/** Las filas y la cuenta exacta que PostgREST da con `count: "exact"`. */
async function readMatches<Row>(
  query: PromiseLike<{
    readonly data: unknown;
    readonly count: number | null;
    readonly error: { readonly message: string } | null;
  }>,
  context: {
    readonly description: string;
    readonly toRow: (row: unknown) => Row;
  },
): Promise<SearchMatches<Row>> {
  const { data, count, error } = await query;
  if (error) {
    throw new Error(
      `No se pudo buscar ${context.description}: ${error.message}`,
    );
  }
  if (count === null) {
    throw new Error(`La base no devolvió la cuenta de ${context.description}.`);
  }
  return {
    total: count,
    rows: z.array(z.unknown()).parse(data).map(context.toRow),
  };
}

async function findMembersMatching(
  serviceClient: SupabaseClient,
  clubId: string,
  text: string,
): ReturnType<SearchGateways["directory"]["findMembersMatching"]> {
  const { data, error } = await serviceClient
    .rpc(MEMBERS_FUNCTION, searchArguments(clubId, text))
    .select(DIRECTORY_COLUMNS);
  if (error) {
    throw new Error(
      `No se pudo buscar entre los socios del club ${clubId}: ${error.message}`,
    );
  }
  return z
    .array(z.record(z.string(), z.unknown()))
    .parse(data)
    .map(toDirectoryMemberRecord);
}

/** El periodo y el orden como en `findAgendaPage`: los próximos desde hoy
 * por inicio ascendente, los pasados hasta ayer por inicio descendente. */
function findEventsMatching(
  serviceClient: SupabaseClient,
  query: EventSearchQuery,
): Promise<SearchMatches<EventMatch>> {
  const request = serviceClient
    .rpc(EVENTS_FUNCTION, eventSearchArguments(query), { count: "exact" })
    .select(EVENT_COLUMNS);
  const inPeriod =
    query.period === "upcoming"
      ? request.gte("starts_on", query.today)
      : request.lt("starts_on", query.today);
  const ascending = query.period === "upcoming";
  return readMatches(
    inPeriod
      .order("starts_at", { ascending })
      .order("id", { ascending })
      .limit(query.limit),
    {
      description: `entre los eventos del club ${query.clubId}`,
      toRow: toEventMatch,
    },
  );
}

/** El orden del feed: lo más reciente primero. */
function findNewsMatching(
  serviceClient: SupabaseClient,
  query: NewsSearchQuery,
): Promise<SearchMatches<NewsMatch>> {
  return readMatches(
    serviceClient
      .rpc(
        NEWS_FUNCTION,
        {
          ...searchArguments(query.clubId, query.text),
          p_reader_id: query.readerId,
          p_group_ids: query.audienceGroupIds,
        },
        { count: "exact" },
      )
      .select(NEWS_COLUMNS)
      .order("published_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(query.limit),
    {
      description: `entre las noticias del club ${query.clubId}`,
      toRow: toNewsMatch,
    },
  );
}

export function createSearchGateways(
  serviceClient: SupabaseClient,
): SearchGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    memberGroups: createSupabaseMemberGroupsGateway(serviceClient),
    directory: {
      findMembersMatching: (clubId, text) =>
        findMembersMatching(serviceClient, clubId, text),
    },
    positions: cachedClubPositions,
    photos: {
      signPhotoUrls: (photoPaths) =>
        signProfilePhotoUrls(serviceClient, photoPaths),
    },
    events: {
      findEventsMatching: (query) => findEventsMatching(serviceClient, query),
    },
    news: {
      findNewsMatching: (query) => findNewsMatching(serviceClient, query),
    },
  };
}

export type SearchGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: SearchGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición de la búsqueda. Devuelve las variables que faltan en
 * vez de lanzar, como las demás. */
export function createSupabaseSearchGateways(
  env: Environment,
): SearchGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createSearchGateways(createServiceRoleClient(env)),
  };
}
