"use client";

import { useRef, useState } from "react";
import type { RequestFailure } from "@/components/auth/request-failure";
import {
  JUSTIFICATION_MAX_LENGTH,
  type RequestableRole,
  type RoleRequest,
  countJustificationCharacters,
  isJustificationTooLong,
} from "@/lib/auth/role-request";
import type { Translator } from "@/lib/i18n/translator";
import {
  describeRoleRequestFailure,
  submitRoleRequest,
} from "./role-request-client";

/**
 * El formulario para pedir Coach o Committee (FR-010). Ofrece sólo los roles
 * que el dominio deja pedir a quien lo abre, avisa del largo de la
 * justificación mientras se escribe, y manda una sola petición aunque se pulse
 * dos veces: quien decide al final es el servidor, y la base no admite dos
 * pendientes.
 */

type Status =
  | { readonly kind: "editing" }
  | { readonly kind: "sending" }
  | {
      readonly kind: "failed";
      readonly failure: RequestFailure;
      readonly reason: string | null;
    };

const ROLE_ERROR_ID = "rol-pedido-error";
const JUSTIFICATION_ID = "rol-justificacion";
const JUSTIFICATION_HINT_ID = "rol-justificacion-cuenta";
const JUSTIFICATION_ERROR_ID = "rol-justificacion-error";

function FormAlert({
  translate,
  status,
  isRoleMissing,
}: {
  translate: Translator;
  status: Status;
  isRoleMissing: boolean;
}): React.JSX.Element | null {
  if (status.kind === "failed") {
    return (
      <p className="auth-error" role="alert">
        {describeRoleRequestFailure(
          translate,
          status.failure,
          status.reason,
          JUSTIFICATION_MAX_LENGTH,
        )}
      </p>
    );
  }
  return isRoleMissing ? (
    <p className="auth-error" role="alert" id={ROLE_ERROR_ID}>
      {translate("account.request.roleMissing")}
    </p>
  ) : null;
}

function RoleOptions({
  translate,
  roles,
  selected,
  isRoleMissing,
  onSelect,
}: {
  translate: Translator;
  roles: readonly RequestableRole[];
  selected: RequestableRole | null;
  isRoleMissing: boolean;
  onSelect: (role: RequestableRole) => void;
}): React.JSX.Element {
  return (
    <fieldset
      className="account-role-options"
      aria-describedby={isRoleMissing ? ROLE_ERROR_ID : undefined}
    >
      <legend>{translate("account.request.roleLegend")}</legend>
      {roles.map((role) => (
        <div className="account-role-option" key={role}>
          <input
            id={`rol-pedido-${role}`}
            type="radio"
            name="requestedRole"
            value={role}
            checked={selected === role}
            onChange={() => onSelect(role)}
          />
          <label htmlFor={`rol-pedido-${role}`}>
            {translate(`role.${role}`)}
          </label>
        </div>
      ))}
    </fieldset>
  );
}

function JustificationField({
  translate,
  value,
  onChange,
}: {
  translate: Translator;
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const isTooLong = isJustificationTooLong(value);
  return (
    <div className="auth-field">
      <label htmlFor={JUSTIFICATION_ID}>
        {translate("account.request.justification")}
      </label>
      <textarea
        id={JUSTIFICATION_ID}
        name="justification"
        rows={4}
        value={value}
        aria-invalid={isTooLong}
        aria-describedby={
          isTooLong
            ? `${JUSTIFICATION_HINT_ID} ${JUSTIFICATION_ERROR_ID}`
            : JUSTIFICATION_HINT_ID
        }
        onChange={(event) => onChange(event.target.value)}
      />
      <p
        className="auth-hint account-character-count"
        id={JUSTIFICATION_HINT_ID}
      >
        {translate("account.request.characterCount", {
          used: countJustificationCharacters(value),
          max: JUSTIFICATION_MAX_LENGTH,
        })}
      </p>
      {isTooLong ? (
        <p
          className="auth-field-error"
          id={JUSTIFICATION_ERROR_ID}
          role="alert"
        >
          {translate("account.request.justificationTooLong", {
            max: JUSTIFICATION_MAX_LENGTH,
          })}
        </p>
      ) : null}
    </div>
  );
}

export function RoleRequestForm({
  translate,
  roles,
  onCreated,
}: {
  translate: Translator;
  roles: readonly RequestableRole[];
  onCreated: (request: RoleRequest) => void;
}): React.JSX.Element {
  // Con un solo rol posible no hay nada que elegir.
  const [requestedRole, setRequestedRole] = useState<RequestableRole | null>(
    roles.length === 1 ? (roles[0] ?? null) : null,
  );
  const [justification, setJustification] = useState("");
  const [isRoleMissing, setIsRoleMissing] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "editing" });
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSendingRef = useRef(false);

  function selectRole(role: RequestableRole): void {
    setRequestedRole(role);
    setIsRoleMissing(false);
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (isSendingRef.current || isJustificationTooLong(justification)) {
      return;
    }
    if (requestedRole === null) {
      setIsRoleMissing(true);
      return;
    }

    isSendingRef.current = true;
    setStatus({ kind: "sending" });
    const result = await submitRoleRequest({ requestedRole, justification });
    isSendingRef.current = false;
    if (result.kind === "failed") {
      setStatus(result);
      return;
    }
    onCreated(result.request);
  }

  const isSending = status.kind === "sending";
  return (
    <section className="auth-pending" aria-labelledby="pedir-rol">
      <h2 id="pedir-rol">{translate("account.request.title")}</h2>
      <p>{translate("account.request.body")}</p>

      <form className="auth-fields" onSubmit={handleSubmit} noValidate>
        <FormAlert
          translate={translate}
          status={status}
          isRoleMissing={isRoleMissing}
        />
        <RoleOptions
          translate={translate}
          roles={roles}
          selected={requestedRole}
          isRoleMissing={isRoleMissing}
          onSelect={selectRole}
        />
        <JustificationField
          translate={translate}
          value={justification}
          onChange={setJustification}
        />
        <button type="submit" className="auth-submit" disabled={isSending}>
          {translate(
            isSending ? "account.request.sending" : "account.request.submit",
          )}
        </button>
      </form>
    </section>
  );
}
