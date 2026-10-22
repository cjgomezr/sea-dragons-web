import type { GroupUsage } from "@/lib/groups/group-overview";
import type { GroupOverview } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Las frases de la pantalla Grupos que se arman a trozos (#828, E32): el uso
 * de un grupo, el resumen de su panel y el aviso de borrarlo (D11). Cada trozo
 * sale del catálogo; aquí sólo se decide cuáles van y en qué orden.
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
