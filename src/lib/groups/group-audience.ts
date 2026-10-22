import type { IsoWeekday } from "@/lib/events/event-occurrences";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import type { GroupScope } from "./group-members";
import {
  type PostUse,
  type SeriesSession,
  type SeriesUse,
  type StandaloneEventUse,
  isOngoingSeries,
  isPublishedPost,
  isUpcomingEvent,
} from "./group-overview";
import {
  GroupNotFoundError,
  type GroupsGateways,
  findGroupManager,
} from "./groups";

/**
 * Dónde se usa un grupo (#827, D9 del PRD de E32): la tarjeta "Audiencia de"
 * del panel. Las reglas de qué cuenta son las mismas del uso de la lista de
 * grupos (`group-overview.ts`); aquí se añade qué se enseña de cada cosa, en
 * qué orden y cuántas.
 */

/** Cuántos eventos y cuántas noticias enseña la tarjeta; del resto sólo
 * viaja el total ("+ {n} más"). */
export const GROUP_AUDIENCE_LIMIT = 5;

/** Las horas son `HH:MM` y las fechas `YYYY-MM-DD`, de pared de Melbourne. */
export type AudienceEventRecord = StandaloneEventUse & {
  readonly id: string;
  readonly title: string;
  readonly startTime: string;
};

export type AudienceSeriesRecord = SeriesUse & {
  readonly id: string;
  readonly title: string;
  readonly weekdays: readonly IsoWeekday[];
  readonly startTime: string;
};

/** `publishedAt` es un instante ISO 8601. */
export type AudiencePostRecord = PostUse & {
  readonly id: string;
  readonly title: string;
  readonly publishedAt: string;
};

/** Lo que tiene al grupo en su audiencia, sin filtrar por las reglas. */
export type GroupAudienceRecords = {
  readonly events: readonly AudienceEventRecord[];
  readonly series: readonly AudienceSeriesRecord[];
  readonly posts: readonly AudiencePostRecord[];
};

/** Que el grupo exista se lee a la vez que su audiencia: un grupo que otro
 * acaba de borrar responde 404, como en el resto de `/api/v1/groups`. */
export type GroupAudienceResult =
  | { readonly kind: "found"; readonly records: GroupAudienceRecords }
  | { readonly kind: "group_not_found" };

export type GroupAudienceGateways = Pick<GroupsGateways, "members"> & {
  readonly audience: {
    /** Puede dejar fuera lo que ya terminó antes de `today`, para no leerlo. */
    findGroupAudience(
      query: GroupScope & { readonly today: string },
    ): Promise<GroupAudienceResult>;
  };
};

/** Un evento suelto se enseña con su fecha; una serie, con sus días y su
 * próxima sesión, que es a la que enlaza y por la que se ordena. */
export type AudienceEvent =
  | {
      readonly kind: "event";
      readonly id: string;
      readonly title: string;
      readonly startsOn: string;
      readonly startTime: string;
    }
  | {
      readonly kind: "series";
      readonly id: string;
      readonly title: string;
      readonly weekdays: readonly IsoWeekday[];
      readonly startTime: string;
      readonly nextSession: SeriesSession;
    };

export type AudiencePost = {
  readonly id: string;
  readonly title: string;
  readonly publishedAt: string;
};

/** Los primeros de una lista y cuántos hay en total. */
export type AudienceSlice<Item> = {
  readonly items: readonly Item[];
  readonly total: number;
};

export type GroupAudience = {
  readonly events: AudienceSlice<AudienceEvent>;
  readonly posts: AudienceSlice<AudiencePost>;
};

function takeFirst<Item>(items: readonly Item[]): AudienceSlice<Item> {
  return { items: items.slice(0, GROUP_AUDIENCE_LIMIT), total: items.length };
}

function targets(
  use: { readonly groupIds: readonly string[] },
  groupId: string,
): boolean {
  return use.groupIds.includes(groupId);
}

/** Fecha y hora juntas: `YYYY-MM-DD HH:MM` ordena igual como texto. Una
 * serie va con la hora de la serie, que es la que enseña la tarjeta ("mié
 * 18:00"), aunque alguien haya movido la hora de su próxima sesión. */
function eventMoment(event: AudienceEvent): string {
  const startsOn =
    event.kind === "event" ? event.startsOn : event.nextSession.startsOn;
  return `${startsOn} ${event.startTime}`;
}

function selectEvents(
  records: GroupAudienceRecords,
  scope: { readonly groupId: string; readonly today: string },
): readonly AudienceEvent[] {
  const events = records.events
    .filter((event) => targets(event, scope.groupId))
    .filter((event) => isUpcomingEvent(event, scope.today))
    .map(({ id, title, startsOn, startTime }): AudienceEvent => ({
      kind: "event",
      id,
      title,
      startsOn,
      startTime,
    }));
  const series = records.series
    .filter((record) => targets(record, scope.groupId))
    .filter((record) => isOngoingSeries(record, scope.today))
    .map(({ id, title, weekdays, startTime, nextSession }): AudienceEvent => ({
      kind: "series",
      id,
      title,
      weekdays,
      startTime,
      nextSession,
    }));
  return [...events, ...series].sort((first, second) =>
    eventMoment(first).localeCompare(eventMoment(second)),
  );
}

/** De la más reciente a la más antigua, como el tablón. */
function selectPosts(
  records: GroupAudienceRecords,
  groupId: string,
): readonly AudiencePost[] {
  return records.posts
    .filter((post) => targets(post, groupId) && isPublishedPost(post))
    .map(({ id, title, publishedAt }) => ({ id, title, publishedAt }))
    .sort(
      (first, second) =>
        Date.parse(second.publishedAt) - Date.parse(first.publishedAt),
    );
}

/** Los eventos y las noticias que tienen al grupo en su audiencia ahora,
 * hasta cinco de cada uno con su total. */
export async function listGroupAudience(
  gateways: GroupAudienceGateways,
  request: {
    readonly callerId: string;
    readonly groupId: string;
    readonly now: Date;
  },
): Promise<GroupAudience> {
  const caller = await findGroupManager(gateways, request.callerId);
  const today = clubCalendarDate(request.now);
  const result = await gateways.audience.findGroupAudience({
    clubId: caller.clubId,
    groupId: request.groupId,
    today,
  });
  if (result.kind === "group_not_found") {
    throw new GroupNotFoundError();
  }
  return {
    events: takeFirst(
      selectEvents(result.records, { groupId: request.groupId, today }),
    ),
    posts: takeFirst(selectPosts(result.records, request.groupId)),
  };
}
