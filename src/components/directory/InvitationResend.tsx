"use client";

import { useState } from "react";
import type { Translator } from "@/lib/i18n/translator";
import {
  type InvitationResend as InvitationResendResult,
  describeNewMemberFailure,
  resendMemberInvitation,
} from "./new-member-client";

/**
 * El reenvío de la invitación de un miembro que todavía no activó su cuenta
 * (#243, FR-021): el botón y lo que respondió el servidor. Lo usan el aviso
 * del alta, cuando la invitación no salió, y la ficha del miembro, porque el
 * enlace caduca y el correo le pide al miembro que lo pida al club.
 */

type ResendState =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  | InvitationResendResult;

function ResendOutcome({
  translate,
  state,
  sentText,
}: {
  translate: Translator;
  state: ResendState;
  sentText: string;
}): React.JSX.Element | null {
  if (state.kind === "sent") {
    return (
      <p className="auth-note" role="status">
        {sentText}
      </p>
    );
  }
  if (state.kind === "failed") {
    return (
      <p className="auth-error" role="alert">
        {describeNewMemberFailure(translate, state)}
      </p>
    );
  }
  return null;
}

export function InvitationResend({
  translate,
  userId,
  isPrimary,
  sentText,
}: {
  translate: Translator;
  userId: string;
  /** En la ficha la acción principal es guardar, así que allí va como
   * secundaria: una pantalla tiene una sola acción principal. */
  isPrimary: boolean;
  /** Lo que se dice cuando salió, que cada pantalla escribe a su manera. */
  sentText: string;
}): React.JSX.Element {
  const [state, setState] = useState<ResendState>({ kind: "idle" });
  const isSending = state.kind === "sending";

  async function resend(): Promise<void> {
    setState({ kind: "sending" });
    setState(await resendMemberInvitation(userId));
  }

  return (
    <div className="invitation-resend">
      <ResendOutcome translate={translate} state={state} sentText={sentText} />
      {state.kind === "sent" ? null : (
        <button
          type="button"
          className={isPrimary ? "auth-submit" : "admin-secondary"}
          disabled={isSending}
          onClick={() => void resend()}
        >
          {translate(isSending ? "newMember.resending" : "newMember.resend")}
        </button>
      )}
    </div>
  );
}
