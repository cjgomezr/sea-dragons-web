"use client";

import { UserMinus } from "@phosphor-icons/react/dist/ssr/UserMinus";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Translator } from "@/lib/i18n/translator";
import type { RequestableMemberStatus } from "@/lib/members/member-status-change";
import {
  type MemberStatusFailure,
  describeMemberStatusFailure,
  submitMemberStatus,
} from "./member-status-client";

/**
 * La baja y la reactivación de un miembro desde su ficha (#244, RF-6 del PRD
 * de E5). Desde #775 se piden en el ⋯ de la cabecera: la baja se confirma en
 * una franja en peligro, y la reactivación sale al elegirla, como antes. El
 * control de un solo botón que vivía aquí se partió en tres piezas: el hook
 * que pide el cambio, el aviso de cómo fue y la franja de confirmar.
 *
 * El estado que enseña es el que la ficha tiene de verdad: sólo cambia cuando
 * el servidor confirma, y un rechazo (el último Admin, la baja propia) deja
 * la ficha como estaba, con la explicación.
 */

export type MemberStatusState =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "changed"; readonly status: AccountStatus }
  | MemberStatusFailure;

const DEACTIVATED_STATUS = "inactive" satisfies RequestableMemberStatus;

/** Quien está de baja vuelve; los demás se van. */
function requestedStatusFor(
  currentStatus: AccountStatus,
): RequestableMemberStatus {
  return currentStatus === DEACTIVATED_STATUS ? "active" : DEACTIVATED_STATUS;
}

export type MemberStatusChange = {
  readonly state: MemberStatusState;
  /** Pide lo contrario de lo que el socio es, y avisa a la ficha si cambió. */
  readonly changeStatus: () => Promise<void>;
  /** Olvida cómo fue el último cambio: al volver a elegir la baja, la franja
   * sale de nuevo. */
  readonly reset: () => void;
};

export function useMemberStatusChange({
  member,
  onStatusChanged,
}: {
  member: {
    readonly userId: string;
    readonly accountStatus: AccountStatus;
  };
  /** La ficha guarda el estado nuevo: es ella quien decide qué más cambia
   * (la invitación pendiente, por ejemplo). */
  onStatusChanged: (status: AccountStatus) => void;
}): MemberStatusChange {
  const [state, setState] = useState<MemberStatusState>({ kind: "idle" });
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSavingRef = useRef(false);

  async function changeStatus(): Promise<void> {
    if (isSavingRef.current) {
      return;
    }
    isSavingRef.current = true;
    setState({ kind: "saving" });
    const outcome = await submitMemberStatus(
      member.userId,
      requestedStatusFor(member.accountStatus),
    );
    isSavingRef.current = false;
    setState(outcome);
    if (outcome.kind === "changed") {
      onStatusChanged(outcome.status);
    }
  }

  return {
    state,
    changeStatus,
    reset: () => setState({ kind: "idle" }),
  };
}

/** Lo que pasó al pedir el cambio, o nada mientras no ha terminado. */
export function MemberStatusOutcome({
  translate,
  state,
  name,
}: {
  translate: Translator;
  state: MemberStatusState;
  name: string;
}): React.JSX.Element | null {
  if (state.kind === "changed") {
    return (
      <p className="auth-note" role="status">
        {translate(
          state.status === DEACTIVATED_STATUS
            ? "memberStatus.deactivated"
            : "memberStatus.reactivated",
          { name },
        )}
      </p>
    );
  }
  if (state.kind === "failed") {
    return (
      <p className="auth-error" role="alert">
        {describeMemberStatusFailure(translate, state)}
      </p>
    );
  }
  return null;
}

/** La franja en peligro que confirma la baja (#775), bajo la cabecera. */
export function DeactivationConfirmation({
  translate,
  name,
  isSaving,
  onCancel,
  onConfirm,
}: {
  translate: Translator;
  name: string;
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  return (
    <div className="profile-strip profile-strip-danger">
      <span className="profile-strip-icon">
        <Icon glyph={UserMinus} />
      </span>
      <p className="profile-strip-text">
        {translate("memberRecord.deactivation.prompt", { name })}
      </p>
      <div className="profile-strip-actions">
        <button
          type="button"
          className="profile-strip-button profile-strip-cancel"
          disabled={isSaving}
          onClick={onCancel}
        >
          {translate("memberRecord.deactivation.cancel")}
        </button>
        <button
          type="button"
          className="profile-strip-button profile-strip-danger-button"
          disabled={isSaving}
          onClick={onConfirm}
        >
          {translate(
            isSaving
              ? "memberStatus.saving"
              : "memberRecord.deactivation.confirm",
          )}
        </button>
      </div>
    </div>
  );
}
