"use client";

import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { useEffect, useId, useRef } from "react";
import { useClubName } from "@/components/club/ClubNameProvider";
import { Icon } from "@/components/Icon";
import type { DirectoryEmailQuota } from "@/lib/directory/directory-email-rules";
import type { Translator } from "@/lib/i18n/translator";
import type { EmailRecipient } from "./DirectoryEmailComposer";
import { type QuotaState, isQuotaLow } from "./use-directory-email-quota";

/**
 * El paso antes de mandar el correo del directorio (#501, rediseñado en #859,
 * RF-5 del PRD de E33): a quién va, con qué asunto y cuántos correos quedan
 * hoy antes y después. Nada sale hasta que se confirma aquí.
 *
 * El cupo es el que el redactor leyó al abrirse, y sólo informa: quien decide
 * si cabe es el servidor al enviar. Un `<dialog>` modal trae el rol, la capa
 * modal y lo que queda detrás inerte; mientras manda no se cierra con Escape,
 * porque lo que el servidor responda tiene que verse.
 */

function QuotaNote({
  translate,
  quota,
  after,
}: {
  readonly translate: Translator;
  readonly quota: DirectoryEmailQuota;
  readonly after: number;
}): React.JSX.Element {
  if (after === 0) {
    return <p>{translate("directory.email.confirm.noteLast")}</p>;
  }
  return (
    <p>
      {isQuotaLow(after)
        ? translate("directory.email.confirm.noteLow", { count: after })
        : translate("directory.email.confirm.noteResets", {
            limit: quota.limit,
          })}
    </p>
  );
}

/** Antes y después, y una barra partida: lo que queda en verde y lo que
 * gasta este envío en el acento. */
function QuotaChange({
  translate,
  quota,
  recipientCount,
}: {
  readonly translate: Translator;
  readonly quota: DirectoryEmailQuota;
  readonly recipientCount: number;
}): React.JSX.Element {
  const after = Math.max(quota.remaining - recipientCount, 0);
  return (
    <div className="directory-email-dialog-quota">
      <p className="directory-email-dialog-quota-row">
        <span>{translate("directory.email.confirm.quotaLabel")}</span>{" "}
        <span>
          <strong>
            {quota.remaining} → {after}
          </strong>{" "}
          {translate("directory.email.confirm.quotaOf", {
            limit: quota.limit,
          })}
        </span>
      </p>
      <div className="directory-email-dialog-quota-bar" aria-hidden="true">
        <span style={{ flexGrow: after }} />
        <span style={{ flexGrow: quota.remaining - after }} />
        <span style={{ flexGrow: quota.limit - quota.remaining }} />
      </div>
      <QuotaNote translate={translate} quota={quota} after={after} />
    </div>
  );
}

function QuotaSummary({
  translate,
  quota,
  recipientCount,
}: {
  readonly translate: Translator;
  readonly quota: QuotaState;
  readonly recipientCount: number;
}): React.JSX.Element {
  switch (quota.kind) {
    case "loading":
      return <p>{translate("directory.email.quota.loading")}</p>;
    case "failed":
      return <p>{translate("directory.email.confirm.quotaUnknown")}</p>;
    case "loaded":
      return (
        <QuotaChange
          translate={translate}
          quota={quota.quota}
          recipientCount={recipientCount}
        />
      );
  }
}

function dialogTitle(
  translate: Translator,
  recipients: readonly EmailRecipient[],
): string {
  const [onlyRecipient] = recipients;
  return recipients.length === 1 && onlyRecipient !== undefined
    ? translate("directory.email.confirm.titleOne", {
        name: onlyRecipient.fullName,
      })
    : translate("directory.email.confirm.title", {
        count: recipients.length,
      });
}

function ConfirmActions({
  translate,
  recipientCount,
  isSending,
  onCancel,
}: {
  readonly translate: Translator;
  readonly recipientCount: number;
  readonly isSending: boolean;
  readonly onCancel: () => void;
}): React.JSX.Element {
  return (
    <div className="directory-email-dialog-actions">
      <button
        type="button"
        className="admin-secondary"
        disabled={isSending}
        onClick={onCancel}
      >
        {translate("directory.email.confirm.cancel")}
      </button>
      <button type="submit" className="auth-submit" disabled={isSending}>
        {isSending ? (
          <>
            <span className="directory-email-spinner" aria-hidden="true" />
            {translate("directory.email.confirm.sending")}
          </>
        ) : (
          translate("directory.email.confirm.send", { count: recipientCount })
        )}
      </button>
    </div>
  );
}

export function DirectoryEmailConfirmDialog({
  translate,
  recipients,
  subject,
  quota,
  isSending,
  onConfirm,
  onClosed,
}: {
  readonly translate: Translator;
  readonly recipients: readonly EmailRecipient[];
  readonly subject: string;
  readonly quota: QuotaState;
  readonly isSending: boolean;
  readonly onConfirm: () => void;
  /** Ya cerrado: quien lo abrió lo desmonta. */
  readonly onClosed: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const clubName = useClubName();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onConfirm();
  }

  return (
    <dialog
      ref={dialogRef}
      className="event-dialog directory-email-dialog"
      aria-labelledby={titleId}
      aria-modal="true"
      onClose={onClosed}
      onCancel={(event) => {
        if (isSending) {
          event.preventDefault();
        }
      }}
    >
      <form className="event-dialog-panel" onSubmit={submit}>
        <div className="directory-email-dialog-header">
          <span className="directory-email-header-icon" aria-hidden="true">
            <Icon glyph={PaperPlaneTilt} />
          </span>
          <h2 id={titleId}>{dialogTitle(translate, recipients)}</h2>
        </div>
        <div className="directory-email-dialog-body" aria-live="polite">
          <p>
            {translate("directory.email.confirm.lead", {
              count: recipients.length,
              club: clubName,
            })}{" "}
            <strong>“{subject}”</strong>.{" "}
            {translate("directory.email.confirm.replies")}
          </p>
          <QuotaSummary
            translate={translate}
            quota={quota}
            recipientCount={recipients.length}
          />
        </div>
        <ConfirmActions
          translate={translate}
          recipientCount={recipients.length}
          isSending={isSending}
          onCancel={onClosed}
        />
      </form>
    </dialog>
  );
}
