import { NEWS_TITLE_MAX_LENGTH, type NewsDraft } from "./news-posts";

/**
 * Lo que el formulario de publicar (#330) comprueba antes de mandar nada, con
 * la misma regla que el servidor aplica en `prepareNewsPost` (#327). El
 * servidor sigue siendo quien decide: esto sólo adelanta el aviso para
 * enseñarlo junto a su campo.
 */

export type NewsDraftInput = Omit<NewsDraft, "category">;

export type NewsDraftField = "title" | "body" | "audience";

export type NewsDraftIssueCode =
  "title_missing" | "title_too_long" | "body_missing" | "audience_groups_empty";

export type NewsDraftIssue = {
  readonly field: NewsDraftField;
  readonly code: NewsDraftIssueCode;
};

const NON_BLANK = /\S/;

/** Contado en caracteres y recortado, como `char_length(btrim(title))`. */
function titleIssue(title: string): NewsDraftIssueCode | null {
  const length = [...title.trim()].length;
  if (length === 0) {
    return "title_missing";
  }
  return length > NEWS_TITLE_MAX_LENGTH ? "title_too_long" : null;
}

/** Los avisos del borrador, en el orden en que se leen los campos. */
export function listNewsDraftIssues(
  draft: NewsDraftInput,
): readonly NewsDraftIssue[] {
  const title = titleIssue(draft.title);
  return [
    ...(title === null ? [] : [{ field: "title", code: title } as const]),
    ...(NON_BLANK.test(draft.body)
      ? []
      : [{ field: "body", code: "body_missing" } as const]),
    ...(draft.audience.kind === "groups" && draft.audience.groupIds.length === 0
      ? [{ field: "audience", code: "audience_groups_empty" } as const]
      : []),
  ];
}
