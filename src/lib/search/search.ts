import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import type { ClubPositionsGateway } from "@/lib/club/club-positions";
import {
  type DirectoryGateways,
  type DirectoryMemberRecord,
  type DirectoryPosition,
  canSeeInDirectory,
  directoryPositionOf,
  photoUrlOf,
  referencedPositionIds,
  signListedPhotos,
} from "@/lib/directory/directory";
import {
  type AgendaPeriod,
  type EventStatus,
  type EventVisibility,
  eventVisibilityFor,
} from "@/lib/events/event-agenda";
import type { EventType } from "@/lib/events/event-creation";
import type { MemberGroupsGateway } from "@/lib/groups/member-groups";
import type { NewsCategory } from "@/lib/news/news-posts";
import { compareNames } from "@/lib/text/name-order";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import { SEARCH_GROUP_SIZE, SEARCH_TEXT_MIN_LENGTH } from "./search-limits";

/**
 * La búsqueda global (#425, RF-7 del PRD de E14): socios, eventos y
 * noticias, en ese orden, con hasta cinco de cada uno y el total.
 *
 * Nadie encuentra aquí nada que no vería en su sección (D3): los socios
 * pasan por `canSeeInDirectory`, los eventos por la misma visibilidad que la
 * agenda y las noticias por los filtros del feed. La coincidencia sin
 * acentos ni mayúsculas la hace la base (`0049_search.sql`, D5), y el texto
 * le llega siempre como un valor, nunca como parte de un patrón.
 */

export { SEARCH_GROUP_SIZE, SEARCH_TEXT_MIN_LENGTH };

/** Lo que sobra se ignora en vez de rechazarse: nadie escribe un nombre de
 * más de 100 caracteres, y quien pega un párrafo sigue obteniendo algo. */
export const SEARCH_TEXT_MAX_LENGTH = 100;

export type SearchTextIssue = "too_short";

export class InvalidSearchTextError extends Error {
  readonly reason: SearchTextIssue = "too_short";

  constructor() {
    super(
      `La búsqueda necesita al menos ${SEARCH_TEXT_MIN_LENGTH} caracteres.`,
    );
    this.name = "InvalidSearchTextError";
  }
}

/** Lo que coincide con el texto, recortado a `limit`, y cuántos hay. */
export type SearchMatches<Row> = {
  readonly total: number;
  readonly rows: readonly Row[];
};

export type EventMatch = {
  readonly id: string;
  readonly title: string;
  readonly startsOn: string;
  readonly startTime: string;
  readonly location: string;
  readonly eventType: EventType;
  readonly status: EventStatus;
};

/** Los próximos por inicio ascendente o los pasados por inicio descendente,
 * como la agenda, entre los que alcanzan a quien busca. */
export type EventSearchQuery = {
  readonly clubId: string;
  readonly visibility: EventVisibility;
  readonly period: AgendaPeriod;
  /** `YYYY-MM-DD` de Melbourne, como en la agenda. */
  readonly today: string;
  readonly text: string;
  readonly limit: number;
};

export type NewsMatch = {
  readonly id: string;
  readonly title: string;
  readonly category: NewsCategory;
  readonly publishedAt: string;
};

/** Las mismas reglas que el feed: lo publicado para el lector y lo suyo. */
export type NewsSearchQuery = {
  readonly clubId: string;
  readonly readerId: string;
  readonly audienceGroupIds: readonly string[];
  readonly text: string;
  readonly limit: number;
};

export type SearchGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly memberGroups: MemberGroupsGateway;
  readonly directory: {
    /** Todos los socios del club cuyo nombre coincide, sin filtrar por
     * visibilidad: esa la decide `canSeeInDirectory`. */
    findMembersMatching(
      clubId: string,
      text: string,
    ): Promise<readonly DirectoryMemberRecord[]>;
  };
  readonly positions: ClubPositionsGateway;
  readonly photos: DirectoryGateways["photos"];
  readonly events: {
    findEventsMatching(
      query: EventSearchQuery,
    ): Promise<SearchMatches<EventMatch>>;
  };
  readonly news: {
    findNewsMatching(query: NewsSearchQuery): Promise<SearchMatches<NewsMatch>>;
  };
};

export type MemberSearchResult = {
  readonly kind: "member";
  readonly userId: string;
  readonly fullName: string;
  readonly position: DirectoryPosition | null;
  /** Firmada como en el directorio (AC-032); null sin foto. */
  readonly photoUrl: string | null;
};

export type EventSearchResult = {
  readonly kind: "event";
  readonly id: string;
  readonly title: string;
  readonly startsOn: string;
  readonly startTime: string;
  readonly location: string;
  readonly eventType: EventType;
  readonly isCancelled: boolean;
};

export type NewsSearchResult = {
  readonly kind: "news";
  readonly id: string;
  readonly title: string;
  readonly category: NewsCategory;
  readonly publishedAt: string;
};

export type SearchResult =
  MemberSearchResult | EventSearchResult | NewsSearchResult;

export type SearchGroup<Result extends SearchResult> = {
  readonly total: number;
  readonly items: readonly Result[];
};

