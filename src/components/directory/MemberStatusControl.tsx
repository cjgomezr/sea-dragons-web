"use client";

import { useRef, useState } from "react";
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
 * de E5). Un solo botón que dice lo contrario de lo que el miembro es: a quien
 * está de baja se le ofrece volver, a los demás irse.
 *
 * El estado que enseña es el que la ficha tiene de verdad: sólo cambia cuando
 * el servidor confirma, y un rechazo (el último Admin, la baja propia) deja el
 * botón como estaba, con la explicación al lado.
 */

type ControlState =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "changed"; readonly status: AccountStatus }
  | MemberStatusFailure;

const DEACTIVATED_STATUS = "inactive" satisfies RequestableMemberStatus;

function requestedStatusFor(
  currentStatus: AccountStatus,
): RequestableMemberStatus {
  return currentStatus === DEACTIVATED_STATUS ? "active" : DEACTIVATED_STATUS;
}

function Outcome({
  translate,
  state,
  name,
}: {
  translate: Translator;
  state: ControlState;
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

export function MemberStatusControl({
  translate,
  member,
  onStatusChanged,
}: {
  translate: Translator;
  member: {
    readonly userId: string;
    readonly fullName: string;
    readonly accountStatus: AccountStatus;
  };
  /** La ficha guarda el estado nuevo: es ella quien decide qué más cambia
   * (la invitación pendiente, por ejemplo). */
  onStatusChanged: (status: AccountStatus) => void;
}): React.JSX.Element {
  const [state, setState] = useState<ControlState>({ kind: "idle" });
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSavingRef = useRef(false);
  const isDeactivated = member.accountStatus === DEACTIVATED_STATUS;
  const isSaving = state.kind === "saving";

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

  return (
    <section className="admin-section" aria-labelledby="ficha-membresia">
      <h2 id="ficha-membresia">{translate("memberStatus.title")}</h2>
      <p className="app-lead">
        {translate(
          isDeactivated
            ? "memberStatus.lead.inactive"
            : "memberStatus.lead.active",
          { name: member.fullName },
        )}
      </p>
      <Outcome translate={translate} state={state} name={member.fullName} />
      <div>
        <button
          type="button"
          className="admin-secondary"
          disabled={isSaving}
          onClick={() => void changeStatus()}
        >
          {translate(
            isSaving
              ? "memberStatus.saving"
              : isDeactivated
                ? "memberStatus.reactivate"
                : "memberStatus.deactivate",
          )}
        </button>
      </div>
    </section>
  );
}
