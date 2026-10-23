"use client";

import { UserPlus } from "@phosphor-icons/react/dist/ssr/UserPlus";
import { Fragment, useId, useState } from "react";
import { Icon } from "@/components/Icon";
import { memberInitials } from "@/lib/auth/member-initials";
import {
  type RecipientCandidate,
  type RecipientSearchResult,
  type RecipientSuggestion,
  searchRecipients,
} from "@/lib/directory/recipient-search";
import type { Translator } from "@/lib/i18n/translator";
import type { EmailRecipient } from "./DirectoryEmailComposer";
import type { CandidatesLoad } from "./use-recipient-candidates";

/**
 * El campo "Añadir un socio por su nombre" del correo (#858, RF-3 del PRD
 * de E33): un combobox con su listbox debajo. ↑ y ↓ mueven, Enter añade,
 * Esc vacía la búsqueda y Retroceso con el campo vacío quita la última
 * ficha. Al añadir, el foco se queda en el campo para seguir escribiendo.
 */

const NO_RESULTS: RecipientSearchResult = { kind: "empty" };

/** Lo que dice el desplegable cuando no hay opciones que enseñar. */
function describeEmptyResult(
  translate: Translator,
  load: CandidatesLoad,
  result: RecipientSearchResult,
  query: string,
): string | null {
  if (load.kind === "idle" || load.kind === "loading") {
    return translate("directory.email.search.loading");
  }
  if (result.kind === "noMatch") {
    return translate("directory.email.search.noMatch", { query });
  }
  if (result.kind === "allAlreadyAdded") {
    return translate("directory.email.search.allAdded", { query });
  }
  return null;
}

function SuggestionOption({
  translate,
  id,
  suggestion,
  isHighlighted,
  onAdd,
}: {
  readonly translate: Translator;
  readonly id: string;
  readonly suggestion: RecipientSuggestion;
  readonly isHighlighted: boolean;
  readonly onAdd: (candidate: RecipientCandidate) => void;
}): React.JSX.Element {
  const { candidate, parts } = suggestion;
  return (
    // El teclado lo maneja el combobox (aria-activedescendant): la opción
    // sólo atiende al ratón, y sin robarle el foco al campo.

    <li
      id={id}
      role="option"
      aria-selected={isHighlighted}
      className="directory-email-option"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onAdd(candidate)}
    >
      <span className="directory-email-avatar" aria-hidden="true">
        {memberInitials(candidate.fullName)}
      </span>
      <span className="directory-email-option-text">
        <span className="directory-email-option-name">
          {parts.map((part, index) =>
            part.isMatch ? (
              <strong key={index}>{part.text}</strong>
            ) : (
              <Fragment key={index}>{part.text}</Fragment>
            ),
          )}
        </span>
        <span className="directory-email-option-meta">
          {translate(`role.${candidate.role}`)}
        </span>
      </span>
      <span className="directory-email-option-hint" aria-hidden="true">
        {translate(
          isHighlighted
            ? "directory.email.search.enterHint"
            : "directory.email.search.add",
        )}
      </span>
    </li>
  );
}

export function RecipientSearch({
  translate,
  inputRef,
  recipients,
  load,
  onFirstFocus,
  onAdd,
  onRemoveLast,
}: {
  readonly translate: Translator;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly recipients: readonly EmailRecipient[];
  readonly load: CandidatesLoad;
  readonly onFirstFocus: () => void;
  readonly onAdd: (recipient: EmailRecipient) => void;
  readonly onRemoveLast: () => void;
}): React.JSX.Element {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const result =
    load.kind === "loaded"
      ? searchRecipients({
          candidates: load.candidates,
          recipientIds: recipients.map((recipient) => recipient.userId),
          query,
        })
      : NO_RESULTS;
  const suggestions = result.kind === "matches" ? result.suggestions : [];
  const highlightedIndex = Math.min(highlighted, suggestions.length - 1);
  const isOpen = isFocused && query.trim() !== "" && load.kind !== "failed";
  const isExpanded = isOpen && suggestions.length > 0;
  const optionId = (index: number): string => `${listboxId}-${index}`;

  function changeQuery(next: string): void {
    setQuery(next);
    setHighlighted(0);
  }

  function add(candidate: RecipientCandidate): void {
    onAdd({ userId: candidate.userId, fullName: candidate.fullName });
    changeQuery("");
    inputRef.current?.focus();
  }

  function moveHighlight(step: number): void {
    const count = suggestions.length;
    setHighlighted((highlightedIndex + step + count) % count);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      // Enter añade; nunca envía el formulario a medio escribir.
      event.preventDefault();
      const suggestion = suggestions[highlightedIndex];
      if (isExpanded && suggestion !== undefined) {
        add(suggestion.candidate);
      }
      return;
    }
    if (event.key === "Escape") {
      changeQuery("");
      return;
    }
    if (event.key === "Backspace" && query === "") {
      onRemoveLast();
      return;
    }
    if (isExpanded && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
    }
  }

  const emptyMessage = isOpen
    ? describeEmptyResult(translate, load, result, query.trim())
    : null;

  return (
    <div className="directory-email-search">
      <span className="directory-email-search-icon">
        <Icon glyph={UserPlus} />
      </span>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-label={translate("directory.email.search.label")}
        placeholder={translate("directory.email.search.label")}
        aria-autocomplete="list"
        aria-expanded={isExpanded}
        aria-controls={listboxId}
        aria-activedescendant={
          isExpanded ? optionId(highlightedIndex) : undefined
        }
        value={query}
        onChange={(event) => changeQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          setIsFocused(true);
          onFirstFocus();
        }}
        onBlur={() => setIsFocused(false)}
      />
      <div className="directory-email-search-popover" hidden={!isOpen}>
        <ul
          id={listboxId}
          role="listbox"
          aria-label={translate("directory.email.search.label")}
          hidden={!isExpanded}
        >
          {suggestions.map((suggestion, index) => (
            <SuggestionOption
              key={suggestion.candidate.userId}
              translate={translate}
              id={optionId(index)}
              suggestion={suggestion}
              isHighlighted={index === highlightedIndex}
              onAdd={add}
            />
          ))}
        </ul>
        {emptyMessage === null ? null : (
          <p className="directory-email-search-empty" role="status">
            {emptyMessage}
          </p>
        )}
        {isExpanded ? (
          <p className="directory-email-search-keys" aria-hidden="true">
            {translate("directory.email.search.keys")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
