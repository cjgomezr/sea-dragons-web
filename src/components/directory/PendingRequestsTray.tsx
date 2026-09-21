"use client";

import { useId, useRef, useState } from "react";
import type { PendingRoleRequest } from "@/lib/auth/club-administration";
import type { RoleRequestDecision } from "@/lib/auth/role-request-decision";
import { formatClubMoment } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import {
  AdministrationNotice,
  type AdministrationNoticeState,
} from "./AdministrationNotice";

/**
 * La bandeja de solicitudes pendientes del club (RF-8 del PRD de E3), que
 * desde #240 vive en el directorio y sólo se dibuja para un Admin.
 *
 * Pinta sólo lo que va debajo del título: la sección, con su título y su
 * estado de carga, la pone `RoleRequestsPanel`.
 *
 * Quién decide de verdad es el servidor: aquí sólo se manda la decisión y se
 * espera. Mientras una está en vuelo, ninguna otra sale, así que un doble clic
 * no puede mandar dos.
 */

function RequestActions({
  translate,
  request,
  isBusy,
  onDecide,
}: {
  translate: Translator;
  request: PendingRoleRequest;
  isBusy: boolean;
  onDecide: (decision: RoleRequestDecision) => void;
}): React.JSX.Element {
  return (
    <div className="admin-request-actions">
      <button
        type="button"
        className="auth-submit"
        aria-label={translate("admin.requests.approveLabel", {
          name: request.fullName,
        })}
        disabled={isBusy}
        onClick={() => onDecide("approved")}
      >
        {translate("admin.requests.approve")}
      </button>
      <button
        type="button"
        className="admin-secondary"
        aria-label={translate("admin.requests.rejectLabel", {
          name: request.fullName,
        })}
        disabled={isBusy}
        onClick={() => onDecide("rejected")}
      >
        {translate("admin.requests.reject")}
      </button>
    </div>
  );
}

function RequestItem({
  translate,
  request,
  isBusy,
  onDecide,
}: {
  translate: Translator;
  request: PendingRoleRequest;
  isBusy: boolean;
  onDecide: (decision: RoleRequestDecision) => void;
}): React.JSX.Element {
  // Nombra la entrada de la lista, para que quien la recorre con un lector de
  // pantalla sepa de quién son los dos botones que vienen después.
  const summaryId = useId();
  return (
    <li className="admin-request" aria-labelledby={summaryId}>
      <h3 id={summaryId} className="admin-request-summary">
        {translate("admin.requests.asked", {
          name: request.fullName,
          role: translate(`role.${request.requestedRole}`),
        })}
      </h3>
      <p className="admin-request-date">
        {translate("admin.requests.askedOn", {
          date: formatClubMoment(translate.locale, new Date(request.createdAt)),
        })}
      </p>
      <p className="admin-request-note">
        {request.justification ?? translate("admin.requests.noJustification")}
      </p>
      <RequestActions
        translate={translate}
        request={request}
        isBusy={isBusy}
        onDecide={onDecide}
      />
    </li>
  );
}

export function PendingRequestsTray({
  translate,
  requests,
  notice,
  onDecide,
}: {
  translate: Translator;
  requests: readonly PendingRoleRequest[];
  notice: AdministrationNoticeState;
  onDecide: (
    request: PendingRoleRequest,
    decision: RoleRequestDecision,
  ) => Promise<void>;
}): React.JSX.Element {
  const [isDeciding, setIsDeciding] = useState(false);
  // El estado desactiva los botones en el siguiente pintado, pero un doble
  // clic llega antes. La referencia cambia en el acto.
  const isDecidingRef = useRef(false);

  async function decide(
    request: PendingRoleRequest,
    decision: RoleRequestDecision,
  ): Promise<void> {
    if (isDecidingRef.current) {
      return;
    }
    isDecidingRef.current = true;
    setIsDeciding(true);
    await onDecide(request, decision);
    isDecidingRef.current = false;
    setIsDeciding(false);
  }

  return (
    <>
      <AdministrationNotice notice={notice} />
      {requests.length === 0 ? (
        <p className="admin-empty">{translate("admin.requests.empty")}</p>
      ) : (
        <ul className="admin-requests">
          {requests.map((request) => (
            <RequestItem
              key={request.id}
              translate={translate}
              request={request}
              isBusy={isDeciding}
              onDecide={(decision) => void decide(request, decision)}
            />
          ))}
        </ul>
      )}
    </>
  );
}
