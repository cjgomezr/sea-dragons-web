"use client";

import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { ROLES, type Role } from "@/lib/auth/roles";
import type { Translator } from "@/lib/i18n/translator";
import type { RoleEditableMember } from "./MemberRoleControl";
import { requestRoleChange } from "./use-member-role-change";

/**
 * El rol en la ficha rápida del panel lateral (#550, RF-5 del PRD de E21):
 * un control segmentado con los cuatro roles. Elegir uno no guarda nada: sale
 * una franja "{de} → {a}" con Cancelar y Guardar rol, y sólo al confirmar va
 * la petición, por el mismo endpoint y con la misma bitácora que la ficha
 * completa (#240).
 *
 * El rol de la ficha y el de la fila son el que el servidor confirmó. Lo que
 * rechaza por una regla (el último Admin, sin permiso) devuelve el control a
 * ese rol, con el error en la franja; un tropiezo de red deja el elegido,
 * para que reintentar sea un clic.
 */

type RoleChangeState =
  | { readonly kind: "idle" }
  | { readonly kind: "saved" }
  | {
      readonly kind: "draft";
      readonly role: Role;
      /** El error del intento anterior, si lo hubo. */
      readonly error: string | null;
    }
  | { readonly kind: "saving"; readonly role: Role }
  | { readonly kind: "refused"; readonly error: string };

function shownRoleOf(state: RoleChangeState, actualRole: Role): Role {
  return state.kind === "draft" || state.kind === "saving"
    ? state.role
    : actualRole;
}

function useConfirmedRoleChange(
  translate: Translator,
  member: RoleEditableMember,
  onRoleChanged: (userId: string, role: Role) => void,
): {
  readonly state: RoleChangeState;
  readonly choose: (role: Role) => void;
  readonly cancel: () => void;
  readonly save: () => void;
} {
  const [state, setState] = useState<RoleChangeState>({ kind: "idle" });
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSavingRef = useRef(false);

  function choose(role: Role): void {
    setState(
      role === member.role
        ? { kind: "idle" }
        : { kind: "draft", role, error: null },
    );
  }

  async function saveDraft(role: Role): Promise<void> {
    if (isSavingRef.current) {
      return;
    }
    isSavingRef.current = true;
    setState({ kind: "saving", role });
    const result = await requestRoleChange(translate, member, role);
    isSavingRef.current = false;
    if (result.kind === "changed") {
      onRoleChanged(member.userId, result.role);
      setState({ kind: "saved" });
      return;
    }
    setState(
      result.isRefused
        ? { kind: "refused", error: result.message }
        : { kind: "draft", role, error: result.message },
    );
  }

  return {
    state,
    choose,
    cancel: () => setState({ kind: "idle" }),
    save: () => {
      if (state.kind === "draft" || state.kind === "saving") {
        void saveDraft(state.role);
      }
    },
  };
}

function RoleSegments({
  translate,
  shownRole,
  isLocked,
  onChoose,
}: {
  translate: Translator;
  shownRole: Role;
  isLocked: boolean;
  onChoose: (role: Role) => void;
}): React.JSX.Element {
  return (
    <fieldset className="directory-roles directory-card-section">
      <legend className="directory-card-label">
        {translate("directory.card.role")}
      </legend>
      <div className="directory-role-options directory-card-roles">
        {ROLES.map((role) => (
          <label key={role} className="directory-role">
            <input
              type="radio"
              name="directory-card-role"
              checked={shownRole === role}
              disabled={isLocked}
              onChange={() => onChoose(role)}
            />
            <span>{translate(`role.${role}`)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ConfirmStrip({
  translate,
  from,
  to,
  isSaving,
  error,
  onCancel,
  onSave,
}: {
  translate: Translator;
  from: Role;
  to: Role;
  isSaving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: () => void;
}): React.JSX.Element {
  return (
    <div className="directory-confirm">
      <div className="directory-confirm-row">
        <p className="directory-confirm-text">
          {translate("directory.card.roleChange", {
            from: translate(`role.${from}`),
            to: translate(`role.${to}`),
          })}
        </p>
        <button
          type="button"
          className="directory-link-button"
          disabled={isSaving}
          onClick={onCancel}
        >
          {translate("directory.card.cancel")}
        </button>
        <button
          type="button"
          className="auth-submit directory-confirm-save"
          disabled={isSaving}
          onClick={onSave}
        >
          {translate(
            isSaving ? "directory.card.savingRole" : "directory.card.saveRole",
          )}
        </button>
      </div>
      {error === null ? null : (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Lo que va bajo el control: la franja, el error de un rechazo, o el
 * "Rol guardado" de un cambio que el servidor confirmó. */
function RoleOutcome({
  translate,
  member,
  state,
  onCancel,
  onSave,
}: {
  translate: Translator;
  member: RoleEditableMember;
  state: RoleChangeState;
  onCancel: () => void;
  onSave: () => void;
}): React.JSX.Element | null {
  switch (state.kind) {
    case "idle":
      return null;
    case "saved":
      return (
        <p className="directory-card-saved" role="status">
          <Icon glyph={Check} />
          {translate("directory.card.roleSaved")}
        </p>
      );
    case "refused":
      return (
        <div className="directory-confirm">
          <p className="auth-error" role="alert">
            {state.error}
          </p>
        </div>
      );
    case "draft":
    case "saving":
      return (
        <ConfirmStrip
          translate={translate}
          from={member.role}
          to={state.role}
          isSaving={state.kind === "saving"}
          error={state.kind === "draft" ? state.error : null}
          onCancel={onCancel}
          onSave={onSave}
        />
      );
  }
}

export function QuickCardRole({
  translate,
  member,
  onRoleChanged,
}: {
  translate: Translator;
  member: RoleEditableMember;
  onRoleChanged: (userId: string, role: Role) => void;
}): React.JSX.Element {
  const roleChange = useConfirmedRoleChange(translate, member, onRoleChanged);
  return (
    <div className="directory-card-role">
      <RoleSegments
        translate={translate}
        shownRole={shownRoleOf(roleChange.state, member.role)}
        isLocked={roleChange.state.kind === "saving"}
        onChoose={roleChange.choose}
      />
      <RoleOutcome
        translate={translate}
        member={member}
        state={roleChange.state}
        onCancel={roleChange.cancel}
        onSave={roleChange.save}
      />
    </div>
  );
}
