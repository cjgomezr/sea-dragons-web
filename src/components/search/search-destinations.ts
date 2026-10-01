import type { Role } from "@/lib/auth/roles";
import { hasCapability } from "@/lib/auth/roles";
import {
  ACCOUNT_PAGE_PATH,
  CALENDAR_EVENT_QUERY_PARAM,
  CALENDAR_PATH,
  CALENDAR_PERIOD_QUERY_PARAM,
  DIRECTORY_PATH,
  MEMBER_RECORD_PATH,
  NEWS_PATH,
  NEWS_POST_PATH,
} from "@/lib/auth/routes";
import { SEARCH_QUERY_PARAM } from "@/lib/directory/directory-query";
import type {
  EventSearchResult,
  MemberSearchResult,
  SearchResult,
  SearchResults,
} from "@/lib/search/search";
import { clubCalendarDate } from "@/lib/time/club-calendar";

/**
 * A dónde lleva cada cosa que encuentra la búsqueda global (#427, RF-8 del
 * PRD de E14). Reutiliza las pantallas que ya existen: ninguna se abre sólo
 * para la búsqueda.
 */

/** Quién busca: decide a dónde lleva un socio. Lo lee el servidor. */
export type SearchViewer = {
  readonly userId: string;
  readonly role: Role;
};

export type SearchGroupKey = keyof SearchResults;

function directoryFilteredBy(text: string): string {
  return `${DIRECTORY_PATH}?${SEARCH_QUERY_PARAM}=${encodeURIComponent(text)}`;
}

/** Uno mismo, a su perfil; quien abre fichas (Admin), a la ficha; el resto,
 * al directorio con el nombre puesto, que es lo que ve de los demás. */
function memberDestination(
  member: MemberSearchResult,
  viewer: SearchViewer,
): string {
  if (member.userId === viewer.userId) {
    return ACCOUNT_PAGE_PATH;
  }
  return hasCapability(viewer.role, "manageUsersAndRoles")
    ? MEMBER_RECORD_PATH.replace("[id]", member.userId)
    : directoryFilteredBy(member.fullName);
}

/** El calendario separa próximos de pasados, y desde hoy todo es próximo,
 * como en la agenda: la fila hay que buscarla en su lado. */
function eventDestination(event: EventSearchResult, now: Date): string {
  const target = `${CALENDAR_PATH}?${CALENDAR_EVENT_QUERY_PARAM}=${event.id}`;
  return event.startsOn < clubCalendarDate(now)
    ? `${target}&${CALENDAR_PERIOD_QUERY_PARAM}=past`
    : target;
}

export function searchResultDestination(
  result: SearchResult,
  viewer: SearchViewer,
  now: Date,
): string {
  switch (result.kind) {
    case "member":
      return memberDestination(result, viewer);
    case "event":
      return eventDestination(result, now);
    case "news":
      return NEWS_POST_PATH.replace("[id]", result.id);
  }
}

/** "Ver todos": el directorio con el texto ya en su búsqueda; el calendario y
 * Noticias no tienen buscador, así que se abren tal cual. */
export function seeAllDestination(group: SearchGroupKey, text: string): string {
  switch (group) {
    case "members":
      return directoryFilteredBy(text);
    case "events":
      return CALENDAR_PATH;
    case "news":
      return NEWS_PATH;
  }
}
