"use client";

import { useEffect, useState } from "react";
import { ModalDialog } from "@/components/ModalDialog";
import type { Translator } from "@/lib/i18n/translator";
import {
  type QuotaOutcome,
  loadDirectoryEmailQuota,
} from "./directory-email-client";

/**
 * El paso antes de mandar el correo del directorio (#501): a cuántos socios
 * va y cuántos correos le quedan hoy al directorio. Nada sale hasta que se
 * confirma aquí.
 *
 * El cupo se lee al abrir y es sólo informativo: quien decide si cabe es el
 * servidor al enviar, que es el único que ve los envíos de los demás.
 */

type QuotaState = { readonly kind: "loading" } | QuotaOutcome;

function RemainingQuota({
  translate,
  quota,
}: {
  readonly translate: Translator;
  readonly quota: QuotaState;
}): React.JSX.Element {
  switch (quota.kind) {
    case "loading":
      return <p>{translate("directory.email.confirm.loadingQuota")}</p>;
    case "loaded":
      return (
        <p>
          {translate("directory.email.confirm.remaining", {
            count: quota.quota.remaining,
          })}
        </p>
      );
    case "failed":
      return <p>{translate("directory.email.confirm.quotaUnknown")}</p>;
  }
}

export function DirectoryEmailConfirmDialog({
  translate,
  recipientCount,
  isSending,
  onConfirm,
  onClosed,
}: {
  readonly translate: Translator;
  readonly recipientCount: number;
  readonly isSending: boolean;
  readonly onConfirm: () => void;
  readonly onClosed: () => void;
}): React.JSX.Element {
  const [quota, setQuota] = useState<QuotaState>({ kind: "loading" });

  useEffect(() => {
    let isCurrent = true;
    void loadDirectoryEmailQuota().then((outcome) => {
      if (isCurrent) {
        setQuota(outcome);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onConfirm();
  }

  return (
    <ModalDialog
      title={translate("directory.email.confirm.title")}
      isSending={isSending}
      onClosed={onClosed}
    >
      <form className="event-form" onSubmit={submit}>
        <div className="directory-email-confirm" aria-live="polite">
          <p>
            {translate("directory.email.confirm.recipients", {
              count: recipientCount,
            })}
          </p>
          <RemainingQuota translate={translate} quota={quota} />
        </div>
        <div className="event-form-actions">
          <button
            type="button"
            className="admin-secondary"
            disabled={isSending}
            onClick={onClosed}
          >
            {translate("directory.email.confirm.cancel")}
          </button>
          <button type="submit" className="auth-submit" disabled={isSending}>
            {isSending
              ? translate("directory.email.confirm.sending")
              : translate("directory.email.confirm.send")}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
