import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import { normalizeForSearch } from "@/lib/text/name-search";

/**
 * El buscador de destinatarios del correo (#858, RF-3 y D8 del PRD de E33).
 * Ofrece sólo a quien el envío acepta, que son los socios activos, y nunca a
 * quien ya está en la lista. La coincidencia no mira mayúsculas ni acentos.
 */

export const RECIPIENT_SUGGESTION_LIMIT = 6;

export type RecipientCandidate = {
  readonly userId: string;
  readonly fullName: string;
  readonly role: Role;
  readonly status: AccountStatus;
};

/** Un trozo del nombre tal como se escribió, marcado si es lo buscado. */
export type NamePart = {
  readonly text: string;
  readonly isMatch: boolean;
};

export type RecipientSuggestion = {
  readonly candidate: RecipientCandidate;
  readonly parts: readonly NamePart[];
};

export type RecipientSearchResult =
  | { readonly kind: "empty" }
  | {
      readonly kind: "matches";
      readonly suggestions: readonly RecipientSuggestion[];
    }
  | { readonly kind: "noMatch" }
  | { readonly kind: "allAlreadyAdded" };

type CharacterSpan = { readonly start: number; readonly end: number };

/** El nombre sin mayúsculas ni acentos, y de qué letra original sale cada
 * letra: así la parte encontrada se marca sobre el nombre escrito. */
function foldWithSpans(fullName: string): {
  readonly folded: string;
  readonly spans: readonly CharacterSpan[];
} {
  const spans: CharacterSpan[] = [];
  let folded = "";
  let start = 0;
  for (const character of fullName) {
    const foldedCharacter = normalizeForSearch(character);
    const span = { start, end: start + character.length };
    folded += foldedCharacter;
    spans.push(...Array.from(foldedCharacter, () => span));
    start = span.end;
  }
  return { folded, spans };
}

function splitAtMatch(
  fullName: string,
  foldedQuery: string,
): readonly NamePart[] | null {
  const { folded, spans } = foldWithSpans(fullName);
  const index = folded.indexOf(foldedQuery);
  if (index === -1) {
    return null;
  }
  const first = spans[index];
  const last = spans[index + foldedQuery.length - 1];
  if (first === undefined || last === undefined) {
    return null;
  }
  return [
    { text: fullName.slice(0, first.start), isMatch: false },
    { text: fullName.slice(first.start, last.end), isMatch: true },
    { text: fullName.slice(last.end), isMatch: false },
  ].filter((part) => part.text !== "");
}

export function searchRecipients({
  candidates,
  recipientIds,
  query,
}: {
  readonly candidates: readonly RecipientCandidate[];
  readonly recipientIds: readonly string[];
  readonly query: string;
}): RecipientSearchResult {
  const foldedQuery = normalizeForSearch(query.trim());
  if (foldedQuery === "") {
    return { kind: "empty" };
  }
  const matches = candidates.flatMap((candidate) => {
    if (candidate.status !== "active") {
      return [];
    }
    const parts = splitAtMatch(candidate.fullName, foldedQuery);
    return parts === null ? [] : [{ candidate, parts }];
  });
  if (matches.length === 0) {
    return { kind: "noMatch" };
  }
  const listed = new Set(recipientIds);
  const suggestions = matches
    .filter((match) => !listed.has(match.candidate.userId))
    .slice(0, RECIPIENT_SUGGESTION_LIMIT);
  return suggestions.length === 0
    ? { kind: "allAlreadyAdded" }
    : { kind: "matches", suggestions };
}
