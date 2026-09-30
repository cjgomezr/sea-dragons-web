import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { cachedClubPositions } from "@/lib/club/supabase-club-positions";
import {
  DIRECTORY_COLUMNS,
  toDirectoryMemberRecord,
} from "@/lib/directory/supabase-directory-gateways";
import { EVENT_TYPES } from "@/lib/events/event-creation";
import {
  READER_AUDIENCE_FILTER,
  READER_GROUP_FILTER as EVENT_READER_GROUP_FILTER,
  READER_GROUPS_EMBED,
} from "@/lib/events/supabase-event-agenda-gateways";
import { toHoursAndMinutes } from "@/lib/events/supabase-event-management-gateways";
import { createSupabaseMemberGroupsGateway } from "@/lib/groups/supabase-member-groups-gateway";
import { signProfilePhotoUrls } from "@/lib/members/supabase-profile-photo-gateways";
import { NEWS_CATEGORIES } from "@/lib/news/news-posts";
import {
  READER_GROUP_FILTER as NEWS_READER_GROUP_FILTER,
  audienceFilter,
  statusFilter,
} from "@/lib/news/supabase-news-gateways";
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
 * escapa el texto en la base; sobre lo que devuelve se aplican los mismos
 * filtros que la agenda y el feed, importados de sus adaptadores para que
 * la audiencia no tenga dos copias.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const MEMBERS_FUNCTION = "search_members";
const EVENTS_FUNCTION = "search_events";
const NEWS_FUNCTION = "search_news_posts";

const EVENT_COLUMNS =
  "id, title, starts_on, start_time, location, event_type, status";
const NEWS_COLUMNS =
  "id, title, category, published_at, news_post_groups(group_id)";

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

/** La audiencia y el periodo como en `findAgendaPage`: los próximos desde
 * hoy por inicio ascendente, los pasados hasta ayer por inicio descendente. */
function findEventsMatching(
  serviceClient: SupabaseClient,
  query: EventSearchQuery,
): Promise<SearchMatches<EventMatch>> {
  const isAudience = query.visibility.kind === "audience";
  const columns = isAudience
    ? `${EVENT_COLUMNS}, ${READER_GROUPS_EMBED}`
    : EVENT_COLUMNS;
  let request = serviceClient
    .rpc(EVENTS_FUNCTION, searchArguments(query.clubId, query.text), {
      count: "exact",
    })
    .select(columns);
  request =
    query.period === "upcoming"
      ? request.gte("starts_on", query.today)
      : request.lt("starts_on", query.today);
  if (query.visibility.kind === "audience") {
    request = request
      .in(EVENT_READER_GROUP_FILTER, query.visibility.groupIds)
      .or(READER_AUDIENCE_FILTER);
  }
  const ascending = query.period === "upcoming";
  return readMatches(
    request
      .order("starts_at", { ascending })
      .order("id", { ascending })
      .limit(query.limit),
    {
      description: `entre los eventos del club ${query.clubId}`,
      toRow: toEventMatch,
    },
  );
}

/** Los mismos filtros que `findFeedPage`, y el mismo orden. */
function findNewsMatching(
  serviceClient: SupabaseClient,
  query: NewsSearchQuery,
): Promise<SearchMatches<NewsMatch>> {
  return readMatches(
    serviceClient
      .rpc(NEWS_FUNCTION, searchArguments(query.clubId, query.text), {
        count: "exact",
      })
      .select(NEWS_COLUMNS)
      .or(statusFilter(query.readerId))
      .in(NEWS_READER_GROUP_FILTER, query.audienceGroupIds)
      .or(audienceFilter(query.readerId))
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
