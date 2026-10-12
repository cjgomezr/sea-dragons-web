"use client";

import type { PendingRoleRequest } from "@/lib/auth/club-administration";
import type { RoleRequestDecision } from "@/lib/auth/role-request-decision";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Aprobar y Rechazar una solicitud de rol: los dos botones que comparten la
 * tarjeta del resumen del club (#551) y el recuadro de la ficha rápida.
 *
 * Quién decide de verdad es el servidor: aquí sólo se manda la decisión. Que
 * no salgan dos a la vez lo cuida quien los pinta, con `useSingleDecision`.
 */
export function RequestActions({
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
