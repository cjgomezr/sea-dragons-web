"use client";

import { Info } from "@phosphor-icons/react/dist/ssr/Info";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { memberInitials } from "@/lib/auth/member-initials";
import type { Translator } from "@/lib/i18n/translator";
import type { ComposerLayout, EmailRecipient } from "./DirectoryEmailComposer";
import { RecipientSearch } from "./RecipientSearch";
import { useRecipientCandidates } from "./use-recipient-candidates";

/**
 * El "Para" del correo (#858, RF-2 y D10 del PRD de E33): una caja con una
 * ficha por destinatario y el buscador, que saltan de línea juntos. Desde
 * Grupos llegan veinte o más, así que una lista larga se pliega.
 *
 * En el móvil (#860) se pliega antes, y el buscador va debajo de la caja, con
 * los resultados en línea.
 */

/** Cuántas fichas se ven plegada la lista. Sólo se pliega con dos o más
 * de más: esconder una sola detrás de "+1 más" no ahorra sitio. */
const FOLDED_VISIBLE_COUNT: Readonly<Record<ComposerLayout, number>> = {
  desktop: 10,
  phone: 6,
};
/** "Quitar todos" sólo cuando hay más de uno: con uno basta su ×. */
const CLEAR_ALL_MIN_COUNT = 2;

function RecipientChip({
  translate,
  recipient,
  onRemove,
}: {
  readonly translate: Translator;
  readonly recipient: EmailRecipient;
  readonly onRemove: () => void;
}): React.JSX.Element {
  return (
    <li className="directory-email-chip">
      <span className="directory-email-avatar" aria-hidden="true">
        {memberInitials(recipient.fullName)}
      </span>
      <span className="directory-email-chip-name" title={recipient.fullName}>
        {recipient.fullName}
      </span>
      <button
        type="button"
        className="directory-email-chip-remove"
        aria-label={translate("directory.email.remove", {
          name: recipient.fullName,
        })}
        onClick={onRemove}
      >
        <Icon glyph={X} />
      </button>
    </li>
  );
}

function FoldToggle({
  translate,
  total,
  visibleCount,
  isExpanded,
  onToggle,
}: {
  readonly translate: Translator;
  readonly total: number;
  readonly visibleCount: number;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element {
  if (isExpanded) {
    return (
      <button
        type="button"
        className="directory-email-text-button"
        onClick={onToggle}
      >
        {translate("directory.email.showLess")}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="directory-email-more"
      aria-label={translate("directory.email.showAll", { count: total })}
      onClick={onToggle}
    >
      {translate("directory.email.hiddenCount", {
        count: total - visibleCount,
      })}
    </button>
  );
}

function CandidatesFailure({
  translate,
  onRetry,
}: {
  readonly translate: Translator;
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="directory-email-search-failure" role="alert">
      <p>{translate("directory.email.search.failed")}</p>
      <button type="button" className="admin-secondary" onClick={onRetry}>
        {translate("directory.email.search.retry")}
      </button>
    </div>
  );
}

export function DirectoryEmailRecipients({
  translate,
  layout,
  recipients,
  onChange,
}: {
  readonly translate: Translator;
  readonly layout: ComposerLayout;
  readonly recipients: readonly EmailRecipient[];
  readonly onChange: (recipients: readonly EmailRecipient[]) => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const { load, requestOnce, retry } = useRecipientCandidates();
  const visibleCount = FOLDED_VISIBLE_COUNT[layout];
  const isFoldable = recipients.length > visibleCount + 1;
  const visible =
    isFoldable && !isExpanded ? recipients.slice(0, visibleCount) : recipients;
  const search = (
    <RecipientSearch
      translate={translate}
      inputRef={inputRef}
      placement={layout === "phone" ? "inline" : "popover"}
      recipients={recipients}
      load={load}
      onFirstFocus={requestOnce}
      onAdd={(recipient) => onChange([...recipients, recipient])}
      onRemoveLast={() => onChange(recipients.slice(0, -1))}
    />
  );

  function remove(userId: string): void {
    onChange(recipients.filter((recipient) => recipient.userId !== userId));
  }

  /** Un clic en la caja, fuera de una ficha o un botón, es para escribir. */
  function focusSearch(event: React.MouseEvent<HTMLDivElement>): void {
    const target = event.target;
    if (target instanceof Element && target.closest("li, button, input")) {
      return;
    }
    inputRef.current?.focus();
  }

  return (
    <div className="directory-email-recipients">
      <div className="directory-email-label-row">
        <span className="directory-email-label">
          {translate("directory.email.to", { count: recipients.length })}
        </span>
        {recipients.length >= CLEAR_ALL_MIN_COUNT ? (
          <button
            type="button"
            className="directory-email-text-button"
            onClick={() => onChange([])}
          >
            {translate("directory.email.clearAll")}
          </button>
        ) : null}
      </div>
      {/* El clic sólo acerca el foco al campo, que ya se alcanza con el
          teclado: no hace falta un equivalente de teclado. */}
      <div className="directory-email-to-box" onClick={focusSearch}>
        <ul
          aria-label={translate("directory.email.recipients", {
            count: recipients.length,
          })}
        >
          {visible.map((recipient) => (
            <RecipientChip
              key={recipient.userId}
              translate={translate}
              recipient={recipient}
              onRemove={() => remove(recipient.userId)}
            />
          ))}
        </ul>
        {isFoldable ? (
          <FoldToggle
            translate={translate}
            total={recipients.length}
            visibleCount={visibleCount}
            isExpanded={isExpanded}
            onToggle={() => setIsExpanded((current) => !current)}
          />
        ) : null}
        {layout === "desktop" ? search : null}
      </div>
      {layout === "phone" ? search : null}
      {recipients.length === 0 ? (
        <p className="directory-email-empty">
          <Icon glyph={Info} />
          {translate("directory.email.noRecipients")}
        </p>
      ) : null}
      {load.kind === "failed" ? (
        <CandidatesFailure translate={translate} onRetry={retry} />
      ) : null}
    </div>
  );
}
