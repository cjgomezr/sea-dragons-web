import type { AudienceChoice } from "@/components/AudienceField";
import type { EditableNewsPost } from "@/lib/news/news-management";
import type { NewsCategory } from "@/lib/news/news-posts";

/**
 * Lo que se escribe en el formulario de publicar y editar. Saber si cambió
 * desde que se abrió es lo que decide si Cancelar pregunta antes de salir
 * (#602): escribir y borrar lo escrito no cuenta como cambio.
 */

export type NewsFormDraft = {
  readonly category: NewsCategory;
  readonly title: string;
  readonly body: string;
  readonly audience: AudienceChoice;
};

export const EMPTY_NEWS_FORM_DRAFT: NewsFormDraft = {
  category: "news",
  title: "",
  body: "",
  audience: { kind: "club", groupIds: new Set() },
};

export function newsFormDraftOf(post: EditableNewsPost): NewsFormDraft {
  return {
    category: post.category,
    title: post.title,
    body: post.body,
    audience: {
      kind: post.audience.kind,
      groupIds: new Set(
        post.audience.kind === "groups" ? post.audience.groupIds : [],
      ),
    },
  };
}

/** Con todo el club, los grupos que quedaron marcados no se mandan. */
function isSameAudience(
  first: AudienceChoice,
  second: AudienceChoice,
): boolean {
  if (first.kind !== second.kind) {
    return false;
  }
  return (
    first.kind === "club" ||
    (first.groupIds.size === second.groupIds.size &&
      [...first.groupIds].every((groupId) => second.groupIds.has(groupId)))
  );
}

export function isSameNewsFormDraft(
  first: NewsFormDraft,
  second: NewsFormDraft,
): boolean {
  return (
    first.category === second.category &&
    first.title === second.title &&
    first.body === second.body &&
    isSameAudience(first.audience, second.audience)
  );
}
