import type { AccountStatus } from "@/lib/auth/account-status";
import type { EventStatus } from "@/lib/events/event-agenda";
import type { NewsPostStatus } from "@/lib/news/news-posts";
import { compareNames } from "@/lib/text/name-order";

/**
 * Lo que la lista de grupos de E32 enseña de cada uno además de su nombre y
 * su conteo (#826, D4 del PRD): dónde se usa y a tres de sus miembros. Las
 * reglas viven aquí, contadas sin Supabase delante; el adaptador sólo trae
 * los hechos.
 */

/** Los miembros que enseña la vista previa de cada grupo (D4). */
export const GROUP_PREVIEW_SIZE = 3;

const ACTIVE_STATUS: AccountStatus = "active";

/** Cuántos eventos y noticias tienen al grupo en su audiencia ahora. Sin
 * tope: el aviso de borrar (D11) dice los números enteros. */
export type GroupUsage = { readonly events: number; readonly posts: number };

/** Un miembro de la vista previa: lo justo para pintar su avatar. */
export type GroupPreviewMember = {
  readonly id: string;
  readonly fullName: string;
  readonly photoUrl: string | null;
};

/** Un evento suelto, sin serie: las ocurrencias de una serie cuentan una vez,
 * como su serie. Las fechas son `YYYY-MM-DD` de Melbourne. */
export type StandaloneEventUse = {
  readonly groupIds: readonly string[];
  readonly startsOn: string;
  readonly status: EventStatus;
};

/** Cancelar una serie cancela sus sesiones y no la marca a ella, así que
 * sigue en pie mientras le quede alguna sesión programada de hoy en
 * adelante. */
export type SeriesUse = {
  readonly groupIds: readonly string[];
  readonly endsOn: string;
  readonly hasSessionsLeft: boolean;
};

export type PostUse = {
  readonly groupIds: readonly string[];
  readonly status: NewsPostStatus;
};

/** Lo que tiene a algún grupo del club en su audiencia. */
export type GroupAudienceUses = {
  readonly events: readonly StandaloneEventUse[];
  readonly series: readonly SeriesUse[];
  readonly posts: readonly PostUse[];
};

/** Una pertenencia con lo que la vista previa necesita de su socio. */
export type GroupMembershipRecord = {
  readonly groupId: string;
  readonly member: {
    readonly id: string;
    readonly fullName: string;
    readonly accountStatus: AccountStatus;
    readonly photoPath: string | null;
  };
};

export type GroupPreviewRecord = GroupMembershipRecord["member"];

function isUpcomingEvent(event: StandaloneEventUse, today: string): boolean {
  return event.status === "scheduled" && event.startsOn >= today;
}

function isOngoingSeries(series: SeriesUse, today: string): boolean {
  return series.hasSessionsLeft && series.endsOn >= today;
}

function isPublishedPost(post: PostUse): boolean {
  return post.status === "published";
}

function tallyGroups(
  uses: readonly { readonly groupIds: readonly string[] }[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const groupId of uses.flatMap(({ groupIds }) => groupIds)) {
    counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
  }
  return counts;
}

/** El uso de cada grupo que tiene alguno, por id: los eventos sueltos
 * programados de hoy en adelante, las series sin terminar ni cancelar y las
 * noticias publicadas (D4, con la regla de D9). El grupo sin uso no está. */
export function countGroupUsage(
  uses: GroupAudienceUses,
  today: string,
): ReadonlyMap<string, GroupUsage> {
  const events = tallyGroups([
    ...uses.events.filter((event) => isUpcomingEvent(event, today)),
    ...uses.series.filter((series) => isOngoingSeries(series, today)),
  ]);
  const posts = tallyGroups(uses.posts.filter(isPublishedPost));
  const groupIds = new Set([...events.keys(), ...posts.keys()]);
  return new Map(
    [...groupIds].map((groupId) => [
      groupId,
      { events: events.get(groupId) ?? 0, posts: posts.get(groupId) ?? 0 },
    ]),
  );
}

/** Los tres primeros miembros activos del grupo en orden de nombre. Los
 * pendientes de activar y los dados de baja siguen asignados, pero no
 * cuentan (D1), y por eso tampoco salen. */
export function pickPreviewMembers(
  memberships: readonly GroupMembershipRecord[],
  groupId: string,
): readonly GroupPreviewRecord[] {
  return memberships
    .filter(
      (membership) =>
        membership.groupId === groupId &&
        membership.member.accountStatus === ACTIVE_STATUS,
    )
    .map(({ member }) => member)
    .sort((first, second) => compareNames(first.fullName, second.fullName))
    .slice(0, GROUP_PREVIEW_SIZE);
}