export type SearchResults = {
  readonly members: SearchGroup<MemberSearchResult>;
  readonly events: SearchGroup<EventSearchResult>;
  readonly news: SearchGroup<NewsSearchResult>;
};

export type SearchRequest = {
  readonly callerId: string;
  /** Tal como llega en `?q=`. */
  readonly text: string;
  readonly now: Date;
};

/** Postgres no admite este carácter en un `text`: llegaría como un 500. */
const NULL_CHARACTER = /\u0000/g;

/** Sin los espacios de los extremos y cortado en caracteres, no en unidades
 * de UTF-16, para no partir una letra en dos. */
function readSearchText(raw: string): string {
  const characters = [...raw.replace(NULL_CHARACTER, "").trim()];
  if (characters.length < SEARCH_TEXT_MIN_LENGTH) {
    throw new InvalidSearchTextError();
  }
  return characters.slice(0, SEARCH_TEXT_MAX_LENGTH).join("");
}

type Searcher = {
  readonly id: string;
  readonly clubId: string;
  readonly visibility: EventVisibility;
  readonly canSee: (record: DirectoryMemberRecord) => boolean;
  readonly groupIds: readonly string[];
};

async function findSearcher(
  gateways: SearchGateways,
  callerId: string,
): Promise<Searcher> {
  const [caller, groups] = await Promise.all([
    gateways.members.findRoleRequestMember(callerId),
    gateways.memberGroups.listGroupsOf(callerId),
  ]);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  const groupIds = groups.map((group) => group.id);
  return {
    id: callerId,
    clubId: caller.clubId,
    visibility: eventVisibilityFor(caller.role, groupIds),
    canSee: (record) => canSeeInDirectory(record, caller.role),
    groupIds,
  };
}

async function searchMembers(
  gateways: SearchGateways,
  searcher: Searcher,
  text: string,
): Promise<SearchGroup<MemberSearchResult>> {
  const records = await gateways.directory.findMembersMatching(
    searcher.clubId,
    text,
  );
  const visible = records.filter(searcher.canSee);
  const listed = [...visible]
    .sort((first, second) => compareNames(first.fullName, second.fullName))
    .slice(0, SEARCH_GROUP_SIZE);
  const [positions, signedPhotos] = await Promise.all([
    gateways.positions.findClubPositions(
      searcher.clubId,
      referencedPositionIds(listed),
    ),
    signListedPhotos(gateways, listed),
  ]);
  return {
    total: visible.length,
    items: listed.map((record) => ({
      kind: "member",
      userId: record.userId,
      fullName: record.fullName,
      position: directoryPositionOf(positions, record.positionId),
      photoUrl: photoUrlOf(record, signedPhotos),
    })),
  };
}

function toEventResult(match: EventMatch): EventSearchResult {
  return {
    kind: "event",
    id: match.id,
    title: match.title,
    startsOn: match.startsOn,
    startTime: match.startTime,
    location: match.location,
    eventType: match.eventType,
    isCancelled: match.status === "cancelled",
  };
}

/** Los próximos primero, que es lo que casi siempre se busca, y los pasados
 * detrás hasta llenar el grupo. */
async function searchEvents(
  gateways: SearchGateways,
  searcher: Searcher,
  request: { readonly text: string; readonly today: string },
): Promise<SearchGroup<EventSearchResult>> {
  const queryFor = (period: AgendaPeriod): EventSearchQuery => ({
    clubId: searcher.clubId,
    visibility: searcher.visibility,
    period,
    today: request.today,
    text: request.text,
    limit: SEARCH_GROUP_SIZE,
  });
  const [upcoming, past] = await Promise.all([
    gateways.events.findEventsMatching(queryFor("upcoming")),
    gateways.events.findEventsMatching(queryFor("past")),
  ]);
  return {
    total: upcoming.total + past.total,
    items: [...upcoming.rows, ...past.rows]
      .slice(0, SEARCH_GROUP_SIZE)
      .map(toEventResult),
  };
}

async function searchNews(
  gateways: SearchGateways,
  searcher: Searcher,
  text: string,
): Promise<SearchGroup<NewsSearchResult>> {
  const matches = await gateways.news.findNewsMatching({
    clubId: searcher.clubId,
    readerId: searcher.id,
    audienceGroupIds: searcher.groupIds,
    text,
    limit: SEARCH_GROUP_SIZE,
  });
  return {
    total: matches.total,
    items: matches.rows.map((match) => ({
      kind: "news",
      id: match.id,
      title: match.title,
      category: match.category,
      publishedAt: match.publishedAt,
    })),
  };
}

export async function searchClub(
  gateways: SearchGateways,
  request: SearchRequest,
): Promise<SearchResults> {
  // Antes de leer nada: un texto que no vale no le cuesta nada a la base.
  const text = readSearchText(request.text);
  const searcher = await findSearcher(gateways, request.callerId);
  const [members, events, news] = await Promise.all([
    searchMembers(gateways, searcher, text),
    searchEvents(gateways, searcher, {
      text,
      today: clubCalendarDate(request.now),
    }),
    searchNews(gateways, searcher, text),
  ]);
  return { members, events, news };
}
