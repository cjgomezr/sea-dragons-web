import type { AudienceEvent, AudiencePost } from "@/lib/groups/group-audience";
import type { RejectionReason } from "@/lib/groups/group-members";
import type { GroupUsage } from "@/lib/groups/group-overview";
import type { GroupOverview } from "@/lib/groups/groups";
import {
  formatClockTime,
  formatClubCompactDay,
  formatDashboardDay,
  formatWeekdayName,
} from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { RosterCandidate } from "./groups-client";

/**
 * Las frases de la pantalla Grupos que se arman a trozos (#828, E32): el uso
 * de un grupo, el resumen de su panel, el aviso de borrarlo (D11), las del
 * selector de añadir a varios (#829) y la fecha de lo que lo tiene de
 * audiencia (#830). Cada trozo sale del catálogo; aquí sólo se decide
 * cuáles van y en qué orden.
 */

const PART_SEPARATOR = " · ";

/** "2 events · 1 post", sin la parte que valga cero, o "Not used yet". */
export function describeUsage(
  translate: Translator,
  usage: GroupUsage,
): string {
  const parts = [
    usage.events > 0
      ? translate("groups.usage.events", { count: usage.events })
      : null,
    usage.posts > 0
      ? translate("groups.usage.posts", { count: usage.posts })
      : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0
    ? translate("groups.usage.none")
    : parts.join(PART_SEPARATOR);
}

/** "{n} members · {k} not activated · {uso}"; la parte del medio sólo cuando
 * hay alguien sin activar (RF-3). */
export function describeSummary(
  translate: Translator,
  group: GroupOverview,
  notActivatedCount: number,
): string {
  return [
    translate("groups.memberCount", { count: group.memberCount }),
    notActivatedCount > 0
      ? translate("groups.summary.notActivated", { count: notActivatedCount })
      : null,
    describeUsage(translate, group.usage),
  ]
    .filter((part): part is string => part !== null)
    .join(PART_SEPARATOR);
}

/** Qué pierde la audiencia: "2 events and 1 news post". */
function describeLostUses(translate: Translator, usage: GroupUsage): string {
  const events = translate("groups.usage.events", { count: usage.events });
  const posts = translate("groups.deleteUses.posts", { count: usage.posts });
  if (usage.posts === 0) {
    return events;
  }
  return usage.events === 0
    ? posts
    : translate("groups.deleteUses.both", { events, posts });
}

/** Quién sigue viendo lo que se queda sin grupos: el evento, el Admin y el
 * Committee; la noticia, sólo quien la publicó (lo prueba #826). */
function describeFallback(translate: Translator, usage: GroupUsage): string {
  if (usage.posts === 0) {
    return translate("groups.deleteFallback.events", { count: usage.events });
  }
  return usage.events === 0
    ? translate("groups.deleteFallback.posts", { count: usage.posts })
    : translate("groups.deleteFallback.both");
}

/** El cuerpo del aviso de borrar (D11): lo que de verdad pasa. */
export function describeDeletion(
  translate: Translator,
  group: GroupOverview,
): string {
  const { usage, memberCount } = group;
  if (usage.events === 0 && usage.posts === 0) {
    return memberCount === 0
      ? translate("groups.deleteEmptyUnused")
      : translate("groups.deleteUnused", { count: memberCount });
  }
  const used = translate("groups.deleteUsed", {
    count: usage.events + usage.posts,
    uses: describeLostUses(translate, usage),
  });
  return `${used} ${describeFallback(translate, usage)}`;
}

const WEEKDAY_SEPARATOR = ", ";

/** "Weekly · Wed 6:00 pm" para una serie, "Sat 24 Oct" para un evento suelto
 * (RF-5): la fila dice cuándo es, sin el año, igual que el inicio. */
export function describeAudienceEventDate(
  translate: Translator,
  event: AudienceEvent,
): string {
  const { locale } = translate;
  if (event.kind === "event") {
    return formatDashboardDay(locale, event.startsOn);
  }
  const days = event.weekdays
    .map((weekday) => formatWeekdayName(locale, weekday, "short"))
    .join(WEEKDAY_SEPARATOR);
  return translate("groups.audience.weekly", {
    days,
    time: formatClockTime(locale, event.startTime),
  });
}

/** "Posted 12 Oct": el día del club en que salió, sin el año. */
export function describeAudiencePostDate(
  translate: Translator,
  post: AudiencePost,
): string {
  return translate("groups.audience.posted", {
    date: formatClubCompactDay(translate.locale, new Date(post.publishedAt)),
  });
}

/** "Forward · in 2 groups" en la fila del selector, sin la parte que no se
 * sepa. Puede quedar vacía. */
export function describeCandidate(
  translate: Translator,
  candidate: RosterCandidate,
): string {
  return [
    candidate.positionName,
    candidate.groupCount === null
      ? null
      : translate("groups.picker.groupCount", { count: candidate.groupCount }),
  ]
    .filter((part): part is string => part !== null)
    .join(PART_SEPARATOR);
}

/** Quien el alta masiva dejó fuera, con el nombre que enseñaba el selector. */
export type RejectedCandidate = {
  readonly fullName: string;
  readonly reason: RejectionReason;
};

/** "Couldn't add: Bea (no longer in the club), Tomás (account deactivated)." */
export function describeRejection(
  translate: Translator,
  rejected: readonly RejectedCandidate[],
): string {
  const members = rejected
    .map(({ fullName, reason }) =>
      translate("groups.picker.rejectedMember", {
        name: fullName,
        reason: translate(`groups.picker.reason.${reason}`),
      }),
    )
    .join(", ");
  return translate("groups.picker.rejected", { members });
}
