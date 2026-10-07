"use client";

import { useRef, useState } from "react";
import { ModalDialog } from "@/components/ModalDialog";
import type { Translator } from "@/lib/i18n/translator";
import {
  type MembershipWaiverChange,
  WAIVER_REASON_MAX_LENGTH,
} from "@/lib/membership/membership-waiver";
import {
  type MembershipWaiverOutcome,
  describeMembershipWaiverFailure,
  removeMembershipWaiver,
  submitMembershipWaiver,
} from "./membership-waiver-client";

/**
 * Los dos diálogos de la exención de cuota (#457): eximir, con el motivo y la
 * fecha de fin, y confirmar la retirada. Son `<dialog>` modales como el del
 * calendario (#382), y por eso llevan sus clases: el navegador trae el rol,
 * la capa modal y lo que queda detrás inerte.
 *
 * Mientras guardan no se cierran: lo que el servidor responda tiene que verse
 * aquí, y un rechazo se explica dentro, sin perder lo escrito.
 */

type Sending = { readonly isSending: boolean; readonly failure: string | null };

const IDLE: Sending = { isSending: false, failure: null };

/** Manda la petición y, si cambió, avisa a quien abrió el diálogo. Si no, se
 * queda con la explicación. */
function useWaiverRequest(
  translate: Translator,
  onChanged: (change: MembershipWaiverChange) => void,
): {
  readonly sending: Sending;
  readonly send: (request: () => Promise<MembershipWaiverOutcome>) => void;
} {
  const [sending, setSending] = useState<Sending>(IDLE);
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSendingRef = useRef(false);

  function send(request: () => Promise<MembershipWaiverOutcome>): void {
    if (isSendingRef.current) {
      return;
    }
    isSendingRef.current = true;
    setSending({ isSending: true, failure: null });
    void request().then((outcome) => {
      isSendingRef.current = false;
      if (outcome.kind === "changed") {
        setSending(IDLE);
        onChanged(outcome.change);
        return;
      }
      setSending({
        isSending: false,
        failure: describeMembershipWaiverFailure(translate, outcome),
      });
    });
  }

  return { sending, send };
}


function DialogActions({
  translate,
  sending,
  confirmLabel,
  isConfirmDisabled,
  onCancel,
}: {
  readonly translate: Translator;
  readonly sending: Sending;
  readonly confirmLabel: string;
  readonly isConfirmDisabled: boolean;
  readonly onCancel: () => void;
}): React.JSX.Element {
  return (
    <>
      {sending.failure === null ? null : (
        <p className="auth-error" role="alert">
          {sending.failure}
        </p>
      )}
      <div className="event-form-actions">
        <button
          type="button"
          className="admin-secondary"
          disabled={sending.isSending}
          onClick={onCancel}
        >
          {translate("membershipWaiver.cancel")}
        </button>
        <button
          type="submit"
          className="auth-submit"
          disabled={sending.isSending || isConfirmDisabled}
        >
          {sending.isSending
            ? translate("membershipWaiver.saving")
            : confirmLabel}
        </button>
      </div>
    </>
  );
}

type DialogProps = {
  readonly translate: Translator;
  readonly userId: string;
  readonly name: string;
  readonly onChanged: (change: MembershipWaiverChange) => void;
  readonly onClosed: () => void;
};

const REASON_ID = "exencion-motivo";
const REASON_HINT_ID = "exencion-motivo-ayuda";
const UNTIL_ID = "exencion-fin";
const UNTIL_HINT_ID = "exencion-fin-ayuda";

function WaiverFields({
  translate,
  reason,
  until,
  onReasonChange,
  onUntilChange,
}: {
  readonly translate: Translator;
  readonly reason: string;
  readonly until: string;
  readonly onReasonChange: (value: string) => void;
  readonly onUntilChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <>
      <div className="auth-field">
        <label htmlFor={REASON_ID}>
          {translate("membershipWaiver.field.reason")}
        </label>
        <textarea
          id={REASON_ID}
          rows={3}
          required
          maxLength={WAIVER_REASON_MAX_LENGTH}
          value={reason}
          aria-describedby={REASON_HINT_ID}
          onChange={(event) => onReasonChange(event.target.value)}
        />
        <p className="auth-hint" id={REASON_HINT_ID}>
          {translate("membershipWaiver.field.reasonHint")}
        </p>
      </div>
      <div className="auth-field">
        <label htmlFor={UNTIL_ID}>
          {translate("membershipWaiver.field.until")}
        </label>
        <input
          id={UNTIL_ID}
          type="date"
          value={until}
          aria-describedby={UNTIL_HINT_ID}
          onChange={(event) => onUntilChange(event.target.value)}
        />
        <p className="auth-hint" id={UNTIL_HINT_ID}>
          {translate("membershipWaiver.field.untilHint")}
        </p>
      </div>
    </>
  );
}

export function WaiveDialog({
  translate,
  userId,
  name,
  onChanged,
  onClosed,
}: DialogProps): React.JSX.Element {
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const { sending, send } = useWaiverRequest(translate, onChanged);

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    send(() =>
      submitMembershipWaiver(userId, {
        reason,
        until: until === "" ? null : until,
      }),
    );
  }

  return (
    <ModalDialog
      title={translate("membershipWaiver.dialog.waiveTitle", { name })}
      isSending={sending.isSending}
      onClosed={onClosed}
    >
      <form className="event-form" onSubmit={submit} noValidate>
        <p className="app-lead">
          {translate("membershipWaiver.dialog.waiveLead")}
        </p>
        <WaiverFields
          translate={translate}
          reason={reason}
          until={until}
          onReasonChange={setReason}
          onUntilChange={setUntil}
        />
        <DialogActions
          translate={translate}
          sending={sending}
          confirmLabel={translate("membershipWaiver.confirmWaive")}
          isConfirmDisabled={reason.trim() === ""}
          onCancel={onClosed}
        />
      </form>
    </ModalDialog>
  );
}

export function RemoveWaiverDialog({
  translate,
  userId,
  name,
  onChanged,
  onClosed,
}: DialogProps): React.JSX.Element {
  const { sending, send } = useWaiverRequest(translate, onChanged);

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    send(() => removeMembershipWaiver(userId));
  }

  return (
    <ModalDialog
      title={translate("membershipWaiver.dialog.removeTitle", { name })}
      isSending={sending.isSending}
      onClosed={onClosed}
    >
      <form className="event-form" onSubmit={submit}>
        <p className="app-lead">
          {translate("membershipWaiver.dialog.removeLead")}
        </p>
        <DialogActions
          translate={translate}
          sending={sending}
          confirmLabel={translate("membershipWaiver.confirmRemove")}
          isConfirmDisabled={false}
          onCancel={onClosed}
        />
      </form>
    </ModalDialog>
  );
}
